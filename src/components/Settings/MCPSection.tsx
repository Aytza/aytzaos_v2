import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../common';
import { MCPServerConnect } from '../MCP/MCPServerConnect';
import { CREDENTIAL_TYPES, type BoardCredential, type MCPServer, type MCPTool } from '../../types';
import * as api from '../../api/client';
import './MCPSection.css';

// Small component for the "+N more" with fixed tooltip
function ToolsMore({ count, tools }: { count: number; tools: string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <span
      ref={ref}
      className="mcp-tools-more"
      onMouseEnter={() => {
        if (ref.current) {
          const rect = ref.current.getBoundingClientRect();
          setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
        }
      }}
      onMouseLeave={() => setTooltipPos(null)}
    >
      +{count} more
      {tooltipPos && (
        <span
          className="mcp-tools-tooltip"
          style={{
            position: 'fixed',
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {tools.join(', ')}
        </span>
      )}
    </span>
  );
}

/**
 * Account-based MCPs that can be added when an account is connected
 * These match the MCPs in worker/mcp/AccountMCPRegistry.ts
 */
const ACCOUNT_MCPS = [
  {
    accountId: 'google',
    credentialType: CREDENTIAL_TYPES.GOOGLE_OAUTH,
    mcps: [
      { id: 'gmail', name: 'Gmail', description: 'Read, send, and search emails' },
      { id: 'google-docs', name: 'Google Docs', description: 'Create and edit documents' },
      { id: 'google-sheets', name: 'Google Sheets', description: 'Create and edit spreadsheets' },
    ],
  },
];

interface MCPSectionProps {
  projectId: string;
  credentials: BoardCredential[];
  onConnectGitHub: () => void;
  connectingGitHub: boolean;
}

// Icons
const GITHUB_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
);

const MCP_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <circle cx="9" cy="9" r="1.5" fill="currentColor" />
    <circle cx="15" cy="9" r="1.5" fill="currentColor" />
    <path d="M9 15h6" />
  </svg>
);

const GOOGLE_ICON = (
  <svg viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

export function MCPSection({
  projectId,
  credentials,
  onConnectGitHub,
  connectingGitHub,
}: MCPSectionProps) {
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [showMCPForm, setShowMCPForm] = useState(false);
  const [serverTools, setServerTools] = useState<Record<string, MCPTool[]>>({});
  const [addingAccountMCP, setAddingAccountMCP] = useState<string | null>(null);

  const loadMCPServers = useCallback(async () => {
    const result = await api.getMCPServers(projectId);
    if (result.success && result.data) {
      setMcpServers(result.data);
      result.data.forEach((server) => loadServerTools(server.id));
    }
    setLoading(false);
  }, [projectId]);

  // Load MCP servers on mount and when credentials change (e.g., account disconnected)
  useEffect(() => {
    loadMCPServers();
  }, [loadMCPServers, credentials]);

  const loadServerTools = async (serverId: string) => {
    const result = await api.getMCPServerTools(projectId, serverId);
    if (result.success && result.data) {
      setServerTools((prev) => ({ ...prev, [serverId]: result.data! }));
    }
  };

  const handleDeleteMCP = async (serverId: string) => {
    const result = await api.deleteMCPServer(projectId, serverId);
    if (result.success) {
      setMcpServers((prev) => prev.filter((s) => s.id !== serverId));
    }
  };

  const handleAddAccountMCP = async (accountId: string, mcpId: string) => {
    setAddingAccountMCP(mcpId);
    try {
      const result = await api.createAccountMCP(projectId, accountId, mcpId);
      if (result.success && result.data) {
        setMcpServers((prev) => [...prev, result.data!]);
        loadServerTools(result.data.id);
        setShowAddOptions(false);
      }
    } finally {
      setAddingAccountMCP(null);
    }
  };

  const getAccountInfo = (server: MCPServer): string | null => {
    if (!server.credentialId) return null;
    const cred = credentials.find((c) => c.id === server.credentialId);
    if (cred?.type === CREDENTIAL_TYPES.GOOGLE_OAUTH) {
      return cred.metadata?.email as string || null;
    }
    if (cred?.type === CREDENTIAL_TYPES.GITHUB_OAUTH) {
      const login = cred.metadata?.login as string | undefined;
      return login ? `@${login}` : null;
    }
    return null;
  };

  const MAX_VISIBLE_TOOLS = 2;

  const renderTools = (tools: string[]) => {
    if (tools.length === 0) return null;
    if (tools.length <= MAX_VISIBLE_TOOLS) return tools.join(', ');

    const visible = tools.slice(0, MAX_VISIBLE_TOOLS);
    const hidden = tools.slice(MAX_VISIBLE_TOOLS);

    return (
      <>
        {visible.join(', ')}{' '}
        <ToolsMore count={hidden.length} tools={hidden} />
      </>
    );
  };

  const handleMCPServerAdded = (server: MCPServer) => {
    setMcpServers((prev) => [...prev, server]);
    setShowMCPForm(false);
    setShowAddOptions(false);
    loadServerTools(server.id);
  };

  // Get available account MCPs to add (connected account, MCP not already added)
  const getAvailableAccountMCPs = () => {
    const available: Array<{
      accountId: string;
      mcpId: string;
      name: string;
      description: string;
    }> = [];

    for (const account of ACCOUNT_MCPS) {
      const credential = credentials.find((c) => c.type === account.credentialType);
      if (!credential) continue;

      for (const mcp of account.mcps) {
        // Check if this MCP is already added
        const alreadyAdded = mcpServers.some(
          (s) => s.name === mcp.name || s.name.toLowerCase() === mcp.id
        );
        if (!alreadyAdded) {
          available.push({
            accountId: account.accountId,
            mcpId: mcp.id,
            name: mcp.name,
            description: mcp.description,
          });
        }
      }
    }

    return available;
  };

  const hasMCPs = mcpServers.length > 0;
  const availableAccountMCPs = getAvailableAccountMCPs();
  const hasGitHubMCP = mcpServers.some((s) => s.name === 'GitHub');
  const showGitHubOption = !hasGitHubMCP;

  // Empty state
  if (!hasMCPs && !showAddOptions && !showMCPForm) {
    return (
      <div className="mcp-empty">
        <p>No MCP servers configured</p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowAddOptions(true)}
        >
          + Add MCP Server
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* MCP Servers list */}
      {hasMCPs && (
        <div className="mcp-list">
          {!loading && mcpServers.map((server) => {
            const tools = serverTools[server.id] || [];
            const toolNames = tools.map((t) => t.name);
            const accountInfo = getAccountInfo(server);
            const isGitHub = server.name === 'GitHub';
            const isGoogle = server.name === 'Gmail' || server.name === 'Google Docs' || server.name === 'Google Sheets';

            return (
              <div key={server.id} className="mcp-item">
                <div className="mcp-item-left">
                  <div className={`mcp-item-icon ${isGitHub ? 'github' : isGoogle ? 'google' : ''}`}>
                    {isGitHub ? GITHUB_ICON : isGoogle ? GOOGLE_ICON : MCP_ICON}
                  </div>
                  <div className="mcp-item-info">
                    <span className="mcp-item-name">
                      {server.name}
                      {accountInfo && (
                        <span className="mcp-item-account">({accountInfo})</span>
                      )}
                    </span>
                    <span className="mcp-item-meta">
                      {toolNames.length > 0
                        ? renderTools(toolNames)
                        : server.status}
                    </span>
                  </div>
                </div>
                <button
                  className="mcp-item-delete"
                  onClick={() => handleDeleteMCP(server.id)}
                  title="Remove"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add MCP button */}
      {hasMCPs && !showAddOptions && !showMCPForm && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAddOptions(true)}
          className="mcp-add-btn"
        >
          + Add MCP Server
        </Button>
      )}

      {/* Add options */}
      {showAddOptions && !showMCPForm && (
        <div className="mcp-add-form">
          <div className="mcp-add-form-header">Add MCP Server</div>
          <div className="mcp-options">
            {/* GitHub option */}
            {showGitHubOption && (
              <button
                className="mcp-option"
                onClick={onConnectGitHub}
                disabled={connectingGitHub}
              >
                <div className="mcp-option-icon github">{GITHUB_ICON}</div>
                <div className="mcp-option-info">
                  <div className="mcp-option-name">GitHub</div>
                  <div className="mcp-option-desc">
                    Repositories, issues, pull requests
                  </div>
                </div>
                {connectingGitHub ? (
                  <span className="mcp-option-spinner" />
                ) : (
                  <svg
                    className="mcp-option-arrow"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                )}
              </button>
            )}

            {/* Account-based MCPs (e.g., Gmail, Google Docs) */}
            {availableAccountMCPs.map((mcp) => (
              <button
                key={mcp.mcpId}
                className="mcp-option"
                onClick={() => handleAddAccountMCP(mcp.accountId, mcp.mcpId)}
                disabled={addingAccountMCP === mcp.mcpId}
              >
                <div className="mcp-option-icon google">{GOOGLE_ICON}</div>
                <div className="mcp-option-info">
                  <div className="mcp-option-name">{mcp.name}</div>
                  <div className="mcp-option-desc">{mcp.description}</div>
                </div>
                {addingAccountMCP === mcp.mcpId ? (
                  <span className="mcp-option-spinner" />
                ) : (
                  <svg
                    className="mcp-option-arrow"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                )}
              </button>
            ))}

            {/* Custom MCP option */}
            <button
              className="mcp-option"
              onClick={() => setShowMCPForm(true)}
            >
              <div className="mcp-option-icon mcp">{MCP_ICON}</div>
              <div className="mcp-option-info">
                <div className="mcp-option-name">Custom MCP Server</div>
                <div className="mcp-option-desc">
                  Connect any MCP-compatible server
                </div>
              </div>
              <svg
                className="mcp-option-arrow"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
          <div className="mcp-add-form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddOptions(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Custom MCP Form */}
      {showMCPForm && (
        <div className="mcp-add-form">
          <MCPServerConnect
            projectId={projectId}
            onClose={() => {
              setShowMCPForm(false);
              setShowAddOptions(true);
            }}
            onServerAdded={handleMCPServerAdded}
            inline
          />
        </div>
      )}
    </>
  );
}
