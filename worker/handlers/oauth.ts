/**
 * OAuth handlers for GitHub and Google
 * Supports both project-level and global (user-level) OAuth
 */

import {
  getOAuthUrl as getGitHubOAuthUrl,
  exchangeCodeForToken as exchangeGitHubCode,
  getUser as getGitHubUser,
  generateState,
} from '../github/oauth';
import {
  getOAuthUrl as getGoogleOAuthUrl,
  exchangeCodeForToken as exchangeGoogleCode,
  getUserInfo as getGoogleUser,
} from '../google/oauth';
import { getAccountByCredentialType, getMCPTools, getMCPDefinition } from '../mcp/AccountMCPRegistry';
import { encodeOAuthState, decodeOAuthState } from '../utils/oauth-state';
import { jsonResponse } from '../utils/response';
import { CREDENTIAL_TYPES } from '../constants';
import type { BoardDO } from '../BoardDO';

type BoardDOStub = DurableObjectStub<BoardDO>;

// Extended state to support global OAuth
interface OAuthState {
  boardId: string;
  nonce: string;
  global?: boolean;
  userId?: string;
}

// ============================================
// PROVIDER CONFIGS
// ============================================

interface OAuthProvider {
  name: 'github' | 'google';
  credentialType: string;
  getClientId: (env: Env) => string | undefined;
  getClientSecret: (env: Env) => string | undefined;
  getOAuthUrl: (clientId: string, redirectUri: string, state: string) => string;
  exchangeCode: (code: string, clientId: string, clientSecret: string, redirectUri: string) => Promise<OAuthTokenData>;
  getUser: (token: string) => Promise<OAuthUserData>;
  buildCredential: (user: OAuthUserData, tokenData: OAuthTokenData) => {
    name: string;
    metadata: Record<string, unknown>;
  };
  callbackPath: string;
}

interface OAuthTokenData {
  access_token: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface OAuthUserData {
  id: string | number;
  login?: string;
  email?: string;
  name?: string | null;
  picture?: string;
}

const githubProvider: OAuthProvider = {
  name: 'github',
  credentialType: CREDENTIAL_TYPES.GITHUB_OAUTH,
  getClientId: (env) => env.GITHUB_CLIENT_ID,
  getClientSecret: (env) => env.GITHUB_CLIENT_SECRET,
  getOAuthUrl: getGitHubOAuthUrl,
  exchangeCode: exchangeGitHubCode,
  getUser: getGitHubUser,
  buildCredential: (user, tokenData) => ({
    name: `GitHub: ${user.login}`,
    metadata: {
      login: user.login,
      userId: user.id,
      scope: tokenData.scope,
    },
  }),
  callbackPath: '/github/callback',
};

const googleProvider: OAuthProvider = {
  name: 'google',
  credentialType: CREDENTIAL_TYPES.GOOGLE_OAUTH,
  getClientId: (env) => env.GOOGLE_CLIENT_ID,
  getClientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
  getOAuthUrl: getGoogleOAuthUrl,
  exchangeCode: exchangeGoogleCode,
  getUser: getGoogleUser,
  buildCredential: (user, tokenData) => ({
    name: `Google: ${user.email}`,
    metadata: {
      email: user.email,
      userId: user.id,
      name: user.name,
      picture: user.picture,
      scope: tokenData.scope,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
    },
  }),
  callbackPath: '/google/callback',
};

// ============================================
// GENERIC OAUTH HANDLERS
// ============================================

async function handleOAuthUrl(
  request: Request,
  env: Env,
  url: URL,
  provider: OAuthProvider
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ success: false, error: { code: '405', message: 'Method not allowed' } }, 405);
  }

  const clientId = provider.getClientId(env);
  if (!clientId) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: `${provider.name} OAuth not configured` },
    }, 500);
  }

  // Support both projectId (new) and boardId (legacy)
  const projectId = url.searchParams.get('projectId') || url.searchParams.get('boardId');
  if (!projectId) {
    return jsonResponse({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'projectId is required' },
    }, 400);
  }

  const redirectUri = `${url.origin}${provider.callbackPath}`;
  const signedState = await encodeOAuthState(
    { boardId: projectId, nonce: generateState() },
    env.ENCRYPTION_KEY
  );

  const authUrl = provider.getOAuthUrl(clientId, redirectUri, signedState);

  return jsonResponse({
    success: true,
    data: { url: authUrl },
  });
}

async function handleOAuthExchange(
  env: Env,
  url: URL,
  provider: OAuthProvider
): Promise<Response> {
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (!code || !stateParam) {
    return jsonResponse({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Missing code or state parameter' },
    }, 400);
  }

  const clientId = provider.getClientId(env);
  const clientSecret = provider.getClientSecret(env);

  if (!clientId || !clientSecret) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: `${provider.name} OAuth not configured` },
    }, 500);
  }

  try {
    const state = await decodeOAuthState(stateParam, env.ENCRYPTION_KEY) as OAuthState | null;
    if (!state) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Invalid or expired state parameter' },
      }, 400);
    }

    const { boardId: projectId } = state;
    const redirectUri = `${url.origin}${provider.callbackPath}`;

    const tokenData = await provider.exchangeCode(code, clientId, clientSecret, redirectUri);
    const user = await provider.getUser(tokenData.access_token);

    // Store credential and create MCP servers
    await storeCredentialAndCreateMCPs(env, projectId, provider, user, tokenData);

    // Return different data for global vs project-level OAuth
    if (state.global) {
      return jsonResponse({
        success: true,
        data: { global: true },
      });
    }

    return jsonResponse({
      success: true,
      data: { projectId },
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: {
        code: 'OAUTH_FAILED',
        message: error instanceof Error ? error.message : 'OAuth failed',
      },
    }, 500);
  }
}

async function storeCredentialAndCreateMCPs(
  env: Env,
  projectId: string,
  provider: OAuthProvider,
  user: OAuthUserData,
  tokenData: OAuthTokenData
): Promise<void> {
  const doId = env.BOARD_DO.idFromName(projectId);
  const stub = env.BOARD_DO.get(doId) as BoardDOStub;

  const credentialData = provider.buildCredential(user, tokenData);
  const credential = await stub.createCredential(projectId, {
    type: provider.credentialType,
    name: credentialData.name,
    value: tokenData.access_token,
    metadata: credentialData.metadata,
  });

  if (!credential.id) return;

  // Create MCP servers based on the account registry
  const account = getAccountByCredentialType(provider.credentialType);
  if (account) {
    // Use registry-based MCP creation (Google style - multiple MCPs per account)
    for (const mcpDef of account.mcps) {
      const mcpServer = await stub.createMCPServer(projectId, {
        name: mcpDef.name,
        type: 'hosted',
        authType: 'oauth',
        credentialId: credential.id,
        status: 'connected',
        urlPatterns: mcpDef.urlPatterns,
      });

      if (mcpServer.id) {
        const mcpServerInstance = mcpDef.factory({});
        const tools = mcpServerInstance.getTools();
        await stub.cacheMCPServerTools(mcpServer.id, { tools });
      }
    }
  } else if (provider.name === 'github') {
    // Fallback for GitHub if not in registry
    const githubMcpDef = getMCPDefinition('github', 'github');
    const mcpServer = await stub.createMCPServer(projectId, {
      name: 'GitHub',
      type: 'hosted',
      authType: 'oauth',
      credentialId: credential.id,
      status: 'connected',
      urlPatterns: githubMcpDef?.urlPatterns,
    });

    if (mcpServer.id) {
      const githubTools = getMCPTools('github', 'github');
      await stub.cacheMCPServerTools(mcpServer.id, { tools: githubTools });
    }
  }
}

// ============================================
// EXPORTED HANDLERS
// ============================================

export function handleGitHubOAuthUrl(request: Request, env: Env, url: URL): Promise<Response> {
  return handleOAuthUrl(request, env, url, githubProvider);
}

export function handleGitHubOAuthExchange(_request: Request, env: Env, url: URL): Promise<Response> {
  return handleOAuthExchange(env, url, githubProvider);
}

export async function handleGitHubOAuthCallback(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ success: false, error: { code: '405', message: 'Method not allowed' } }, 405);
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (!code || !stateParam) {
    return redirectWithError(url.origin, 'Missing code or state parameter');
  }

  const clientId = githubProvider.getClientId(env);
  const clientSecret = githubProvider.getClientSecret(env);

  if (!clientId || !clientSecret) {
    return redirectWithError(url.origin, 'GitHub OAuth not configured');
  }

  try {
    const state = await decodeOAuthState(stateParam, env.ENCRYPTION_KEY);
    if (!state) {
      return redirectWithError(url.origin, 'Invalid or expired state parameter');
    }

    const { boardId: projectId } = state;
    const redirectUri = `${url.origin}/api/github/oauth/callback`;

    const tokenData = await githubProvider.exchangeCode(code, clientId, clientSecret, redirectUri);
    const user = await githubProvider.getUser(tokenData.access_token);

    await storeCredentialAndCreateMCPs(env, projectId, githubProvider, user, tokenData);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/project/${projectId}?github=connected`,
      },
    });
  } catch (error) {
    return redirectWithError(
      url.origin,
      error instanceof Error ? error.message : 'OAuth failed'
    );
  }
}

export function handleGoogleOAuthUrl(request: Request, env: Env, url: URL): Promise<Response> {
  return handleOAuthUrl(request, env, url, googleProvider);
}

export function handleGoogleOAuthExchange(_request: Request, env: Env, url: URL): Promise<Response> {
  return handleOAuthExchange(env, url, googleProvider);
}

function redirectWithError(origin: string, error: string, provider: 'github' | 'google' = 'github'): Response {
  // Redirect to /tasks for global flows or root for project flows
  // Using /tasks ensures the error is visible on a valid page
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/tasks?${provider}_error=${encodeURIComponent(error)}` },
  });
}

// ============================================
// GLOBAL OAUTH HANDLERS (User-level credentials)
// ============================================

/**
 * Get OAuth URL for global (user-level) credentials
 * Stores credentials in user's task container so they're available
 * for both projects and standalone tasks
 */
export async function handleGlobalOAuthUrl(
  request: Request,
  env: Env,
  url: URL,
  userId: string
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ success: false, error: { code: '405', message: 'Method not allowed' } }, 405);
  }

  const providerName = url.searchParams.get('provider');
  if (!providerName || !['github', 'google'].includes(providerName)) {
    return jsonResponse({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid provider. Must be "github" or "google"' },
    }, 400);
  }

  const provider = providerName === 'github' ? githubProvider : googleProvider;
  const clientId = provider.getClientId(env);

  if (!clientId) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: `${provider.name} OAuth not configured` },
    }, 500);
  }

  // Use user's task container as the "project" for global credentials
  const userTasksContainerId = `user-tasks-${userId}`;
  // Use the same callback path as project-level OAuth (already registered in Google Console)
  const redirectUri = `${url.origin}${provider.callbackPath}`;

  const signedState = await encodeOAuthState(
    {
      boardId: userTasksContainerId,
      nonce: generateState(),
      global: true,
      userId,
    },
    env.ENCRYPTION_KEY
  );

  const authUrl = provider.getOAuthUrl(clientId, redirectUri, signedState);

  return jsonResponse({
    success: true,
    data: { url: authUrl },
  });
}

/**
 * Handle OAuth callback for global credentials
 * Called by the standard callback handlers when global mode is detected
 */
async function handleGlobalOAuthCallback(
  env: Env,
  url: URL,
  provider: OAuthProvider,
  code: string,
  state: OAuthState
): Promise<Response> {
  const clientId = provider.getClientId(env);
  const clientSecret = provider.getClientSecret(env);

  if (!clientId || !clientSecret) {
    return redirectToSettingsWithError(url.origin, `${provider.name} OAuth not configured`, provider.name);
  }

  try {
    const redirectUri = `${url.origin}${provider.callbackPath}`;
    const tokenData = await provider.exchangeCode(code, clientId, clientSecret, redirectUri);
    const user = await provider.getUser(tokenData.access_token);

    // Store in user's task container
    await storeCredentialAndCreateMCPs(env, state.boardId, provider, user, tokenData);

    // Redirect to tasks page with success param (global settings are accessed from there)
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/tasks?${provider.name}=connected`,
      },
    });
  } catch (error) {
    return redirectToSettingsWithError(
      url.origin,
      error instanceof Error ? error.message : 'OAuth failed',
      provider.name
    );
  }
}

function redirectToSettingsWithError(origin: string, error: string, provider: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/tasks?${provider}_error=${encodeURIComponent(error)}`,
    },
  });
}

/**
 * Updated GitHub callback that handles both project-level and global OAuth
 */
export async function handleGitHubOAuthCallbackV2(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ success: false, error: { code: '405', message: 'Method not allowed' } }, 405);
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (!code || !stateParam) {
    return redirectWithError(url.origin, 'Missing code or state parameter', 'github');
  }

  try {
    const state = await decodeOAuthState(stateParam, env.ENCRYPTION_KEY) as OAuthState | null;
    if (!state) {
      return redirectWithError(url.origin, 'Invalid or expired state parameter', 'github');
    }

    // Check if this is a global OAuth flow
    if (state.global) {
      return handleGlobalOAuthCallback(env, url, githubProvider, code, state);
    }

    // Standard project-level OAuth flow
    const clientId = githubProvider.getClientId(env);
    const clientSecret = githubProvider.getClientSecret(env);

    if (!clientId || !clientSecret) {
      return redirectWithError(url.origin, 'GitHub OAuth not configured', 'github');
    }

    const { boardId: projectId } = state;
    const redirectUri = `${url.origin}/api/github/oauth/callback`;

    const tokenData = await githubProvider.exchangeCode(code, clientId, clientSecret, redirectUri);
    const user = await githubProvider.getUser(tokenData.access_token);

    await storeCredentialAndCreateMCPs(env, projectId, githubProvider, user, tokenData);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/project/${projectId}?github=connected`,
      },
    });
  } catch (error) {
    return redirectWithError(
      url.origin,
      error instanceof Error ? error.message : 'OAuth failed',
      'github'
    );
  }
}

/**
 * Google OAuth callback that handles both project-level and global OAuth
 */
export async function handleGoogleOAuthCallback(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ success: false, error: { code: '405', message: 'Method not allowed' } }, 405);
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (!code || !stateParam) {
    return redirectWithError(url.origin, 'Missing code or state parameter', 'google');
  }

  try {
    const state = await decodeOAuthState(stateParam, env.ENCRYPTION_KEY) as OAuthState | null;

    if (!state) {
      return redirectWithError(url.origin, 'Invalid or expired state parameter', 'google');
    }

    // Check if this is a global OAuth flow
    if (state.global) {
      return handleGlobalOAuthCallback(env, url, googleProvider, code, state);
    }

    // Standard project-level OAuth flow
    const clientId = googleProvider.getClientId(env);
    const clientSecret = googleProvider.getClientSecret(env);

    if (!clientId || !clientSecret) {
      return redirectWithError(url.origin, 'Google OAuth not configured', 'google');
    }

    const { boardId: projectId } = state;
    const redirectUri = `${url.origin}/api/google/oauth/callback`;

    const tokenData = await googleProvider.exchangeCode(code, clientId, clientSecret, redirectUri);
    const user = await googleProvider.getUser(tokenData.access_token);

    await storeCredentialAndCreateMCPs(env, projectId, googleProvider, user, tokenData);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/project/${projectId}?google=connected`,
      },
    });
  } catch (error) {
    return redirectWithError(
      url.origin,
      error instanceof Error ? error.message : 'OAuth failed',
      'google'
    );
  }
}

// ============================================
// GLOBAL CREDENTIAL MANAGEMENT
// ============================================

/**
 * Get all global credentials for a user
 */
export async function handleGetGlobalCredentials(
  env: Env,
  userId: string
): Promise<Response> {
  const userTasksContainerId = `user-tasks-${userId}`;
  const doId = env.BOARD_DO.idFromName(userTasksContainerId);
  const stub = env.BOARD_DO.get(doId) as BoardDOStub;

  const credentials = await stub.getCredentials(userTasksContainerId);
  return jsonResponse({ success: true, data: credentials });
}

/**
 * Delete a global credential
 */
export async function handleDeleteGlobalCredential(
  env: Env,
  userId: string,
  credentialId: string
): Promise<Response> {
  const userTasksContainerId = `user-tasks-${userId}`;
  const doId = env.BOARD_DO.idFromName(userTasksContainerId);
  const stub = env.BOARD_DO.get(doId) as BoardDOStub;

  await stub.deleteCredential(userTasksContainerId, credentialId);
  return jsonResponse({ success: true });
}
