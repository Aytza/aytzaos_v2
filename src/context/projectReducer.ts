/**
 * Project reducer - State management logic for ProjectContext
 *
 * Extracted from ProjectContext.tsx for better maintainability.
 */

import type { Project, Column, Task, DragState, ColumnDragState, WorkflowPlan, WorkflowLog } from '../types';
import type { ProjectWithDetails } from '../api/client';

// ============================================
// STATE
// ============================================

export interface ProjectState {
  projects: Project[];
  activeProject: ProjectWithDetails | null;
  loading: boolean;
  error: string | null;
  dragState: DragState;
  columnDragState: ColumnDragState;
  // Workflow state - keyed by plan ID
  workflowPlans: Record<string, WorkflowPlan>;
  workflowLogs: Record<string, WorkflowLog[]>;
}

/** @deprecated Use ProjectState instead */
export type BoardState = ProjectState;

export const initialProjectState: ProjectState = {
  projects: [],
  activeProject: null,
  loading: false,
  error: null,
  dragState: {
    isDragging: false,
    taskId: null,
    sourceColumnId: null,
  },
  columnDragState: {
    isDragging: false,
    columnId: null,
  },
  workflowPlans: {},
  workflowLogs: {},
};

/** @deprecated Use initialProjectState instead */
export const initialBoardState = initialProjectState;

// ============================================
// ACTIONS
// ============================================

export type ProjectAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'SET_ACTIVE_PROJECT'; payload: ProjectWithDetails | null }
  | { type: 'ADD_PROJECT'; payload: ProjectWithDetails }
  | { type: 'UPDATE_PROJECT'; payload: { id: string; name: string } }
  | { type: 'REMOVE_PROJECT'; payload: string }
  | { type: 'ADD_COLUMN'; payload: Column }
  | { type: 'UPDATE_COLUMN'; payload: Column }
  | { type: 'REMOVE_COLUMN'; payload: string }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Task }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'MOVE_TASK'; payload: { taskId: string; columnId: string; position: number } }
  | { type: 'SET_DRAG_STATE'; payload: Partial<DragState> }
  | { type: 'SET_COLUMN_DRAG_STATE'; payload: Partial<ColumnDragState> }
  // Workflow actions
  | { type: 'SET_WORKFLOW_PLANS'; payload: WorkflowPlan[] }
  | { type: 'UPDATE_WORKFLOW_PLAN'; payload: WorkflowPlan }
  | { type: 'REMOVE_WORKFLOW_PLAN'; payload: string }
  | { type: 'ADD_WORKFLOW_LOG'; payload: WorkflowLog }
  | { type: 'SET_WORKFLOW_LOGS'; payload: { planId: string; logs: WorkflowLog[] } }
  | { type: 'CLEAR_WORKFLOW_STATE' };

/** @deprecated Use ProjectAction instead */
export type BoardAction = ProjectAction;

// ============================================
// REDUCER
// ============================================

export function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };

    case 'SET_ACTIVE_PROJECT':
      return { ...state, activeProject: action.payload };

    case 'ADD_PROJECT':
      return {
        ...state,
        projects: [action.payload, ...state.projects],
        activeProject: action.payload,
      };

    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.payload.id ? { ...p, name: action.payload.name } : p
        ),
        activeProject:
          state.activeProject?.id === action.payload.id
            ? { ...state.activeProject, name: action.payload.name }
            : state.activeProject,
      };

    case 'REMOVE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.payload),
        activeProject:
          state.activeProject?.id === action.payload ? null : state.activeProject,
      };

    case 'ADD_COLUMN':
      if (!state.activeProject) return state;
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          columns: [...state.activeProject.columns, action.payload],
        },
      };

    case 'UPDATE_COLUMN':
      if (!state.activeProject) return state;
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          columns: state.activeProject.columns.map((c) =>
            c.id === action.payload.id ? action.payload : c
          ),
        },
      };

    case 'REMOVE_COLUMN':
      if (!state.activeProject) return state;
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          columns: state.activeProject.columns.filter((c) => c.id !== action.payload),
          tasks: state.activeProject.tasks.filter((t) => t.columnId !== action.payload),
        },
      };

    case 'ADD_TASK':
      if (!state.activeProject) return state;
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          tasks: [...state.activeProject.tasks, action.payload],
        },
      };

    case 'UPDATE_TASK':
      if (!state.activeProject) return state;
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          tasks: state.activeProject.tasks.map((t) =>
            t.id === action.payload.id ? action.payload : t
          ),
        },
      };

    case 'REMOVE_TASK':
      if (!state.activeProject) return state;
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          tasks: state.activeProject.tasks.filter((t) => t.id !== action.payload),
        },
      };

    case 'MOVE_TASK': {
      if (!state.activeProject) return state;
      const { taskId, columnId: targetColumnId, position: newPosition } = action.payload;
      const movedTask = state.activeProject.tasks.find(t => t.id === taskId);
      if (!movedTask) return state;

      const sourceColumnId = movedTask.columnId;
      const oldPosition = movedTask.position;

      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          tasks: state.activeProject.tasks.map((t) => {
            if (t.id === taskId) {
              return { ...t, columnId: targetColumnId, position: newPosition };
            }

            if (sourceColumnId === targetColumnId) {
              // Same column reorder
              if (oldPosition < newPosition) {
                // Moving down: shift tasks between old and new up (decrement)
                if (t.columnId === targetColumnId && t.position > oldPosition && t.position <= newPosition) {
                  return { ...t, position: t.position - 1 };
                }
              } else if (oldPosition > newPosition) {
                // Moving up: shift tasks between new and old down (increment)
                if (t.columnId === targetColumnId && t.position >= newPosition && t.position < oldPosition) {
                  return { ...t, position: t.position + 1 };
                }
              }
            } else {
              // Cross-column move
              // Close gap in source column
              if (t.columnId === sourceColumnId && t.position > oldPosition) {
                return { ...t, position: t.position - 1 };
              }
              // Make room in target column
              if (t.columnId === targetColumnId && t.position >= newPosition) {
                return { ...t, position: t.position + 1 };
              }
            }

            return t;
          }),
        },
      };
    }

    case 'SET_DRAG_STATE':
      return { ...state, dragState: { ...state.dragState, ...action.payload } };

    case 'SET_COLUMN_DRAG_STATE':
      return { ...state, columnDragState: { ...state.columnDragState, ...action.payload } };

    // Workflow reducers
    case 'SET_WORKFLOW_PLANS': {
      const plans: Record<string, WorkflowPlan> = {};
      for (const plan of action.payload) {
        plans[plan.id] = plan;
      }
      return { ...state, workflowPlans: plans };
    }

    case 'UPDATE_WORKFLOW_PLAN':
      return {
        ...state,
        workflowPlans: {
          ...state.workflowPlans,
          [action.payload.id]: action.payload,
        },
      };

    case 'REMOVE_WORKFLOW_PLAN': {
      const { [action.payload]: _, ...remainingPlans } = state.workflowPlans;
      const { [action.payload]: __, ...remainingLogs } = state.workflowLogs;
      return {
        ...state,
        workflowPlans: remainingPlans,
        workflowLogs: remainingLogs,
      };
    }

    case 'ADD_WORKFLOW_LOG': {
      const log = action.payload;
      return {
        ...state,
        workflowLogs: {
          ...state.workflowLogs,
          [log.planId]: [...(state.workflowLogs[log.planId] || []), log],
        },
      };
    }

    case 'SET_WORKFLOW_LOGS':
      return {
        ...state,
        workflowLogs: {
          ...state.workflowLogs,
          [action.payload.planId]: action.payload.logs,
        },
      };

    case 'CLEAR_WORKFLOW_STATE':
      return { ...state, workflowPlans: {}, workflowLogs: {} };

    default:
      return state;
  }
}

/** @deprecated Use projectReducer instead */
export const boardReducer = projectReducer;
