/**
 * AgentWorkflow - Dynamic agent-driven workflow execution
 *
 * Runs a Claude agent loop that dynamically creates steps as it reasons
 * through the task. Each agent turn and tool call becomes a durable step.
 *
 * Key features:
 * - No upfront code generation - agent reasons step-by-step
 * - Dynamic step creation with real-time UI updates
 * - Streaming responses via WebSocket
 * - Agent-initiated approvals via special tool
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock, ToolUseBlock, TextBlock, Tool } from '@anthropic-ai/sdk/resources/messages';
import {
  getMCPByServerName,
  getMCPTools,
  getAlwaysEnabledAccounts,
  getOAuthAccounts,
  getWorkflowGuidance,
  type MCPCredentials,
  type MCPEnvBindings,
  type AccountDefinition,
} from '../mcp/AccountMCPRegistry';
import { MCPClient, type MCPServerConfig } from '../mcp/MCPClient';
import { logger } from '../utils/logger';
import type { BoardDO } from '../BoardDO';

// Constants
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

// Workflow parameters
export interface AgentWorkflowParams {
  planId: string;
  taskId: string;
  projectId: string;
  /** User ID for loading global MCPs */
  userId: string;
  taskDescription: string;
  anthropicApiKey: string;
  /** Custom system prompt from custom agent */
  customSystemPrompt?: string;
  /** Custom model from custom agent */
  agentModel?: string;
  /** Conversation history for resume/continue (MessageParam[]) */
  conversationHistory?: Array<{ role: string; content: unknown }>;
  /** User feedback when resuming a workflow */
  resumeFeedback?: string;
}

// Event sent to resume from checkpoint
export interface CheckpointEvent {
  action: 'approve' | 'request_changes' | 'cancel';
  feedback?: string;
  // User-edited data from approval form (e.g., PR title/body), passed as JSON string for serialization
  dataJson?: string;
}

// Extended Env with workflow bindings
// Uses index signature for dynamic MCP env bindings (Sandbox, GOOGLE_CLIENT_ID, etc.)
interface WorkflowEnv {
  BOARD_DO: DurableObjectNamespace;
  [key: string]: unknown;
}

// Step type for UI display
interface AgentStep {
  id: string;
  name: string;
  type: 'agent' | 'tool' | 'approval';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval';
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
  // For agent steps
  thinking?: string;
  // For tool steps
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  // For approval steps
  approvalMessage?: string;
  approvalData?: unknown;
}

// Artifact created during execution
interface WorkflowArtifact {
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

// MCP tool info for loading
interface MCPServerInfo {
  id: string;
  name: string;
  type: 'remote' | 'hosted';
  endpoint?: string;
  authType: string;
  transportType?: 'streamable-http' | 'sse';
  credentialId?: string;
  accessToken?: string; // OAuth access token for remote servers
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    approvalRequiredFields?: string[];
  }>;
}

// Store for all credentials during workflow execution
interface CredentialStore {
  googleToken?: string;
  googleRefreshToken?: string;
  googleTokenExpiresAt?: string;
  githubToken?: string;
  anthropicApiKey?: string;
  // Index signature for dynamic credential types
  [key: string]: string | undefined;
}

/**
 * Convert internal tool name to user-friendly display name
 * e.g. "Google_Docs__createDocument" -> "Create Document"
 */
function formatToolName(toolName: string): string {
  // Split server__method format
  const parts = toolName.split('__');
  const method = parts.length > 1 ? parts[1] : toolName;

  // Convert camelCase to Title Case with spaces
  return method
    .replace(/([A-Z])/g, ' $1') // Add space before capitals
    .replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
    .trim();
}

export class AgentWorkflow extends WorkflowEntrypoint<WorkflowEnv, AgentWorkflowParams> {
  async run(event: WorkflowEvent<AgentWorkflowParams>, step: WorkflowStep) {
    const params = event.payload;
    const { planId, projectId, userId, taskDescription, anthropicApiKey, customSystemPrompt, agentModel, conversationHistory, resumeFeedback } = params;

    const getBoardStub = (): DurableObjectStub<BoardDO> => {
      const doId = this.env.BOARD_DO.idFromName(projectId);
      return this.env.BOARD_DO.get(doId) as DurableObjectStub<BoardDO>;
    };

    // Get user's global container for global MCPs
    const getUserGlobalStub = (): DurableObjectStub<BoardDO> => {
      const userTasksId = `user-tasks-${userId}`;
      const doId = this.env.BOARD_DO.idFromName(userTasksId);
      return this.env.BOARD_DO.get(doId) as DurableObjectStub<BoardDO>;
    };

    const updatePlan = async (data: Record<string, unknown>) => {
      const stub = getBoardStub();
      await stub.updateWorkflowPlan(planId, data);
    };

    const addLog = async (level: string, message: string, stepId?: string, metadata?: object) => {
      const stub = getBoardStub();
      stub.addWorkflowLog(planId, level, message, stepId, metadata);
    };

    const broadcastStreamChunk = async (turnIndex: number, text: string) => {
      const stub = getBoardStub();
      stub.broadcastStreamChunk(projectId, planId, turnIndex, text);
    };

    try {
      const mcpConfigJson = await step.do('load-mcp-config', async () => {
        const stub = getBoardStub();
        const globalStub = getUserGlobalStub();

        // Load project-specific MCP servers
        const rawServers = await stub.getMCPServers(projectId);
        const enabledServers = rawServers.filter((s: { enabled: boolean }) => s.enabled);

        // Load global MCP servers (user-level)
        type MCPServerRow = { id: string; name: string; type: string; endpoint: string | null; authType: string; transportType: string | null; credentialId: string | null; enabled: boolean };
        let globalRawServers: MCPServerRow[] = [];
        try {
          globalRawServers = await globalStub.getMCPServers('__global__') as MCPServerRow[];
        } catch {
          // User container may not exist yet, ignore
        }
        const enabledGlobalServers = globalRawServers.filter((s) => s.enabled);

        const servers: MCPServerInfo[] = [];

        // Process global servers first
        for (const server of enabledGlobalServers) {
          const tools = await globalStub.getMCPServerTools(server.id);

          let accessToken: string | undefined;
          if (server.type === 'remote' && server.authType === 'oauth' && server.credentialId) {
            const credData = await globalStub.getCredentialById('__global__', server.credentialId);
            if (credData) {
              accessToken = credData.value;
            }
          }

          servers.push({
            id: server.id,
            name: server.name,
            type: server.type as 'remote' | 'hosted',
            endpoint: server.endpoint || undefined,
            authType: server.authType,
            transportType: server.transportType as 'streamable-http' | 'sse' | undefined,
            credentialId: server.credentialId || undefined,
            accessToken,
            tools: tools.map((t: { name: string; description?: string | null; inputSchema: object; approvalRequiredFields?: string[] | null }) => ({
              name: t.name,
              description: t.description || '',
              inputSchema: t.inputSchema as Record<string, unknown>,
              approvalRequiredFields: t.approvalRequiredFields || undefined,
            })),
          });
        }

        // Process project-specific servers
        for (const server of enabledServers) {
          const tools = await stub.getMCPServerTools(server.id);

          let accessToken: string | undefined;
          if (server.type === 'remote' && server.authType === 'oauth' && server.credentialId) {
            const credData = await stub.getCredentialById(projectId, server.credentialId);
            if (credData) {
              accessToken = credData.value;
            }
          }

          servers.push({
            id: server.id,
            name: server.name,
            type: server.type as 'remote' | 'hosted',
            endpoint: server.endpoint || undefined,
            authType: server.authType,
            transportType: server.transportType as 'streamable-http' | 'sse' | undefined,
            credentialId: server.credentialId || undefined,
            accessToken,
            tools: tools.map((t: { name: string; description?: string | null; inputSchema: object; approvalRequiredFields?: string[] | null }) => ({
              name: t.name,
              description: t.description || '',
              inputSchema: t.inputSchema as Record<string, unknown>,
              approvalRequiredFields: t.approvalRequiredFields || undefined,
            })),
          });
        }

        for (const account of getAlwaysEnabledAccounts()) {
          for (const mcp of account.mcps) {
            const tools = getMCPTools(account.id, mcp.id);
            servers.push({
              id: `${account.id}-builtin`,
              name: mcp.serverName, // Use serverName for tool prefix (matches getMCPByServerName lookup)
              type: 'hosted',
              authType: account.authType,
              tools: tools.map(t => ({
                name: t.name,
                description: t.description || '',
                inputSchema: t.inputSchema as unknown as Record<string, unknown>,
              })),
            });
          }
        }

        const credentials: Record<string, string | undefined> = {
          anthropicApiKey,
        };

        for (const account of getOAuthAccounts()) {
          const credData = await stub.getCredentialFull(projectId, account.credentialType);

          const tokenKey = `${account.id}Token`;
          let accessToken = credData?.value;

          if (credData?.metadata && account.refreshToken) {
            try {
              const metadata = credData.metadata as Record<string, unknown>;
              if (metadata.refresh_token) {
                const needsRefresh = !metadata.expires_at ||
                  Date.now() > new Date(metadata.expires_at as string).getTime() - TOKEN_REFRESH_BUFFER_MS;

                if (needsRefresh) {
                  logger.workflow.info('Refreshing token', { account: account.id });

                  const clientIdKey = `${account.id.toUpperCase()}_CLIENT_ID`;
                  const clientSecretKey = `${account.id.toUpperCase()}_CLIENT_SECRET`;
                  const clientId = (this.env as Record<string, unknown>)[clientIdKey] as string | undefined;
                  const clientSecret = (this.env as Record<string, unknown>)[clientSecretKey] as string | undefined;

                  if (clientId && clientSecret) {
                    const newTokenData = await account.refreshToken(
                      metadata.refresh_token as string,
                      clientId,
                      clientSecret
                    );
                    accessToken = newTokenData.access_token;

                    const newExpiresAt = new Date(
                      Date.now() + (newTokenData.expires_in || 3600) * 1000
                    ).toISOString();

                    await stub.updateCredentialValue(projectId, account.credentialType, newTokenData.access_token, { expires_at: newExpiresAt });

                    credentials[`${account.id}RefreshToken`] = metadata.refresh_token as string;
                    credentials[`${account.id}TokenExpiresAt`] = newExpiresAt;
                  }
                } else {
                  credentials[`${account.id}RefreshToken`] = metadata.refresh_token as string;
                  credentials[`${account.id}TokenExpiresAt`] = metadata.expires_at as string;
                }
              }
            } catch (e) {
              logger.workflow.error('Token refresh error', { account: account.id, error: e instanceof Error ? e.message : String(e) });
            }
          }

          credentials[tokenKey] = accessToken;
        }

        return JSON.stringify({
          servers,
          credentials,
        });
      });

      const mcpConfig = JSON.parse(mcpConfigJson) as {
        servers: MCPServerInfo[];
        credentials: CredentialStore;
      };

      const claudeTools = this.buildClaudeTools(mcpConfig.servers);
      // Use custom system prompt if provided, otherwise build default
      const systemPrompt = customSystemPrompt
        ? this.buildSystemPromptWithCustom(customSystemPrompt, mcpConfig.servers)
        : this.buildSystemPrompt(mcpConfig.servers);
      // Use custom model if provided, otherwise use default
      const modelToUse = agentModel || DEFAULT_MODEL;

      // Initialize messages - either from conversation history (resume) or fresh start
      let messages: MessageParam[];
      const isResume = conversationHistory && conversationHistory.length > 0;

      if (isResume) {
        // Resume: Load existing conversation history
        messages = conversationHistory as MessageParam[];
        // Add resume feedback as a new user message if provided
        if (resumeFeedback) {
          messages.push({ role: 'user', content: resumeFeedback });
        }
      } else {
        // Fresh start: Begin with task description
        messages = [{ role: 'user', content: taskDescription }];
      }

      const steps: AgentStep[] = [];
      const artifacts: WorkflowArtifact[] = [];
      // For resume, calculate turn index based on existing assistant messages
      const startingTurnIndex = isResume ? Math.floor(messages.filter(m => m.role === 'assistant').length) : 0;
      let turnIndex = startingTurnIndex;
      let done = false;
      let isFirstTurnOfSession = true;

      while (!done && turnIndex < 50) {
        const currentTurnIndex = turnIndex;

        const turnResultJson = await step.do(`turn-${currentTurnIndex}`, async () => {
          // Log start/resume message on first turn of this session
          if (isFirstTurnOfSession) {
            await updatePlan({
              status: 'executing',
              steps: [],
            });
            await addLog('info', isResume ? 'Agent resumed working on task' : 'Agent started working on task');
          }

          const client = new Anthropic({ apiKey: mcpConfig.credentials.anthropicApiKey });

          const stream = client.messages.stream({
            model: modelToUse,
            max_tokens: 8192,
            system: systemPrompt,
            messages,
            tools: claudeTools,
          });

          stream.on('text', async (text) => {
            broadcastStreamChunk(currentTurnIndex, text).catch((e) =>
              logger.workflow.error('Stream broadcast failed', { error: e instanceof Error ? e.message : String(e) })
            );
          });

          const finalMessage = await stream.finalMessage();

          const textContent = finalMessage.content
            .filter((block): block is TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n');

          const agentStep: AgentStep = {
            id: `turn-${currentTurnIndex}`,
            name: textContent.length > 50 ? textContent.substring(0, 50) + '...' : (textContent || 'Thinking...'),
            type: 'agent',
            status: 'completed',
            completedAt: new Date().toISOString(),
            thinking: textContent,
          };

          return JSON.stringify({
            response: {
              id: finalMessage.id,
              role: finalMessage.role,
              content: finalMessage.content,
              stop_reason: finalMessage.stop_reason,
              usage: finalMessage.usage,
            },
            agentStep,
            textContent,
          });
        });

        const turnResult = JSON.parse(turnResultJson) as {
          response: {
            id: string;
            role: 'assistant';
            content: ContentBlock[];
            stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
            usage: { input_tokens: number; output_tokens: number };
          };
          agentStep: AgentStep;
          textContent: string;
        };

        const { response, agentStep, textContent } = turnResult;
        steps.push(agentStep);

        // Fire-and-forget to avoid extra checkpoint
        updatePlan({ steps: [...steps] }).catch((e) =>
          logger.workflow.error('Plan update failed', { error: e instanceof Error ? e.message : String(e) })
        );
        if (textContent) {
          addLog('info', textContent.substring(0, 200), agentStep.id).catch(() => {});
        }

        messages.push({ role: 'assistant', content: response.content });

        const toolUses = response.content.filter(
          (block): block is ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUses.length > 0) {
          const toolResults: Array<{
            type: 'tool_result';
            tool_use_id: string;
            content: string;
            is_error?: boolean;
          }> = [];

          for (const toolUse of toolUses) {
            const toolStepId = `tool-${currentTurnIndex}-${toolUse.id}`;

            if (toolUse.name === 'request_approval') {
              // Handle approval request
              const approvalArgs = toolUse.input as {
                tool: string;
                action: string;
                data: Record<string, unknown>;
              };

              // Validate required fields from tool metadata
              // Tool name format: "ServerName__methodName"
              const [serverName, methodName] = approvalArgs.tool.split('__');
              const matchingServer = mcpConfig.servers.find((s: MCPServerInfo) => s.name.replace(/\s+/g, '_') === serverName);
              const matchingTool = matchingServer?.tools.find((t: { name: string; approvalRequiredFields?: string[] }) => t.name === methodName);
              const required = matchingTool?.approvalRequiredFields;

              if (required && required.length > 0) {
                const missing = required.filter((f: string) => !approvalArgs.data?.[f]);
                if (missing.length > 0) {
                  // Return error to agent asking for required fields
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: `Error: Missing required fields for ${approvalArgs.tool}: ${missing.join(', ')}. Please include these fields in the data parameter: ${required.map((f: string) => `"${f}"`).join(', ')}.`,
                    is_error: true,
                  });
                  continue;
                }
              }

              const approvalStep: AgentStep = {
                id: toolStepId,
                name: approvalArgs.action || 'Waiting for approval',
                type: 'approval',
                status: 'awaiting_approval',
                startedAt: new Date().toISOString(),
                toolName: approvalArgs.tool,
                approvalData: approvalArgs.data,
              };
              steps.push(approvalStep);

              // Update plan and wait for approval
              await step.do(`checkpoint-setup-${toolStepId}`, async () => {
                await updatePlan({
                  status: 'checkpoint',
                  steps: [...steps],
                  checkpointData: {
                    stepId: toolStepId,
                    tool: approvalArgs.tool,
                    action: approvalArgs.action,
                    data: approvalArgs.data,
                  },
                });
                await addLog('info', `Requesting approval: ${approvalArgs.action}`, toolStepId);
                return 'checkpoint';
              });

              // Wait for user approval event
              const approvalEvent = await step.waitForEvent<CheckpointEvent>(
                `Wait for approval: ${approvalArgs.action}`,
                { type: 'checkpoint-approval', timeout: '7 days' }
              );

              // Process approval result
              const approvalAction = approvalEvent.payload.action;
              const approvalFeedback = approvalEvent.payload.feedback;

              await step.do(`checkpoint-resolve-${toolStepId}`, async () => {
                if (approvalAction === 'cancel') {
                  // User cancelled - fail the workflow
                  const stepIndex = steps.findIndex((s) => s.id === toolStepId);
                  if (stepIndex >= 0) {
                    steps[stepIndex].status = 'failed';
                    steps[stepIndex].error = 'User cancelled';
                    steps[stepIndex].completedAt = new Date().toISOString();
                  }
                  await updatePlan({
                    status: 'failed',
                    steps: [...steps],
                  });
                  throw new Error('User cancelled the workflow');
                }

                if (approvalAction === 'request_changes') {
                  // User requested changes - update step and continue with feedback
                  const stepIndex = steps.findIndex((s) => s.id === toolStepId);
                  if (stepIndex >= 0) {
                    steps[stepIndex].status = 'completed';
                    steps[stepIndex].completedAt = new Date().toISOString();
                  }
                  await updatePlan({
                    status: 'executing',
                    steps: [...steps],
                    checkpointData: undefined,
                  });
                  await addLog('info', `User requested changes: ${approvalFeedback?.substring(0, 100) || ''}`, toolStepId);
                  return 'request_changes';
                }

                // Update step as approved
                const stepIndex = steps.findIndex((s) => s.id === toolStepId);
                if (stepIndex >= 0) {
                  steps[stepIndex].status = 'completed';
                  steps[stepIndex].completedAt = new Date().toISOString();
                }
                await updatePlan({
                  status: 'executing',
                  steps: [...steps],
                  checkpointData: undefined,
                });
                await addLog('info', 'User approved', toolStepId);
                return 'approved';
              });

              let userData: Record<string, unknown> | undefined;
              if (approvalEvent.payload.dataJson) {
                try {
                  userData = JSON.parse(approvalEvent.payload.dataJson);
                } catch {
                  // Ignore invalid JSON
                }
              }

              if (approvalAction === 'request_changes') {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({
                    approved: false,
                    action: 'request_changes',
                    feedback: approvalFeedback || 'User requested changes without specific feedback',
                    message: 'The user has requested changes. Please address the feedback and request approval again.',
                  }),
                });
              } else {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({
                    approved: true,
                    feedback: approvalFeedback,
                    ...(userData && { userData }),
                  }),
                });
              }
            } else {
              const toolResultJson = await step.do(`tool-${toolStepId}`, async () => {
                const startTime = Date.now();
                const toolStepData: AgentStep = {
                  id: toolStepId,
                  name: formatToolName(toolUse.name),
                  type: 'tool',
                  status: 'running',
                  startedAt: new Date().toISOString(),
                  toolName: toolUse.name,
                  toolArgs: toolUse.input as Record<string, unknown>,
                };

                await addLog(
                  'info',
                  `Calling ${formatToolName(toolUse.name)}`,
                  toolStepId,
                  { type: 'tool_call', tool: toolUse.name, args: toolUse.input }
                );

                let success = false;
                let result: unknown;
                let error: string | undefined;

                try {
                  result = await this.executeMcpTool(
                    toolUse.name,
                    toolUse.input as Record<string, unknown>,
                    mcpConfig.credentials,
                    mcpConfig.servers
                  );
                  const mcpResult = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
                  if (mcpResult.isError) {
                    error = mcpResult.content?.find(c => c.type === 'text')?.text || 'Tool returned error';
                  } else {
                    success = true;
                  }
                } catch (e) {
                  error = e instanceof Error ? e.message : String(e);
                }

                const durationMs = Date.now() - startTime;

                toolStepData.status = success ? 'completed' : 'failed';
                toolStepData.completedAt = new Date().toISOString();
                toolStepData.durationMs = durationMs;
                toolStepData.result = success ? result : undefined;
                toolStepData.error = error;

                await addLog(
                  success ? 'info' : 'error',
                  success
                    ? `Tool completed in ${durationMs}ms`
                    : `Tool failed: ${error}`,
                  toolStepId,
                  { type: 'tool_result', durationMs }
                );

                return JSON.stringify({
                  toolStep: toolStepData,
                  success,
                  result: success ? result : undefined,
                  error,
                });
              });

              const toolResultData = JSON.parse(toolResultJson) as {
                toolStep: AgentStep;
                success: boolean;
                result?: unknown;
                error?: string;
              };

              steps.push(toolResultData.toolStep);

              // Fire-and-forget to avoid extra checkpoint
              updatePlan({ steps: [...steps] }).catch((e) =>
                logger.workflow.error('Plan update failed', { error: e instanceof Error ? e.message : String(e) })
              );

              if (toolResultData.success && toolResultData.result) {
                const artifact = this.extractArtifact(toolUse.name, toolResultData.result);
                if (artifact) {
                  artifacts.push(artifact);
                }
              }

              if (toolResultData.success) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(toolResultData.result),
                });
              } else {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: `Error: ${toolResultData.error}`,
                  is_error: true,
                });
              }
            }
          }

          messages.push({ role: 'user', content: toolResults });
        } else if (response.stop_reason === 'end_turn') {
          done = true;
        }

        // Save conversation history after each turn for resume capability
        updatePlan({ conversationHistory: messages }).catch((e) =>
          logger.workflow.error('Failed to save conversation history', { error: e instanceof Error ? e.message : String(e) })
        );

        isFirstTurnOfSession = false;
        turnIndex++;
      }

      const failedSteps = steps.filter((s) => s.status === 'failed');
      const hasFailures = failedSteps.length > 0;
      const hasArtifacts = artifacts.length > 0;

      // If artifacts were produced, agent succeeded even with intermediate failures
      const isSuccess = hasArtifacts || !hasFailures;

      await step.do('complete', async () => {
        if (isSuccess) {
          await updatePlan({
            status: 'completed',
            steps: [...steps],
            result: {
              success: true,
              totalTurns: turnIndex,
              artifacts: hasArtifacts ? artifacts : undefined,
              warnings:
                hasFailures
                  ? failedSteps.map((s) => ({ name: s.name, error: s.error }))
                  : undefined,
            },
          });
          if (hasFailures) {
            await addLog(
              'info',
              `Agent completed successfully (${failedSteps.length} intermediate tool error(s) were handled)`
            );
          } else {
            await addLog('info', 'Agent completed task successfully');
          }
        } else {
          await updatePlan({
            status: 'failed',
            steps: [...steps],
            result: {
              success: false,
              totalTurns: turnIndex,
              error: `${failedSteps.length} tool(s) failed`,
              failedSteps: failedSteps.map((s) => ({ name: s.name, error: s.error })),
            },
          });
          await addLog('error', `Agent failed: ${failedSteps.length} tool error(s)`);
        }
        return 'completed';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.workflow.error('Workflow error', { error: message });

      await step.do('handle-error', async () => {
        await updatePlan({
          status: 'failed',
          result: { success: false, error: message },
        });
        await addLog('error', `Workflow failed: ${message}`);
        return 'error';
      });

      throw error;
    }
  }

  /**
   * Build Claude tools from MCP server definitions
   */
  private buildClaudeTools(servers: MCPServerInfo[]): Tool[] {
    const tools: Tool[] = [];

    for (const server of servers) {
      for (const tool of server.tools) {
        const inputSchema = tool.inputSchema as Tool['input_schema'];
        if (!inputSchema.type) {
          inputSchema.type = 'object';
        }
        tools.push({
          name: `${server.name.replace(/\s+/g, '_')}__${tool.name}`,
          description: `[${server.name}] ${tool.description}`,
          input_schema: inputSchema,
        });
      }
    }

    tools.push({
      name: 'request_approval',
      description:
        'Pause execution and ask user for approval before proceeding. Use this before sending emails, creating documents, or any action that cannot be undone.',
      input_schema: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: 'The MCP tool that will be called if approved (e.g., "Google_Docs__createDocument", "Gmail__sendMessage")',
          },
          action: {
            type: 'string',
            description: 'Short human-readable action label (e.g., "Create Document", "Send Email")',
          },
          data: {
            type: 'object',
            description: 'The exact data that will be passed to the tool (e.g., { title: "...", content: "..." } for docs)',
          },
        },
        required: ['tool', 'action', 'data'],
      },
    });

    return tools;
  }

  /**
   * Build system prompt for the agent
   * Uses registry-based workflow guidance for each enabled MCP
   */
  private buildSystemPrompt(servers: MCPServerInfo[]): string {
    const toolsList = servers
      .map((s) => `- **${s.name}**: ${s.tools.map((t) => t.name).join(', ')}`)
      .join('\n');

    const serverNames = servers.map(s => s.name.replace(/\s+/g, '_'));
    const workflowGuidance = getWorkflowGuidance(serverNames);

    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return `You are a helpful AI assistant that accomplishes tasks using available tools.

**Today's date:** ${currentDate}

## CRITICAL: First Step for Every Task
**Your very first action for ANY task must be to ask clarifying questions using AskUser.**
Before doing ANY work (no searching, no tool calls), you MUST call:
\`\`\`
request_approval({
  tool: "AskUser__askQuestions",
  action: "Clarify Requirements",
  data: { questions: [...] }
})
\`\`\`
Ask about: output format, specific requirements, scope, and any preferences.
DO NOT skip this step. DO NOT assume what the user wants.

## Available Tools
${toolsList}
- **request_approval**: Pause and ask user for approval

## Guidelines
1. **Think step by step** - Break down complex tasks into smaller steps
2. **Use tools effectively** - Call tools to gather information and take actions
3. **Request approval before irreversible actions** - Use request_approval before sending emails, creating documents, making commits, etc.
4. **Be concise** - Keep responses focused and to the point
5. **Handle errors gracefully** - If a tool fails, try to recover or explain what went wrong

## Approval Guidelines
Always request approval before:
- Sending emails or messages
- Creating or modifying documents or spreadsheets
- Making commits or pushing code
- Any action that modifies external systems

When requesting approval, include:
- Clear description of what you want to do
- Preview of the content (email body, document content, etc.)
- Any relevant context the user needs to make a decision

**CRITICAL: Handling user edits in approval responses**
When the approval result contains a \`userData\` field, the user has edited the data during approval.
You MUST use the values from \`userData\` to override your original data when calling the actual tool.

This applies to ALL approval types - emails, documents, PRs, etc. Always check for userData and use those values.

${workflowGuidance}

## Output Guidelines
When providing final outputs to the user:
- Be minimal - only include the requested content
- No extra headers, metadata, or footers
- No "Here is..." preambles or "I've created..." explanations
- Just the content itself`;
  }

  /**
   * Build system prompt with custom agent prompt
   * Combines the custom prompt with tool information and standard guidelines
   */
  private buildSystemPromptWithCustom(customPrompt: string, servers: MCPServerInfo[]): string {
    const toolsList = servers
      .map((s) => `- **${s.name}**: ${s.tools.map((t) => t.name).join(', ')}`)
      .join('\n');

    const serverNames = servers.map(s => s.name.replace(/\s+/g, '_'));
    const workflowGuidance = getWorkflowGuidance(serverNames);

    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return `${customPrompt}

**Today's date:** ${currentDate}

## CRITICAL: First Step for Every Task
**Your very first action for ANY task must be to ask clarifying questions using AskUser.**
Before doing ANY work (no searching, no tool calls), you MUST call:
\`\`\`
request_approval({
  tool: "AskUser__askQuestions",
  action: "Clarify Requirements",
  data: { questions: [...] }
})
\`\`\`
Ask about: output format, specific requirements, scope, and any preferences.
DO NOT skip this step. DO NOT assume what the user wants.

## Available Tools
${toolsList}
- **request_approval**: Pause and ask user for approval

## Tool Usage Guidelines
- Use request_approval before any irreversible actions (sending emails, creating documents, etc.)
- When approval includes \`userData\`, use those values to override your original data

${workflowGuidance}`;
  }

  /**
   * Get a valid access token for any OAuth account, refreshing if needed
   */
  private async ensureValidToken(
    account: AccountDefinition,
    credentials: CredentialStore
  ): Promise<string> {
    // Build credential keys based on account id (e.g., 'google' -> 'googleToken')
    const tokenKey = `${account.id}Token`;
    const refreshTokenKey = `${account.id}RefreshToken`;
    const expiresAtKey = `${account.id}TokenExpiresAt`;

    const accessToken = credentials[tokenKey];
    const refreshToken = credentials[refreshTokenKey];
    const expiresAt = credentials[expiresAtKey];

    if (!accessToken) {
      throw new Error(`${account.name} OAuth not configured`);
    }

    // Check if token needs refresh
    if (refreshToken && expiresAt && account.refreshToken) {
      const expiresAtMs = new Date(expiresAt).getTime();
      const now = Date.now();

      if (now > expiresAtMs - TOKEN_REFRESH_BUFFER_MS) {
        logger.workflow.info('Refreshing expired token', { account: account.name });

        // Get client credentials from env using account id pattern
        const clientIdKey = `${account.id.toUpperCase()}_CLIENT_ID` as keyof WorkflowEnv;
        const clientSecretKey = `${account.id.toUpperCase()}_CLIENT_SECRET` as keyof WorkflowEnv;
        const clientId = this.env[clientIdKey] as string | undefined;
        const clientSecret = this.env[clientSecretKey] as string | undefined;

        if (!clientId || !clientSecret) {
          throw new Error(`Missing OAuth config for ${account.name}`);
        }

        const newTokenData = await account.refreshToken(
          refreshToken,
          clientId,
          clientSecret
        );

        credentials[tokenKey] = newTokenData.access_token;
        credentials[expiresAtKey] = new Date(
          Date.now() + (newTokenData.expires_in || 3600) * 1000
        ).toISOString();

        logger.workflow.info('Token refreshed successfully', { account: account.name });
        return newTokenData.access_token;
      }
    }

    return accessToken;
  }

  /**
   * Execute an MCP tool using registry-based dispatch
   */
  private async executeMcpTool(
    toolName: string,
    args: Record<string, unknown>,
    credentials: CredentialStore,
    servers: MCPServerInfo[]
  ): Promise<unknown> {
    const parts = toolName.split('__');
    if (parts.length !== 2) {
      throw new Error(`Invalid tool name format: ${toolName}`);
    }

    const [serverName, method] = parts;

    const lookup = getMCPByServerName(serverName);

    if (lookup) {
      return this.executeHostedMcpTool(lookup, method, args, credentials);
    }

    const remoteServer = servers.find(s => {
      const normalized = s.name.replace(/[^a-zA-Z0-9]/g, '_');
      return normalized === serverName;
    });

    if (remoteServer && remoteServer.type === 'remote') {
      return this.executeRemoteMcpTool(remoteServer, method, args);
    }

    throw new Error(`Unknown MCP server: ${serverName}`);
  }

  /**
   * Execute a tool on a hosted MCP server (Gmail, Docs, etc.)
   * Uses registry-driven credential and env binding configuration
   */
  private async executeHostedMcpTool(
    lookup: { account: AccountDefinition; mcp: { factory: (creds: MCPCredentials, env: MCPEnvBindings) => { callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> } } },
    method: string,
    args: Record<string, unknown>,
    credentials: CredentialStore
  ): Promise<unknown> {
    const { account, mcp } = lookup;

    const mcpCredentials: MCPCredentials = {};

    if (account.authType === 'oauth') {
      const accessToken = await this.ensureValidToken(account, credentials);
      mcpCredentials.accessToken = accessToken;
    }

    if (account.additionalCredentialKeys) {
      for (const key of account.additionalCredentialKeys) {
        if (credentials[key]) {
          mcpCredentials[key] = credentials[key];
        }
      }
    }

    const envBindings: MCPEnvBindings = {};
    if (account.envBindingKeys) {
      for (const key of account.envBindingKeys) {
        const value = (this.env as Record<string, unknown>)[key];
        if (value !== undefined) {
          envBindings[key] = value;
        }
      }
    }

    const server = mcp.factory(mcpCredentials, envBindings);
    return await server.callTool(method, args);
  }

  /**
   * Execute a tool on a remote MCP server (user-added servers like Cloudflare Docs)
   */
  private async executeRemoteMcpTool(
    server: MCPServerInfo,
    method: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!server.endpoint) {
      throw new Error(`Remote MCP server ${server.name} has no endpoint configured`);
    }

    const config: MCPServerConfig = {
      id: server.id,
      name: server.name,
      type: 'remote',
      endpoint: server.endpoint,
      authType: server.authType as MCPServerConfig['authType'],
      transportType: server.transportType || 'streamable-http',
    };

    if (server.authType === 'oauth' && server.accessToken) {
      config.credentials = { token: server.accessToken };
    }

    const client = new MCPClient(config);

    try {
      await client.initialize();
      const result = await client.callTool(method, args);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Remote MCP tool call failed: ${message}`);
    }
  }

  /**
   * Extract artifact from tool result using registry-based type lookup
   */
  private extractArtifact(toolName: string, result: unknown): WorkflowArtifact | null {
    const structured = (result as { structuredContent?: Record<string, unknown> })?.structuredContent;
    if (!structured) return null;

    const url = structured.url as string | undefined;
    const title = structured.title as string | undefined;
    const content = structured.content as WorkflowArtifact['content'] | undefined;

    const [serverName] = toolName.split('__');
    const lookup = getMCPByServerName(serverName);

    if (!lookup?.mcp.artifactType) {
      return url ? { type: 'other', url, title } : null;
    }

    if (lookup.mcp.artifactContentType === 'inline') {
      return content ? { type: lookup.mcp.artifactType, title, content } : null;
    }

    return url ? { type: lookup.mcp.artifactType, url, title } : null;
  }
}
