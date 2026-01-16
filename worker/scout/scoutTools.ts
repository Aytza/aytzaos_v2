/**
 * Scout Tools - Zod schema definitions for company scouting
 *
 * Enhanced multi-stage scouting:
 * 1. Generate diverse search queries from criteria
 * 2. Run parallel Exa searches for initial candidates
 * 3. Verify each candidate with targeted follow-up searches
 * 4. Extract and confirm company data with Claude
 * 5. Score, deduplicate, and rank by verified relevance
 */

import { z } from 'zod';
import { defineTools } from '../utils/zodTools';

/**
 * Source information with metadata
 */
export const sourceSchema = z.object({
  url: z.string().describe('Source URL'),
  title: z.string().optional().describe('Source title/headline'),
  snippet: z.string().optional().describe('Relevant text snippet'),
});

export type Source = z.infer<typeof sourceSchema>;

/**
 * Enhanced schema for a discovered company
 * Supports 1-10 scoring, verification status, and detailed reasoning
 */
export const companySchema = z.object({
  name: z.string().describe('Official company name'),
  website: z.string().describe('Company website URL'),
  domain: z.string().describe('Domain extracted from website (e.g., company.com)'),
  description: z.string().describe('Brief description of what the company does'),
  relevanceScore: z.number().min(1).max(10).describe('Relevance score from 1-10'),
  relevanceLevel: z.enum(['High', 'Medium', 'Low']).describe('Relevance category'),
  status: z.enum(['Accepted', 'Rejected']).describe('Whether company met the minimum relevance threshold'),
  reason: z.string().describe('Detailed explanation of why this company matches or does not match the criteria'),
  sources: z.array(z.string()).describe('URLs where this company was found'),
  mentions: z.number().int().min(1).describe('Number of times company was mentioned across sources'),
  verified: z.boolean().describe('Whether URL and relevance have been verified'),
});

export type Company = z.infer<typeof companySchema>;

/**
 * Schema for initial candidate extraction (before verification)
 */
export const candidateCompanySchema = z.object({
  name: z.string().describe('Company name'),
  website: z.string().describe('Company website URL (best guess)'),
  domain: z.string().describe('Domain'),
  reason: z.string().describe('Initial reason for match'),
  initialScore: z.number().min(1).max(10).describe('Initial relevance score 1-10'),
  sources: z.array(z.string()).describe('Source URLs'),
});

export type CandidateCompany = z.infer<typeof candidateCompanySchema>;

/**
 * Schema for verification result
 */
export const verificationResultSchema = z.object({
  companyName: z.string().describe('Company name being verified'),
  urlConfirmed: z.boolean().describe('Whether the website URL is correct'),
  correctUrl: z.string().optional().describe('Corrected URL if different'),
  matchesScope: z.boolean().describe('Whether company actually matches the search criteria'),
  scopeEvidence: z.string().describe('Evidence supporting or refuting scope match'),
  adjustedScore: z.number().min(1).max(10).describe('Adjusted relevance score after verification'),
  description: z.string().describe('Verified description of company'),
});

export type VerificationResult = z.infer<typeof verificationResultSchema>;


/**
 * Scout tool definitions
 */
export const scoutTools = defineTools({
  scout_companies: {
    description: `Find and verify companies matching specific criteria using multi-stage intelligent search.

This enhanced tool:
1. Generates 7-9 strategic search queries optimized for company discovery
2. Runs parallel Exa searches with full text content
3. Extracts initial candidate companies with Claude Haiku (fast)
4. **Verifies ALL candidates** with targeted follow-up searches
5. Uses Claude Opus for rigorous verification - confirms URLs, validates relevance, adjusts scores
6. Returns thoroughly vetted companies with confidence scores

Scoring (1-10):
- 9-10: Perfect match - core business aligns exactly with criteria
- 7-8: Strong match - primary focus matches with minor variations
- 5-6: Partial match - related but not exact fit
- 1-4: Weak match - tangentially related

Example criteria:
- "Pharma companies developing GLP-1 drugs - Novo Nordisk, Eli Lilly as good fits"
- "DTC telehealth companies exclusively offering GLP-1 medications"
- "AI startups in healthcare with Series A+ funding"

Returns verified companies with URLs, detailed reasoning, and source evidence.`,
    input: z.object({
      criteria: z.string().min(10).max(1000).describe(
        'Description of companies to find. Include example companies if known.'
      ),
      maxResults: z.number().int().min(5).max(50).default(20).describe(
        'Maximum number of verified companies to return (default: 20)'
      ),
      minRelevanceScore: z.number().int().min(1).max(10).default(5).describe(
        'Minimum relevance score to include (1-10, default: 5)'
      ),
    }),
    output: z.object({
      companies: z.array(companySchema).describe('All companies found - accepted companies first (sorted by score), then rejected companies. Check status field for Accepted/Rejected.'),
      inScopeCount: z.number().describe('Number of companies meeting minimum score (Accepted)'),
      outOfScopeCount: z.number().describe('Number of candidates below threshold (Rejected)'),
      queriesRun: z.number().describe('Total search queries executed (initial + verification)'),
      totalSourcesProcessed: z.number().describe('Total unique sources analyzed'),
      searchQueries: z.array(z.string()).describe('Initial search queries used'),
    }),
  },
});

/**
 * Test cases for validating scout performance
 */
export const scoutTestCases = [
  {
    name: 'GLP-1 Pharma Developers',
    criteria: 'Pharma companies developing GLP-1 drugs - Novo Nordisk, Eli Lilly as good fits; exclude generics',
    expectedCompanies: ['Novo Nordisk', 'Eli Lilly', 'Pfizer', 'Roche'],
    minExpectedCount: 5,
  },
  {
    name: 'DTC GLP-1 Telehealth',
    criteria: 'DTC telehealth companies exclusively offering GLP-1 medications for weight loss',
    expectedCompanies: ['Hims', 'Ro', 'Noom'],
    minExpectedCount: 3,
  },
  {
    name: 'AI Healthcare Startups',
    criteria: 'AI startups in healthcare diagnostics with Series A+ funding',
    expectedCompanies: [],
    minExpectedCount: 5,
  },
];
