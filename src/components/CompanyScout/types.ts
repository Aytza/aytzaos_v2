/**
 * Types for Company Scout
 */

// Company status in the pipeline
export type CompanyStatus =
  | 'discovered'      // Just found, not yet verified
  | 'verifying'       // Currently being verified
  | 'verified'        // Website and basic info confirmed
  | 'scoring'         // Currently being scored
  | 'scored'          // Has a fit score
  | 'error';          // Failed verification

// Scout workflow phases
export type ScoutPhase =
  | 'idle'            // Not started
  | 'questions'       // Asking clarifying questions
  | 'searching'       // Searching for companies
  | 'verifying'       // Verifying discovered companies
  | 'scoring'         // Scoring verified companies
  | 'complete';       // All done

// A discovered company
export interface Company {
  id: string;
  name: string;
  website: string;
  reasoning: string;
  fitScore: number | null;          // 1-10 score, null if not yet scored
  status: CompanyStatus;
  discoveredAt: string;
  verifiedAt?: string;
  scoredAt?: string;
  error?: string;
}

// Clarifying question from the agent
export interface ScoutQuestion {
  id: string;
  question: string;
  header?: string;
  options: Array<{
    label: string;
    description?: string;
  }>;
  multiSelect?: boolean;
  allowOther?: boolean;
}

// Pipeline statistics
export interface PipelineStats {
  totalDiscovered: number;
  verified: number;
  verifying: number;
  scored: number;
  scoring: number;
  included: number;        // Fit score >= 5
  excluded: number;        // Fit score < 5
  errors: number;
}

// Question answer format
export interface QuestionAnswer {
  questionIndex: number;
  selectedOptions: string[];
  otherText?: string;
}

// Scout task data stored in workflow
export interface ScoutTaskData {
  query: string;
  criteria?: Record<string, unknown>;
  companies: Company[];
  phase: ScoutPhase;
}
