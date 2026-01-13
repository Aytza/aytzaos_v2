import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Modal, Input, RichTextEditor, AgentIcon } from '../common';
import { AgentSection } from '../Task/AgentSection';
import { WorkflowProgress } from '../Workflow';
import { getApprovalView } from '../Approval';
import { useTaskWorkflow } from '../../hooks/useTaskWorkflow';
import type { Task, TaskPriority, WorkflowArtifact } from '../../types';
import * as api from '../../api/client';
import './Tasks.css';

type TaskModalView = 'main' | 'checkpoint-review' | 'email-view';
type ModalMode = 'create' | 'edit';

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Form state (shared between create and edit)
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium');

  // UI state for the modal
  const [currentView, setCurrentView] = useState<TaskModalView>('main');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedEmailArtifact, setSelectedEmailArtifact] = useState<WorkflowArtifact | null>(null);

  // Use the shared workflow hook - handles all workflow state and API calls
  const workflow = useTaskWorkflow({
    taskId: editingTask?.id || '',
    mode: 'standalone',
  });

  // Load tasks on mount
  useEffect(() => {
    loadTasks();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load workflow plan when opening edit modal
  useEffect(() => {
    if (showModal && modalMode === 'edit' && editingTask) {
      workflow.loadWorkflowPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, modalMode, editingTask?.id, workflow.loadWorkflowPlan]);

  const loadTasks = async () => {
    setLoading(true);
    const result = await api.getStandaloneTasks();
    if (result.success && result.data) {
      setTasks(result.data);
    }
    setLoading(false);
  };

  const resetForm = useCallback(() => {
    setTaskTitle('');
    setTaskDescription('');
    setTaskPriority('medium');
    setEditingTask(null);
    setCurrentView('main');
    setConfirmingDelete(false);
    setSelectedEmailArtifact(null);
  }, []);

  const openCreateModal = () => {
    resetForm();
    setModalMode('create');
    setShowModal(true);
    workflow.clearError();
  };

  const openEditModal = (task: Task) => {
    setEditingTask({ ...task });
    setTaskTitle(task.title);
    setTaskDescription(task.description || '');
    setTaskPriority(task.priority);
    setModalMode('edit');
    setShowModal(true);
    setMenuOpenId(null);
    setCurrentView('main');
    setConfirmingDelete(false);
    setSelectedEmailArtifact(null);
    workflow.clearError();
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleCreateTask = async (runAgent?: boolean, agentId?: string) => {
    if (!taskTitle.trim()) return;

    setIsSaving(true);
    const result = await api.createStandaloneTask({
      title: taskTitle.trim(),
      description: taskDescription.trim() || undefined,
      priority: taskPriority,
    });

    if (result.success && result.data) {
      setTasks((prev) => [...prev, result.data!]);

      if (runAgent) {
        // Switch to edit mode with the new task to run the agent
        setEditingTask(result.data);
        setModalMode('edit');
        setIsSaving(false);
        // Start the workflow after a brief delay to let state settle
        setTimeout(() => {
          workflow.startWorkflow(agentId);
        }, 100);
      } else {
        closeModal();
      }
    }
    setIsSaving(false);
  };

  const handleUpdateTask = async () => {
    if (!editingTask || !taskTitle.trim()) return;

    setIsSaving(true);
    const result = await api.updateStandaloneTask(editingTask.id, {
      title: taskTitle.trim(),
      description: taskDescription.trim() || undefined,
      priority: taskPriority,
    });

    if (result.success && result.data) {
      setTasks((prev) =>
        prev.map((t) => (t.id === editingTask.id ? result.data! : t))
      );
      closeModal();
    }
    setIsSaving(false);
  };

  const handleDeleteTask = async (taskId: string) => {
    const result = await api.deleteStandaloneTask(taskId);
    if (result.success) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setMenuOpenId(null);
      closeModal();
    }
  };

  const handleStartAgent = async (agentId?: string) => {
    if (modalMode === 'create') {
      // Create the task first, then run the agent
      await handleCreateTask(true, agentId);
    } else if (editingTask) {
      // Save any pending changes first
      const originalTask = tasks.find(t => t.id === editingTask.id);
      const hasChanges = taskDescription !== (originalTask?.description || '') ||
                         taskTitle !== originalTask?.title ||
                         taskPriority !== originalTask?.priority;

      if (hasChanges) {
        await api.updateStandaloneTask(editingTask.id, {
          title: taskTitle,
          description: taskDescription,
          priority: taskPriority,
        });
      }

      await workflow.startWorkflow(agentId);
    }
  };

  // Handlers for checkpoint approval
  const handleApproveCheckpoint = async (responseData?: Record<string, unknown>) => {
    await workflow.resolveCheckpoint('approve', { data: responseData });
    setCurrentView('main');
  };

  const handleRequestChanges = async (feedback: string) => {
    await workflow.resolveCheckpoint('request_changes', { feedback });
    setCurrentView('main');
  };

  const handleCancelCheckpoint = async () => {
    await workflow.resolveCheckpoint('cancel');
    setCurrentView('main');
  };

  const getPriorityColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'high':
        return 'priority-high';
      case 'low':
        return 'priority-low';
      default:
        return 'priority-medium';
    }
  };

  const getModalTitle = () => {
    if (currentView === 'checkpoint-review') return 'Approval Required';
    if (currentView === 'email-view') return selectedEmailArtifact?.title || 'Sent Email';
    return modalMode === 'create' ? 'New Task' : 'Edit Task';
  };

  const showBackButton = currentView === 'checkpoint-review' || currentView === 'email-view';

  const renderModalContent = () => {
    // Checkpoint Review
    if (currentView === 'checkpoint-review' && workflow.workflowPlan) {
      const checkpointData = workflow.workflowPlan.checkpointData as {
        tool?: string;
        action?: string;
        data?: Record<string, unknown>;
      } | undefined;

      const toolName = checkpointData?.tool || '';
      const ApprovalView = getApprovalView(toolName);

      let dataObj: Record<string, unknown> = {};
      if (checkpointData?.data) {
        if (typeof checkpointData.data === 'string') {
          try {
            dataObj = JSON.parse(checkpointData.data);
          } catch {
            dataObj = {};
          }
        } else {
          dataObj = checkpointData.data;
        }
      }

      return (
        <ApprovalView
          tool={toolName}
          action={checkpointData?.action || ''}
          data={dataObj}
          onApprove={handleApproveCheckpoint}
          onRequestChanges={handleRequestChanges}
          onCancel={handleCancelCheckpoint}
          isLoading={workflow.isRespondingToCheckpoint}
        />
      );
    }

    // Email View
    if (currentView === 'email-view' && selectedEmailArtifact?.content) {
      const { to, cc, bcc, subject, body, sentAt } = selectedEmailArtifact.content;
      return (
        <div className="email-viewer-content">
          {to && <div><strong>To:</strong> {to}</div>}
          {cc && <div><strong>CC:</strong> {cc}</div>}
          {bcc && <div><strong>BCC:</strong> {bcc}</div>}
          {subject && <div><strong>Subject:</strong> {subject}</div>}
          {sentAt && <div><strong>Sent:</strong> {new Date(sentAt).toLocaleString()}</div>}
          {body && (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginTop: 'var(--spacing-md)' }}>
              {body}
            </pre>
          )}
        </div>
      );
    }

    // Main view (create or edit)
    const isRunning = workflow.isGeneratingPlan;
    const hasWorkflow = modalMode === 'edit' && workflow.workflowPlan;
    const canRunAgent = taskDescription.trim().length > 0;

    return (
      <>
        <div className="modal-form">
          <Input
            label="Title"
            placeholder="What needs to be done?"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            autoFocus
          />
          <RichTextEditor
            label="Description / Instructions"
            placeholder="Describe the task or provide instructions for the agent..."
            value={taskDescription}
            onChange={setTaskDescription}
            rows={4}
          />
          <div className="form-field">
            <label className="form-label">Priority</label>
            <select
              className="form-select"
              value={taskPriority}
              onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        {/* Agent Section */}
        <div className="task-modal-agent">
          {workflow.error && (
            <div className="task-modal-error">{workflow.error}</div>
          )}

          {hasWorkflow ? (
            <div className="task-modal-workflow">
              <WorkflowProgress
                plan={workflow.workflowPlan!}
                onCancel={workflow.cancelWorkflow}
                onDismiss={workflow.dismissWorkflow}
                onReviewCheckpoint={() => setCurrentView('checkpoint-review')}
                onViewEmail={(artifact) => {
                  setSelectedEmailArtifact(artifact);
                  setCurrentView('email-view');
                }}
                customLogs={{
                  logs: workflow.workflowLogs,
                  fetchLogs: workflow.loadWorkflowPlan,
                }}
              />
            </div>
          ) : (
            <AgentSection
              onRun={handleStartAgent}
              disabled={!canRunAgent || isSaving}
              isRunning={isRunning}
            />
          )}

          {!canRunAgent && !hasWorkflow && (
            <p className="agent-hint">Add a description to enable the agent</p>
          )}
        </div>

        <div className="modal-actions-split">
          <div className={`delete-action ${confirmingDelete ? 'confirming' : ''}`}>
            {modalMode === 'edit' && (
              confirmingDelete ? (
                <>
                  <Button variant="danger" onClick={() => editingTask && handleDeleteTask(editingTask.id)}>
                    Confirm Delete
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              )
            )}
          </div>
          <div className="modal-actions-right">
            <Button variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={modalMode === 'create' ? () => handleCreateTask(false) : handleUpdateTask}
              disabled={!taskTitle.trim() || isSaving}
            >
              {isSaving ? 'Saving...' : modalMode === 'create' ? 'Create Task' : 'Save'}
            </Button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="tasks-page">
      <div className="tasks-container">
        <div className="tasks-header">
          <h1 className="tasks-title">&gt; My Tasks</h1>
          <Button variant="primary" onClick={openCreateModal}>
            + New Task
          </Button>
        </div>

        {loading ? (
          <div className="tasks-loading">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="tasks-empty">
            <div className="tasks-empty-icon">
              <AgentIcon size={48} />
            </div>
            <h2>No tasks yet</h2>
            <p>Create a task and let the AI agent handle it for you</p>
            <Button variant="primary" onClick={openCreateModal}>
              Create your first task
            </Button>
          </div>
        ) : (
          <div className="tasks-list">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="task-item"
                onClick={() => openEditModal(task)}
                ref={menuOpenId === task.id ? menuRef : null}
              >
                <div className="task-item-main">
                  <span className={`task-priority-dot ${getPriorityColor(task.priority)}`} />
                  <div className="task-item-content">
                    <span className="task-item-title">{task.title}</span>
                    {task.description && (
                      <span className="task-item-description">
                        {task.description.replace(/<[^>]*>/g, '').slice(0, 80)}
                        {task.description.length > 80 ? '...' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="task-item-right">
                  <span className="task-item-date">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    className="task-item-menu-trigger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === task.id ? null : task.id);
                    }}
                  >
                    ...
                  </button>
                </div>
                {menuOpenId === task.id && (
                  <div className="task-item-dropdown">
                    <button onClick={(e) => { e.stopPropagation(); openEditModal(task); }}>Edit</button>
                    <button className="danger" onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Unified Task Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={getModalTitle()}
        width="lg"
        showBackButton={showBackButton}
        onBack={() => setCurrentView('main')}
      >
        <div className={`task-modal ${currentView !== 'main' ? `view-${currentView}` : ''}`}>
          {renderModalContent()}
        </div>
      </Modal>
    </div>
  );
}
