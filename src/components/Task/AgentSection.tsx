/**
 * AgentSection - Agent launch UI with available tools display
 *
 * Shows a polished section for starting the AI agent with
 * visual indication of available/connected tools.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Button, AgentIcon, McpIcon } from '../common';
import type { MCPServer } from '../../types';
import * as api from '../../api/client';
import './AgentSection.css';

interface AgentSectionProps {
  projectId?: string;
  onRun: () => void;
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
function getIconType(name: string): 'gmail' | 'google-docs' | 'google-sheets' | 'github' | 'sandbox' | 'claude-code' | 'generic' {
  const lower = name.toLowerCase();
  if (lower === 'gmail') return 'gmail';
  if (lower === 'google docs' || lower === 'google-docs') return 'google-docs';
  if (lower === 'google sheets' || lower === 'google-sheets') return 'google-sheets';
  if (lower === 'github') return 'github';
  if (lower === 'claude code' || lower === 'claude-code') return 'claude-code';
  if (lower === 'sandbox') return 'sandbox';
  return 'generic';
}

// Built-in tools always available
const BUILTIN_TOOLS = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'sandbox', name: 'Sandbox' },
];

export function AgentSection({ projectId, onRun, disabled, isRunning }: AgentSectionProps) {
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  // Pick a random sentence on mount
  const sentence = useMemo(() => {
    return PLAYFUL_SENTENCES[Math.floor(Math.random() * PLAYFUL_SENTENCES.length)];
  }, []);

  useEffect(() => {
    async function loadServers() {
      if (!projectId) {
        setLoading(false);
        return;
      }
      const result = await api.getMCPServers(projectId);
      if (result.success && result.data) {
        setMcpServers(result.data);
      }
      setLoading(false);
    }
    loadServers();
  }, [projectId]);

  // Combine built-in tools with enabled MCPs only
  const allTools = [
    ...BUILTIN_TOOLS,
    ...mcpServers
      .filter(s => s.enabled)
      .map(s => ({ id: s.id, name: s.name })),
  ];

  const MAX_VISIBLE = 4;
  const visibleTools = allTools.slice(0, MAX_VISIBLE);
  const hiddenTools = allTools.slice(MAX_VISIBLE);
  const hasMore = hiddenTools.length > 0;

  return (
    <div className="agent-section">
      <div className="agent-section-content">
        <Button
          variant="agent"
          onClick={onRun}
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
