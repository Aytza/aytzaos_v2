/**
 * useTaskWorkflow - Unified workflow management for both project and standalone tasks
 *
 * This hook abstracts away the differences between project-based and standalone task
 * workflow APIs, providing a consistent interface for workflow operations.
 *
 * For standalone tasks, it connects to WebSocket for real-time updates using the
 * user's task container ID (user-tasks-${userId}).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WorkflowPlan, WorkflowLog } from '../types';
import * as api from '../api/client';

export type TaskMode = 'project' | 'standalone';

interface UseTaskWorkflowOptions {
  /** For project tasks: the project ID. For standalone: the user's task container ID */
  projectId?: string;
  /** The task ID */
  taskId: string;
  /** Whether this is a project task or standalone task */
  mode: TaskMode;
  /** Called when workflow plan updates (for external state sync) */
  onPlanUpdate?: (plan: WorkflowPlan | null) => void;
}

interface UseTaskWorkflowReturn {
  // State
  workflowPlan: WorkflowPlan | null;
  workflowLogs: WorkflowLog[];
  isLoading: boolean;
  isGeneratingPlan: boolean;
  isRespondingToCheckpoint: boolean;
  error: string | null;
  wsConnected: boolean;

  // Actions
  loadWorkflowPlan: () => Promise<void>;
  startWorkflow: (agentId?: string) => Promise<void>;
  cancelWorkflow: () => Promise<void>;
  dismissWorkflow: () => Promise<void>;
  resolveCheckpoint: (
    action: 'approve' | 'request_changes' | 'cancel',
    options?: { feedback?: string; data?: Record<string, unknown> }
  ) => Promise<void>;
  clearError: () => void;
}

export function useTaskWorkflow({
  projectId,
  taskId,
  mode,
  onPlanUpdate,
}: UseTaskWorkflowOptions): UseTaskWorkflowReturn {
  const [workflowPlan, setWorkflowPlan] = useState<WorkflowPlan | null>(null);
  const [workflowLogs, setWorkflowLogs] = useState<WorkflowLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isRespondingToCheckpoint, setIsRespondingToCheckpoint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [userTasksId, setUserTasksId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Use refs for values needed in WebSocket callbacks to avoid stale closures
  const taskIdRef = useRef(taskId);
  const workflowPlanRef = useRef(workflowPlan);

  // Keep refs in sync
  useEffect(() => {
    taskIdRef.current = taskId;
  }, [taskId]);

  useEffect(() => {
    workflowPlanRef.current = workflowPlan;
  }, [workflowPlan]);

  // Reset state when taskId changes
  useEffect(() => {
    setWorkflowPlan(null);
    setWorkflowLogs([]);
    setError(null);
    setIsGeneratingPlan(false);
    setIsRespondingToCheckpoint(false);
  }, [taskId]);

  // Get user ID for standalone tasks WebSocket connection
  useEffect(() => {
    if (mode === 'standalone' && !userTasksId) {
      api.getMe().then((result) => {
        if (result.success && result.data) {
          setUserTasksId(`user-tasks-${result.data.id}`);
        }
      });
    }
  }, [mode, userTasksId]);

  // WebSocket connection for real-time updates (standalone tasks)
  useEffect(() => {
    if (mode !== 'standalone' || !userTasksId || !taskId) return;

    const connectWebSocket = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      if (wsRef.current) {
        wsRef.current.close();
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws?projectId=${encodeURIComponent(userTasksId)}`;

      try {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setWsConnected(true);

          // Ping to keep connection alive
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 30000);
        };

        ws.onclose = (event) => {
          setWsConnected(false);

          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }

          // Reconnect on unexpected close
          if (event.code !== 1000) {
            reconnectTimeoutRef.current = setTimeout(() => {
              connectWebSocket();
            }, 3000);
          }
        };

        ws.onerror = () => {
          // Error handling done via onclose
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'pong') return;

            // Handle workflow plan updates
            if (message.type === 'workflow_plan_update') {
              const plan = message.data as WorkflowPlan;
              // Only update if it's for our current task (use ref to avoid stale closure)
              if (plan.taskId === taskIdRef.current) {
                setWorkflowPlan(plan);
                if (plan.status === 'executing' || plan.status === 'completed' || plan.status === 'failed') {
                  setIsGeneratingPlan(false);
                }
              }
            }

            // Handle workflow log updates
            if (message.type === 'workflow_log') {
              const log = message.data as WorkflowLog;
              // Only add if it's for our current plan (use ref to avoid stale closure)
              const currentPlan = workflowPlanRef.current;
              if (currentPlan && log.planId === currentPlan.id) {
                setWorkflowLogs((prev) => {
                  if (prev.some((l) => l.id === log.id)) return prev;
                  return [...prev, log];
                });
              }
            }
          } catch {
            // Silently ignore malformed messages
          }
        };

        wsRef.current = ws;
      } catch {
        // Connection failure will be handled by onclose/onerror
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Task changed');
        wsRef.current = null;
      }
    };
  }, [mode, userTasksId, taskId]);

  // Update external state when plan changes
  useEffect(() => {
    onPlanUpdate?.(workflowPlan);
  }, [workflowPlan, onPlanUpdate]);

  // Load workflow plan and logs
  const loadWorkflowPlan = useCallback(async () => {
    if (!taskId) return;

    setIsLoading(true);
    setError(null);

    try {
      const planResult = mode === 'standalone'
        ? await api.getStandaloneTaskWorkflowPlan(taskId)
        : await api.getTaskWorkflowPlan(projectId!, taskId);

      if (planResult.success && planResult.data) {
        setWorkflowPlan(planResult.data);

        // Also fetch logs
        const logsResult = mode === 'standalone'
          ? await api.getStandaloneWorkflowLogs(taskId, planResult.data.id)
          : await api.getWorkflowLogs(projectId!, planResult.data.id);

        if (logsResult.success && logsResult.data) {
          setWorkflowLogs(logsResult.data);
        }
      } else {
        setWorkflowPlan(null);
        setWorkflowLogs([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workflow');
    } finally {
      setIsLoading(false);
    }
  }, [taskId, projectId, mode]);

  // Start a new workflow
  const startWorkflow = useCallback(async (agentId?: string) => {
    if (!taskId) return;

    setIsGeneratingPlan(true);
    setError(null);
    setWorkflowLogs([]); // Clear logs when starting new workflow

    try {
      const result = mode === 'standalone'
        ? await api.generateStandaloneWorkflowPlan(taskId, agentId)
        : await api.generateWorkflowPlan(projectId!, taskId, agentId);

      if (result.success && result.data) {
        setWorkflowPlan(result.data);
        // Don't set isGeneratingPlan to false - wait for WebSocket update
      } else {
        setError(result.error?.message || 'Failed to start workflow');
        setIsGeneratingPlan(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start workflow');
      setIsGeneratingPlan(false);
    }
  }, [taskId, projectId, mode]);

  // Cancel running workflow
  const cancelWorkflow = useCallback(async () => {
    if (!workflowPlan) return;

    try {
      const result = mode === 'standalone'
        ? await api.cancelStandaloneWorkflow(taskId, workflowPlan.id)
        : await api.cancelWorkflow(projectId!, workflowPlan.id);

      if (result.success && result.data) {
        setWorkflowPlan(result.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel workflow');
    }
  }, [workflowPlan, taskId, projectId, mode]);

  // Dismiss/delete completed workflow
  const dismissWorkflow = useCallback(async () => {
    if (!workflowPlan) return;

    try {
      const result = mode === 'standalone'
        ? await api.deleteStandaloneWorkflowPlan(taskId, workflowPlan.id)
        : await api.deleteWorkflowPlan(projectId!, workflowPlan.id);

      if (result.success) {
        setWorkflowPlan(null);
        setWorkflowLogs([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to dismiss workflow');
    }
  }, [workflowPlan, taskId, projectId, mode]);

  // Resolve checkpoint (approve, request changes, or cancel)
  const resolveCheckpoint = useCallback(async (
    action: 'approve' | 'request_changes' | 'cancel',
    options?: { feedback?: string; data?: Record<string, unknown> }
  ) => {
    if (!workflowPlan) return;

    setIsRespondingToCheckpoint(true);
    setError(null);

    try {
      const result = mode === 'standalone'
        ? await api.resolveStandaloneWorkflowCheckpoint(taskId, workflowPlan.id, {
            action,
            feedback: options?.feedback,
            data: options?.data,
          })
        : await api.resolveWorkflowCheckpoint(projectId!, workflowPlan.id, {
            action,
            feedback: options?.feedback,
            data: options?.data,
          });

      if (result.success && result.data) {
        setWorkflowPlan(result.data);
      } else {
        setError(result.error?.message || 'Failed to resolve checkpoint');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve checkpoint');
    } finally {
      setIsRespondingToCheckpoint(false);
    }
  }, [workflowPlan, taskId, projectId, mode]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    workflowPlan,
    workflowLogs,
    isLoading,
    isGeneratingPlan,
    isRespondingToCheckpoint,
    error,
    wsConnected,
    loadWorkflowPlan,
    startWorkflow,
    cancelWorkflow,
    dismissWorkflow,
    resolveCheckpoint,
    clearError,
  };
}
