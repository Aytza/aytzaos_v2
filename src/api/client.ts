import type {
  Project,
  Column,
  Task,
  ApiResponse,
  TaskPriority,
  ProjectCredential,
  MCPServer,
  MCPTool,
  WorkflowPlan,
  WorkflowLog,
  User,
  Agent,
  RoadmapItem,
  RoadmapColumn,
  ItemSize,
  BugItem,
  BugColumn,
  BugSeverity,
} from '../types';

const API_BASE = '/api';

// ============================================
// AUTH
// ============================================

export async function getMe(): Promise<ApiResponse<User>> {
  const response = await fetch(`${API_BASE}/me`);
  return response.json();
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    // Server returns { success: false, error: { code, message } }
    const errorObj = data.error || {};
    return {
      success: false,
      error: {
        code: errorObj.code || String(response.status),
        message: errorObj.message || 'Request failed',
      },
    };
  }

  return data;
}

// ============================================
// PROJECTS
// ============================================

export interface ProjectWithDetails extends Project {
  columns: Column[];
  tasks: Task[];
}

/** @deprecated Use getProjects instead */
export const getBoards = getProjects;

export async function getProjects(): Promise<ApiResponse<Project[]>> {
  return request<Project[]>('/projects');
}

/** @deprecated Use getProject instead */
export const getBoard = getProject;

export async function getProject(id: string): Promise<ApiResponse<ProjectWithDetails>> {
  return request<ProjectWithDetails>(`/projects/${id}`);
}

/** @deprecated Use createProject instead */
export const createBoard = createProject;

export async function createProject(name: string): Promise<ApiResponse<ProjectWithDetails>> {
  return request<ProjectWithDetails>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** @deprecated Use updateProject instead */
export const updateBoard = updateProject;

export async function updateProject(
  id: string,
  data: { name?: string }
): Promise<ApiResponse<ProjectWithDetails>> {
  return request<ProjectWithDetails>(`/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** @deprecated Use deleteProject instead */
export const deleteBoard = deleteProject;

export async function deleteProject(id: string): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${id}`, {
    method: 'DELETE',
  });
}

/** @deprecated Use ProjectWithDetails instead */
export type BoardWithDetails = ProjectWithDetails;

// ============================================
// COLUMNS
// ============================================

export async function createColumn(
  projectId: string,
  name: string
): Promise<ApiResponse<Column>> {
  return request<Column>(`/projects/${projectId}/columns`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateColumn(
  projectId: string,
  id: string,
  data: { name?: string; position?: number }
): Promise<ApiResponse<Column>> {
  return request<Column>(`/projects/${projectId}/columns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteColumn(projectId: string, id: string): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${projectId}/columns/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// TASKS
// ============================================

export async function createTask(
  projectId: string,
  data: {
    columnId?: string;
    title: string;
    description?: string;
    priority?: TaskPriority;
  }
): Promise<ApiResponse<Task>> {
  return request<Task>(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTask(projectId: string, id: string): Promise<ApiResponse<Task>> {
  return request<Task>(`/projects/${projectId}/tasks/${id}`);
}

export async function updateTask(
  projectId: string,
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
  }
): Promise<ApiResponse<Task>> {
  return request<Task>(`/projects/${projectId}/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteTask(projectId: string, id: string): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${projectId}/tasks/${id}`, {
    method: 'DELETE',
  });
}

export async function moveTask(
  projectId: string,
  id: string,
  columnId: string,
  position: number
): Promise<ApiResponse<Task>> {
  return request<Task>(`/projects/${projectId}/tasks/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ columnId, position }),
  });
}

// ============================================
// STANDALONE TASKS (user's personal tasks)
// ============================================

export async function getStandaloneTasks(): Promise<ApiResponse<Task[]>> {
  return request<Task[]>('/tasks');
}

export async function createStandaloneTask(data: {
  title: string;
  description?: string;
  priority?: TaskPriority;
}): Promise<ApiResponse<Task>> {
  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getStandaloneTask(id: string): Promise<ApiResponse<Task>> {
  return request<Task>(`/tasks/${id}`);
}

export async function updateStandaloneTask(
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
  }
): Promise<ApiResponse<Task>> {
  return request<Task>(`/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteStandaloneTask(id: string): Promise<ApiResponse<void>> {
  return request<void>(`/tasks/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// AGENTS (Custom AI agents)
// ============================================

export async function getAgents(projectId?: string): Promise<ApiResponse<Agent[]>> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<Agent[]>(`/agents${query}`);
}

export async function getAgent(id: string, projectId?: string): Promise<ApiResponse<Agent>> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<Agent>(`/agents/${id}${query}`);
}

export async function createAgent(data: {
  projectId?: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  icon?: string;
}): Promise<ApiResponse<Agent>> {
  return request<Agent>('/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAgent(
  id: string,
  data: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    model?: string;
    icon?: string;
    enabled?: boolean;
  },
  projectId?: string
): Promise<ApiResponse<Agent>> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<Agent>(`/agents/${id}${query}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(id: string, projectId?: string): Promise<ApiResponse<void>> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<void>(`/agents/${id}${query}`, {
    method: 'DELETE',
  });
}

// ============================================
// GLOBAL MCP SERVERS (User-level MCPs)
// ============================================

export async function getGlobalMCPServers(): Promise<ApiResponse<MCPServer[]>> {
  return request<MCPServer[]>('/mcp-servers');
}

export async function getGlobalMCPServer(serverId: string): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/mcp-servers/${serverId}`);
}

export async function createGlobalMCPServer(data: {
  name: string;
  type: 'remote' | 'hosted';
  endpoint?: string;
  authType?: 'none' | 'oauth' | 'api_key' | 'bearer';
  credentialId?: string;
  transportType?: 'streamable-http' | 'sse';
}): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>('/mcp-servers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateGlobalMCPServer(
  serverId: string,
  data: {
    name?: string;
    endpoint?: string;
    authType?: 'none' | 'oauth' | 'api_key' | 'bearer';
    credentialId?: string;
    transportType?: 'streamable-http' | 'sse';
    enabled?: boolean;
    status?: 'connected' | 'disconnected' | 'error';
  }
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/mcp-servers/${serverId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteGlobalMCPServer(serverId: string): Promise<ApiResponse<void>> {
  return request<void>(`/mcp-servers/${serverId}`, {
    method: 'DELETE',
  });
}

export async function getGlobalMCPServerTools(serverId: string): Promise<ApiResponse<MCPTool[]>> {
  return request<MCPTool[]>(`/mcp-servers/${serverId}/tools`);
}

export async function connectGlobalMCPServer(serverId: string): Promise<ApiResponse<{
  status: string;
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
}>> {
  return request<{ status: string; toolCount: number; tools: Array<{ name: string; description?: string }> }>(
    `/mcp-servers/${serverId}/connect`,
    { method: 'POST' }
  );
}

// ============================================
// CREDENTIALS
// ============================================

export async function getCredentials(
  projectId: string
): Promise<ApiResponse<ProjectCredential[]>> {
  return request<ProjectCredential[]>(`/projects/${projectId}/credentials`);
}

export async function createCredential(
  projectId: string,
  data: {
    type: 'github_oauth' | 'google_oauth' | 'anthropic_api_key';
    name: string;
    value: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ApiResponse<ProjectCredential>> {
  return request<ProjectCredential>(`/projects/${projectId}/credentials`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteCredential(
  projectId: string,
  credentialId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${projectId}/credentials/${credentialId}`, {
    method: 'DELETE',
  });
}

// ============================================
// GITHUB
// ============================================

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
}

export async function getGitHubOAuthUrl(
  projectId: string
): Promise<ApiResponse<{ url: string }>> {
  return request<{ url: string }>(`/github/oauth/url?projectId=${encodeURIComponent(projectId)}`);
}

export async function getGitHubRepos(
  projectId: string
): Promise<ApiResponse<GitHubRepo[]>> {
  return request<GitHubRepo[]>(`/projects/${projectId}/github/repos`);
}

// ============================================
// GOOGLE
// ============================================

export async function getGoogleOAuthUrl(
  projectId: string
): Promise<ApiResponse<{ url: string }>> {
  return request<{ url: string }>(`/google/oauth/url?projectId=${encodeURIComponent(projectId)}`);
}

// ============================================
// GLOBAL CREDENTIALS (User-level OAuth accounts)
// ============================================

export async function getGlobalCredentials(): Promise<ApiResponse<ProjectCredential[]>> {
  return request<ProjectCredential[]>('/global/credentials');
}

export async function getGlobalOAuthUrl(
  provider: string
): Promise<ApiResponse<{ url: string }>> {
  return request<{ url: string }>(`/global/oauth/url?provider=${encodeURIComponent(provider)}`);
}

export async function deleteGlobalCredential(
  credentialId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/global/credentials/${credentialId}`, {
    method: 'DELETE',
  });
}

// ============================================
// MCP SERVERS
// ============================================

export async function getMCPServers(
  projectId: string
): Promise<ApiResponse<MCPServer[]>> {
  return request<MCPServer[]>(`/projects/${projectId}/mcp-servers`);
}

export async function getMCPServer(
  projectId: string,
  serverId: string
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/projects/${projectId}/mcp-servers/${serverId}`);
}

export async function createMCPServer(
  projectId: string,
  data: {
    name: string;
    type: 'remote' | 'hosted';
    endpoint?: string;
    authType?: 'none' | 'oauth' | 'api_key' | 'bearer';
    credentialId?: string;
    transportType?: 'streamable-http' | 'sse';
  }
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/projects/${projectId}/mcp-servers`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMCPServer(
  projectId: string,
  serverId: string,
  data: {
    name?: string;
    endpoint?: string;
    authType?: 'none' | 'oauth' | 'api_key' | 'bearer';
    credentialId?: string;
    transportType?: 'streamable-http' | 'sse';
    enabled?: boolean;
    status?: 'connected' | 'disconnected' | 'error';
  }
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/projects/${projectId}/mcp-servers/${serverId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteMCPServer(
  projectId: string,
  serverId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${projectId}/mcp-servers/${serverId}`, {
    method: 'DELETE',
  });
}

export async function getMCPServerTools(
  projectId: string,
  serverId: string
): Promise<ApiResponse<MCPTool[]>> {
  return request<MCPTool[]>(`/projects/${projectId}/mcp-servers/${serverId}/tools`);
}

export async function connectMCPServer(
  projectId: string,
  serverId: string
): Promise<ApiResponse<{ status: string; toolCount: number; tools: Array<{ name: string; description?: string }> }>> {
  return request<{ status: string; toolCount: number; tools: Array<{ name: string; description?: string }> }>(
    `/projects/${projectId}/mcp-servers/${serverId}/connect`,
    { method: 'POST' }
  );
}

export async function cacheMCPServerTools(
  projectId: string,
  serverId: string,
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: object;
  }>
): Promise<ApiResponse<MCPTool[]>> {
  return request<MCPTool[]>(`/projects/${projectId}/mcp-servers/${serverId}/tools`, {
    method: 'PUT',
    body: JSON.stringify({ tools }),
  });
}

/**
 * Create an account-based MCP server (e.g., Gmail, Google Docs)
 * Uses the AccountMCPRegistry to create and initialize the MCP
 */
export async function createAccountMCP(
  projectId: string,
  accountId: string,
  mcpId: string
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/projects/${projectId}/mcp-servers/account`, {
    method: 'POST',
    body: JSON.stringify({ accountId, mcpId }),
  });
}

// ============================================
// MCP OAUTH
// ============================================

/**
 * Discover OAuth endpoints for a remote MCP server
 */
export async function discoverMCPOAuth(
  projectId: string,
  serverId: string
): Promise<ApiResponse<{
  resource: string;
  authorizationServer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopesSupported?: string[];
}>> {
  return request(`/projects/${projectId}/mcp-servers/${serverId}/oauth/discover`, {
    method: 'POST',
  });
}

/**
 * Get OAuth authorization URL for a remote MCP server
 */
export async function getMCPOAuthUrl(
  projectId: string,
  serverId: string,
  redirectUri: string
): Promise<ApiResponse<{ url: string; state: string }>> {
  const params = new URLSearchParams({ redirectUri });
  return request(`/projects/${projectId}/mcp-servers/${serverId}/oauth/url?${params.toString()}`);
}

/**
 * Exchange OAuth authorization code for tokens
 */
export async function exchangeMCPOAuthCode(
  projectId: string,
  serverId: string,
  code: string,
  state: string,
  redirectUri: string
): Promise<ApiResponse<{ status: string; credentialId: string }>> {
  return request(`/projects/${projectId}/mcp-servers/${serverId}/oauth/exchange`, {
    method: 'POST',
    body: JSON.stringify({ code, state, redirectUri }),
  });
}

// ============================================
// WORKFLOW PLANS
// ============================================

/** @deprecated Use getProjectWorkflowPlans instead */
export const getBoardWorkflowPlans = getProjectWorkflowPlans;

export async function getProjectWorkflowPlans(
  projectId: string
): Promise<ApiResponse<WorkflowPlan[]>> {
  return request<WorkflowPlan[]>(`/projects/${projectId}/workflow-plans`);
}

export async function getTaskWorkflowPlan(
  projectId: string,
  taskId: string
): Promise<ApiResponse<WorkflowPlan | null>> {
  return request<WorkflowPlan | null>(`/projects/${projectId}/tasks/${taskId}/plan`);
}

export async function createWorkflowPlan(
  projectId: string,
  taskId: string,
  data: {
    summary?: string;
    generatedCode?: string;
    steps?: object[];
  }
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/projects/${projectId}/tasks/${taskId}/plan`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getWorkflowPlan(
  projectId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/projects/${projectId}/plans/${planId}`);
}

export async function updateWorkflowPlan(
  projectId: string,
  planId: string,
  data: {
    status?: string;
    summary?: string;
    generatedCode?: string;
    steps?: object[];
    currentStepIndex?: number;
    checkpointData?: object;
  }
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/projects/${projectId}/plans/${planId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteWorkflowPlan(
  projectId: string,
  planId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${projectId}/plans/${planId}`, {
    method: 'DELETE',
  });
}

export async function approveWorkflowPlan(
  projectId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/projects/${projectId}/plans/${planId}/approve`, {
    method: 'POST',
  });
}

export async function cancelWorkflow(
  projectId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/projects/${projectId}/plans/${planId}/cancel`, {
    method: 'POST',
  });
}

export async function resolveWorkflowCheckpoint(
  projectId: string,
  planId: string,
  data: {
    action: 'approve' | 'request_changes' | 'cancel';
    data?: object;
    feedback?: string;
  }
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/projects/${projectId}/plans/${planId}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getWorkflowLogs(
  projectId: string,
  planId: string,
  options?: { limit?: number; offset?: number }
): Promise<ApiResponse<WorkflowLog[]>> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<WorkflowLog[]>(`/projects/${projectId}/plans/${planId}/logs${query}`);
}

export async function generateWorkflowPlan(
  projectId: string,
  taskId: string,
  agentId?: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/projects/${projectId}/tasks/${taskId}/generate-plan`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
}

// ============================================
// STANDALONE TASK WORKFLOW
// ============================================

export async function getStandaloneTaskWorkflowPlan(
  taskId: string
): Promise<ApiResponse<WorkflowPlan | null>> {
  return request<WorkflowPlan | null>(`/tasks/${taskId}/plan`);
}

export async function generateStandaloneWorkflowPlan(
  taskId: string,
  agentId?: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/tasks/${taskId}/generate-plan`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
}

export async function getStandaloneWorkflowPlan(
  taskId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/tasks/${taskId}/plans/${planId}`);
}

export async function deleteStandaloneWorkflowPlan(
  taskId: string,
  planId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/tasks/${taskId}/plans/${planId}`, {
    method: 'DELETE',
  });
}

export async function cancelStandaloneWorkflow(
  taskId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/tasks/${taskId}/plans/${planId}/cancel`, {
    method: 'POST',
  });
}

export async function resolveStandaloneWorkflowCheckpoint(
  taskId: string,
  planId: string,
  data: {
    action: 'approve' | 'request_changes' | 'cancel';
    data?: object;
    feedback?: string;
  }
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/tasks/${taskId}/plans/${planId}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getStandaloneWorkflowLogs(
  taskId: string,
  planId: string,
  options?: { limit?: number; offset?: number }
): Promise<ApiResponse<WorkflowLog[]>> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<WorkflowLog[]>(`/tasks/${taskId}/plans/${planId}/logs${query}`);
}

// ============================================
// LINK METADATA (for link pills)
// ============================================

export interface LinkMetadata {
  type: 'google_doc' | 'google_sheet' | 'github_pr' | 'github_issue' | 'github_repo';
  title: string;
  id: string;
}

export async function getLinkMetadata(
  projectId: string,
  url: string
): Promise<ApiResponse<LinkMetadata | null>> {
  return request<LinkMetadata | null>(`/projects/${projectId}/links/metadata`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

// ============================================
// ROADMAP
// ============================================

export async function getRoadmapItems(): Promise<ApiResponse<RoadmapItem[]>> {
  return request<RoadmapItem[]>('/roadmap/items');
}

export async function getRoadmapItem(id: string): Promise<ApiResponse<RoadmapItem>> {
  return request<RoadmapItem>(`/roadmap/items/${id}`);
}

export async function createRoadmapItem(data: {
  title: string;
  description?: string;
  column?: RoadmapColumn;
  ownerEmail?: string;
  startDate?: string;
  endDate?: string;
  size?: ItemSize;
  notes?: string;
}): Promise<ApiResponse<RoadmapItem>> {
  return request<RoadmapItem>('/roadmap/items', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateRoadmapItem(
  id: string,
  data: {
    title?: string;
    description?: string;
    ownerEmail?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    size?: ItemSize;
    notes?: string | null;
  }
): Promise<ApiResponse<RoadmapItem>> {
  return request<RoadmapItem>(`/roadmap/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function moveRoadmapItem(
  id: string,
  column: RoadmapColumn,
  position: number
): Promise<ApiResponse<RoadmapItem>> {
  return request<RoadmapItem>(`/roadmap/items/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ column, position }),
  });
}

export async function deleteRoadmapItem(id: string): Promise<ApiResponse<void>> {
  return request<void>(`/roadmap/items/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// BUG BOARD
// ============================================

export async function getBugItems(): Promise<ApiResponse<BugItem[]>> {
  return request<BugItem[]>('/bugs/items');
}

export async function getBugItem(id: string): Promise<ApiResponse<BugItem>> {
  return request<BugItem>(`/bugs/items/${id}`);
}

export async function createBugItem(data: {
  title: string;
  description?: string;
  column?: BugColumn;
  severity?: BugSeverity;
  ownerEmail?: string;
  screenshots?: string[];
}): Promise<ApiResponse<BugItem>> {
  return request<BugItem>('/bugs/items', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateBugItem(
  id: string,
  data: {
    title?: string;
    description?: string;
    severity?: BugSeverity;
    ownerEmail?: string | null;
    screenshots?: string[];
  }
): Promise<ApiResponse<BugItem>> {
  return request<BugItem>(`/bugs/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function moveBugItem(
  id: string,
  column: BugColumn,
  position: number
): Promise<ApiResponse<BugItem>> {
  return request<BugItem>(`/bugs/items/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ column, position }),
  });
}

export async function deleteBugItem(id: string): Promise<ApiResponse<void>> {
  return request<void>(`/bugs/items/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// COMPANY SCOUT
// ============================================

export interface ScoutStartResult {
  task: Task;
  plan: WorkflowPlan;
}

export async function startCompanyScout(query: string): Promise<ApiResponse<ScoutStartResult>> {
  return request<ScoutStartResult>('/scout/start', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}
