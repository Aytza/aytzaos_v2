/**
 * Workflow handlers for plan generation, checkpoints, and cancellation
 */

import { type AgentWorkflowParams } from '../workflows/AgentWorkflow';
import { jsonResponse } from '../utils/response';
import { logger } from '../utils/logger';
import { CREDENTIAL_TYPES } from '../constants';
import type { BoardDO } from '../BoardDO';

type BoardDOStub = DurableObjectStub<BoardDO>;

/**
 * Handle generate-plan request - starts agent workflow for a task
 */
export async function handleGeneratePlan(
  env: Env,
  boardStub: BoardDOStub,
  boardId: string,
  taskId: string,
  userId: string,
  agentId?: string
): Promise<Response> {
  if (!env.AGENT_WORKFLOW) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Agent workflow not configured' },
    }, 500);
  }

  // Get the task details
  let task: { id: string; projectId?: string | null; title: string; description?: string | null };
  try {
    task = await boardStub.getTask(taskId);
  } catch {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    }, 404);
  }

  // If an agent is specified, look up its system prompt
  let customSystemPrompt: string | undefined;
  let agentModel: string | undefined;
  if (agentId) {
    try {
      const agent = await boardStub.getAgent(agentId);
      if (agent.enabled) {
        customSystemPrompt = agent.systemPrompt;
        agentModel = agent.model;
      }
    } catch {
      // Agent not found, continue with default
      logger.workflow.warn('Custom agent not found', { agentId });
    }
  }

  // Create a plan record with status 'executing' (skip planning/draft)
  const planId = crypto.randomUUID();

  try {
    await boardStub.createWorkflowPlan(taskId, {
      id: planId,
      projectId: boardId,
      // status is set to 'executing' by default
    });
  } catch {
    return jsonResponse({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'Failed to create plan record' },
    }, 500);
  }

  // Fetch Anthropic API key - prefer env variable, fall back to stored credential
  const anthropicApiKey = env.ANTHROPIC_API_KEY ||
    await boardStub.getCredentialValue(boardId, CREDENTIAL_TYPES.ANTHROPIC_API_KEY);

  if (!anthropicApiKey) {
    await boardStub.updateWorkflowPlan(planId, { status: 'failed', result: { error: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY in your environment.' } });
    return jsonResponse({
      success: false,
      error: { code: 'NO_ANTHROPIC', message: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY in your environment.' },
    }, 400);
  }

  // Combine task title and description for agent
  const taskDescription = task.title && task.description
    ? `${task.title}\n\n${task.description}`
    : task.title || task.description || 'No task description provided';

  // Start the agent workflow directly
  try {
    const workflowParams: AgentWorkflowParams = {
      planId,
      taskId,
      projectId: boardId,
      userId,
      taskDescription,
      anthropicApiKey,
      customSystemPrompt,
      agentModel,
    };

    await env.AGENT_WORKFLOW.create({
      id: planId,
      params: workflowParams,
    });

    // Fetch and return the full plan
    const plan = await boardStub.getWorkflowPlan(planId);
    return jsonResponse({ success: true, data: plan });
  } catch (error) {
    await boardStub.updateWorkflowPlan(planId, {
      status: 'failed',
      result: { error: error instanceof Error ? error.message : 'Failed to start agent' },
    });
    return jsonResponse({
      success: false,
      error: { code: 'WORKFLOW_FAILED', message: 'Failed to start agent workflow' },
    }, 500);
  }
}

/**
 * Handle resolve checkpoint request - resumes workflow after user approval
 */
export async function handleResolveCheckpoint(
  request: Request,
  env: Env,
  boardStub: BoardDOStub,
  _boardId: string,
  planId: string
): Promise<Response> {
  if (!env.AGENT_WORKFLOW) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Agent workflow not configured' },
    }, 500);
  }

  // Get the plan
  let plan: { id: string; taskId: string; projectId: string; status: string };
  try {
    plan = await boardStub.getWorkflowPlan(planId);
  } catch {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Plan not found' },
    }, 404);
  }

  // Parse the checkpoint resolution data
  const body = await request.json() as {
    action: string;
    data?: Record<string, unknown>;
    feedback?: string;
  };

  if (plan.status !== 'checkpoint') {
    return jsonResponse({
      success: false,
      error: { code: 'INVALID_STATE', message: 'Workflow is not at a checkpoint' },
    }, 400);
  }

  // If cancelling (or legacy reject), just update the status and don't resume workflow
  if (body.action === 'cancel' || body.action === 'reject') {
    await boardStub.updateWorkflowPlan(planId, { status: 'failed', result: { error: 'Checkpoint cancelled by user' } });

    const updatedPlan = await boardStub.getWorkflowPlan(planId);
    return jsonResponse({ success: true, data: updatedPlan });
  }

  // For approve or request_changes, send event to resume the waiting workflow
  try {
    const instance = await env.AGENT_WORKFLOW.get(planId);
    await instance.sendEvent({
      type: 'checkpoint-approval',
      payload: {
        action: body.action,
        feedback: body.feedback,
        dataJson: body.data ? JSON.stringify(body.data) : undefined,
      },
    });

    // Allow the workflow to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // Return updated plan
    const updatedPlan = await boardStub.getWorkflowPlan(planId);
    return jsonResponse({ success: true, data: updatedPlan });

  } catch (error) {
    logger.workflow.error('Failed to resume workflow', { planId, error: error instanceof Error ? error.message : String(error) });
    await boardStub.updateWorkflowPlan(planId, {
      status: 'failed',
      result: { error: error instanceof Error ? error.message : 'Failed to resume workflow' },
    });
    return jsonResponse({
      success: false,
      error: { code: 'WORKFLOW_FAILED', message: 'Failed to resume workflow' },
    }, 500);
  }
}

/**
 * Handle resume workflow request - continues a completed/failed workflow with user feedback
 */
export async function handleResumeWorkflow(
  request: Request,
  env: Env,
  boardStub: BoardDOStub,
  boardId: string,
  planId: string,
  userId: string
): Promise<Response> {
  if (!env.AGENT_WORKFLOW) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Agent workflow not configured' },
    }, 500);
  }

  // Get the existing plan
  let existingPlan: {
    id: string;
    taskId: string;
    projectId: string;
    status: string;
    conversationHistory?: object[] | null;
  };
  try {
    existingPlan = await boardStub.getWorkflowPlan(planId);
  } catch {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Plan not found' },
    }, 404);
  }

  // Only allow resuming completed or failed workflows
  if (existingPlan.status !== 'completed' && existingPlan.status !== 'failed') {
    return jsonResponse({
      success: false,
      error: { code: 'INVALID_STATUS', message: `Cannot resume workflow with status: ${existingPlan.status}. Must be completed or failed.` },
    }, 400);
  }

  // Verify conversation history exists
  if (!existingPlan.conversationHistory || existingPlan.conversationHistory.length === 0) {
    return jsonResponse({
      success: false,
      error: { code: 'NO_HISTORY', message: 'No conversation history available to resume from' },
    }, 400);
  }

  // Parse the resume feedback
  const body = await request.json() as { feedback: string };
  if (!body.feedback || body.feedback.trim() === '') {
    return jsonResponse({
      success: false,
      error: { code: 'NO_FEEDBACK', message: 'Resume feedback is required' },
    }, 400);
  }

  // Get the task details
  let task: { id: string; title: string; description?: string | null };
  try {
    task = await boardStub.getTask(existingPlan.taskId);
  } catch {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    }, 404);
  }

  // Create a new plan record for the resumed workflow
  const newPlanId = crypto.randomUUID();
  try {
    await boardStub.createWorkflowPlan(existingPlan.taskId, {
      id: newPlanId,
      projectId: boardId,
    });
  } catch {
    return jsonResponse({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'Failed to create plan record' },
    }, 500);
  }

  // Fetch Anthropic API key
  const anthropicApiKey = env.ANTHROPIC_API_KEY ||
    await boardStub.getCredentialValue(boardId, CREDENTIAL_TYPES.ANTHROPIC_API_KEY);

  if (!anthropicApiKey) {
    await boardStub.updateWorkflowPlan(newPlanId, {
      status: 'failed',
      result: { error: 'Anthropic API key not configured' },
    });
    return jsonResponse({
      success: false,
      error: { code: 'NO_ANTHROPIC', message: 'Anthropic API key not configured' },
    }, 400);
  }

  // Build task description
  const taskDescription = task.title && task.description
    ? `${task.title}\n\n${task.description}`
    : task.title || task.description || 'No task description provided';

  // Start the resumed workflow
  try {
    const workflowParams: AgentWorkflowParams = {
      planId: newPlanId,
      taskId: existingPlan.taskId,
      projectId: boardId,
      userId,
      taskDescription,
      anthropicApiKey,
      conversationHistory: existingPlan.conversationHistory as Array<{ role: string; content: unknown }>,
      resumeFeedback: body.feedback,
    };

    await env.AGENT_WORKFLOW.create({
      id: newPlanId,
      params: workflowParams,
    });

    const plan = await boardStub.getWorkflowPlan(newPlanId);
    return jsonResponse({ success: true, data: plan });
  } catch (error) {
    await boardStub.updateWorkflowPlan(newPlanId, {
      status: 'failed',
      result: { error: error instanceof Error ? error.message : 'Failed to resume workflow' },
    });
    return jsonResponse({
      success: false,
      error: { code: 'WORKFLOW_FAILED', message: 'Failed to resume workflow' },
    }, 500);
  }
}

/**
 * Handle cancel workflow request - terminates running workflow
 */
export async function handleCancelWorkflow(
  env: Env,
  boardStub: BoardDOStub,
  _boardId: string,
  planId: string
): Promise<Response> {
  if (!env.AGENT_WORKFLOW) {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Agent workflow not configured' },
    }, 500);
  }

  // Get the plan
  let plan: { id: string; status: string };
  try {
    plan = await boardStub.getWorkflowPlan(planId);
  } catch {
    return jsonResponse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Plan not found' },
    }, 404);
  }

  // Only allow cancelling running or checkpoint workflows
  if (plan.status !== 'executing' && plan.status !== 'checkpoint') {
    return jsonResponse({
      success: false,
      error: { code: 'INVALID_STATUS', message: `Cannot cancel plan with status: ${plan.status}` },
    }, 400);
  }

  try {
    const instance = await env.AGENT_WORKFLOW.get(planId);
    await instance.terminate();
  } catch (error) {
    logger.workflow.warn('Workflow terminate error (may be expected)', { planId, error: error instanceof Error ? error.message : String(error) });
  }

  // Update plan status to cancelled
  await boardStub.updateWorkflowPlan(planId, {
    status: 'failed',
    result: { error: 'Cancelled by user' },
  });

  // Return updated plan
  const updatedPlan = await boardStub.getWorkflowPlan(planId);
  return jsonResponse({ success: true, data: updatedPlan });
}
