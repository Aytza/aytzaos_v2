/**
 * Company Scout Tool Definitions
 *
 * Specialized tools for company research, verification, and scoring.
 * Uses Zod schemas for type-safe tool definitions.
 */

import { z } from 'zod';
import { defineTools } from '../utils/zodTools';

// ============================================================================
// Schemas
// ============================================================================

const companyDataSchema = z.object({
  name: z.string().describe('Company name'),
  website: z.string().describe('Company website URL'),
  reasoning: z.string().describe('Why this company matches the criteria'),
  fitScore: z.number().min(1).max(10).describe('Fit score from 1-10'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

export const companyScoutTools = defineTools({
  /**
   * Report a discovered company with full details
   */
  reportCompany: {
    description: `Report a discovered company. Use this tool to stream companies to the user as you find them.

Each company must include:
- name: Official company name
- website: Working company URL
- reasoning: 2-3 sentences explaining why it matches criteria
- fitScore: Score 1-10 (5+ = included, <5 = excluded but still shown)`,
    input: z.object({
      companies: z.array(companyDataSchema).min(1).max(10).describe('Array of companies to report'),
    }),
    output: z.object({
      reported: z.number().describe('Number of companies reported'),
    }),
  },

  /**
   * Update the status of the scouting process
   */
  updateScoutStatus: {
    description: 'Update the user on the current scouting progress',
    input: z.object({
      phase: z.enum(['searching', 'verifying', 'scoring', 'complete']).describe('Current phase'),
      message: z.string().optional().describe('Optional status message'),
      progress: z.object({
        found: z.number().describe('Total companies found'),
        verified: z.number().describe('Companies verified'),
        scored: z.number().describe('Companies scored'),
      }).optional(),
    }),
    output: z.object({
      acknowledged: z.boolean(),
    }),
  },

  /**
   * Create a Google Sheet with the results
   */
  createCompanySheet: {
    description: 'Create a Google Sheet with the company results. Use this when the user wants to export.',
    input: z.object({
      title: z.string().describe('Sheet title'),
      companies: z.array(companyDataSchema).describe('Companies to include in the sheet'),
    }),
    output: z.object({
      sheetUrl: z.string().describe('URL of the created Google Sheet'),
    }),
    approvalRequiredFields: ['title', 'companies'],
  },
});

export type CompanyScoutToolName = keyof typeof companyScoutTools;
