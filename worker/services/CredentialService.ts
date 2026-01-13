import { encryptValue, decryptValue } from '../utils/crypto';
import { jsonResponse } from '../utils/response';
import { toCamelCase } from '../utils/transformations';
import { logger } from '../utils/logger';
import { getAccountByCredentialType } from '../mcp/AccountMCPRegistry';

// Buffer time (5 minutes) before expiry to trigger refresh
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// OAuth client credentials for token refresh
// Add new providers here as they're added
interface OAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export class CredentialService {
  private sql: SqlStorage;
  private encryptionKey: string;
  private generateId: () => string;
  private oauthEnv: OAuthEnv;

  constructor(
    sql: SqlStorage,
    encryptionKey: string,
    generateId: () => string,
    oauthEnv: OAuthEnv = {}
  ) {
    this.sql = sql;
    this.encryptionKey = encryptionKey;
    this.generateId = generateId;
    this.oauthEnv = oauthEnv;
  }

  /**
   * Get all credentials for a project (without encrypted values)
   */
  getCredentials(projectId: string): Response {
    const credentials = this.sql.exec(
      'SELECT id, project_id, type, name, metadata, created_at, updated_at FROM project_credentials WHERE project_id = ?',
      projectId
    ).toArray();

    return jsonResponse({
      success: true,
      data: credentials.map(c => {
        const cred = toCamelCase(c as Record<string, unknown>);
        if (typeof cred.metadata === 'string' && cred.metadata) {
          try {
            cred.metadata = JSON.parse(cred.metadata);
          } catch {
            // Leave as string if parsing fails
          }
        }
        return cred;
      })
    });
  }

  /**
   * Create a new credential with encrypted value
   */
  async createCredential(projectId: string, data: {
    type: string;
    name: string;
    value: string;
    metadata?: object;
  }): Promise<Response> {
    const id = this.generateId();
    const now = new Date().toISOString();
    const encryptedValue = await this.encrypt(data.value);

    this.sql.exec(
      `INSERT INTO project_credentials (id, project_id, type, name, encrypted_value, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      data.type,
      data.name,
      encryptedValue,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
      now
    );

    return jsonResponse({
      success: true,
      data: {
        id,
        projectId,
        type: data.type,
        name: data.name,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  /**
   * Delete a credential and cascade to associated MCP servers
   */
  deleteCredential(projectId: string, credentialId: string): Response {
    // Cascade delete associated MCP servers and their tools
    this.sql.exec(
      `DELETE FROM mcp_tool_schemas WHERE server_id IN (
        SELECT id FROM mcp_servers WHERE credential_id = ?
      )`,
      credentialId
    );
    this.sql.exec(
      'DELETE FROM mcp_servers WHERE credential_id = ?',
      credentialId
    );
    this.sql.exec(
      'DELETE FROM project_credentials WHERE id = ? AND project_id = ?',
      credentialId,
      projectId
    );

    return jsonResponse({ success: true });
  }

  /**
   * Get decrypted credential value by type
   */
  async getCredentialValue(projectId: string, type: string): Promise<string | null> {
    const credential = this.sql.exec(
      'SELECT encrypted_value FROM project_credentials WHERE project_id = ? AND type = ?',
      projectId,
      type
    ).toArray()[0] as { encrypted_value: string } | undefined;

    if (!credential) return null;
    return this.decrypt(credential.encrypted_value);
  }

  /**
   * Get a valid access token, refreshing if expired.
   * Centralizes all OAuth token refresh logic.
   */
  async getValidAccessToken(
    projectId: string,
    credentialType: string
  ): Promise<string | null> {
    const credential = this.sql.exec(
      'SELECT encrypted_value, metadata FROM project_credentials WHERE project_id = ? AND type = ?',
      projectId,
      credentialType
    ).toArray()[0] as { encrypted_value: string; metadata: string | null } | undefined;

    if (!credential) return null;

    let accessToken = await this.decrypt(credential.encrypted_value);
    const metadata: { refresh_token?: string; expires_at?: string } = credential.metadata
      ? JSON.parse(credential.metadata)
      : {};

    if (metadata.refresh_token && metadata.expires_at) {
      const expiresAtMs = new Date(metadata.expires_at).getTime();
      const needsRefresh = Date.now() > expiresAtMs - TOKEN_REFRESH_BUFFER_MS;

      if (needsRefresh) {
        const account = getAccountByCredentialType(credentialType);
        if (account?.refreshToken) {
          const { clientId, clientSecret } = this.getOAuthClientCredentials(account.id);

          if (clientId && clientSecret) {
            try {
              logger.credential.info('Refreshing expired OAuth token', { credentialType });

              const newTokenData = await account.refreshToken(
                metadata.refresh_token,
                clientId,
                clientSecret
              );

              accessToken = newTokenData.access_token;
              const newExpiresAt = new Date(
                Date.now() + (newTokenData.expires_in || 3600) * 1000
              ).toISOString();

              await this.updateCredentialValue(
                projectId,
                credentialType,
                newTokenData.access_token,
                { expires_at: newExpiresAt }
              );

              logger.credential.info('OAuth token refreshed successfully', { credentialType });
            } catch (e) {
              logger.credential.error('Failed to refresh OAuth token', {
                credentialType,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      }
    }

    return accessToken;
  }

  /**
   * HTTP handler for getting credential value
   */
  async getCredentialValueResponse(projectId: string, type: string): Promise<Response> {
    const value = await this.getCredentialValue(projectId, type);
    if (!value) {
      return jsonResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: `Credential ${type} not found` }
      }, 404);
    }
    return jsonResponse({ success: true, data: { value } });
  }

  /**
   * Get credential by ID with decrypted value and metadata
   */
  async getCredentialById(projectId: string, credentialId: string): Promise<Response> {
    const credential = this.sql.exec(
      'SELECT encrypted_value, metadata FROM project_credentials WHERE project_id = ? AND id = ?',
      projectId,
      credentialId
    ).toArray()[0] as { encrypted_value: string; metadata: string | null } | undefined;

    if (!credential) {
      return jsonResponse({ success: false, error: 'Credential not found' }, 404);
    }

    return jsonResponse({
      success: true,
      data: {
        value: await this.decrypt(credential.encrypted_value),
        metadata: credential.metadata ? JSON.parse(credential.metadata) : null,
      }
    });
  }

  /**
   * Get full credential by type with decrypted value and metadata
   */
  async getCredentialFullResponse(projectId: string, type: string): Promise<Response> {
    const credential = this.sql.exec(
      'SELECT encrypted_value, metadata FROM project_credentials WHERE project_id = ? AND type = ?',
      projectId,
      type
    ).toArray()[0] as { encrypted_value: string; metadata: string | null } | undefined;

    if (!credential) {
      return jsonResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: `Credential ${type} not found` }
      }, 404);
    }

    return jsonResponse({
      success: true,
      data: {
        value: await this.decrypt(credential.encrypted_value),
        metadata: credential.metadata ? JSON.parse(credential.metadata) : {},
      }
    });
  }

  /**
   * Update credential value (for token refresh)
   */
  async updateCredentialValue(
    projectId: string,
    type: string,
    newValue: string,
    metadataUpdates?: Record<string, unknown>
  ): Promise<Response> {
    const encryptedValue = await this.encrypt(newValue);
    const now = new Date().toISOString();

    if (metadataUpdates) {
      const existing = this.sql.exec(
        'SELECT metadata FROM project_credentials WHERE project_id = ? AND type = ?',
        projectId,
        type
      ).toArray()[0] as { metadata: string | null } | undefined;

      const existingMetadata = existing?.metadata ? JSON.parse(existing.metadata) : {};
      const mergedMetadata = { ...existingMetadata, ...metadataUpdates };

      this.sql.exec(
        'UPDATE project_credentials SET encrypted_value = ?, metadata = ?, updated_at = ? WHERE project_id = ? AND type = ?',
        encryptedValue,
        JSON.stringify(mergedMetadata),
        now,
        projectId,
        type
      );
    } else {
      this.sql.exec(
        'UPDATE project_credentials SET encrypted_value = ?, updated_at = ? WHERE project_id = ? AND type = ?',
        encryptedValue,
        now,
        projectId,
        type
      );
    }

    return jsonResponse({ success: true });
  }

  /**
   * Get raw credential row by ID (for internal use)
   */
  getCredentialRowById(credentialId: string): { encrypted_value: string; metadata?: string } | undefined {
    return this.sql.exec(
      'SELECT encrypted_value, metadata FROM project_credentials WHERE id = ?',
      credentialId
    ).toArray()[0] as { encrypted_value: string; metadata?: string } | undefined;
  }

  /**
   * Find credential ID by project and type
   */
  findCredentialId(projectId: string, type: string): string | undefined {
    const row = this.sql.exec(
      'SELECT id FROM project_credentials WHERE project_id = ? AND type = ?',
      projectId,
      type
    ).toArray()[0] as { id: string } | undefined;
    return row?.id;
  }

  /**
   * Get OAuth client credentials for an account
   * Add new providers here as they're added
   */
  private getOAuthClientCredentials(accountId: string): {
    clientId: string | undefined;
    clientSecret: string | undefined;
  } {
    switch (accountId) {
      case 'google':
        return {
          clientId: this.oauthEnv.GOOGLE_CLIENT_ID,
          clientSecret: this.oauthEnv.GOOGLE_CLIENT_SECRET,
        };
      default:
        return { clientId: undefined, clientSecret: undefined };
    }
  }

  /**
   * Encrypt a value
   */
  async encrypt(value: string): Promise<string> {
    return encryptValue(value, this.encryptionKey);
  }

  /**
   * Decrypt a value
   */
  async decrypt(encrypted: string): Promise<string> {
    return decryptValue(encrypted, this.encryptionKey);
  }
}
