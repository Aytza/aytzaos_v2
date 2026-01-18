/**
 * CompanyScout - Standalone company research tool
 *
 * A specialized AI-powered tool for finding and evaluating companies.
 * Shows real-time agent activity and streams company results.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input } from '../common';
import { CompanyResultsGrid } from './CompanyResultsGrid';
import { ScoutQuestionsPanel } from './ScoutQuestionsPanel';
import { WorkflowProgress } from '../Workflow';
import { getApprovalView } from '../Approval';
import { useTaskWorkflow } from '../../hooks/useTaskWorkflow';
import { useToast } from '../../context/ToastContext';
import type { Task, WorkflowPlan, WorkflowArtifact } from '../../types';
import type { Company, ScoutPhase, PipelineStats, ScoutQuestion } from './types';
import * as api from '../../api/client';
import './CompanyScout.css';

export function CompanyScout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();

  // Scout state
  const [searchQuery, setSearchQuery] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [scoutHistory, setScoutHistory] = useState<Task[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Company results state (parsed from workflow)
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentPhase, setCurrentPhase] = useState<ScoutPhase>('idle');

  // View state for checkpoint
  const [showCheckpointReview, setShowCheckpointReview] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const companiesRef = useRef<Company[]>([]);

  // Use the task workflow hook for the active task
  const workflow = useTaskWorkflow({
    taskId: activeTask?.id || '',
    mode: 'standalone',
  });

  // Handle OAuth callbacks
  useEffect(() => {
    const googleConnected = searchParams.get('google');
    const googleError = searchParams.get('google_error');

    if (googleConnected === 'connected') {
      addToast({ type: 'success', message: 'Google account connected successfully' });
      searchParams.delete('google');
      setSearchParams(searchParams, { replace: true });
    }
    if (googleError) {
      addToast({ type: 'error', message: `Google connection failed: ${googleError}` });
      searchParams.delete('google_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, addToast]);

  // Load scout history on mount
  useEffect(() => {
    loadScoutHistory();
  }, []);

  // Load workflow plan when active task changes
  useEffect(() => {
    if (activeTask) {
      workflow.loadWorkflowPlan();
    }
  }, [activeTask?.id]);

  // Parse companies from workflow logs/steps
  useEffect(() => {
    if (!workflow.workflowPlan) return;

    // Update phase based on workflow status
    if (workflow.workflowPlan.status === 'checkpoint') {
      const checkpointData = workflow.workflowPlan.checkpointData as { tool?: string } | undefined;
      if (checkpointData?.tool === 'AskUser__askQuestions') {
        setCurrentPhase('questions');
      }
    } else if (workflow.workflowPlan.status === 'executing') {
      if (currentPhase === 'idle' || currentPhase === 'questions') {
        setCurrentPhase('searching');
      }
    } else if (workflow.workflowPlan.status === 'completed') {
      setCurrentPhase('complete');
    }

    // Parse companies from workflow steps and result
    parseCompaniesFromWorkflow(workflow.workflowPlan);
  }, [workflow.workflowPlan, workflow.workflowLogs]);

  const loadScoutHistory = async () => {
    setLoadingHistory(true);
    const result = await api.getStandaloneTasks();
    if (result.success && result.data) {
      // Filter to only show Company Scout tasks
      const scoutTasks = result.data.filter(
        (t) => t.title.startsWith('Company Scout:')
      );
      setScoutHistory(scoutTasks);
    }
    setLoadingHistory(false);
  };

  // Parse [COMPANY_DATA] blocks from workflow output
  const parseCompaniesFromWorkflow = useCallback((plan: WorkflowPlan) => {
    const newCompanies: Company[] = [];

    // Parse from workflow logs - look for agent text that contains company data
    if (workflow.workflowLogs) {
      for (const log of workflow.workflowLogs) {
        // Check log message
        if (log.message) {
          const parsed = parseCompaniesFromText(log.message);
          newCompanies.push(...parsed);
        }
        // Check metadata text (for agent streams)
        if (log.metadata?.text) {
          const parsed = parseCompaniesFromText(log.metadata.text);
          newCompanies.push(...parsed);
        }
      }
    }

    // Parse from step results
    if (plan.steps) {
      for (const step of plan.steps) {
        if (step.result && typeof step.result === 'string') {
          const parsed = parseCompaniesFromText(step.result);
          newCompanies.push(...parsed);
        }
      }
    }

    // Dedupe and merge with existing
    if (newCompanies.length > 0) {
      setCompanies((prev) => {
        const existingUrls = new Set(prev.map((c) => c.website.toLowerCase()));
        const toAdd = newCompanies.filter(
          (c) => !existingUrls.has(c.website.toLowerCase())
        );
        if (toAdd.length > 0) {
          const updated = [...prev, ...toAdd];
          companiesRef.current = updated;
          return updated;
        }
        return prev;
      });
    }
  }, [workflow.workflowLogs]);

  const parseCompaniesFromText = (text: string): Company[] => {
    const regex = /\[COMPANY_DATA\]([\s\S]*?)\[\/COMPANY_DATA\]/g;
    const parsed: Company[] = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const data = JSON.parse(match[1].trim());
        if (data.name && data.website) {
          const company: Company = {
            id: `company-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: data.name,
            website: data.website,
            reasoning: data.reasoning || '',
            fitScore: typeof data.fitScore === 'number' ? data.fitScore : null,
            status: data.fitScore !== null ? 'scored' : 'discovered',
            discoveredAt: new Date().toISOString(),
            ...(data.fitScore !== null && { scoredAt: new Date().toISOString() }),
          };
          parsed.push(company);
        }
      } catch {
        // Skip invalid JSON
      }
    }

    return parsed;
  };

  // Compute pipeline stats
  const pipelineStats: PipelineStats = {
    totalDiscovered: companies.length,
    verified: companies.filter((c) => ['verified', 'scoring', 'scored'].includes(c.status)).length,
    verifying: companies.filter((c) => c.status === 'verifying').length,
    scored: companies.filter((c) => c.status === 'scored').length,
    scoring: companies.filter((c) => c.status === 'scoring').length,
    included: companies.filter((c) => c.fitScore !== null && c.fitScore >= 5).length,
    excluded: companies.filter((c) => c.fitScore !== null && c.fitScore < 5).length,
    errors: companies.filter((c) => c.status === 'error').length,
  };

  // Start a new scout
  const handleStartScout = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setIsStarting(true);
    setCompanies([]);
    companiesRef.current = [];
    setCurrentPhase('idle');

    try {
      // Use the Company Scout API which sets the specialized system prompt
      const result = await api.startCompanyScout(searchQuery.trim());

      if (!result.success || !result.data) {
        throw new Error(result.error?.message || 'Failed to start scout');
      }

      const { task } = result.data;
      setActiveTask(task);
      setScoutHistory((prev) => [task, ...prev]);
      setCurrentPhase('searching');
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to start scout',
      });
    }
    setIsStarting(false);
  }, [searchQuery, addToast]);

  // Handle question answers
  const handleQuestionResponse = useCallback(async (answers: Record<string, unknown>) => {
    if (!activeTask || !workflow.workflowPlan) return;

    await workflow.resolveCheckpoint('approve', { data: answers });
    setCurrentPhase('searching');
  }, [activeTask, workflow]);

  // Cancel scout and start new
  const handleNewScout = useCallback(() => {
    if (workflow.workflowPlan?.status === 'executing') {
      workflow.cancelWorkflow();
    }
    setActiveTask(null);
    setSearchQuery('');
    setCompanies([]);
    companiesRef.current = [];
    setCurrentPhase('idle');
    setShowCheckpointReview(false);
    inputRef.current?.focus();
  }, [workflow]);

  // Open a previous scout
  const handleOpenScout = useCallback((task: Task) => {
    setActiveTask(task);
    setSearchQuery(task.title.replace('Company Scout: ', ''));
    setCompanies([]);
    companiesRef.current = [];
    setCurrentPhase('idle');
    setShowCheckpointReview(false);
  }, []);

  // Parse questions from checkpoint data
  const getQuestionsFromCheckpoint = (): ScoutQuestion[] => {
    if (!workflow.workflowPlan?.checkpointData) return [];

    const checkpointData = workflow.workflowPlan.checkpointData as {
      tool?: string;
      data?: { questions?: Array<{
        question: string;
        header?: string;
        options: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
        allowOther?: boolean;
      }> };
    };

    if (checkpointData.tool !== 'AskUser__askQuestions') return [];

    const questions = checkpointData.data?.questions;
    if (!Array.isArray(questions)) return [];

    return questions.map((q, idx) => ({
      id: `question-${idx}`,
      question: q.question,
      header: q.header,
      options: q.options || [],
      multiSelect: q.multiSelect,
      allowOther: q.allowOther ?? true,
    }));
  };

  // Check if we're at a questions checkpoint
  const isAtQuestionsCheckpoint =
    workflow.workflowPlan?.status === 'checkpoint' &&
    (workflow.workflowPlan.checkpointData as { tool?: string })?.tool === 'AskUser__askQuestions';

  // Check if we're at a non-question checkpoint (like approval for sheets)
  const isAtOtherCheckpoint =
    workflow.workflowPlan?.status === 'checkpoint' &&
    !isAtQuestionsCheckpoint;

  const isRunning = workflow.workflowPlan?.status === 'executing';
  const isComplete = workflow.workflowPlan?.status === 'completed';
  const hasWorkflow = !!workflow.workflowPlan;

  // Checkpoint approval handlers
  const handleApproveCheckpoint = async (responseData?: Record<string, unknown>) => {
    await workflow.resolveCheckpoint('approve', { data: responseData });
    setShowCheckpointReview(false);
  };

  const handleRequestChanges = async (feedback: string) => {
    await workflow.resolveCheckpoint('request_changes', { feedback });
    setShowCheckpointReview(false);
  };

  const handleCancelCheckpoint = async () => {
    await workflow.resolveCheckpoint('cancel');
    setShowCheckpointReview(false);
  };

  // Render checkpoint review (for non-question checkpoints)
  const renderCheckpointReview = () => {
    if (!showCheckpointReview || !workflow.workflowPlan) return null;

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
      <div className="scout-checkpoint-review">
        <div className="checkpoint-review-header">
          <button
            className="back-button"
            onClick={() => setShowCheckpointReview(false)}
          >
            ← Back
          </button>
          <h3>Approval Required</h3>
        </div>
        <ApprovalView
          tool={toolName}
          action={checkpointData?.action || ''}
          data={dataObj}
          onApprove={handleApproveCheckpoint}
          onRequestChanges={handleRequestChanges}
          onCancel={handleCancelCheckpoint}
          isLoading={workflow.isRespondingToCheckpoint}
        />
      </div>
    );
  };

  // If showing checkpoint review, render that
  if (showCheckpointReview && isAtOtherCheckpoint) {
    return (
      <div className="company-scout">
        <div className="scout-container">
          {renderCheckpointReview()}
        </div>
      </div>
    );
  }

  return (
    <div className="company-scout">
      <div className="scout-container">
        {/* Header */}
        <div className="scout-header">
          <h1 className="scout-title">Company Scout</h1>
          {activeTask && (
            <Button variant="ghost" onClick={handleNewScout}>
              + New Search
            </Button>
          )}
        </div>

        {/* Main content area */}
        {!activeTask ? (
          // No active task - show search input
          <div className="scout-input-section">
            <div className="scout-input-container">
              <p className="scout-subtitle">
                Discover and evaluate companies with AI-powered research
              </p>

              <div className="scout-search-box">
                <Input
                  ref={inputRef}
                  placeholder="What kind of companies are you looking for?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim()) {
                      handleStartScout();
                    }
                  }}
                  disabled={isStarting}
                />
                <Button
                  variant="primary"
                  onClick={handleStartScout}
                  disabled={!searchQuery.trim() || isStarting}
                >
                  {isStarting ? 'Starting...' : 'Start Scouting'}
                </Button>
              </div>

              <div className="scout-examples">
                <span className="scout-examples-label">Try:</span>
                <button
                  className="scout-example"
                  onClick={() => setSearchQuery('AI startups in healthcare that have raised Series A')}
                >
                  AI healthcare startups (Series A)
                </button>
                <button
                  className="scout-example"
                  onClick={() => setSearchQuery('Enterprise SaaS companies with ARR over $10M')}
                >
                  Enterprise SaaS ($10M+ ARR)
                </button>
                <button
                  className="scout-example"
                  onClick={() => setSearchQuery('Climate tech companies in Europe')}
                >
                  European climate tech
                </button>
              </div>
            </div>

            {/* Scout history */}
            {!loadingHistory && scoutHistory.length > 0 && (
              <div className="scout-history">
                <h3 className="scout-history-title">Recent Searches</h3>
                <div className="scout-history-list">
                  {scoutHistory.slice(0, 5).map((task) => (
                    <button
                      key={task.id}
                      className="scout-history-item"
                      onClick={() => handleOpenScout(task)}
                    >
                      <span className="history-query">
                        {task.title.replace('Company Scout: ', '')}
                      </span>
                      <span className="history-date">
                        {new Date(task.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Active task - show scout progress
          <div className="scout-active-section">
            {/* Query display */}
            <div className="scout-query-header">
              <p className="scout-query-text">Searching: "{searchQuery}"</p>
            </div>

            {/* Questions checkpoint - show inline */}
            {isAtQuestionsCheckpoint && (
              <ScoutQuestionsPanel
                questions={getQuestionsFromCheckpoint()}
                onSubmit={handleQuestionResponse}
                onCancel={handleNewScout}
                isLoading={workflow.isRespondingToCheckpoint}
                searchQuery={searchQuery}
              />
            )}

            {/* Show workflow progress for running/completed states */}
            {hasWorkflow && !isAtQuestionsCheckpoint && (
              <div className="scout-workflow-section">
                {/* Workflow Progress - shows agent activity */}
                <WorkflowProgress
                  plan={workflow.workflowPlan!}
                  onCancel={workflow.cancelWorkflow}
                  onDismiss={handleNewScout}
                  onReviewCheckpoint={() => setShowCheckpointReview(true)}
                  onViewEmail={(artifact: WorkflowArtifact) => {
                    // Handle email view if needed
                    console.log('View email:', artifact);
                  }}
                  customLogs={{
                    logs: workflow.workflowLogs,
                    fetchLogs: workflow.loadWorkflowPlan,
                  }}
                />

                {/* Company results section - only show if we have companies or completed */}
                {(companies.length > 0 || isComplete) && (
                  <div className="scout-results-section">
                    <div className="scout-results-header">
                      <h2>
                        {isComplete
                          ? `Found ${pipelineStats.included} Companies`
                          : `${companies.length} Companies Found`}
                      </h2>
                      {isComplete && pipelineStats.excluded > 0 && (
                        <span className="excluded-count">
                          ({pipelineStats.excluded} excluded with score &lt; 5)
                        </span>
                      )}
                    </div>
                    <CompanyResultsGrid
                      companies={companies}
                      isLoading={isRunning}
                      phase={currentPhase}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Loading state when workflow is starting */}
            {!workflow.workflowPlan && activeTask && (
              <div className="scout-loading">
                <div className="loading-spinner" />
                <p>Starting scout...</p>
              </div>
            )}

            {/* Error state */}
            {workflow.error && (
              <div className="scout-error">
                <p>{workflow.error}</p>
                <Button variant="ghost" onClick={handleNewScout}>
                  Try Again
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
