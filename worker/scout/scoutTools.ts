/**
 * Scout Tools - Zod schema definitions for company scouting
 *
 * Provides efficient company research by:
 * 1. Generating diverse search queries from criteria
 * 2. Running parallel Exa searches
 * 3. Extracting structured company data
 * 4. Deduplicating and ranking results
 */

import { z } from 'zod';
import { defineTools } from '../utils/zodTools';

/**
 * Schema for a discovered company
 */
export const companySchema = z.object({
  name: z.string().describe('Company name'),
  website: z.string().url().describe('Company website URL'),
  domain: z.string().describe('Domain extracted from website (e.g., company.com)'),
  reason: z.string().describe('Why this company matches the search criteria'),
  relevanceScore: z.number().min(0).max(100).describe('How well this matches criteria (0-100)'),
  sources: z.array(z.string()).describe('URLs where this company was found'),
});

export type Company = z.infer<typeof companySchema>;

/**
 * Scout tool definitions
 */
export const scoutTools = defineTools({
  scout_companies: {
    description: `Find companies matching specific criteria. This tool:
1. Generates 5-10 diverse search queries from your criteria
2. Runs all searches in parallel for speed
3. Extracts company name, website, and relevance reason
4. Deduplicates by domain
5. Scores and ranks by relevance

Example criteria:
- "DTC GLP-1 companies that have raised more than $10M"
- "AI startups in healthcare founded after 2020"
- "B2B SaaS companies in the fintech space with Series A+"

Returns a structured list of companies with websites and reasons for matching.`,
    input: z.object({
      criteria: z.string().min(10).max(1000).describe(
        'Description of companies to find. Be specific about industry, funding, business model, etc.'
      ),
      maxResults: z.number().int().min(5).max(50).default(20).describe(
        'Maximum number of companies to return (default: 20)'
      ),
      minRelevanceScore: z.number().int().min(0).max(100).default(60).describe(
        'Minimum relevance score to include (0-100, default: 60)'
      ),
    }),
    output: z.object({
      companies: z.array(companySchema).describe('List of matching companies'),
      queriesRun: z.number().describe('Number of search queries executed'),
      totalResultsProcessed: z.number().describe('Total search results analyzed'),
      searchQueries: z.array(z.string()).describe('The search queries that were used'),
    }),
  },
});
