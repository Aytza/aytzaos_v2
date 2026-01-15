/**
 * Company Scout handlers
 *
 * Specialized handlers for Company Scout workflows that use the
 * Company Scout system prompt for intelligent company research.
 */

import { type AgentWorkflowParams } from '../workflows/AgentWorkflow';
import { COMPANY_SCOUT_SYSTEM_PROMPT, COMPANY_SCOUT_AGENT } from '../companyScout';
import { jsonResponse } from '../utils/response';
import { logger } from '../utils/logger';
import { CREDENTIAL_TYPES } from '../constants';
import type { BoardDO } from '../BoardDO';

type BoardDOStub = DurableObjectStub<BoardDO>;

/**
 * Handle starting a Company Scout workflow
 * Creates a task and starts the workflow with the Company Scout agent
 */
export async function handleStartCompanyScout(
  request: Request,
  env: Env,
  boardStub: BoardDOStub,
  userId: string
): Promise<Response> {
  if (!env.AGENT_WORKFLOW) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Agent workflow not configured' },
    }, 500);
  }

  // Parse request body
  const body = await request.json() as {
    query: string;
  };

  if (!body.query?.trim()) {
    return jsonResponse({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Search query is required' },
    }, 400);
  }

  const query = body.query.trim();
  const boardId = `user-tasks-${userId}`;

  // Create the task
  let task: { id: string; title: string; description?: string | null };
  try {
    task = await boardStub.createTask({
      title: `Company Scout: ${query.slice(0, 50)}${query.length > 50 ? '...' : ''}`,
      description: `<p>Find and evaluate companies matching: <strong>${query}</strong></p>`,
      priority: 'medium',
    });
  } catch (error) {
    logger.workflow.error('Failed to create scout task', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'Failed to create scout task' },
    }, 500);
  }

  // Create a plan record
  const planId = crypto.randomUUID();

  try {
    await boardStub.createWorkflowPlan(task.id, {
      id: planId,
      projectId: boardId,
    });
  } catch (error) {
    logger.workflow.error('Failed to create plan record', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'Failed to create plan record' },
    }, 500);
  }

  // Get Anthropic API key
  const anthropicApiKey = env.ANTHROPIC_API_KEY ||
    await boardStub.getCredentialValue(boardId, CREDENTIAL_TYPES.ANTHROPIC_API_KEY);

  if (!anthropicApiKey) {
    await boardStub.updateWorkflowPlan(planId, {
      status: 'failed',
      result: { error: 'Anthropic API key not configured' },
    });
    return jsonResponse({
      success: false,
      error: { code: 'NO_ANTHROPIC', message: 'Anthropic API key not configured' },
    }, 400);
  }

  // Start the workflow with Company Scout system prompt
  try {
    const workflowParams: AgentWorkflowParams = {
      planId,
      taskId: task.id,
      projectId: boardId,
      userId,
      taskDescription: query, // Just the query - system prompt provides context
      anthropicApiKey,
      customSystemPrompt: COMPANY_SCOUT_SYSTEM_PROMPT,
      agentModel: COMPANY_SCOUT_AGENT.model,
    };

    await env.AGENT_WORKFLOW.create({
      id: planId,
      params: workflowParams,
    });

    // Return task and plan info
    const plan = await boardStub.getWorkflowPlan(planId);
    return jsonResponse({
      success: true,
      data: {
        task,
        plan,
      },
    });
  } catch (error) {
    await boardStub.updateWorkflowPlan(planId, {
      status: 'failed',
      result: { error: error instanceof Error ? error.message : 'Failed to start scout' },
    });
    logger.workflow.error('Failed to start scout workflow', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({
      success: false,
      error: { code: 'WORKFLOW_FAILED', message: 'Failed to start Company Scout' },
    }, 500);
  }
}
