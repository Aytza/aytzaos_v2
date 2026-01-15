/**
 * useCompanyScoutWorkflow - Hook for managing Company Scout workflows
 *
 * Wraps the task workflow system with Company Scout-specific logic:
 * - Manages scout phases (questions, searching, verifying, scoring)
 * - Parses company data from agent responses
 * - Provides streaming company updates
 * - Handles export to Google Sheets
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  Company,
  ScoutPhase,
  ScoutQuestion,
  PipelineStats,
} from '../components/CompanyScout/types';
import type { WorkflowPlan, WorkflowLog } from '../types';
import * as api from '../api/client';

interface UseCompanyScoutWorkflowOptions {
  onPhaseChange?: (phase: ScoutPhase) => void;
  onCompanyDiscovered?: (company: Company) => void;
}

interface UseCompanyScoutWorkflowReturn {
  // State
  currentPhase: ScoutPhase;
  companies: Company[];
  currentQuestions: ScoutQuestion[];
  pipelineStats: PipelineStats;
  isProcessing: boolean;
  isExporting: boolean;
  error: string | null;

  // Actions
  startScout: (query: string) => Promise<void>;
  submitQuestionAnswers: (answers: Record<string, unknown>) => Promise<void>;
  exportToGoogleSheets: () => Promise<string>;
  reset: () => void;
}

export function useCompanyScoutWorkflow({
  onPhaseChange,
  onCompanyDiscovered,
}: UseCompanyScoutWorkflowOptions = {}): UseCompanyScoutWorkflowReturn {
  // Core state
  const [currentPhase, setCurrentPhase] = useState<ScoutPhase>('idle');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentQuestions, setCurrentQuestions] = useState<ScoutQuestion[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Task/workflow refs
  const taskIdRef = useRef<string | null>(null);
  const planIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const queryRef = useRef<string>('');

  // Pipeline stats computed from companies
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

  // Update phase and notify
  const updatePhase = useCallback(
    (phase: ScoutPhase) => {
      setCurrentPhase(phase);
      onPhaseChange?.(phase);
    },
    [onPhaseChange]
  );

  // Parse company data from agent response
  const parseCompaniesFromText = useCallback(
    (text: string): Company[] => {
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
    },
    []
  );

  // Parse questions from checkpoint data
  const parseQuestionsFromCheckpoint = useCallback(
    (checkpointData: Record<string, unknown>): ScoutQuestion[] => {
      const data = checkpointData.data as Record<string, unknown> | undefined;
      const questions = data?.questions as Array<{
        question: string;
        header?: string;
        options: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
        allowOther?: boolean;
      }>;

      if (!Array.isArray(questions)) return [];

      return questions.map((q, idx) => ({
        id: `question-${idx}`,
        question: q.question,
        header: q.header,
        options: q.options || [],
        multiSelect: q.multiSelect,
        allowOther: q.allowOther ?? true,
      }));
    },
    []
  );

  // Connect to WebSocket for real-time updates
  const connectWebSocket = useCallback(
    (taskId: string) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/tasks/${taskId}/ws`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'workflow_update') {
            const plan = message.plan as WorkflowPlan;
            planIdRef.current = plan.id;

            // Check for checkpoint (questions)
            if (plan.status === 'checkpoint' && plan.checkpointData) {
              const checkpoint = plan.checkpointData as { tool?: string };
              if (checkpoint.tool === 'AskUser__askQuestions') {
                const questions = parseQuestionsFromCheckpoint(plan.checkpointData as Record<string, unknown>);
                setCurrentQuestions(questions);
                updatePhase('questions');
                setIsProcessing(false);
              }
            }

            // Check for completion
            if (plan.status === 'completed') {
              updatePhase('complete');
              setIsProcessing(false);
            }

            if (plan.status === 'failed') {
              setError('Scout workflow failed');
              setIsProcessing(false);
            }
          }

          if (message.type === 'stream_chunk') {
            // Parse companies from streaming text
            const text = message.text as string;
            const newCompanies = parseCompaniesFromText(text);

            if (newCompanies.length > 0) {
              // Update phase based on activity
              if (currentPhase === 'questions') {
                updatePhase('searching');
              }

              setCompanies((prev) => {
                // Dedupe by website
                const existing = new Set(prev.map((c) => c.website.toLowerCase()));
                const toAdd = newCompanies.filter(
                  (c) => !existing.has(c.website.toLowerCase())
                );
                if (toAdd.length > 0) {
                  toAdd.forEach((c) => onCompanyDiscovered?.(c));
                  return [...prev, ...toAdd];
                }
                return prev;
              });
            }
          }

          if (message.type === 'log') {
            const log = message.log as WorkflowLog;
            // Check for phase-related logs
            if (log.message.toLowerCase().includes('verif')) {
              updatePhase('verifying');
            } else if (log.message.toLowerCase().includes('scor')) {
              updatePhase('scoring');
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        setError('Connection lost. Please try again.');
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    },
    [currentPhase, onCompanyDiscovered, parseCompaniesFromText, parseQuestionsFromCheckpoint, updatePhase]
  );

  // Start a new scout
  const startScout = useCallback(
    async (query: string) => {
      setError(null);
      setIsProcessing(true);
      queryRef.current = query;

      try {
        // Start Company Scout with the specialized API
        // This creates a task and starts the workflow with the Company Scout system prompt
        const result = await api.startCompanyScout(query);

        if (!result.success || !result.data) {
          throw new Error(result.error?.message || 'Failed to start scout');
        }

        const { task, plan } = result.data;
        taskIdRef.current = task.id;
        planIdRef.current = plan.id;

        // Connect WebSocket for real-time updates
        connectWebSocket(task.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start scout');
        setIsProcessing(false);
      }
    },
    [connectWebSocket]
  );

  // Submit answers to questions
  const submitQuestionAnswers = useCallback(
    async (answers: Record<string, unknown>) => {
      if (!taskIdRef.current || !planIdRef.current) return;

      setIsProcessing(true);
      setCurrentQuestions([]);
      updatePhase('searching');

      try {
        await api.resolveStandaloneWorkflowCheckpoint(taskIdRef.current, planIdRef.current, {
          action: 'approve',
          data: answers,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit answers');
        setIsProcessing(false);
      }
    },
    [updatePhase]
  );

  // Export companies to Google Sheets
  const exportToGoogleSheets = useCallback(async (): Promise<string> => {
    setIsExporting(true);

    try {
      // Prepare data for sheets
      const rows = companies
        .filter((c) => c.status === 'scored')
        .sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0))
        .map((c) => ({
          'Company Name': c.name,
          Website: c.website,
          Reasoning: c.reasoning,
          'Fit Score': c.fitScore,
          Status: c.fitScore && c.fitScore >= 5 ? 'Included' : 'Excluded',
        }));

      // For now, return a placeholder
      // In full implementation, this would call Google Sheets API
      console.log('Would export to sheets:', rows);

      // Simulate export delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setIsExporting(false);
      return 'https://docs.google.com/spreadsheets/d/example';
    } catch (err) {
      setIsExporting(false);
      throw err;
    }
  }, [companies]);

  // Reset the scout
  const reset = useCallback(() => {
    // Close WebSocket if open
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset all state
    setCurrentPhase('idle');
    setCompanies([]);
    setCurrentQuestions([]);
    setIsProcessing(false);
    setIsExporting(false);
    setError(null);
    taskIdRef.current = null;
    planIdRef.current = null;
    queryRef.current = '';
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    currentPhase,
    companies,
    currentQuestions,
    pipelineStats,
    isProcessing,
    isExporting,
    error,
    startScout,
    submitQuestionAnswers,
    exportToGoogleSheets,
    reset,
  };
}
