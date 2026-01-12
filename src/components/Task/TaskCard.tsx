import { useState, useEffect, useRef, type DragEvent, type MouseEvent } from 'react';
import type { Task } from '../../types';
import { useProject } from '../../context/ProjectContext';
import { TaskModal } from './TaskModal';
import { WorkflowBadge } from '../Workflow';
import './TaskCard.css';

/** Strip markdown syntax (pills and links) to plain text for card preview */
function stripMarkdownToText(text: string): string {
  return text
    // [pill:type:title](url) -> title
    .replace(/\[pill:[^:]+:([^\]]+)\]\([^)]+\)/g, '$1')
    // [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

interface TaskCardProps {
  task: Task;
  index: number;
}

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
}

export function TaskCard({ task }: TaskCardProps) {
  const { setDragState, moveTask, getTasksByColumn, deleteTask, activeProject, getTaskWorkflowPlan } = useProject();
  const [isDragging, setIsDragging] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ isOpen: false, x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Get workflow from context (single source of truth)
  const workflowPlan = getTaskWorkflowPlan(task.id);

  // Listen for open-task events from header executions dropdown
  useEffect(() => {
    const handleOpenTask = (e: CustomEvent<{ taskId: string }>) => {
      if (e.detail.taskId === task.id) {
        setShowModal(true);
      }
    };

    window.addEventListener('open-task', handleOpenTask as EventListener);
    return () => {
      window.removeEventListener('open-task', handleOpenTask as EventListener);
    };
  }, [task.id]);

  const handleModalClose = () => {
    setShowModal(false);
  };

  const handleDragStart = (e: DragEvent) => {
    e.stopPropagation(); // Prevent column drag from triggering
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
    setDragState({
      isDragging: true,
      taskId: task.id,
      sourceColumnId: task.columnId,
    });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragState({
      isDragging: false,
      taskId: null,
      sourceColumnId: null,
    });
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const draggedTaskId = e.dataTransfer.getData('text/plain');
    if (draggedTaskId && draggedTaskId !== task.id && task.columnId) {
      const tasks = getTasksByColumn(task.columnId);
      const targetIndex = tasks.findIndex((t) => t.id === task.id);
      await moveTask(draggedTaskId, task.columnId, targetIndex);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, x: 0, y: 0 });
  };

  const handleDelete = async () => {
    closeContextMenu();
    await deleteTask(task.id);
  };

  const handleMoveToColumn = async (columnId: string) => {
    closeContextMenu();
    const tasksInColumn = getTasksByColumn(columnId);
    await moveTask(task.id, columnId, tasksInColumn.length);
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        closeContextMenu();
      }
    };

    if (contextMenu.isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu.isOpen]);

  // Get other columns for move menu
  const otherColumns = activeProject?.columns.filter((c: { id: string }) => c.id !== task.columnId) || [];

  return (
    <>
      <div
        className={`task-card ${isDragging ? 'dragging' : ''}`}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => setShowModal(true)}
        onContextMenu={handleContextMenu}
      >
        <div className="task-card-header">
          <span className="task-title">{task.title}</span>
          {workflowPlan && (
            <WorkflowBadge
              status={workflowPlan.status}
              artifactType={workflowPlan.result?.artifacts?.[0]?.type}
            />
          )}
        </div>
        {task.description && (
          <span className="task-description">{stripMarkdownToText(task.description)}</span>
        )}
      </div>

      {contextMenu.isOpen && (
        <div
          ref={contextMenuRef}
          className="task-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="context-menu-item" onClick={() => { closeContextMenu(); setShowModal(true); }}>
            Edit
          </button>
          {otherColumns.length > 0 && (
            <>
              <div className="context-menu-divider" />
              {otherColumns.map((column) => (
                <button
                  key={column.id}
                  className="context-menu-item"
                  onClick={() => handleMoveToColumn(column.id)}
                >
                  Move to {column.name}
                </button>
              ))}
            </>
          )}
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      )}

      <TaskModal
        task={task}
        isOpen={showModal}
        onClose={handleModalClose}
      />
    </>
  );
}
