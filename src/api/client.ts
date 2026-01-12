import type {
  Board,
  Column,
  Task,
  ApiResponse,
  TaskPriority,
  BoardCredential,
  MCPServer,
  MCPTool,
  WorkflowPlan,
  WorkflowLog,
  User,
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
// BOARDS
// ============================================

export interface BoardWithDetails extends Board {
  columns: Column[];
  tasks: Task[];
}

export async function getBoards(): Promise<ApiResponse<Board[]>> {
  return request<Board[]>('/boards');
}

export async function getBoard(id: string): Promise<ApiResponse<BoardWithDetails>> {
  return request<BoardWithDetails>(`/boards/${id}`);
}

export async function createBoard(name: string): Promise<ApiResponse<BoardWithDetails>> {
  return request<BoardWithDetails>('/boards', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateBoard(
  id: string,
  data: { name?: string }
): Promise<ApiResponse<BoardWithDetails>> {
  return request<BoardWithDetails>(`/boards/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteBoard(id: string): Promise<ApiResponse<void>> {
  return request<void>(`/boards/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// COLUMNS
// ============================================

export async function createColumn(
  boardId: string,
  name: string
): Promise<ApiResponse<Column>> {
  return request<Column>(`/boards/${boardId}/columns`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateColumn(
  boardId: string,
  id: string,
  data: { name?: string; position?: number }
): Promise<ApiResponse<Column>> {
  return request<Column>(`/boards/${boardId}/columns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteColumn(boardId: string, id: string): Promise<ApiResponse<void>> {
  return request<void>(`/boards/${boardId}/columns/${id}`, {
    method: 'DELETE',
  });
}

// ============================================
// TASKS
// ============================================

export async function createTask(
  boardId: string,
  data: {
    columnId: string;
    title: string;
    description?: string;
    priority?: TaskPriority;
  }
): Promise<ApiResponse<Task>> {
  return request<Task>(`/boards/${boardId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTask(boardId: string, id: string): Promise<ApiResponse<Task>> {
  return request<Task>(`/boards/${boardId}/tasks/${id}`);
}

export async function updateTask(
  boardId: string,
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
  }
): Promise<ApiResponse<Task>> {
  return request<Task>(`/boards/${boardId}/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteTask(boardId: string, id: string): Promise<ApiResponse<void>> {
  return request<void>(`/boards/${boardId}/tasks/${id}`, {
    method: 'DELETE',
  });
}

export async function moveTask(
  boardId: string,
  id: string,
  columnId: string,
  position: number
): Promise<ApiResponse<Task>> {
  return request<Task>(`/boards/${boardId}/tasks/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ columnId, position }),
  });
}

// ============================================
// CREDENTIALS
// ============================================

export async function getCredentials(
  boardId: string
): Promise<ApiResponse<BoardCredential[]>> {
  return request<BoardCredential[]>(`/boards/${boardId}/credentials`);
}

export async function createCredential(
  boardId: string,
  data: {
    type: 'github_oauth' | 'google_oauth' | 'anthropic_api_key';
    name: string;
    value: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ApiResponse<BoardCredential>> {
  return request<BoardCredential>(`/boards/${boardId}/credentials`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteCredential(
  boardId: string,
  credentialId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/boards/${boardId}/credentials/${credentialId}`, {
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
  boardId: string
): Promise<ApiResponse<{ url: string }>> {
  return request<{ url: string }>(`/github/oauth/url?boardId=${encodeURIComponent(boardId)}`);
}

export async function getGitHubRepos(
  boardId: string
): Promise<ApiResponse<GitHubRepo[]>> {
  return request<GitHubRepo[]>(`/boards/${boardId}/github/repos`);
}

// ============================================
// GOOGLE
// ============================================

export async function getGoogleOAuthUrl(
  boardId: string
): Promise<ApiResponse<{ url: string }>> {
  return request<{ url: string }>(`/google/oauth/url?boardId=${encodeURIComponent(boardId)}`);
}

// ============================================
// MCP SERVERS
// ============================================

export async function getMCPServers(
  boardId: string
): Promise<ApiResponse<MCPServer[]>> {
  return request<MCPServer[]>(`/boards/${boardId}/mcp-servers`);
}

export async function getMCPServer(
  boardId: string,
  serverId: string
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/boards/${boardId}/mcp-servers/${serverId}`);
}

export async function createMCPServer(
  boardId: string,
  data: {
    name: string;
    type: 'remote' | 'hosted';
    endpoint?: string;
    authType?: 'none' | 'oauth' | 'api_key' | 'bearer';
    credentialId?: string;
    transportType?: 'streamable-http' | 'sse';
  }
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/boards/${boardId}/mcp-servers`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMCPServer(
  boardId: string,
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
  return request<MCPServer>(`/boards/${boardId}/mcp-servers/${serverId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteMCPServer(
  boardId: string,
  serverId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/boards/${boardId}/mcp-servers/${serverId}`, {
    method: 'DELETE',
  });
}

export async function getMCPServerTools(
  boardId: string,
  serverId: string
): Promise<ApiResponse<MCPTool[]>> {
  return request<MCPTool[]>(`/boards/${boardId}/mcp-servers/${serverId}/tools`);
}

export async function connectMCPServer(
  boardId: string,
  serverId: string
): Promise<ApiResponse<{ status: string; toolCount: number; tools: Array<{ name: string; description?: string }> }>> {
  return request<{ status: string; toolCount: number; tools: Array<{ name: string; description?: string }> }>(
    `/boards/${boardId}/mcp-servers/${serverId}/connect`,
    { method: 'POST' }
  );
}

export async function cacheMCPServerTools(
  boardId: string,
  serverId: string,
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: object;
  }>
): Promise<ApiResponse<MCPTool[]>> {
  return request<MCPTool[]>(`/boards/${boardId}/mcp-servers/${serverId}/tools`, {
    method: 'PUT',
    body: JSON.stringify({ tools }),
  });
}

/**
 * Create an account-based MCP server (e.g., Gmail, Google Docs)
 * Uses the AccountMCPRegistry to create and initialize the MCP
 */
export async function createAccountMCP(
  boardId: string,
  accountId: string,
  mcpId: string
): Promise<ApiResponse<MCPServer>> {
  return request<MCPServer>(`/boards/${boardId}/mcp-servers/account`, {
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
  boardId: string,
  serverId: string
): Promise<ApiResponse<{
  resource: string;
  authorizationServer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopesSupported?: string[];
}>> {
  return request(`/boards/${boardId}/mcp-servers/${serverId}/oauth/discover`, {
    method: 'POST',
  });
}

/**
 * Get OAuth authorization URL for a remote MCP server
 */
export async function getMCPOAuthUrl(
  boardId: string,
  serverId: string,
  redirectUri: string
): Promise<ApiResponse<{ url: string; state: string }>> {
  const params = new URLSearchParams({ redirectUri });
  return request(`/boards/${boardId}/mcp-servers/${serverId}/oauth/url?${params.toString()}`);
}

/**
 * Exchange OAuth authorization code for tokens
 */
export async function exchangeMCPOAuthCode(
  boardId: string,
  serverId: string,
  code: string,
  state: string,
  redirectUri: string
): Promise<ApiResponse<{ status: string; credentialId: string }>> {
  return request(`/boards/${boardId}/mcp-servers/${serverId}/oauth/exchange`, {
    method: 'POST',
    body: JSON.stringify({ code, state, redirectUri }),
  });
}

// ============================================
// WORKFLOW PLANS
// ============================================

export async function getBoardWorkflowPlans(
  boardId: string
): Promise<ApiResponse<WorkflowPlan[]>> {
  return request<WorkflowPlan[]>(`/boards/${boardId}/workflow-plans`);
}

export async function getTaskWorkflowPlan(
  boardId: string,
  taskId: string
): Promise<ApiResponse<WorkflowPlan | null>> {
  return request<WorkflowPlan | null>(`/boards/${boardId}/tasks/${taskId}/plan`);
}

export async function createWorkflowPlan(
  boardId: string,
  taskId: string,
  data: {
    summary?: string;
    generatedCode?: string;
    steps?: object[];
  }
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/boards/${boardId}/tasks/${taskId}/plan`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getWorkflowPlan(
  boardId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/boards/${boardId}/plans/${planId}`);
}

export async function updateWorkflowPlan(
  boardId: string,
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
  return request<WorkflowPlan>(`/boards/${boardId}/plans/${planId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteWorkflowPlan(
  boardId: string,
  planId: string
): Promise<ApiResponse<void>> {
  return request<void>(`/boards/${boardId}/plans/${planId}`, {
    method: 'DELETE',
  });
}

export async function approveWorkflowPlan(
  boardId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/boards/${boardId}/plans/${planId}/approve`, {
    method: 'POST',
  });
}

export async function cancelWorkflow(
  boardId: string,
  planId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/boards/${boardId}/plans/${planId}/cancel`, {
    method: 'POST',
  });
}

export async function resolveWorkflowCheckpoint(
  boardId: string,
  planId: string,
  data: {
    action: 'approve' | 'request_changes' | 'cancel';
    data?: object;
    feedback?: string;
  }
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/boards/${boardId}/plans/${planId}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getWorkflowLogs(
  boardId: string,
  planId: string,
  options?: { limit?: number; offset?: number }
): Promise<ApiResponse<WorkflowLog[]>> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<WorkflowLog[]>(`/boards/${boardId}/plans/${planId}/logs${query}`);
}

export async function generateWorkflowPlan(
  boardId: string,
  taskId: string
): Promise<ApiResponse<WorkflowPlan>> {
  return request<WorkflowPlan>(`/boards/${boardId}/tasks/${taskId}/generate-plan`, {
    method: 'POST',
  });
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
  boardId: string,
  url: string
): Promise<ApiResponse<LinkMetadata | null>> {
  return request<LinkMetadata | null>(`/boards/${boardId}/links/metadata`, {
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
  targetWeek?: string;
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
    targetWeek?: string | null;
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
