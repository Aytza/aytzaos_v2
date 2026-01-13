import { DurableObject } from 'cloudflare:workers';
import { initSchema } from './db/schema';
import {
  BoardService,
  CredentialService,
  MCPService,
  MCPOAuthService,
  WorkflowService,
} from './services';

// ============================================
// TYPE EXPORTS FOR RPC
// ============================================

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  columns: Column[];
  tasks: Task[];
}

export interface Column {
  id: string;
  projectId: string;
  name: string;
  position: number;
}

export interface Task {
  id: string;
  columnId: string | null;
  projectId: string | null;
  userId: string | null;
  title: string;
  description: string | null;
  priority: string;
  position: number;
  context: object | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowPlan {
  id: string;
  taskId: string;
  projectId: string;
  status: string;
  summary: string | null;
  generatedCode: string | null;
  steps: object[] | null;
  currentStepIndex: number | null;
  checkpointData: object | null;
  result: object | null;
  conversationHistory: object[] | null; // MessageParam[] for resume/continue
  createdAt: string;
  updatedAt: string;
}

export interface Credential {
  id: string;
  projectId: string;
  type: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface MCPServer {
  id: string;
  projectId: string;
  name: string;
  type: string;
  endpoint: string | null;
  authType: string;
  credentialId: string | null;
  enabled: boolean;
  status: string;
  transportType: string | null;
  urlPatterns: object[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface MCPTool {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  inputSchema: object;
  approvalRequiredFields: string[] | null;
}

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
// BOARD DURABLE OBJECT
// ============================================

/**
 * BoardDO - Durable Object for project state management
 *
 * Note: The class is still called BoardDO for Cloudflare binding stability,
 * but the data model uses "projects" terminology.
 *
 * Uses RPC for all operations except WebSocket (which requires fetch)
 */
export class BoardDO extends DurableObject<Env> {
  private sql: SqlStorage;

  // Services
  private boardService: BoardService;
  private credentialService: CredentialService;
  private mcpService: MCPService;
  private mcpOAuthService: MCPOAuthService;
  private workflowService: WorkflowService;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    initSchema(this.sql);

    const generateId = () => crypto.randomUUID();

    this.credentialService = new CredentialService(
      this.sql,
      env.ENCRYPTION_KEY,
      generateId,
      {
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      }
    );

    this.boardService = new BoardService(
      this.sql,
      this.credentialService,
      generateId
    );

    this.mcpService = new MCPService(
      this.sql,
      this.credentialService,
      generateId
    );

    this.mcpOAuthService = new MCPOAuthService(
      this.sql,
      this.credentialService,
      this.mcpService,
      generateId
    );

    this.workflowService = new WorkflowService(
      this.sql,
      generateId,
      (projectId, type, data) => this.broadcast(projectId, type, data)
    );
  }

  // ============================================
  // WEBSOCKET (requires fetch - can't use RPC)
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(url);
    }

    return new Response('Use RPC methods', { status: 400 });
  }

  private handleWebSocketUpgrade(url: URL): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept both projectId and boardId for backward compatibility
    const projectId = url.searchParams.get('projectId') || url.searchParams.get('boardId');
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ projectId });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === 'string') {
      try {
        const data = JSON.parse(message);
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed messages
      }
    }
  }

  async webSocketClose() {
    // Cleanup handled by runtime
  }

  private broadcast(projectId: string, type: string, data: Record<string, unknown>): void {
    const clients = this.ctx.getWebSockets();
    const message = JSON.stringify({ type, data });

    for (const ws of clients) {
      try {
        const attachment = ws.deserializeAttachment() as { projectId: string } | null;
        if (attachment?.projectId === projectId) {
          ws.send(message);
        }
      } catch {
        // Client may have disconnected
      }
    }
  }

  // ============================================
  // PROJECT RPC METHODS
  // ============================================

  async initProject(data: { id: string; name: string; ownerId: string; isUserTasksContainer?: boolean }): Promise<Project> {
    const response = this.boardService.initProject(data);
    return this.extractData(response);
  }

  // Alias for backward compatibility
  async initBoard(data: { id: string; name: string; ownerId: string; isUserTasksContainer?: boolean }): Promise<Project> {
    return this.initProject(data);
  }

  async getProjectInfo(): Promise<{ id: string; name: string; ownerId: string }> {
    const response = this.boardService.getProjectInfo();
    return this.extractData(response);
  }

  // Alias for backward compatibility
  async getBoardInfo(): Promise<{ id: string; name: string; ownerId: string }> {
    return this.getProjectInfo();
  }

  async getProject(projectId: string): Promise<Project> {
    const response = this.boardService.getProject(projectId);
    return this.extractData(response);
  }

  // Alias for backward compatibility
  async getBoard(projectId: string): Promise<Project> {
    return this.getProject(projectId);
  }

  async updateProject(projectId: string, data: { name?: string }): Promise<Project> {
    const response = this.boardService.updateProject(projectId, data);
    return this.extractData(response);
  }

  // Alias for backward compatibility
  async updateBoard(projectId: string, data: { name?: string }): Promise<Project> {
    return this.updateProject(projectId, data);
  }

  async deleteProject(projectId: string): Promise<{ success: boolean }> {
    const response = this.boardService.deleteProject(projectId);
    return this.extractData(response);
  }

  // Alias for backward compatibility
  async deleteBoard(projectId: string): Promise<{ success: boolean }> {
    return this.deleteProject(projectId);
  }

  // ============================================
  // COLUMN RPC METHODS
  // ============================================

  async createColumn(projectId: string, data: { name: string }): Promise<Column> {
    const response = this.boardService.createColumn(projectId, data);
    return this.extractData(response);
  }

  async updateColumn(columnId: string, data: { name?: string; position?: number }): Promise<Column> {
    const response = this.boardService.updateColumn(columnId, data);
    return this.extractData(response);
  }

  async deleteColumn(columnId: string): Promise<{ success: boolean }> {
    const response = this.boardService.deleteColumn(columnId);
    return this.extractData(response);
  }

  // ============================================
  // TASK RPC METHODS
  // ============================================

  async createTask(data: {
    columnId?: string;
    projectId?: string;
    userId?: string;
    title: string;
    description?: string;
    priority?: string;
    context?: object;
  }): Promise<Task> {
    const response = this.boardService.createTask(data);
    return this.extractData(response);
  }

  async getTask(taskId: string): Promise<Task> {
    const response = this.boardService.getTask(taskId);
    return this.extractData(response);
  }

  async getTasks(): Promise<Task[]> {
    const response = this.boardService.getTasks();
    return this.extractData(response);
  }

  async updateTask(taskId: string, data: {
    title?: string;
    description?: string;
    priority?: string;
    context?: object;
  }): Promise<Task> {
    const response = this.boardService.updateTask(taskId, data);
    return this.extractData(response);
  }

  async deleteTask(taskId: string): Promise<{ success: boolean }> {
    const response = this.boardService.deleteTask(taskId);
    return this.extractData(response);
  }

  async moveTask(taskId: string, data: { columnId: string; position: number }): Promise<Task> {
    const response = this.boardService.moveTask(taskId, data);
    return this.extractData(response);
  }

  // ============================================
  // CREDENTIAL RPC METHODS
  // ============================================

  async getCredentials(projectId: string): Promise<Credential[]> {
    const response = this.credentialService.getCredentials(projectId);
    return this.extractData(response);
  }

  async createCredential(projectId: string, data: {
    type: string;
    name: string;
    value: string;
    metadata?: object;
  }): Promise<Credential> {
    const response = await this.credentialService.createCredential(projectId, data);
    return this.extractData(response);
  }

  async deleteCredential(projectId: string, credentialId: string): Promise<{ success: boolean }> {
    const response = this.credentialService.deleteCredential(projectId, credentialId);
    return this.extractData(response);
  }

  async getCredentialValue(projectId: string, type: string): Promise<string | null> {
    return this.credentialService.getCredentialValue(projectId, type);
  }

  async getCredentialFull(projectId: string, type: string): Promise<{ value: string; metadata: object } | null> {
    const response = await this.credentialService.getCredentialFullResponse(projectId, type);
    const result = await response.json() as { success: boolean; data?: { value: string; metadata: object } };
    return result.success ? result.data! : null;
  }

  async updateCredentialValue(
    projectId: string,
    type: string,
    value: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean }> {
    const response = await this.credentialService.updateCredentialValue(projectId, type, value, metadata);
    return this.extractData(response);
  }

  async getCredentialById(projectId: string, credentialId: string): Promise<{ value: string; metadata: object | null } | null> {
    const response = await this.credentialService.getCredentialById(projectId, credentialId);
    const result = await response.json() as { success: boolean; data?: { value: string; metadata: object | null } };
    return result.success ? result.data! : null;
  }

  // ============================================
  // WORKFLOW PLAN RPC METHODS
  // ============================================

  async getTaskWorkflowPlan(taskId: string): Promise<WorkflowPlan | null> {
    const response = this.workflowService.getTaskWorkflowPlan(taskId);
    const result = await response.json() as { success: boolean; data: WorkflowPlan | null };
    return result.data;
  }

  async getProjectWorkflowPlans(projectId: string): Promise<WorkflowPlan[]> {
    const response = this.workflowService.getProjectWorkflowPlans(projectId);
    return this.extractData(response);
  }

  // Alias for backward compatibility
  async getBoardWorkflowPlans(projectId: string): Promise<WorkflowPlan[]> {
    return this.getProjectWorkflowPlans(projectId);
  }

  async createWorkflowPlan(taskId: string, data: {
    id?: string;
    projectId: string;
    summary?: string;
    generatedCode?: string;
    steps?: object[];
  }): Promise<WorkflowPlan> {
    const response = this.workflowService.createWorkflowPlan(taskId, data);
    return this.extractData(response);
  }

  async getWorkflowPlan(planId: string): Promise<WorkflowPlan> {
    const response = this.workflowService.getWorkflowPlan(planId);
    return this.extractData(response);
  }

  async updateWorkflowPlan(planId: string, data: {
    status?: string;
    summary?: string;
    generatedCode?: string;
    steps?: object[];
    currentStepIndex?: number;
    checkpointData?: object;
    result?: object;
  }): Promise<WorkflowPlan> {
    const response = this.workflowService.updateWorkflowPlan(planId, data);
    return this.extractData(response);
  }

  async deleteWorkflowPlan(planId: string): Promise<{ success: boolean }> {
    const response = this.workflowService.deleteWorkflowPlan(planId);
    return this.extractData(response);
  }

  async approveWorkflowPlan(planId: string): Promise<WorkflowPlan> {
    const response = this.workflowService.approveWorkflowPlan(planId);
    return this.extractData(response);
  }

  async resolveWorkflowCheckpoint(planId: string, data: {
    action: string;
    data?: object;
  }): Promise<WorkflowPlan> {
    const response = this.workflowService.resolveWorkflowCheckpoint(planId, data);
    return this.extractData(response);
  }

  // ============================================
  // WORKFLOW LOG RPC METHODS
  // ============================================

  async getWorkflowLogs(planId: string, limit?: number, offset?: number): Promise<object[]> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const response = this.workflowService.getWorkflowLogs(planId, params);
    return this.extractData(response);
  }

  addWorkflowLog(
    planId: string,
    level: string,
    message: string,
    stepId?: string,
    metadata?: object
  ): Record<string, unknown> {
    return this.workflowService.addWorkflowLog(planId, level, message, stepId, metadata);
  }

  broadcastStreamChunk(projectId: string, planId: string, turnIndex: number, text: string): void {
    this.broadcast(projectId, 'workflow_stream', { planId, turnIndex, text });
  }

  // ============================================
  // MCP SERVER RPC METHODS
  // ============================================

  async getMCPServers(projectId: string): Promise<MCPServer[]> {
    const response = this.mcpService.getMCPServers(projectId);
    return this.extractData(response);
  }

  async getMCPServer(serverId: string): Promise<MCPServer> {
    const response = this.mcpService.getMCPServer(serverId);
    return this.extractData(response);
  }

  async createMCPServer(projectId: string, data: {
    name: string;
    type: 'remote' | 'hosted';
    endpoint?: string;
    authType?: string;
    credentialId?: string;
    status?: string;
    transportType?: 'streamable-http' | 'sse';
    urlPatterns?: Array<{ pattern: string; type: string; fetchTool: string }>;
  }): Promise<MCPServer> {
    const response = this.mcpService.createMCPServer(projectId, data);
    return this.extractData(response);
  }

  async createAccountMCP(projectId: string, data: {
    accountId: string;
    mcpId: string;
  }): Promise<MCPServer> {
    const response = await this.mcpService.createAccountMCP(projectId, data);
    return this.extractData(response);
  }

  async updateMCPServer(serverId: string, data: {
    name?: string;
    endpoint?: string;
    authType?: string;
    credentialId?: string;
    enabled?: boolean;
    status?: string;
    transportType?: 'streamable-http' | 'sse';
  }): Promise<MCPServer> {
    const response = this.mcpService.updateMCPServer(serverId, data);
    return this.extractData(response);
  }

  async deleteMCPServer(serverId: string): Promise<{ success: boolean }> {
    const response = this.mcpService.deleteMCPServer(serverId);
    return this.extractData(response);
  }

  async getMCPServerTools(serverId: string): Promise<MCPTool[]> {
    const response = this.mcpService.getMCPServerTools(serverId);
    return this.extractData(response);
  }

  async cacheMCPServerTools(serverId: string, data: {
    tools: Array<{
      name: string;
      description?: string;
      inputSchema: object;
      approvalRequiredFields?: string[];
    }>;
  }): Promise<MCPTool[]> {
    const response = this.mcpService.cacheMCPServerTools(serverId, data);
    return this.extractData(response);
  }

  async connectMCPServer(serverId: string): Promise<{
    status: string;
    toolCount: number;
    tools: Array<{ name: string; description?: string }>;
  }> {
    const response = await this.mcpService.connectMCPServer(serverId);
    return this.extractData(response);
  }

  // ============================================
  // MCP OAUTH RPC METHODS
  // ============================================

  async discoverMCPOAuth(serverId: string): Promise<object> {
    const response = await this.mcpOAuthService.discoverMCPOAuth(serverId);
    return this.extractData(response);
  }

  async getMCPOAuthUrl(serverId: string, redirectUri: string): Promise<{ url: string; state: string }> {
    const params = new URLSearchParams();
    params.set('redirectUri', redirectUri);
    const response = await this.mcpOAuthService.getMCPOAuthUrl(serverId, params);
    return this.extractData(response);
  }

  async exchangeMCPOAuthCode(serverId: string, data: {
    code: string;
    state: string;
    redirectUri: string;
  }): Promise<{ status: string; credentialId: string }> {
    const response = await this.mcpOAuthService.exchangeMCPOAuthCode(serverId, data);
    return this.extractData(response);
  }

  // ============================================
  // OTHER RPC METHODS
  // ============================================

  async getGitHubRepos(projectId: string): Promise<Array<{
    id: number;
    name: string;
    fullName: string;
    owner: string;
    private: boolean;
    defaultBranch: string;
    description: string | null;
  }>> {
    const response = await this.boardService.getGitHubRepos(projectId);
    return this.extractData(response);
  }

  async getLinkMetadata(projectId: string, data: { url: string }): Promise<{
    type: string;
    title: string;
    id: string;
  } | null> {
    const response = await this.boardService.getLinkMetadata(projectId, data);
    const result = await response.json() as { success: boolean; data: object | null };
    return result.data as { type: string; title: string; id: string } | null;
  }

  // ============================================
  // AGENT RPC METHODS
  // ============================================

  async getAgents(projectId: string | null): Promise<Agent[]> {
    const response = this.boardService.getAgents(projectId);
    return this.extractData(response);
  }

  async getAgent(agentId: string): Promise<Agent> {
    const response = this.boardService.getAgent(agentId);
    return this.extractData(response);
  }

  async createAgent(data: {
    projectId?: string;
    name: string;
    description?: string;
    systemPrompt: string;
    model?: string;
    icon?: string;
  }): Promise<Agent> {
    const response = this.boardService.createAgent(data);
    return this.extractData(response);
  }

  async updateAgent(agentId: string, data: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    model?: string;
    icon?: string;
    enabled?: boolean;
  }): Promise<Agent> {
    const response = this.boardService.updateAgent(agentId, data);
    return this.extractData(response);
  }

  async deleteAgent(agentId: string): Promise<{ success: boolean }> {
    const response = this.boardService.deleteAgent(agentId);
    return this.extractData(response);
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private async extractData<T>(response: Response): Promise<T> {
    const result = await response.json() as { success?: boolean; data?: T; error?: string };
    if (result.error) {
      throw new Error(result.error);
    }
    return result.data as T;
  }
}
