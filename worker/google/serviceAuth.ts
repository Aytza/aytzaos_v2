/**
 * Google Service Account Authentication
 *
 * Uses a service account with domain-wide delegation to access Google APIs
 * without requiring individual user OAuth.
 *
 * Required environment variables:
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL: The service account email
 * - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: The private key (PEM format)
 * - GOOGLE_IMPERSONATE_EMAIL: The user email to impersonate
 */

// Scopes needed for Gmail, Google Docs, and Google Sheets access
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

export interface ServiceAccountConfig {
  serviceAccountEmail: string;
  privateKey: string;
  impersonateEmail: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// Cache for access tokens to avoid unnecessary token requests
let tokenCache: {
  token: string;
  expiresAt: number;
} | null = null;

/**
 * Convert a PEM-encoded private key to a CryptoKey for signing
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and whitespace
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  // Decode base64 to binary
  const binaryString = atob(pemContents);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Import the key
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
}

/**
 * Base64url encode (used for JWT)
 */
function base64urlEncode(data: string | ArrayBuffer): string {
  let base64: string;
  if (typeof data === 'string') {
    base64 = btoa(data);
  } else {
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Create and sign a JWT for Google OAuth
 */
async function createSignedJwt(config: ServiceAccountConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  // JWT Header
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  // JWT Payload
  const payload = {
    iss: config.serviceAccountEmail,
    sub: config.impersonateEmail, // Impersonate this user (domain-wide delegation)
    scope: GOOGLE_SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
  };

  // Encode header and payload
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with private key
  const privateKey = await importPrivateKey(config.privateKey);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(signatureInput)
  );

  const encodedSignature = base64urlEncode(signature);
  return `${signatureInput}.${encodedSignature}`;
}

/**
 * Exchange a signed JWT for an access token
 */
async function exchangeJwtForToken(jwt: string): Promise<TokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} - ${error}`);
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * Get an access token using the service account
 * Automatically caches and refreshes tokens as needed
 */
export async function getServiceAccountToken(config: ServiceAccountConfig): Promise<string> {
  // Check cache (with 5 minute buffer before expiry)
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 5 * 60 * 1000) {
    return tokenCache.token;
  }

  // Create and sign JWT
  const jwt = await createSignedJwt(config);

  // Exchange for access token
  const tokenResponse = await exchangeJwtForToken(jwt);

  // Cache the token
  tokenCache = {
    token: tokenResponse.access_token,
    expiresAt: now + tokenResponse.expires_in * 1000,
  };

  return tokenResponse.access_token;
}

/**
 * Check if service account is configured in environment
 */
export function isServiceAccountConfigured(env: Record<string, unknown>): boolean {
  return !!(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    env.GOOGLE_IMPERSONATE_EMAIL
  );
}

/**
 * Get service account config from environment
 */
export function getServiceAccountConfig(env: Record<string, unknown>): ServiceAccountConfig | null {
  if (!isServiceAccountConfigured(env)) {
    return null;
  }

  return {
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL as string,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY as string,
    impersonateEmail: env.GOOGLE_IMPERSONATE_EMAIL as string,
  };
}
