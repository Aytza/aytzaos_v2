import { useState, useEffect, useCallback, useRef, type ClipboardEvent } from 'react';
import type { Task, WorkflowPlan, WorkflowArtifact } from '../../types';
import { useProject } from '../../context/ProjectContext';
import { Modal, Button, Input, RichTextEditor } from '../common';
import { PlanReviewView, WorkflowProgress, EmailViewer } from '../Workflow';
import { getApprovalView } from '../Approval';
import { AgentSection } from './AgentSection';
import { useUrlDetection, extractUrl } from '../../hooks';
import * as api from '../../api/client';
import './TaskModal.css';

type TaskModalView = 'main' | 'plan-review' | 'checkpoint-review' | 'email-view';

interface TaskModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
}

export function TaskModal({ task, isOpen, onClose }: TaskModalProps) {
  const {
    activeProject,
    updateTask,
    deleteTask,
    getWorkflowPlan: getWorkflowPlanFromContext,
    updateWorkflowPlan: updateWorkflowPlanInContext,
    removeWorkflowPlan: removeWorkflowPlanFromContext,
  } = useProject();

  const [currentView, setCurrentView] = useState<TaskModalView>('main');
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [workflowPlan, setWorkflowPlan] = useState<WorkflowPlan | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [isApprovingPlan, setIsApprovingPlan] = useState(false);
  const [isRespondingToCheckpoint, setIsRespondingToCheckpoint] = useState(false);
  const [selectedEmailArtifact, setSelectedEmailArtifact] = useState<WorkflowArtifact | null>(null);

  const { pendingUrl, isLoading: isCheckingUrl, checkUrl, clear: clearPendingUrl, toPillSyntax } = useUrlDetection(task.projectId);
  const [pastedUrl, setPastedUrl] = useState<string | null>(null);
  const [pastedUrlEndIndex, setPastedUrlEndIndex] = useState<number | null>(null);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      const isInitialOpen = !wasOpenRef.current;
      wasOpenRef.current = true;

      setCurrentView('main');
      setTitle(task.title);
      setDescription(task.description || '');
      setConfirmingDelete(false);
      setWorkflowError(null);
      setSelectedEmailArtifact(null);
      clearPendingUrl();
      setPastedUrl(null);
      setPastedUrlEndIndex(null);

      if (isInitialOpen) {
        setIsGeneratingPlan(false);
      }

      if (activeProject) {
        api.getTaskWorkflowPlan(activeProject.id, task.id).then((result) => {
          if (result.success && result.data) {
            setWorkflowPlan(result.data);
            updateWorkflowPlanInContext(result.data);
          }
        });
      }
    } else {
      wasOpenRef.current = false;
      setCurrentView('main');
    }
  }, [isOpen, task.id, task.title, task.description, activeProject, updateWorkflowPlanInContext]);

  // Sync local state from context (WebSocket updates)
  useEffect(() => {
    if (!workflowPlan?.id) return;
    const contextPlan = getWorkflowPlanFromContext(workflowPlan.id);
    if (contextPlan && contextPlan.updatedAt !== workflowPlan.updatedAt) {
      setWorkflowPlan(contextPlan);
      if (contextPlan.status === 'executing' || contextPlan.status === 'completed' || contextPlan.status === 'failed') {
        setIsGeneratingPlan(false);
      }
    }
  }, [workflowPlan?.id, workflowPlan?.updatedAt, getWorkflowPlanFromContext]);

  const getModalTitle = () => {
    switch (currentView) {
      case 'plan-review':
        return 'Review Workflow';
      case 'checkpoint-review':
        return 'Approval Required';
      case 'email-view':
        return selectedEmailArtifact?.title || 'Sent Email';
      default:
        return 'Edit Task';
    }
  };

  const showBackButton = currentView === 'plan-review' || currentView === 'checkpoint-review' || currentView === 'email-view';

  const handleBack = () => {
    setCurrentView('main');
  };

  const handleSave = async () => {
    setIsSaving(true);
    await updateTask(task.id, {
      title,
      description,
    });
    setIsSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    await deleteTask(task.id);
    onClose();
  };

  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLDivElement>) => {
      const pastedText = e.clipboardData?.getData('text') || '';
      const url = extractUrl(pastedText);

      if (!url) return;

      setPastedUrl(url);
      checkUrl(url);
    },
    [checkUrl]
  );

  const findPlainUrl = useCallback((text: string, url: string): number => {
    let searchStart = 0;
    let foundIndex = -1;
    while (true) {
      const idx = text.indexOf(url, searchStart);
      if (idx === -1) break;
      const prefix = text.slice(Math.max(0, idx - 2), idx);
      if (!prefix.endsWith('](')) {
        foundIndex = idx;
      }
      searchStart = idx + 1;
    }
    return foundIndex;
  }, []);

  const handleConvertToPill = useCallback(() => {
    if (!pendingUrl || !pastedUrl) return;

    const pillSyntax = toPillSyntax(pendingUrl);

    let startIndex: number;
    if (pastedUrlEndIndex !== null) {
      startIndex = pastedUrlEndIndex - pastedUrl.length;
      if (description.slice(startIndex, pastedUrlEndIndex) !== pastedUrl) {
        startIndex = findPlainUrl(description, pastedUrl);
      }
    } else {
      startIndex = findPlainUrl(description, pastedUrl);
    }

    if (startIndex === -1) return;

    const newDescription =
      description.slice(0, startIndex) +
      pillSyntax +
      description.slice(startIndex + pastedUrl.length);

    setDescription(newDescription);
    clearPendingUrl();
    setPastedUrl(null);
    setPastedUrlEndIndex(null);
  }, [pendingUrl, pastedUrl, pastedUrlEndIndex, description, toPillSyntax, clearPendingUrl, findPlainUrl]);

  const handleDismissPillPrompt = useCallback(() => {
    clearPendingUrl();
    setPastedUrl(null);
    setPastedUrlEndIndex(null);
  }, [clearPendingUrl]);

  const handleStartAgent = async (agentId?: string) => {
    setIsGeneratingPlan(true);
    setWorkflowError(null);

    if (description !== task.description) {
      await updateTask(task.id, { title, description });
    }

    if (!activeProject) return;

    const result = await api.generateWorkflowPlan(activeProject.id, task.id, agentId);

    if (result.success && result.data) {
      setWorkflowPlan(result.data);
      updateWorkflowPlanInContext(result.data);
    } else {
      setWorkflowError(result.error?.message || 'Failed to start agent');
      setIsGeneratingPlan(false);
    }
  };

  const handleApprovePlan = async () => {
    if (!workflowPlan || !activeProject) return;

    setIsApprovingPlan(true);
    const result = await api.approveWorkflowPlan(activeProject.id, workflowPlan.id);
    if (result.success && result.data) {
      setWorkflowPlan(result.data);
      updateWorkflowPlanInContext(result.data);
      setCurrentView('main');
    } else {
      setWorkflowError(result.error?.message || 'Failed to approve plan');
    }
    setIsApprovingPlan(false);
  };

  const handleDismissWorkflow = async () => {
    if (!workflowPlan || !activeProject) return;
    await api.deleteWorkflowPlan(activeProject.id, workflowPlan.id);
    removeWorkflowPlanFromContext(workflowPlan.id);
    setWorkflowPlan(null);
  };

  const handleCancelWorkflow = async () => {
    if (!workflowPlan || !activeProject) return;
    const result = await api.cancelWorkflow(activeProject.id, workflowPlan.id);
    if (result.success && result.data) {
      setWorkflowPlan(result.data);
      updateWorkflowPlanInContext(result.data);
    }
  };

  const handleApproveCheckpoint = async (responseData?: Record<string, unknown>) => {
    if (!workflowPlan || !activeProject) return;
    setIsRespondingToCheckpoint(true);
    const result = await api.resolveWorkflowCheckpoint(activeProject.id, workflowPlan.id, {
      action: 'approve',
      data: responseData,
    });
    if (result.success && result.data) {
      setWorkflowPlan(result.data);
      updateWorkflowPlanInContext(result.data);
      setCurrentView('main');
    } else {
      setWorkflowError(result.error?.message || 'Failed to approve checkpoint');
    }
    setIsRespondingToCheckpoint(false);
  };

  const handleRequestChanges = async (feedback: string) => {
    if (!workflowPlan || !activeProject) return;
    setIsRespondingToCheckpoint(true);
    const result = await api.resolveWorkflowCheckpoint(activeProject.id, workflowPlan.id, {
      action: 'request_changes',
      feedback,
    });
    if (result.success && result.data) {
      setWorkflowPlan(result.data);
      updateWorkflowPlanInContext(result.data);
      setCurrentView('main');
    } else {
      setWorkflowError(result.error?.message || 'Failed to request changes');
    }
    setIsRespondingToCheckpoint(false);
  };

  const handleCancelCheckpoint = async () => {
    if (!workflowPlan || !activeProject) return;
    setIsRespondingToCheckpoint(true);
    const result = await api.resolveWorkflowCheckpoint(activeProject.id, workflowPlan.id, { action: 'cancel' });
    if (result.success && result.data) {
      setWorkflowPlan(result.data);
      updateWorkflowPlanInContext(result.data);
      setCurrentView('main');
    } else {
      setWorkflowError(result.error?.message || 'Failed to cancel workflow');
    }
    setIsRespondingToCheckpoint(false);
  };

  // Render content based on current view
  const renderContent = () => {
    // Plan Review (wizard pattern)
    if (currentView === 'plan-review' && workflowPlan) {
      return (
        <PlanReviewView
          plan={workflowPlan}
          onBack={() => setCurrentView('main')}
          onApprove={handleApprovePlan}
          loading={isApprovingPlan}
        />
      );
    }

    // Checkpoint Review (wizard pattern)
    if (currentView === 'checkpoint-review' && workflowPlan) {
      // Use context plan for real-time updates, fallback to local state
      const contextPlan = getWorkflowPlanFromContext(workflowPlan.id);
      const plan = contextPlan || workflowPlan;

      const checkpointData = plan.checkpointData as {
        tool?: string;
        action?: string;
        data?: Record<string, unknown>;
      } | undefined;

      const toolName = checkpointData?.tool || '';
      const ApprovalView = getApprovalView(toolName);

      // Parse data - handle JSON string case
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
          isLoading={isRespondingToCheckpoint}
        />
      );
    }

    // Email View (from artifact dropdown)
    if (currentView === 'email-view' && selectedEmailArtifact?.content) {
      return <EmailViewer content={selectedEmailArtifact.content} />;
    }

    // Main view (default)
    return (
      <>
        <div className="task-modal-form">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title..."
          />

          <RichTextEditor
            label="Description / Instructions"
            value={description}
            onChange={setDescription}
            onPaste={handlePaste}
            onPasteUrlPosition={setPastedUrlEndIndex}
            placeholder="Describe the task or provide instructions for the agent..."
            rows={4}
            pendingUrl={pendingUrl}
            isCheckingUrl={isCheckingUrl}
            onAcceptPill={handleConvertToPill}
            onDismissPill={handleDismissPillPrompt}
          />
        </div>

        {/* Agent Section */}
        <div className="task-modal-agent">
          {workflowError && (
            <div className="task-modal-error">{workflowError}</div>
          )}

          {workflowPlan ? (
            <div className="task-modal-workflow">
              {/* Use context plan for real-time updates, fallback to local state */}
              {(() => {
                const contextPlan = getWorkflowPlanFromContext(workflowPlan.id);
                const plan = contextPlan || workflowPlan;
                return (
                  <WorkflowProgress
                    plan={plan}
                    onCancel={handleCancelWorkflow}
                    onDismiss={handleDismissWorkflow}
                    onReviewCheckpoint={() => setCurrentView('checkpoint-review')}
                    onViewEmail={(artifact) => {
                      setSelectedEmailArtifact(artifact);
                      setCurrentView('email-view');
                    }}
                  />
                );
              })()}
            </div>
          ) : (
            <AgentSection
              projectId={task.projectId}
              onRun={handleStartAgent}
              disabled={!description.trim()}
              isRunning={isGeneratingPlan}
            />
          )}
        </div>

        <div className="task-modal-footer">
          <div className={`delete-action ${confirmingDelete ? 'confirming' : ''}`}>
            {confirmingDelete ? (
              <>
                <Button variant="danger" onClick={handleDelete}>
                  Confirm
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            )}
          </div>
          <div className="task-modal-footer-right">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!title.trim() || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </>
    );
  };

  // Use full width for approval views with rich content (PR diffs, Google Docs, Sheets, Emails)
  const FULL_WIDTH_TOOLS = [
    'GitHub__create_pr',
    'Google_Docs__createDocument',
    'Google_Docs__appendToDocument',
    'Google_Docs__replaceDocumentContent',
    'Google_Sheets__createSpreadsheet',
    'Google_Sheets__appendRows',
    'Google_Sheets__updateCells',
    'Google_Sheets__replaceSheetContent',
    'Gmail__sendEmail',
    'Gmail__createDraft',
  ];
  const checkpointTool = (workflowPlan?.checkpointData as { tool?: string } | undefined)?.tool;
  const needsFullWidth = currentView === 'checkpoint-review' &&
    checkpointTool && FULL_WIDTH_TOOLS.includes(checkpointTool);
  const modalWidth = needsFullWidth ? 'full' : 'lg';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={getModalTitle()}
      width={modalWidth}
      showBackButton={showBackButton}
      onBack={handleBack}
    >
      <div className={`task-modal ${currentView !== 'main' ? `view-${currentView}` : ''}`}>
        {renderContent()}
      </div>
    </Modal>
  );
}
