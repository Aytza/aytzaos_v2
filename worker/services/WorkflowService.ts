import { jsonResponse } from '../utils/response';
import { transformWorkflowPlan, transformWorkflowLog } from '../utils/transformations';

type BroadcastFn = (projectId: string, type: string, data: Record<string, unknown>) => void;

export class WorkflowService {
  private sql: SqlStorage;
  private generateId: () => string;
  private broadcast: BroadcastFn;

  constructor(
    sql: SqlStorage,
    generateId: () => string,
    broadcast: BroadcastFn
  ) {
    this.sql = sql;
    this.generateId = generateId;
    this.broadcast = broadcast;
  }

  // ============================================
  // WORKFLOW PLAN OPERATIONS
  // ============================================

  /**
   * Get the latest workflow plan for a task
   */
  getTaskWorkflowPlan(taskId: string): Response {
    const task = this.sql.exec('SELECT id FROM tasks WHERE id = ?', taskId).toArray()[0];
    if (!task) {
      return jsonResponse({ error: 'Task not found' }, 404);
    }

    const plan = this.sql.exec(
      'SELECT * FROM workflow_plans WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      taskId
    ).toArray()[0];

    if (!plan) {
      return jsonResponse({ success: true, data: null });
    }

    return jsonResponse({
      success: true,
      data: transformWorkflowPlan(plan as Record<string, unknown>)
    });
  }

  /**
   * Get all workflow plans for a project (latest per task)
   */
  getProjectWorkflowPlans(projectId: string): Response {
    const plans = this.sql.exec(`
      SELECT wp.* FROM workflow_plans wp
      INNER JOIN (
        SELECT task_id, MAX(created_at) as max_created
        FROM workflow_plans
        WHERE project_id = ?
        GROUP BY task_id
      ) latest ON wp.task_id = latest.task_id AND wp.created_at = latest.max_created
      WHERE wp.project_id = ?
    `, projectId, projectId).toArray();

    return jsonResponse({
      success: true,
      data: plans.map(plan => transformWorkflowPlan(plan as Record<string, unknown>))
    });
  }

  /**
   * Get a specific workflow plan by ID
   */
  getWorkflowPlan(planId: string): Response {
    const plan = this.sql.exec(
      'SELECT * FROM workflow_plans WHERE id = ?',
      planId
    ).toArray()[0];

    if (!plan) {
      return jsonResponse({ error: 'Workflow plan not found' }, 404);
    }

    return jsonResponse({
      success: true,
      data: transformWorkflowPlan(plan as Record<string, unknown>)
    });
  }

  /**
   * Create a new workflow plan
   */
  createWorkflowPlan(taskId: string, data: {
    id?: string;
    projectId: string;
    summary?: string;
    generatedCode?: string;
    steps?: object[];
  }): Response {
    const id = data.id || this.generateId();
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO workflow_plans (id, task_id, project_id, status, summary, generated_code, steps, created_at, updated_at)
       VALUES (?, ?, ?, 'planning', ?, ?, ?, ?, ?)`,
      id,
      taskId,
      data.projectId,
      data.summary || null,
      data.generatedCode || null,
      data.steps ? JSON.stringify(data.steps) : null,
      now,
      now
    );

    return this.getWorkflowPlan(id);
  }

  /**
   * Update a workflow plan
   */
  updateWorkflowPlan(planId: string, data: {
    status?: string;
    summary?: string;
    generatedCode?: string;
    steps?: object[];
    currentStepIndex?: number;
    checkpointData?: object;
    result?: object;
    conversationHistory?: object[];
  }): Response {
    const now = new Date().toISOString();
    const plan = this.sql.exec('SELECT * FROM workflow_plans WHERE id = ?', planId).toArray()[0];

    if (!plan) {
      return jsonResponse({ error: 'Workflow plan not found' }, 404);
    }

    this.sql.exec(
      `UPDATE workflow_plans SET
        status = COALESCE(?, status),
        summary = COALESCE(?, summary),
        generated_code = COALESCE(?, generated_code),
        steps = COALESCE(?, steps),
        current_step_index = COALESCE(?, current_step_index),
        checkpoint_data = COALESCE(?, checkpoint_data),
        result = COALESCE(?, result),
        conversation_history = COALESCE(?, conversation_history),
        updated_at = ?
       WHERE id = ?`,
      data.status ?? null,
      data.summary ?? null,
      data.generatedCode ?? null,
      data.steps ? JSON.stringify(data.steps) : null,
      data.currentStepIndex ?? null,
      data.checkpointData ? JSON.stringify(data.checkpointData) : null,
      data.result ? JSON.stringify(data.result) : null,
      data.conversationHistory ? JSON.stringify(data.conversationHistory) : null,
      now,
      planId
    );

    // Broadcast update
    const updatedPlan = this.sql.exec('SELECT * FROM workflow_plans WHERE id = ?', planId).toArray()[0];
    if (updatedPlan) {
      const projectId = (updatedPlan as Record<string, unknown>).project_id as string;
      this.broadcast(projectId, 'workflow_plan_update', transformWorkflowPlan(updatedPlan as Record<string, unknown>));
    }

    return this.getWorkflowPlan(planId);
  }

  /**
   * Delete a workflow plan
   */
  deleteWorkflowPlan(planId: string): Response {
    const plan = this.sql.exec('SELECT id FROM workflow_plans WHERE id = ?', planId).toArray()[0];
    if (!plan) {
      return jsonResponse({ error: 'Workflow plan not found' }, 404);
    }
    this.sql.exec('DELETE FROM workflow_plans WHERE id = ?', planId);
    return jsonResponse({ success: true });
  }

  /**
   * Approve a workflow plan (transition from draft to approved)
   */
  approveWorkflowPlan(planId: string): Response {
    const now = new Date().toISOString();
    this.sql.exec(
      "UPDATE workflow_plans SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'draft'",
      now,
      planId
    );
    return this.getWorkflowPlan(planId);
  }

  /**
   * Resolve a workflow checkpoint
   */
  resolveWorkflowCheckpoint(planId: string, data: {
    action: string;
    data?: object;
  }): Response {
    const now = new Date().toISOString();

    this.sql.exec(
      `UPDATE workflow_plans SET
        status = 'executing',
        checkpoint_data = ?,
        updated_at = ?
       WHERE id = ? AND status = 'checkpoint'`,
      JSON.stringify({ action: data.action, ...data.data }),
      now,
      planId
    );

    // Broadcast the update
    const plan = this.sql.exec('SELECT * FROM workflow_plans WHERE id = ?', planId).toArray()[0];
    if (plan) {
      const projectId = (plan as Record<string, unknown>).project_id as string;
      this.broadcast(projectId, 'workflow_plan_update', transformWorkflowPlan(plan as Record<string, unknown>));
    }

    return this.getWorkflowPlan(planId);
  }

  // ============================================
  // WORKFLOW LOG OPERATIONS
  // ============================================

  /**
   * Get workflow logs for a plan
   */
  getWorkflowLogs(planId: string, params: URLSearchParams): Response {
    const plan = this.sql.exec('SELECT id FROM workflow_plans WHERE id = ?', planId).toArray()[0];
    if (!plan) {
      return jsonResponse({ error: 'Plan not found' }, 404);
    }

    const limit = parseInt(params.get('limit') || '100');
    const offset = parseInt(params.get('offset') || '0');

    const logs = this.sql.exec(
      'SELECT * FROM workflow_logs WHERE plan_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?',
      planId,
      limit,
      offset
    ).toArray();

    return jsonResponse({
      success: true,
      data: logs.map(l => transformWorkflowLog(l as Record<string, unknown>))
    });
  }

  /**
   * Add a workflow log entry (HTTP handler)
   */
  handleAddWorkflowLog(planId: string, data: {
    level: string;
    message: string;
    stepId?: string;
    metadata?: object;
  }): Response {
    const log = this.addWorkflowLog(planId, data.level, data.message, data.stepId, data.metadata);
    return jsonResponse({ success: true, data: log });
  }

  /**
   * Add a workflow log entry (internal use)
   */
  addWorkflowLog(
    planId: string,
    level: string,
    message: string,
    stepId?: string,
    metadata?: object
  ): Record<string, unknown> {
    const id = this.generateId();
    const now = new Date().toISOString();

    this.sql.exec(
      'INSERT INTO workflow_logs (id, plan_id, step_id, timestamp, level, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      planId,
      stepId || null,
      now,
      level,
      message,
      metadata ? JSON.stringify(metadata) : null
    );

    const log = {
      id,
      planId,
      stepId: stepId || null,
      timestamp: now,
      level,
      message,
      metadata: metadata || null,
    };

    // Get projectId from plan and broadcast
    const plan = this.sql.exec('SELECT project_id FROM workflow_plans WHERE id = ?', planId).toArray()[0];
    if (plan) {
      this.broadcast((plan as Record<string, unknown>).project_id as string, 'workflow_log', log);
    }

    return log;
  }
}
