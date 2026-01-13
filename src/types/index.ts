import type { CredentialType } from '../constants';

// ============================================
// CORE ENTITIES
// ============================================

export interface User {
  id: string;
  email: string;
  logoutUrl?: string | null;
  config?: {
    anthropicApiKeyConfigured?: boolean;
  };
}

export interface Project {
  id: string;
  name: string;
  ownerId?: string;
  columns: Column[];
  toolConfig?: ProjectToolConfig;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use Project instead */
export type Board = Project;

export interface Column {
  id: string;
  projectId: string;
  name: string;
  position: number;
}

export interface Task {
  id: string;
  columnId?: string;
  projectId?: string;
  userId?: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  position: number;
  context?: TaskContext;
  createdAt: string;
  updatedAt: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

// ============================================
// AGENT EXECUTION (Future-Ready)
// ============================================

export interface ProjectToolConfig {
  tools: ToolDefinition[];
  credentials: CredentialRef[];
  sandboxConfig?: SandboxSettings;
}

/** @deprecated Use ProjectToolConfig instead */
export type BoardToolConfig = ProjectToolConfig;

export interface ToolDefinition {
  id: string;
  name: string;
  type: 'mcp' | 'api' | 'filesystem' | 'browser';
  config: {
    endpoint?: string;
    permissions?: string[];
    scope?: string;
  };
  enabled: boolean;
}

export interface CredentialRef {
  id: string;
  name: string;
  type: string;
  // Actual credentials stored encrypted separately
}

export interface ProjectCredential {
  id: string;
  projectId: string;
  type: CredentialType;
  name: string;
  // Note: encrypted_value is never exposed to frontend
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use ProjectCredential instead */
export type BoardCredential = ProjectCredential;

export interface SandboxSettings {
  memoryLimitMb?: number;
  timeoutMs?: number;
  allowedDomains?: string[];
}

export interface TaskContext {
  instructions?: string;
  references?: string[];
  expectedOutputs?: string[];
  constraints?: string[];
  dependsOn?: string[];
}

// ============================================
// API TYPES
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
}

// ============================================
// DIFF COMMENTS
// ============================================

export interface DiffComment {
  id: string;
  filePath: string;
  lineNumber: number;
  endLine?: number;  // For multi-line selections
  lineType: 'addition' | 'deletion' | 'context';
  content: string;
}

// ============================================
// TEXT COMMENTS (for non-diff content)
// ============================================

export interface TextComment {
  id: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}

// ============================================
// UI STATE
// ============================================

export interface DragState {
  isDragging: boolean;
  taskId: string | null;
  sourceColumnId: string | null;
}

export interface ColumnDragState {
  isDragging: boolean;
  columnId: string | null;
}

export interface ProjectViewState {
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  isCreatingTask: boolean;
  isEditingTask: boolean;
}

/** @deprecated Use ProjectViewState instead */
export type BoardViewState = ProjectViewState;

// ============================================
// MCP SERVER TYPES
// ============================================

export interface MCPServer {
  id: string;
  projectId: string;
  name: string;
  type: 'remote' | 'hosted';
  endpoint?: string;
  authType: 'none' | 'oauth' | 'api_key' | 'bearer';
  credentialId?: string;
  /** Transport type for remote servers. Defaults to 'streamable-http' */
  transportType?: 'streamable-http' | 'sse';
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  /** URL patterns this MCP can enrich (for link pills) */
  urlPatterns?: MCPUrlPattern[];
  createdAt: string;
  updatedAt: string;
}

/** Link pill types for enriched URL display */
export type LinkPillType = 'google_doc' | 'google_sheet' | 'github_pr' | 'github_issue' | 'github_repo';

export interface MCPUrlPattern {
  /** Regex pattern to match URLs */
  pattern: string;
  /** Type of resource this pattern matches */
  type: LinkPillType;
  /** Tool name to call for fetching metadata */
  fetchTool: string;
}

export interface MCPTool {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  inputSchema: JSONSchema;
  cachedAt: string;
}

export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'integer' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  format?: string;
}

// ============================================
// AGENT TYPES (Custom AI agents)
// ============================================

export interface Agent {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  systemPrompt: string;
  model: string;
  icon: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// WORKFLOW PLAN TYPES
// ============================================

export type WorkflowPlanStatus =
  | 'planning'
  | 'draft'
  | 'approved'
  | 'executing'
  | 'checkpoint'
  | 'completed'
  | 'failed';

export interface WorkflowArtifact {
  type: 'google_doc' | 'google_sheet' | 'gmail_message' | 'github_pr' | 'file' | 'other';
  url?: string;
  title?: string;
  description?: string;
  // Email content for inline viewing (gmail_message type)
  content?: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    sentAt?: string;
  };
}

export interface WorkflowResult {
  success: boolean;
  artifacts?: WorkflowArtifact[];
  stepResults?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowPlan {
  id: string;
  taskId: string;
  projectId: string;
  status: WorkflowPlanStatus;
  summary?: string;
  generatedCode?: string;
  steps?: WorkflowStep[];
  currentStepIndex?: number;
  checkpointData?: Record<string, unknown>;
  result?: WorkflowResult;
  conversationHistory?: object[];
  createdAt: string;
  updatedAt: string;
}

export type WorkflowStepType = 'tool_call' | 'checkpoint' | 'internal' | 'agent' | 'tool';
export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_approval';

export interface WorkflowStep {
  id: string;
  name: string;
  type: WorkflowStepType;
  mcpServer?: string;
  toolName?: string;
  status: WorkflowStepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

// ============================================
// WORKFLOW LOGS (Real-Time Observability)
// ============================================

export type WorkflowLogLevel = 'info' | 'warn' | 'error';

export interface WorkflowLogMetadata {
  type?: 'tool_call' | 'tool_result' | 'step_start' | 'step_end' | 'checkpoint' | 'workflow_complete' | 'workflow_error' | 'step_error' | 'agent_turn' | 'agent_stream';
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  durationMs?: number;
  resultPreview?: string;
  stepIndex?: number;
  totalSteps?: number;
  artifactCount?: number;
  turnIndex?: number;
  text?: string;
}

export interface WorkflowLog {
  id: string;
  planId: string;
  stepId?: string;
  timestamp: string;
  level: WorkflowLogLevel;
  message: string;
  metadata?: WorkflowLogMetadata;
}

// ============================================
// ROADMAP TYPES
// ============================================

export type RoadmapColumn = 'ideas' | 'prototyping' | 'building' | 'shipped';
export type ItemSize = 'S' | 'M' | 'L';

export interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  column: RoadmapColumn;
  position: number;
  ownerEmail: string | null;
  startDate: string | null;
  endDate: string | null;
  size: ItemSize;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// BUG BOARD TYPES
// ============================================

export type BugColumn = 'reported' | 'triaged' | 'fixing' | 'fixed';
export type BugSeverity = 'low' | 'medium' | 'high';

export interface BugItem {
  id: string;
  title: string;
  description: string | null;
  column: BugColumn;
  position: number;
  severity: BugSeverity;
  ownerEmail: string | null;
  screenshots: string[]; // Array of base64 data URLs
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// TEAM MEMBERS
// ============================================

export interface TeamMember {
  name: string;
  email: string;
}

export const TEAM_MEMBERS: TeamMember[] = [
  { name: 'Pranay Madan', email: 'pranay@aytza.com' },
  { name: 'Sari Kaganoff', email: 'sari@aytza.com' },
  { name: 'Ali Yousefli', email: 'ali@aytza.com' },
  { name: 'Juliarose', email: 'jr@aytza.com' },
];

// Re-export constants for convenience
export { CREDENTIAL_TYPES, type CredentialType } from '../constants';
