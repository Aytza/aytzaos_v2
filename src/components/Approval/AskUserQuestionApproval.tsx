/**
 * AskUserQuestionApproval - Custom approval view for AskUser__askQuestions
 *
 * Displays a nice UI for users to answer structured questions with
 * multiple choice options. Supports single-select, multi-select,
 * and custom "Other" responses.
 */

import { useState } from 'react';
import { McpIcon } from '../common';
import { ApprovalFooter } from './ApprovalFooter';
import type { ApprovalViewProps } from './ApprovalViewRegistry';
import './Approval.css';
import './AskUserQuestionApproval.css';

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
  allowOther?: boolean;
}

interface QuestionAnswer {
  questionIndex: number;
  selectedOptions: string[];
  otherText?: string;
}

export function AskUserQuestionApproval({
  action,
  data,
  onApprove,
  onRequestChanges,
  onCancel,
  isLoading,
}: ApprovalViewProps) {
  // Parse questions from data
  const questions: Question[] = data.questions as Question[] || [];

  // State for tracking selected options per question
  // Key: questionIndex, Value: Set of selected option labels
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
  const handleOptionSelect = (questionIndex: number, optionLabel: string, isMultiSelect: boolean) => {
    setSelections((prev) => {
      const newSelections = new Map(prev);
      const current = new Set(newSelections.get(questionIndex) || []);

      if (isMultiSelect) {
        // Toggle selection for multi-select
        if (current.has(optionLabel)) {
          current.delete(optionLabel);
        } else {
          current.add(optionLabel);
        }
      } else {
        // Single select - clear and set
        current.clear();
        current.add(optionLabel);
      }

      // Remove "Other" from selections if a regular option is selected in single-select mode
      if (!isMultiSelect && optionLabel !== '__other__') {
        current.delete('__other__');
      }

      newSelections.set(questionIndex, current);
      return newSelections;
    });
  };

  // Handle "Other" text change
  const handleOtherTextChange = (questionIndex: number, text: string) => {
    setOtherTexts((prev) => {
      const newTexts = new Map(prev);
      newTexts.set(questionIndex, text);
      return newTexts;
    });

    // Also select the "Other" option when user starts typing
    if (text.length > 0) {
      setSelections((prev) => {
        const newSelections = new Map(prev);
        const current = new Set(newSelections.get(questionIndex) || []);
        const question = questions[questionIndex];

        if (question?.multiSelect) {
          current.add('__other__');
        } else {
          // Single select - clear others and select "Other"
          current.clear();
          current.add('__other__');
        }

        newSelections.set(questionIndex, current);
        return newSelections;
      });
    }
  };

  // Check if at least one question has a selection
  const hasAnySelection = () => {
    for (const [idx, selected] of selections) {
      if (selected.size > 0) {
        // If "Other" is selected, make sure there's text
        if (selected.has('__other__') && selected.size === 1) {
          const otherText = otherTexts.get(idx) || '';
          if (otherText.trim().length > 0) return true;
        } else if (selected.size > 0 && !selected.has('__other__')) {
          return true;
        } else if (selected.size > 1) {
          // Has other selections besides "Other"
          return true;
        }
      }
    }
    return false;
  };

  // Build answers array for approval
  const buildAnswers = (): QuestionAnswer[] => {
    return questions.map((_, idx) => {
      const selected = selections.get(idx) || new Set();
      const otherText = otherTexts.get(idx) || '';

      // Filter out __other__ from selected options and get actual labels
      const selectedOptions = Array.from(selected).filter((s) => s !== '__other__');

      const answer: QuestionAnswer = {
        questionIndex: idx,
        selectedOptions,
      };

      // Add other text if "Other" was selected
      if (selected.has('__other__') && otherText.trim()) {
        answer.otherText = otherText.trim();
      }

      return answer;
    });
  };

  // Handle approve
  const handleApprove = () => {
    const answers = buildAnswers();
    onApprove({ answers });
  };

  // Handle request changes (user wants to provide feedback)
  const handleRequestChanges = () => {
    onRequestChanges('User would like to provide additional feedback on the questions.');
  };

  return (
    <div className="approval-card askuser-approval">
      {/* Header */}
      <div className="approval-header">
        <McpIcon type="askuser" size={24} className="approval-icon" />
        <span className="approval-title">
          {action || 'User Input Required'}
        </span>
      </div>

      {/* Questions */}
      <div className="askuser-questions">
        {questions.map((question, questionIndex) => {
          const selected = selections.get(questionIndex) || new Set();
          const otherText = otherTexts.get(questionIndex) || '';
          const isMultiSelect = question.multiSelect ?? false;
          const allowOther = question.allowOther ?? true;

          return (
            <div key={questionIndex} className="askuser-question">
              {/* Question header and text */}
              <div className="askuser-question-header">
                {question.header && (
                  <span className="askuser-question-label">{question.header}</span>
                )}
                <p className="askuser-question-text">{question.question}</p>
                {isMultiSelect && (
                  <span className="askuser-multi-hint">Select all that apply</span>
                )}
              </div>

              {/* Options */}
              <div className="askuser-options">
                {question.options.map((option, optionIndex) => {
                  const isSelected = selected.has(option.label);

                  return (
                    <button
                      key={optionIndex}
                      type="button"
                      className={`askuser-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleOptionSelect(questionIndex, option.label, isMultiSelect)}
                      disabled={isLoading}
                    >
                      <div className="askuser-option-indicator">
                        {isMultiSelect ? (
                          <div className={`askuser-checkbox ${isSelected ? 'checked' : ''}`}>
                            {isSelected && (
                              <svg viewBox="0 0 16 16" fill="currentColor">
                                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`askuser-radio ${isSelected ? 'checked' : ''}`}>
                            {isSelected && <div className="askuser-radio-dot" />}
                          </div>
                        )}
                      </div>
                      <div className="askuser-option-content">
                        <span className="askuser-option-label">{option.label}</span>
                        {option.description && (
                          <span className="askuser-option-description">{option.description}</span>
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* "Other" option */}
                {allowOther && (
                  <div className={`askuser-option askuser-option-other ${selected.has('__other__') ? 'selected' : ''}`}>
                    <button
                      type="button"
                      className="askuser-option-other-toggle"
                      onClick={() => handleOptionSelect(questionIndex, '__other__', isMultiSelect)}
                      disabled={isLoading}
                    >
                      <div className="askuser-option-indicator">
                        {isMultiSelect ? (
                          <div className={`askuser-checkbox ${selected.has('__other__') ? 'checked' : ''}`}>
                            {selected.has('__other__') && (
                              <svg viewBox="0 0 16 16" fill="currentColor">
                                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`askuser-radio ${selected.has('__other__') ? 'checked' : ''}`}>
                            {selected.has('__other__') && <div className="askuser-radio-dot" />}
                          </div>
                        )}
                      </div>
                      <span className="askuser-option-label">Other</span>
                    </button>
                    {selected.has('__other__') && (
                      <input
                        type="text"
                        className="askuser-other-input"
                        placeholder="Enter your response..."
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

      {/* Footer */}
      <ApprovalFooter
        onApprove={handleApprove}
        onRequestChanges={handleRequestChanges}
        onCancel={onCancel}
        isLoading={isLoading}
        approveLabel="Submit"
        approveDisabled={!hasAnySelection()}
      />
    </div>
  );
}
