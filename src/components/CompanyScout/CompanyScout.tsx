/**
 * CompanyScout - Standalone company research tool
 *
 * A specialized AI-powered tool for finding and evaluating companies.
 * Features:
 * - Smart clarifying questions to understand search criteria
 * - Real-time streaming of discovered companies
 * - Visual pipeline showing extraction → verification → scoring
 * - Fixed output format: Company name, Website, Reasoning, Fit score
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input } from '../common';
import { CompanyResultsGrid } from './CompanyResultsGrid';
import { CompanyPipeline } from './CompanyPipeline';
import { ScoutQuestionsPanel } from './ScoutQuestionsPanel';
import { useCompanyScoutWorkflow } from '../../hooks/useCompanyScoutWorkflow';
import { useToast } from '../../context/ToastContext';
// Types used implicitly through hook return type
import './CompanyScout.css';

type ScoutView = 'input' | 'questions' | 'scouting' | 'results';

export function CompanyScout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();
  const [view, setView] = useState<ScoutView>('input');
  const [searchQuery, setSearchQuery] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Workflow hook for managing the scout workflow
  const workflow = useCompanyScoutWorkflow({
    onPhaseChange: (phase) => {
      if (phase === 'questions') setView('questions');
      else if (phase === 'searching' || phase === 'verifying' || phase === 'scoring') setView('scouting');
      else if (phase === 'complete') setView('results');
    },
    onCompanyDiscovered: () => {
      // Company added to list, handled internally by hook
    },
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

  // Focus input on mount
  useEffect(() => {
    if (view === 'input' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [view]);

  const handleStartScout = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setIsStarting(true);
    try {
      await workflow.startScout(searchQuery.trim());
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to start scout',
      });
    }
    setIsStarting(false);
  }, [searchQuery, workflow, addToast]);

  const handleQuestionResponse = useCallback(async (answers: Record<string, unknown>) => {
    await workflow.submitQuestionAnswers(answers);
  }, [workflow]);

  const handleReset = useCallback(() => {
    setSearchQuery('');
    setView('input');
    workflow.reset();
  }, [workflow]);

  const handleExportToSheets = useCallback(async () => {
    try {
      await workflow.exportToGoogleSheets();
      addToast({ type: 'success', message: 'Exported to Google Sheets!' });
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to export',
      });
    }
  }, [workflow, addToast]);

  // Render based on current view
  const renderContent = () => {
    switch (view) {
      case 'input':
        return (
          <div className="scout-input-section">
            <div className="scout-input-container">
              <h1 className="scout-title">Company Scout</h1>
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
          </div>
        );

      case 'questions':
        return (
          <ScoutQuestionsPanel
            questions={workflow.currentQuestions}
            onSubmit={handleQuestionResponse}
            onCancel={handleReset}
            isLoading={workflow.isProcessing}
            searchQuery={searchQuery}
          />
        );

      case 'scouting':
      case 'results':
        return (
          <div className="scout-results-section">
            <div className="scout-results-header">
              <div className="scout-results-title-row">
                <h2 className="scout-results-title">
                  {view === 'scouting' ? 'Scouting Companies...' : 'Scout Results'}
                </h2>
                <div className="scout-results-actions">
                  {view === 'results' && workflow.companies.length > 0 && (
                    <Button
                      variant="primary"
                      onClick={handleExportToSheets}
                      disabled={workflow.isExporting}
                    >
                      {workflow.isExporting ? 'Exporting...' : 'Export to Google Sheets'}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={handleReset}>
                    New Search
                  </Button>
                </div>
              </div>
              <p className="scout-results-query">"{searchQuery}"</p>
            </div>

            {/* Pipeline visualization */}
            <CompanyPipeline
              phase={workflow.currentPhase}
              stats={workflow.pipelineStats}
            />

            {/* Company results grid */}
            <CompanyResultsGrid
              companies={workflow.companies}
              isLoading={view === 'scouting'}
              phase={workflow.currentPhase}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="company-scout">
      <div className="scout-container">
        {renderContent()}
      </div>
    </div>
  );
}
