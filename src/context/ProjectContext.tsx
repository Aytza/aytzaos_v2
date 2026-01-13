import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import type { Column, Task, DragState, ColumnDragState, TaskPriority, WorkflowPlan, WorkflowLog } from '../types';
import * as api from '../api/client';
import { projectReducer, initialProjectState, type ProjectState } from './projectReducer';

// ============================================
// CONTEXT
// ============================================

interface ProjectContextValue extends Omit<ProjectState, 'workflowLogs'> {
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  clearActiveProject: () => void;
  createProject: (name: string) => Promise<string | null>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createColumn: (name: string) => Promise<Column | null>;
  updateColumn: (id: string, data: { name?: string; position?: number }) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  createTask: (columnId: string, title: string, description?: string, priority?: TaskPriority) => Promise<void>;
  updateTask: (id: string, data: { title?: string; description?: string; priority?: TaskPriority }) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  moveTask: (taskId: string, columnId: string, position: number) => Promise<void>;
  moveColumn: (columnId: string, newPosition: number) => Promise<void>;
  setDragState: (state: Partial<DragState>) => void;
  setColumnDragState: (state: Partial<ColumnDragState>) => void;
  getTasksByColumn: (columnId: string) => Task[];
  addingToColumn: string | null;
  setAddingToColumn: (columnId: string | null) => void;
  // Workflow state and methods
  activeWorkflows: WorkflowPlan[];
  wsConnected: boolean;
  getWorkflowPlan: (planId: string) => WorkflowPlan | null;
  getTaskWorkflowPlan: (taskId: string) => WorkflowPlan | null;
  updateWorkflowPlan: (plan: WorkflowPlan) => void;
  removeWorkflowPlan: (planId: string) => void;
  getWorkflowLogs: (planId: string) => WorkflowLog[];
  fetchWorkflowLogs: (projectId: string, planId: string) => Promise<void>;
}

/** @deprecated Use ProjectContextValue instead */
export type BoardContextValue = ProjectContextValue;

const ProjectContext = createContext<ProjectContextValue | null>(null);

// ============================================
// PROVIDER
// ============================================

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, initialProjectState);
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch all workflow plans for the project
  const fetchProjectWorkflowPlans = useCallback(async (projectId: string) => {
    const result = await api.getProjectWorkflowPlans(projectId);
    if (result.success && result.data) {
      dispatch({ type: 'SET_WORKFLOW_PLANS', payload: result.data });
    }
  }, []);

  // WebSocket connection for real-time updates
  const connectWebSocket = useCallback((projectId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws?projectId=${encodeURIComponent(projectId)}`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);

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

        if (event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (state.activeProject?.id) {
              connectWebSocket(state.activeProject.id);
            }
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

          if (message.type === 'workflow_plan_update') {
            const plan = message.data as WorkflowPlan;
            dispatch({ type: 'UPDATE_WORKFLOW_PLAN', payload: plan });
          }

          if (message.type === 'workflow_log') {
            const log = message.data as WorkflowLog;
            dispatch({ type: 'ADD_WORKFLOW_LOG', payload: log });
          }
        } catch {
          // Silently ignore malformed messages
        }
      };

      wsRef.current = ws;
    } catch {
      // Connection failure will be handled by onclose/onerror
    }
  }, [state.activeProject?.id]);

  // Connect WebSocket and fetch data when project changes
  useEffect(() => {
    if (state.activeProject?.id) {
      dispatch({ type: 'CLEAR_WORKFLOW_STATE' });
      fetchProjectWorkflowPlans(state.activeProject.id);
      connectWebSocket(state.activeProject.id);
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Project changed');
        wsRef.current = null;
      }
    };
  }, [state.activeProject?.id, fetchProjectWorkflowPlans, connectWebSocket]);

  // Derived: active workflows (executing, checkpoint, or planning)
  const activeWorkflows = Object.values(state.workflowPlans).filter(
    (p) => p.status === 'executing' || p.status === 'checkpoint' || p.status === 'planning'
  );

  // Get a workflow plan from state by plan ID
  const getWorkflowPlan = useCallback((planId: string): WorkflowPlan | null => {
    return state.workflowPlans[planId] || null;
  }, [state.workflowPlans]);

  // Get workflow plan for a task (searches by taskId)
  const getTaskWorkflowPlan = useCallback((taskId: string): WorkflowPlan | null => {
    const plans = Object.values(state.workflowPlans);
    return plans.find(p => p.taskId === taskId) || null;
  }, [state.workflowPlans]);

  // Update workflow plan in state
  const updateWorkflowPlanAction = useCallback((plan: WorkflowPlan) => {
    dispatch({ type: 'UPDATE_WORKFLOW_PLAN', payload: plan });
  }, []);

  // Remove workflow plan from state
  const removeWorkflowPlanAction = useCallback((planId: string) => {
    dispatch({ type: 'REMOVE_WORKFLOW_PLAN', payload: planId });
  }, []);

  // Get workflow logs from state
  const getWorkflowLogsFromState = useCallback((planId: string): WorkflowLog[] => {
    return state.workflowLogs[planId] || [];
  }, [state.workflowLogs]);

  // Fetch workflow logs from API
  const fetchWorkflowLogs = useCallback(async (projectId: string, planId: string): Promise<void> => {
    const result = await api.getWorkflowLogs(projectId, planId);
    if (result.success && result.data) {
      dispatch({ type: 'SET_WORKFLOW_LOGS', payload: { planId, logs: result.data } });
    }
  }, []);

  const loadProjects = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    const result = await api.getProjects();
    if (result.success && result.data) {
      dispatch({ type: 'SET_PROJECTS', payload: result.data });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to load projects' });
    }
    dispatch({ type: 'SET_LOADING', payload: false });
  }, []);

  const loadProject = useCallback(async (id: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    const result = await api.getProject(id);
    if (result.success && result.data) {
      dispatch({ type: 'SET_ACTIVE_PROJECT', payload: result.data });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to load project' });
    }
    dispatch({ type: 'SET_LOADING', payload: false });
  }, []);

  const clearActiveProject = useCallback(() => {
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: null });
  }, []);

  const createProjectAction = useCallback(async (name: string): Promise<string | null> => {
    const result = await api.createProject(name);
    if (result.success && result.data) {
      dispatch({ type: 'ADD_PROJECT', payload: result.data });
      return result.data.id;
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to create project' });
      return null;
    }
  }, []);

  const renameProjectAction = useCallback(async (id: string, name: string) => {
    const result = await api.updateProject(id, { name });
    if (result.success && result.data) {
      dispatch({ type: 'UPDATE_PROJECT', payload: { id, name } });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to rename project' });
    }
  }, []);

  const deleteProjectAction = useCallback(async (id: string) => {
    const result = await api.deleteProject(id);
    if (result.success) {
      dispatch({ type: 'REMOVE_PROJECT', payload: id });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to delete project' });
    }
  }, []);

  const createColumnAction = useCallback(async (name: string): Promise<Column | null> => {
    if (!state.activeProject) return null;
    const result = await api.createColumn(state.activeProject.id, name);
    if (result.success && result.data) {
      dispatch({ type: 'ADD_COLUMN', payload: result.data });
      return result.data;
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to create column' });
      return null;
    }
  }, [state.activeProject]);

  const updateColumnAction = useCallback(async (
    id: string,
    data: { name?: string; position?: number }
  ) => {
    if (!state.activeProject) return;
    const result = await api.updateColumn(state.activeProject.id, id, data);
    if (result.success && result.data) {
      dispatch({ type: 'UPDATE_COLUMN', payload: result.data });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to update column' });
    }
  }, [state.activeProject]);

  const deleteColumnAction = useCallback(async (id: string) => {
    if (!state.activeProject) return;
    const result = await api.deleteColumn(state.activeProject.id, id);
    if (result.success) {
      dispatch({ type: 'REMOVE_COLUMN', payload: id });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to delete column' });
    }
  }, [state.activeProject]);

  const createTaskAction = useCallback(async (
    columnId: string,
    title: string,
    description?: string,
    priority?: TaskPriority
  ) => {
    if (!state.activeProject) return;
    const result = await api.createTask(state.activeProject.id, {
      columnId,
      title,
      description,
      priority,
    });
    if (result.success && result.data) {
      dispatch({ type: 'ADD_TASK', payload: result.data });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to create task' });
    }
  }, [state.activeProject]);

  const updateTaskAction = useCallback(async (
    id: string,
    data: { title?: string; description?: string; priority?: TaskPriority }
  ) => {
    if (!state.activeProject) return;
    const result = await api.updateTask(state.activeProject.id, id, data);
    if (result.success && result.data) {
      dispatch({ type: 'UPDATE_TASK', payload: result.data });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to update task' });
    }
  }, [state.activeProject]);

  const deleteTaskAction = useCallback(async (id: string) => {
    if (!state.activeProject) return;
    const result = await api.deleteTask(state.activeProject.id, id);
    if (result.success) {
      dispatch({ type: 'REMOVE_TASK', payload: id });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to delete task' });
    }
  }, [state.activeProject]);

  const moveTaskAction = useCallback(async (
    taskId: string,
    columnId: string,
    position: number
  ) => {
    if (!state.activeProject) return;
    // Optimistic update
    dispatch({ type: 'MOVE_TASK', payload: { taskId, columnId, position } });

    const result = await api.moveTask(state.activeProject.id, taskId, columnId, position);
    if (!result.success) {
      // Revert on error by reloading the project
      loadProject(state.activeProject.id);
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to move task' });
    }
  }, [state.activeProject, loadProject]);

  const setDragState = useCallback((dragState: Partial<DragState>) => {
    dispatch({ type: 'SET_DRAG_STATE', payload: dragState });
  }, []);

  const setColumnDragState = useCallback((columnDragState: Partial<ColumnDragState>) => {
    dispatch({ type: 'SET_COLUMN_DRAG_STATE', payload: columnDragState });
  }, []);

  const moveColumnAction = useCallback(async (columnId: string, newPosition: number) => {
    if (!state.activeProject) return;

    // Find the column being moved
    const columns = [...state.activeProject.columns].sort((a, b) => a.position - b.position);
    const columnIndex = columns.findIndex((c) => c.id === columnId);
    if (columnIndex === -1) return;

    // Optimistically update column positions
    const updatedColumns = columns.map((col, idx) => {
      if (col.id === columnId) {
        return { ...col, position: newPosition };
      }
      // Adjust other columns
      if (columnIndex < newPosition) {
        // Moving right: shift columns between old and new position left
        if (idx > columnIndex && idx <= newPosition) {
          return { ...col, position: col.position - 1 };
        }
      } else {
        // Moving left: shift columns between new and old position right
        if (idx >= newPosition && idx < columnIndex) {
          return { ...col, position: col.position + 1 };
        }
      }
      return col;
    });

    // Update local state optimistically
    updatedColumns.forEach((col) => {
      dispatch({ type: 'UPDATE_COLUMN', payload: col });
    });

    // Call API to persist the move
    if (!state.activeProject) return;
    const result = await api.updateColumn(state.activeProject.id, columnId, { position: newPosition });
    if (!result.success) {
      // Revert on error by reloading the project
      loadProject(state.activeProject.id);
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to move column' });
    }
  }, [state.activeProject, loadProject]);

  const getTasksByColumn = useCallback((columnId: string): Task[] => {
    if (!state.activeProject) return [];
    return state.activeProject.tasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);
  }, [state.activeProject]);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const value: ProjectContextValue = {
    projects: state.projects,
    activeProject: state.activeProject,
    loading: state.loading,
    error: state.error,
    dragState: state.dragState,
    columnDragState: state.columnDragState,
    workflowPlans: state.workflowPlans,
    loadProjects,
    loadProject,
    clearActiveProject,
    createProject: createProjectAction,
    renameProject: renameProjectAction,
    deleteProject: deleteProjectAction,
    createColumn: createColumnAction,
    updateColumn: updateColumnAction,
    deleteColumn: deleteColumnAction,
    createTask: createTaskAction,
    updateTask: updateTaskAction,
    deleteTask: deleteTaskAction,
    moveTask: moveTaskAction,
    moveColumn: moveColumnAction,
    setDragState,
    setColumnDragState,
    getTasksByColumn,
    addingToColumn,
    setAddingToColumn,
    activeWorkflows,
    wsConnected,
    getWorkflowPlan,
    getTaskWorkflowPlan,
    updateWorkflowPlan: updateWorkflowPlanAction,
    removeWorkflowPlan: removeWorkflowPlanAction,
    getWorkflowLogs: getWorkflowLogsFromState,
    fetchWorkflowLogs,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

// ============================================
// HOOK
// ============================================

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}

/** @deprecated Use useProject instead */
export const useBoard = useProject;

/** @deprecated Use ProjectProvider instead */
export const BoardProvider = ProjectProvider;
