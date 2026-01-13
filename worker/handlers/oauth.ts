/**
 * OAuth handlers for GitHub
 * (Google now uses service account - see worker/google/serviceAuth.ts)
 */

import {
  getOAuthUrl as getGitHubOAuthUrl,
  exchangeCodeForToken as exchangeGitHubCode,
  getUser as getGitHubUser,
  generateState,
} from '../github/oauth';
import { getAccountByCredentialType, getMCPTools, getMCPDefinition } from '../mcp/AccountMCPRegistry';
import { encodeOAuthState, decodeOAuthState } from '../utils/oauth-state';
import { jsonResponse } from '../utils/response';
import { CREDENTIAL_TYPES } from '../constants';
import type { BoardDO } from '../BoardDO';

type BoardDOStub = DurableObjectStub<BoardDO>;

// ============================================
// PROVIDER CONFIGS
// ============================================

interface OAuthProvider {
  name: 'github';
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
    const state = await decodeOAuthState(stateParam, env.ENCRYPTION_KEY);
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

function redirectWithError(origin: string, error: string): Response {
  const errorUrl = new URL(origin);
  errorUrl.searchParams.set('github_error', error);
  return new Response(null, {
    status: 302,
    headers: { Location: errorUrl.toString() },
  });
}
