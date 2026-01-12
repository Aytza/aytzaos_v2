import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../common';
import type { MCPServer, MCPTool } from '../../types';
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

const MCP_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <circle cx="9" cy="9" r="1.5" fill="currentColor" />
    <circle cx="15" cy="9" r="1.5" fill="currentColor" />
    <path d="M9 15h6" />
  </svg>
);

export function GlobalMCPSection() {
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [serverTools, setServerTools] = useState<Record<string, MCPTool[]>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [newName, setNewName] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [saving, setSaving] = useState(false);

  const loadMCPServers = useCallback(async () => {
    const result = await api.getGlobalMCPServers();
    if (result.success && result.data) {
      setMcpServers(result.data);
      result.data.forEach((server) => loadServerTools(server.id));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMCPServers();
  }, [loadMCPServers]);

  const loadServerTools = async (serverId: string) => {
    const result = await api.getGlobalMCPServerTools(serverId);
    if (result.success && result.data) {
      setServerTools((prev) => ({ ...prev, [serverId]: result.data! }));
    }
  };

  const handleDeleteMCP = async (serverId: string) => {
    const result = await api.deleteGlobalMCPServer(serverId);
    if (result.success) {
      setMcpServers((prev) => prev.filter((s) => s.id !== serverId));
    }
  };

  const handleConnect = async (serverId: string) => {
    setConnecting(serverId);
    setError(null);
    try {
      const result = await api.connectGlobalMCPServer(serverId);
      if (result.success && result.data) {
        await loadServerTools(serverId);
        setMcpServers((prev) =>
          prev.map((s) =>
            s.id === serverId ? { ...s, status: 'connected' as const } : s
          )
        );
      } else {
        setError(result.error?.message || 'Failed to connect');
      }
    } finally {
      setConnecting(null);
    }
  };

  const handleAddMCP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEndpoint.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const result = await api.createGlobalMCPServer({
        name: newName.trim(),
        type: 'remote',
        endpoint: newEndpoint.trim(),
        authType: 'none',
        transportType: 'streamable-http',
      });

      if (result.success && result.data) {
        setMcpServers((prev) => [...prev, result.data!]);
        setNewName('');
        setNewEndpoint('');
        setShowAddForm(false);
        // Auto-connect
        handleConnect(result.data.id);
      } else {
        setError(result.error?.message || 'Failed to add MCP server');
      }
    } finally {
      setSaving(false);
    }
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

  const hasMCPs = mcpServers.length > 0;

  if (loading) {
    return <div className="mcp-loading">Loading...</div>;
  }

  // Empty state
  if (!hasMCPs && !showAddForm) {
    return (
      <div className="mcp-empty">
        <p>No global MCP servers configured</p>
        <p className="mcp-empty-hint">Global MCPs are available across all your projects</p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowAddForm(true)}
        >
          + Add MCP Server
        </Button>
      </div>
    );
  }

  return (
    <>
      {error && <div className="mcp-error">{error}</div>}

      {/* MCP Servers list */}
      {hasMCPs && (
        <div className="mcp-list">
          {mcpServers.map((server) => {
            const tools = serverTools[server.id] || [];
            const toolNames = tools.map((t) => t.name);
            const isConnecting = connecting === server.id;

            return (
              <div key={server.id} className="mcp-item">
                <div className="mcp-item-left">
                  <div className="mcp-item-icon">{MCP_ICON}</div>
                  <div className="mcp-item-info">
                    <span className="mcp-item-name">{server.name}</span>
                    <span className="mcp-item-meta">
                      {toolNames.length > 0
                        ? renderTools(toolNames)
                        : server.status === 'connected'
                        ? 'Connected'
                        : server.endpoint}
                    </span>
                  </div>
                </div>
                <div className="mcp-item-actions">
                  {server.status !== 'connected' && (
                    <button
                      className="mcp-item-connect"
                      onClick={() => handleConnect(server.id)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? '...' : 'Connect'}
                    </button>
                  )}
                  <button
                    className="mcp-item-delete"
                    onClick={() => handleDeleteMCP(server.id)}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add MCP button */}
      {hasMCPs && !showAddForm && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAddForm(true)}
          className="mcp-add-btn"
        >
          + Add MCP Server
        </Button>
      )}

      {/* Add Form */}
      {showAddForm && (
        <form className="mcp-add-form" onSubmit={handleAddMCP}>
          <div className="mcp-add-form-header">Add Global MCP Server</div>
          <div className="mcp-form-field">
            <label>Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My MCP Server"
              autoFocus
            />
          </div>
          <div className="mcp-form-field">
            <label>Endpoint URL</label>
            <input
              type="url"
              value={newEndpoint}
              onChange={(e) => setNewEndpoint(e.target.value)}
              placeholder="https://mcp.example.com/sse"
            />
          </div>
          <div className="mcp-add-form-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAddForm(false);
                setNewName('');
                setNewEndpoint('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!newName.trim() || !newEndpoint.trim() || saving}
            >
              {saving ? 'Adding...' : 'Add Server'}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
