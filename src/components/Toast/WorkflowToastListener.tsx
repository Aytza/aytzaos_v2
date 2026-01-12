import { useEffect, useRef } from 'react';
import { useProject } from '../../context/ProjectContext';
import { useToast } from '../../context/ToastContext';
import type { WorkflowPlan, Task } from '../../types';

/**
 * Listens for workflow status changes and shows toast notifications.
 * Renders nothing - it's just a listener.
 */
export function WorkflowToastListener() {
  const { workflowPlans, activeProject } = useProject();
  const { addToast } = useToast();
  const prevStatusesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const prevStatuses = prevStatusesRef.current;
    const currentPlans: WorkflowPlan[] = Object.values(workflowPlans);

    for (const plan of currentPlans) {
      const prevStatus = prevStatuses[plan.id];
      const currentStatus = plan.status;

      // Skip if no change or if this is the first time we're seeing this plan
      if (!prevStatus || prevStatus === currentStatus) {
        continue;
      }

      // Get task title for the message
      const taskTitle = getTaskTitle(plan, activeProject?.tasks || null);

      // Show toast based on status transition
      if (currentStatus === 'completed') {
        addToast({
          type: 'success',
          message: `"${taskTitle}" completed`,
          taskId: plan.taskId,
        });
      } else if (currentStatus === 'failed') {
        // Don't show toast if user explicitly cancelled/rejected (from checkpoint or header)
        // Only show for unexpected failures (e.g., from executing state)
        if (prevStatus === 'executing') {
          addToast({
            type: 'error',
            message: `"${taskTitle}" failed`,
            taskId: plan.taskId,
          });
        }
      } else if (currentStatus === 'checkpoint') {
        addToast({
          type: 'warning',
          message: `"${taskTitle}" needs approval`,
          taskId: plan.taskId,
        });
      }
    }

    // Update previous statuses
    const newStatuses: Record<string, string> = {};
    for (const plan of currentPlans) {
      newStatuses[plan.id] = plan.status;
    }
    prevStatusesRef.current = newStatuses;
  }, [workflowPlans, activeProject, addToast]);

  return null;
}

function getTaskTitle(plan: WorkflowPlan, tasks: Task[] | null): string {
  if (!tasks) {
    return `Task ${plan.taskId.slice(0, 8)}`;
  }

  const task = tasks.find((t) => t.id === plan.taskId);
  return task?.title || `Task ${plan.taskId.slice(0, 8)}`;
}
