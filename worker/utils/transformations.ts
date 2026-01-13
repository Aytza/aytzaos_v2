/**
 * Data transformation utilities for API responses
 *
 * Converts snake_case database records to camelCase for client consumption
 * and parses JSON string fields.
 */

/**
 * Convert snake_case keys to camelCase
 */
export function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = obj[key];
  }
  return result;
}

/**
 * Transform project record for API response
 */
export function transformProject(project: Record<string, unknown>): Record<string, unknown> {
  return toCamelCase(project);
}

// Alias for backward compatibility
export function transformBoard(board: Record<string, unknown>): Record<string, unknown> {
  return transformProject(board);
}

/**
 * Transform column record for API response
 */
export function transformColumn(column: Record<string, unknown>): Record<string, unknown> {
  return toCamelCase(column);
}

/**
 * Transform task record for API response
 */
export function transformTask(task: Record<string, unknown>): Record<string, unknown> {
  return toCamelCase(task);
}

/**
 * Transform workflow plan record for API response
 * Parses steps, checkpointData, and result JSON fields
 */
export function transformWorkflowPlan(plan: Record<string, unknown>): Record<string, unknown> {
  const transformed = toCamelCase(plan);

  if (typeof transformed.steps === 'string' && transformed.steps) {
    try {
      transformed.steps = JSON.parse(transformed.steps);
    } catch {
      // Leave as string
    }
  }

  if (typeof transformed.checkpointData === 'string' && transformed.checkpointData) {
    try {
      transformed.checkpointData = JSON.parse(transformed.checkpointData);
    } catch {
      // Leave as string
    }
  }

  if (typeof transformed.result === 'string' && transformed.result) {
    try {
      transformed.result = JSON.parse(transformed.result);
    } catch {
      // Leave as string
    }
  }

  if (typeof transformed.conversationHistory === 'string' && transformed.conversationHistory) {
    try {
      transformed.conversationHistory = JSON.parse(transformed.conversationHistory);
    } catch {
      // Leave as string
    }
  }

  return transformed;
}

/**
 * Transform workflow log record for API response
 * Parses metadata JSON if present
 */
export function transformWorkflowLog(log: Record<string, unknown>): Record<string, unknown> {
  const transformed = toCamelCase(log);

  if (typeof transformed.metadata === 'string' && transformed.metadata) {
    try {
      transformed.metadata = JSON.parse(transformed.metadata);
    } catch {
      // Leave as string
    }
  }

  return transformed;
}

/**
 * Transform agent record for API response
 */
export function transformAgent(agent: Record<string, unknown>): Record<string, unknown> {
  const transformed = toCamelCase(agent);
  // Convert enabled from SQLite integer to boolean
  transformed.enabled = transformed.enabled === 1;
  return transformed;
}
