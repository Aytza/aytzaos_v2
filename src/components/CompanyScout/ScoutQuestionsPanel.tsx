/**
 * ScoutQuestionsPanel - Smart clarifying questions for company criteria
 *
 * Displays agent-generated questions to refine the company search.
 * Questions are focused on:
 * - Industry/sector specifics
 * - Company stage (startup vs established)
 * - Geographic focus
 * - Funding stage/revenue size
 * - Specific characteristics or technologies
 */

import { useState, useCallback } from 'react';
import { Button } from '../common';
import type { ScoutQuestion, QuestionAnswer } from './types';
import './ScoutQuestionsPanel.css';

interface ScoutQuestionsPanelProps {
  questions: ScoutQuestion[];
  onSubmit: (answers: Record<string, unknown>) => void;
  onCancel: () => void;
  isLoading: boolean;
  searchQuery: string;
}

export function ScoutQuestionsPanel({
  questions,
  onSubmit,
  onCancel,
  isLoading,
  searchQuery,
}: ScoutQuestionsPanelProps) {
  // State for tracking selected options per question
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => {
    const initial = new Map<number, Set<string>>();
    questions.forEach((_, idx) => initial.set(idx, new Set()));
    return initial;
  });

  // State for "Other" text inputs per question
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => {
    const initial = new Map<number, string>();
    questions.forEach((_, idx) => initial.set(idx, ''));
    return initial;
  });

  // Handle option selection
  const handleOptionSelect = useCallback((questionIndex: number, optionLabel: string, isMultiSelect: boolean) => {
    setSelections((prev) => {
      const newSelections = new Map(prev);
      const current = new Set(newSelections.get(questionIndex) || []);

      if (isMultiSelect) {
        if (current.has(optionLabel)) {
          current.delete(optionLabel);
        } else {
          current.add(optionLabel);
        }
      } else {
        current.clear();
        current.add(optionLabel);
      }

      if (!isMultiSelect && optionLabel !== '__other__') {
        current.delete('__other__');
      }

      newSelections.set(questionIndex, current);
      return newSelections;
    });
  }, []);

  // Handle "Other" text change
  const handleOtherTextChange = useCallback((questionIndex: number, text: string) => {
    setOtherTexts((prev) => {
      const newTexts = new Map(prev);
      newTexts.set(questionIndex, text);
      return newTexts;
    });

    if (text.length > 0) {
      setSelections((prev) => {
        const newSelections = new Map(prev);
        const current = new Set(newSelections.get(questionIndex) || []);
        const question = questions[questionIndex];

        if (question?.multiSelect) {
          current.add('__other__');
        } else {
          current.clear();
          current.add('__other__');
        }

        newSelections.set(questionIndex, current);
        return newSelections;
      });
    }
  }, [questions]);

  // Check if at least one question has a selection
  const hasAnySelection = useCallback(() => {
    for (const [idx, selected] of selections) {
      if (selected.size > 0) {
        if (selected.has('__other__') && selected.size === 1) {
          const otherText = otherTexts.get(idx) || '';
          if (otherText.trim().length > 0) return true;
        } else if (selected.size > 0 && !selected.has('__other__')) {
          return true;
        } else if (selected.size > 1) {
          return true;
        }
      }
    }
    return false;
  }, [selections, otherTexts]);

  // Build answers array for submission
  const buildAnswers = useCallback((): QuestionAnswer[] => {
    return questions.map((_, idx) => {
      const selected = selections.get(idx) || new Set();
      const otherText = otherTexts.get(idx) || '';

      const selectedOptions = Array.from(selected).filter((s) => s !== '__other__');

      const answer: QuestionAnswer = {
        questionIndex: idx,
        selectedOptions,
      };

      if (selected.has('__other__') && otherText.trim()) {
        answer.otherText = otherText.trim();
      }

      return answer;
    });
  }, [questions, selections, otherTexts]);

  const handleSubmit = useCallback(() => {
    const answers = buildAnswers();
    onSubmit({ answers });
  }, [buildAnswers, onSubmit]);

  if (questions.length === 0) {
    return (
      <div className="scout-questions-panel">
        <div className="scout-questions-loading">
          <div className="loading-spinner" />
          <p>Analyzing your request...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scout-questions-panel">
      <div className="scout-questions-header">
        <h2>Let's refine your search</h2>
        <p className="scout-questions-context">
          Searching for: <strong>"{searchQuery}"</strong>
        </p>
        <p className="scout-questions-subtitle">
          Answer these questions to help me find the most relevant companies for you.
        </p>
      </div>

      <div className="scout-questions-list">
        {questions.map((question, questionIndex) => {
          const selected = selections.get(questionIndex) || new Set();
          const otherText = otherTexts.get(questionIndex) || '';
          const isMultiSelect = question.multiSelect ?? false;
          const allowOther = question.allowOther ?? true;

          return (
            <div key={question.id || questionIndex} className="scout-question">
              <div className="scout-question-header">
                {question.header && (
                  <span className="scout-question-label">{question.header}</span>
                )}
                <p className="scout-question-text">{question.question}</p>
                {isMultiSelect && (
                  <span className="scout-multi-hint">Select all that apply</span>
                )}
              </div>

              <div className="scout-options">
                {question.options.map((option, optionIndex) => {
                  const isSelected = selected.has(option.label);

                  return (
                    <button
                      key={optionIndex}
                      type="button"
                      className={`scout-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleOptionSelect(questionIndex, option.label, isMultiSelect)}
                      disabled={isLoading}
                    >
                      <div className="scout-option-indicator">
                        {isMultiSelect ? (
                          <div className={`scout-checkbox ${isSelected ? 'checked' : ''}`}>
                            {isSelected && (
                              <svg viewBox="0 0 16 16" fill="currentColor">
                                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`scout-radio ${isSelected ? 'checked' : ''}`}>
                            {isSelected && <div className="scout-radio-dot" />}
                          </div>
                        )}
                      </div>
                      <div className="scout-option-content">
                        <span className="scout-option-label">{option.label}</span>
                        {option.description && (
                          <span className="scout-option-description">{option.description}</span>
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* "Other" option */}
                {allowOther && (
                  <div className={`scout-option scout-option-other ${selected.has('__other__') ? 'selected' : ''}`}>
                    <button
                      type="button"
                      className="scout-option-other-toggle"
                      onClick={() => handleOptionSelect(questionIndex, '__other__', isMultiSelect)}
                      disabled={isLoading}
                    >
                      <div className="scout-option-indicator">
                        {isMultiSelect ? (
                          <div className={`scout-checkbox ${selected.has('__other__') ? 'checked' : ''}`}>
                            {selected.has('__other__') && (
                              <svg viewBox="0 0 16 16" fill="currentColor">
                                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`scout-radio ${selected.has('__other__') ? 'checked' : ''}`}>
                            {selected.has('__other__') && <div className="scout-radio-dot" />}
                          </div>
                        )}
                      </div>
                      <span className="scout-option-label">Other</span>
                    </button>
                    {selected.has('__other__') && (
                      <input
                        type="text"
                        className="scout-other-input"
                        placeholder="Enter your specific criteria..."
                        value={otherText}
                        onChange={(e) => handleOtherTextChange(questionIndex, e.target.value)}
                        disabled={isLoading}
                        autoFocus
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="scout-questions-footer">
        <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!hasAnySelection() || isLoading}
        >
          {isLoading ? 'Starting...' : 'Start Searching'}
        </Button>
      </div>
    </div>
  );
}
