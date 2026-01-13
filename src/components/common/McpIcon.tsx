/**
 * Reusable MCP service icon component
 */

interface McpIconProps {
  type: 'google-docs' | 'google-sheets' | 'gmail' | 'github' | 'sandbox' | 'claude-code' | 'askuser' | 'generic';
  size?: number;
  className?: string;
}

export function McpIcon({ type, size = 20, className = '' }: McpIconProps) {
  const style = { width: size, height: size };

  switch (type) {
    case 'google-docs':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          {/* Document with folded corner and lines */}
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="14" y2="17" />
        </svg>
      );

    case 'google-sheets':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          {/* Spreadsheet grid */}
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      );

    case 'gmail':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          {/* Envelope with clear shape */}
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polyline points="22 6 12 13 2 6" />
        </svg>
      );

    case 'github':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          {/* Git fork / merge icon */}
          <circle cx="12" cy="4" r="2" />
          <circle cx="6" cy="20" r="2" />
          <circle cx="18" cy="20" r="2" />
          <path d="M12 6v6m0 0l-6 6m6-6l6 6" />
        </svg>
      );

    case 'claude-code':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          {/* Terminal/code brackets with sparkle */}
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
          <path d="M18 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor" stroke="none" />
        </svg>
      );

    case 'sandbox':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          {/* Container/box icon */}
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );

    case 'askuser':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          {/* Question mark in circle with chat bubble */}
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <circle cx="12" cy="17" r="0.5" fill="currentColor" />
        </svg>
      );

    case 'generic':
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

/**
 * Agent icon - fun robot/AI assistant icon
 */
interface AgentIconProps {
  size?: number;
  className?: string;
}

export function AgentIcon({ size = 20, className = '' }: AgentIconProps) {
  const style = { width: size, height: size };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
    >
      {/* Robot head */}
      <rect x="5" y="7" width="14" height="12" rx="2" />
      {/* Antenna */}
      <line x1="12" y1="3" x2="12" y2="7" />
      <circle cx="12" cy="3" r="1" fill="currentColor" />
      {/* Eyes */}
      <circle cx="9" cy="12" r="1.5" fill="currentColor" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" />
      {/* Mouth */}
      <line x1="9" y1="16" x2="15" y2="16" />
      {/* Ears */}
      <line x1="3" y1="11" x2="5" y2="11" />
      <line x1="19" y1="11" x2="21" y2="11" />
    </svg>
  );
}

/**
 * Get icon type from MCP tool name
 */
export function getIconTypeFromTool(toolName: string): McpIconProps['type'] {
  if (toolName.startsWith('Google_Docs__') || toolName.startsWith('GoogleDocs__')) {
    return 'google-docs';
  }
  if (toolName.startsWith('Google_Sheets__') || toolName.startsWith('GoogleSheets__')) {
    return 'google-sheets';
  }
  if (toolName.startsWith('Gmail__')) {
    return 'gmail';
  }
  if (toolName.startsWith('GitHub__') || toolName.startsWith('Sandbox__')) {
    return 'sandbox';
  }
  if (toolName.startsWith('AskUser__')) {
    return 'askuser';
  }
  return 'generic';
}
