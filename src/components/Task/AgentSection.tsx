/**
 * AgentSection - Agent launch UI with available tools display
 *
 * Shows a polished section for starting the AI agent with
 * visual indication of available/connected tools and agent selection.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Button, AgentIcon, McpIcon } from '../common';
import type { MCPServer, Agent } from '../../types';
import * as api from '../../api/client';
import './AgentSection.css';

interface AgentSectionProps {
  projectId?: string;
  onRun: (agentId?: string) => void;
  disabled?: boolean;
  isRunning?: boolean;
}

// Playful sentences about available tools - randomly selected on mount
const PLAYFUL_SENTENCES = [
  "Tools at my disposal:",
  "I have access to:",
  "My toolkit includes:",
  "At my fingertips:",
  "I can tap into:",
  "Available to me:",
];

// Map MCP server names to icon types
function getIconType(name: string): 'gmail' | 'google-docs' | 'google-sheets' | 'github' | 'sandbox' | 'claude-code' | 'exa' | 'generic' {
  const lower = name.toLowerCase();
  if (lower === 'gmail') return 'gmail';
  if (lower === 'google docs' || lower === 'google-docs') return 'google-docs';
  if (lower === 'google sheets' || lower === 'google-sheets') return 'google-sheets';
  if (lower === 'github') return 'github';
  if (lower === 'claude code' || lower === 'claude-code') return 'claude-code';
  if (lower === 'sandbox') return 'sandbox';
  if (lower === 'exa' || lower === 'exa search') return 'exa';
  return 'generic';
}

// Built-in tools always available
const BUILTIN_TOOLS = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'sandbox', name: 'Sandbox' },
  { id: 'exa', name: 'Exa Search' },
];

export function AgentSection({ projectId, onRun, disabled, isRunning }: AgentSectionProps) {
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [globalMcpServers, setGlobalMcpServers] = useState<MCPServer[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [showAgentSelect, setShowAgentSelect] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const agentSelectRef = useRef<HTMLDivElement>(null);

  // Pick a random sentence on mount
  const sentence = useMemo(() => {
    return PLAYFUL_SENTENCES[Math.floor(Math.random() * PLAYFUL_SENTENCES.length)];
  }, []);

  useEffect(() => {
    async function loadData() {
      const promises: Promise<void>[] = [];

      // Load global MCP servers (always)
      promises.push(
        api.getGlobalMCPServers().then(result => {
          if (result.success && result.data) {
            setGlobalMcpServers(result.data);
          }
        })
      );

      // Load project-specific MCP servers
      if (projectId) {
        promises.push(
          api.getMCPServers(projectId).then(result => {
            if (result.success && result.data) {
              setMcpServers(result.data);
            }
          })
        );
      }

      // Load agents (both global and project-specific)
      promises.push(
        api.getAgents(projectId).then(result => {
          if (result.success && result.data) {
            setAgents(result.data.filter(a => a.enabled));
          }
        })
      );

      await Promise.all(promises);
      setLoading(false);
    }
    loadData();
  }, [projectId]);

  // Close agent dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (agentSelectRef.current && !agentSelectRef.current.contains(event.target as Node)) {
        setShowAgentSelect(false);
      }
    }
    if (showAgentSelect) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAgentSelect]);

  const selectedAgent = useMemo(() => {
    return agents.find(a => a.id === selectedAgentId);
  }, [agents, selectedAgentId]);

  // Combine built-in tools with enabled MCPs (both global and project-specific)
  const allTools = [
    ...BUILTIN_TOOLS,
    ...globalMcpServers
      .filter(s => s.enabled)
      .map(s => ({ id: s.id, name: s.name, isGlobal: true })),
    ...mcpServers
      .filter(s => s.enabled)
      .map(s => ({ id: s.id, name: s.name, isGlobal: false })),
  ];

  const MAX_VISIBLE = 4;
  const visibleTools = allTools.slice(0, MAX_VISIBLE);
  const hiddenTools = allTools.slice(MAX_VISIBLE);
  const hasMore = hiddenTools.length > 0;

  const handleRun = () => {
    onRun(selectedAgentId);
  };

  return (
    <div className="agent-section">
      <div className="agent-section-content">
        <div className="agent-run-area">
          <Button
            variant="agent"
            onClick={handleRun}
            disabled={disabled || isRunning}
            className="agent-run-button"
          >
            {isRunning ? (
              <>
                <span className="agent-spinner" />
                Starting...
              </>
            ) : (
              <>
                <AgentIcon size={16} />
                Run Agent
              </>
            )}
          </Button>

          {/* Agent selector - only show if there are custom agents */}
          {agents.length > 0 && (
            <div className="agent-select-wrapper" ref={agentSelectRef}>
              <button
                type="button"
                className="agent-select-trigger"
                onClick={() => setShowAgentSelect(!showAgentSelect)}
                disabled={isRunning}
              >
                <span className="agent-select-label">
                  {selectedAgent ? selectedAgent.name : 'Default Agent'}
                </span>
                <span className="agent-select-chevron">▼</span>
              </button>

              {showAgentSelect && (
                <div className="agent-select-dropdown">
                  <button
                    type="button"
                    className={`agent-select-option ${!selectedAgentId ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedAgentId(undefined);
                      setShowAgentSelect(false);
                    }}
                  >
                    <span className="agent-option-name">Default Agent</span>
                    <span className="agent-option-desc">Standard task execution</span>
                  </button>
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`agent-select-option ${selectedAgentId === agent.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedAgentId(agent.id);
                        setShowAgentSelect(false);
                      }}
                    >
                      <span className="agent-option-name">
                        {agent.icon && <span className="agent-option-icon">{agent.icon}</span>}
                        {agent.name}
                      </span>
                      {agent.description && (
                        <span className="agent-option-desc">{agent.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="agent-tools-area">
          <span className="agent-sentence">{sentence}</span>
          <div className="agent-tools-list">
            {loading ? (
              <span className="agent-tools-loading">...</span>
            ) : allTools.length === 0 ? (
              <span className="agent-tools-empty">No tools connected</span>
            ) : (
              <>
                {visibleTools.map(tool => (
                  <div
                    key={tool.id}
                    className="agent-tool"
                    title={tool.name}
                  >
                    <McpIcon type={getIconType(tool.name)} size={12} />
                    <span className="agent-tool-name">{tool.name}</span>
                  </div>
                ))}
                {hasMore && (
                  <div
                    ref={moreRef}
                    className="agent-tool agent-tool-more"
                    onMouseEnter={() => {
                      if (moreRef.current) {
                        const rect = moreRef.current.getBoundingClientRect();
                        setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
                      }
                    }}
                    onMouseLeave={() => setTooltipPos(null)}
                  >
                    <span className="agent-tool-name">+{hiddenTools.length} more</span>
                    {tooltipPos && (
                      <div
                        className="agent-tool-tooltip"
                        style={{
                          position: 'fixed',
                          left: tooltipPos.x,
                          top: tooltipPos.y,
                          transform: 'translate(-50%, -100%)',
                        }}
                      >
                        {hiddenTools.map(t => t.name).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
