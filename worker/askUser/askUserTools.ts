/**
 * AskUser MCP Tool Definitions
 *
 * Single source of truth for AskUser tool schemas using Zod.
 * Allows agents to ask users structured questions with multiple choice options.
 */

import { z } from 'zod';
import { defineTools } from '../utils/zodTools';

// ============================================================================
// Input/Output Schemas
// ============================================================================

const questionOptionSchema = z.object({
  label: z.string().min(1).max(100).describe('Short label for the option'),
  description: z.string().max(500).optional().describe('Optional longer description of this option'),
});

const questionSchema = z.object({
  question: z.string().min(1).max(1000).describe('The question text to display to the user'),
  header: z.string().max(50).optional().describe('Short header/label for the question (e.g., "Priority", "Format")'),
  options: z.array(questionOptionSchema).min(2).max(10).describe('Array of options for the user to choose from'),
  multiSelect: z.boolean().default(false).describe('Allow user to select multiple options (default: false)'),
  allowOther: z.boolean().default(true).describe('Allow user to enter a custom "Other" response (default: true)'),
});

const askQuestionsOutput = z.object({
  answers: z.array(z.object({
    questionIndex: z.number().describe('Index of the question (0-based)'),
    selectedOptions: z.array(z.string()).describe('Array of selected option labels'),
    otherText: z.string().optional().describe('Custom text if user selected "Other"'),
  })).describe('Array of answers corresponding to each question'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

export const askUserTools = defineTools({
  askQuestions: {
    description: 'Ask the user one or more structured questions with multiple choice options. Use this when you need user input, preferences, or decisions. Each question can have 2-10 options, support multi-select, and optionally allow custom "Other" responses.',
    input: z.object({
      questions: z.array(questionSchema).min(1).max(4).describe('Array of 1-4 questions to ask the user'),
    }),
    output: askQuestionsOutput,
    approvalRequiredFields: ['questions'],
  },
});

// Export type for tool names
export type AskUserToolName = keyof typeof askUserTools;
