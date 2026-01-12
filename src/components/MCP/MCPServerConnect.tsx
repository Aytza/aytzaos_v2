import { useState } from 'react';
import { Modal, Input, Button } from '../common';
import type { MCPServer } from '../../types';
import * as api from '../../api/client';
import './MCPServerConnect.css';

interface MCPServerConnectProps {
  projectId: string;
  onClose: () => void;
  onServerAdded: (server: MCPServer) => void;
  inline?: boolean;
}

type TransportType = 'streamable-http' | 'sse';

export function MCPServerConnect({ projectId, onClose, onServerAdded, inline }: MCPServerConnectProps) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [transportType, setTransportType] = useState<TransportType>('streamable-http');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const startOAuthFlow = async (server: MCPServer) => {
    setStatusMessage('Discovering OAuth endpoints...');

    const discoverResult = await api.discoverMCPOAuth(projectId, server.id);
    if (!discoverResult.success) {
      return { success: false, error: discoverResult.error?.message || 'OAuth discovery failed' };
    }

    setStatusMessage('Redirecting to authorization...');

    const redirectUri = `${window.location.origin}/mcp/oauth/callback`;
    const urlResult = await api.getMCPOAuthUrl(projectId, server.id, redirectUri);

    if (!urlResult.success || !urlResult.data?.url) {
      return { success: false, error: urlResult.error?.message || 'Failed to get authorization URL' };
    }

    // Store server ID for callback
    sessionStorage.setItem('mcp_oauth_server_id', server.id);
    sessionStorage.setItem('mcp_oauth_project_id', projectId);
    sessionStorage.setItem('mcp_oauth_state', urlResult.data.state);

    // Redirect to OAuth authorization
    window.location.href = urlResult.data.url;
    return { success: true };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !endpoint.trim()) return;

    setSaving(true);
    setError(null);
    setStatusMessage(null);

    // Create the MCP server (start with no auth)
    setStatusMessage('Creating server...');
    const result = await api.createMCPServer(projectId, {
      name: name.trim(),
      type: 'remote',
      endpoint: endpoint.trim(),
      authType: 'none',
      transportType,
    });

    if (!result.success || !result.data) {
      setError(result.error?.message || 'Failed to add MCP server');
      setSaving(false);
      return;
    }

    const server = result.data;

    // Try connecting without auth first
    setStatusMessage('Connecting...');
    const connectResult = await api.connectMCPServer(projectId, server.id);

    if (connectResult.success) {
      // Connected without auth
      server.status = 'connected';
      onServerAdded(server);
      return;
    }

    // Connection failed - try OAuth
    setStatusMessage('Authentication required, trying OAuth...');

    // Update server to OAuth auth type
    await api.updateMCPServer(projectId, server.id, { authType: 'oauth' });
    server.authType = 'oauth';

    const oauthResult = await startOAuthFlow(server);
    if (!oauthResult.success) {
      // OAuth also failed - show error but keep server (user can retry)
      setError(`Connection failed: ${connectResult.error?.message || 'Unknown error'}. OAuth also failed: ${oauthResult.error}`);
      setSaving(false);
      onServerAdded(server); // Add anyway so user can see it and retry
    }
  };

  const formContent = (
    <form className="mcp-form" onSubmit={handleSubmit}>
      {error && <div className="mcp-form-error">{error}</div>}
      {statusMessage && <div className="mcp-form-status">{statusMessage}</div>}

      <Input
        label="Server Name"
        placeholder="e.g., My MCP Server"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />

      <Input
        label="Endpoint URL"
        placeholder="https://example.com/mcp"
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
      />

      <div className="mcp-form-field">
        <label className="mcp-form-label">Transport</label>
        <select
          className="mcp-form-select"
          value={transportType}
          onChange={(e) => setTransportType(e.target.value as TransportType)}
        >
          <option value="streamable-http">Streamable HTTP (Recommended)</option>
          <option value="sse">SSE (Legacy)</option>
        </select>
        <span className="mcp-form-hint">
          {transportType === 'streamable-http'
            ? 'Current MCP standard - POST to /mcp endpoint'
            : 'Deprecated - GET /sse then POST to returned endpoint'}
        </span>
      </div>

      <div className="mcp-form-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {inline ? 'Back' : 'Cancel'}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!name.trim() || !endpoint.trim() || saving}
        >
          {saving ? 'Connecting...' : 'Add Server'}
        </Button>
      </div>
    </form>
  );

  if (inline) {
    return formContent;
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Add MCP Server" width="sm">
      {formContent}
    </Modal>
  );
}
