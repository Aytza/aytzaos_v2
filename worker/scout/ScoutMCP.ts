/**
 * ScoutMCP - Enhanced Company Scouting MCP Server
 *
 * Multi-stage intelligent company research:
 * 1. Generate diverse search queries from criteria
 * 2. Run parallel Exa searches with full text content
 * 3. Extract initial candidate companies
 * 4. Verify top candidates with targeted follow-up searches
 * 5. Confirm URLs, validate relevance, adjust scores
 * 6. Return thoroughly vetted companies with confidence scores
 */

import { HostedMCPServer, type MCPToolSchema, type MCPToolCallResult } from '../mcp/MCPClient';
import {
  scoutTools,
  type Company,
  type CandidateCompany,
  candidateCompanySchema,
  verificationResultSchema,
  scoutTestCases,
} from './scoutTools';
import { toolsToMCPSchemas, parseToolArgs } from '../utils/zodTools';
import { logger } from '../utils/logger';
import { type MCPProgress } from '../mcp/AccountMCPRegistry';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Exa MCP endpoint
const EXA_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';

// Model configuration per step
const MODELS = {
  // Fast/cheap for simple extraction tasks
  queryGeneration: 'claude-haiku-4-5-20251001' as const,
  candidateExtraction: 'claude-haiku-4-5-20251001' as const,
  // Best model for nuanced verification and scoring
  verification: 'claude-opus-4-5-20251101' as const,
};

// Zod schemas for Claude structured outputs
const searchQueriesSchema = z.object({
  queries: z.array(z.string()).min(5).max(12).describe('Array of diverse search queries'),
});

const candidatesSchema = z.object({
  candidates: z.array(candidateCompanySchema).describe('Array of candidate companies'),
});

const verificationsSchema = z.object({
  verifications: z.array(verificationResultSchema).describe('Array of verification results'),
});

interface ExaSearchResult {
  title: string;
  url: string;
  text?: string;
  highlights?: string[];
  score?: number;
  publishedDate?: string;
}

interface ExaSession {
  sessionId: string;
  expiresAt: number;
}

/**
 * Scout MCP Server - Enhanced company scouting with verification
 */
export class ScoutMCPServer extends HostedMCPServer {
  readonly name = 'Scout';
  readonly description = 'Find and verify companies matching specific criteria';

  private exaApiKey: string;
  private anthropicApiKey: string;
  private exaSession: ExaSession | null = null;
  private onProgress?: (progress: MCPProgress) => void;

  constructor(
    exaApiKey: string,
    anthropicApiKey: string,
    onProgress?: (progress: MCPProgress) => void
  ) {
    super();
    this.exaApiKey = exaApiKey;
    this.anthropicApiKey = anthropicApiKey;
    this.onProgress = onProgress;
  }

  /**
   * Emit progress event to the workflow
   */
  private emitProgress(
    stage: string,
    message: string,
    progress?: { current: number; total: number },
    data?: Record<string, unknown>
  ) {
    this.onProgress?.({
      toolName: 'scout_companies',
      stage,
      message,
      progress,
      data,
    });
  }

  getTools(): MCPToolSchema[] {
    return toolsToMCPSchemas(scoutTools);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    try {
      switch (name) {
        case 'scout_companies':
          return await this.scoutCompanies(args);
        default:
          return this.errorContent(`Unknown tool: ${name}`);
      }
    } catch (error) {
      logger.mcp.error('Scout tool error', {
        tool: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.errorContent(
        `Scout tool failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Main company scouting flow with verification
   */
  private async scoutCompanies(args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const parsed = parseToolArgs(scoutTools.scout_companies.input, args);
    const { criteria, maxResults, minRelevanceScore } = parsed;

    logger.mcp.info('Starting enhanced company scout', { criteria, maxResults, minRelevanceScore });

    // Stage 1: Generate search queries
    this.emitProgress('query_generation', 'Generating search queries...');
    const searchQueries = await this.generateSearchQueries(criteria);
    logger.mcp.info('Generated search queries', { count: searchQueries.length });
    this.emitProgress('query_generation', `Generated ${searchQueries.length} search queries`, undefined, { queries: searchQueries });

    // Stage 2: Run initial searches
    this.emitProgress('search', 'Running parallel searches...', { current: 0, total: searchQueries.length });
    const searchResults = await this.runParallelSearchesWithProgress(searchQueries);
    const allResults = searchResults.flat();
    logger.mcp.info('Initial search complete', { totalResults: allResults.length });
    this.emitProgress('search', `Found ${allResults.length} search results`, { current: searchQueries.length, total: searchQueries.length });

    // Stage 3: Extract initial candidates
    this.emitProgress('extraction', 'Extracting candidate companies...');
    const candidates = await this.extractCandidates(criteria, allResults);
    logger.mcp.info('Extracted candidates', { count: candidates.length });
    this.emitProgress('extraction', `Found ${candidates.length} candidate companies`, undefined, {
      topCandidates: candidates.slice(0, 5).map(c => c.name)
    });

    if (candidates.length === 0) {
      this.emitProgress('complete', 'No candidates found');
      return this.emptyResult(searchQueries);
    }

    // Stage 4: Sort candidates by initial score (verify ALL candidates)
    const sortedCandidates = candidates.sort((a, b) => b.initialScore - a.initialScore);

    logger.mcp.info('Verifying all candidates', {
      count: sortedCandidates.length,
      topNames: sortedCandidates.slice(0, 10).map(c => c.name)
    });

    // Stage 5: Verify candidates with targeted searches (with progress)
    this.emitProgress('verification', `Verifying ${sortedCandidates.length} candidates...`, { current: 0, total: sortedCandidates.length });
    const { verified: verifiedCompanies, rejected: rejectedCompanies } = await this.verifyAndEnrichWithProgress(
      criteria,
      sortedCandidates,
      allResults,
      minRelevanceScore
    );
    logger.mcp.info('Verification complete', { verifiedCount: verifiedCompanies.length, rejectedCount: rejectedCompanies.length });

    // Stage 6: Sort final results (already filtered during verification)
    const finalCompanies = verifiedCompanies
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults);

    const inScopeCount = finalCompanies.length;
    const outOfScopeCount = rejectedCompanies.length;

    logger.mcp.info('Scout complete', {
      inScopeCount,
      outOfScopeCount,
      topCompanies: finalCompanies.slice(0, 5).map(c => ({ name: c.name, score: c.relevanceScore }))
    });

    // Combine accepted (sorted by score) + rejected (also sorted, limited to 20)
    const sortedRejected = rejectedCompanies
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 20);
    const allCompanies = [...finalCompanies, ...sortedRejected];

    // Calculate total unique sources
    const allSources = new Set([
      ...finalCompanies.flatMap(c => c.sources),
      ...sortedRejected.flatMap(c => c.sources),
    ]);

    const result = {
      companies: allCompanies,
      inScopeCount,
      outOfScopeCount,
      queriesRun: searchQueries.length + sortedCandidates.length, // Initial + verification queries
      totalSourcesProcessed: allSources.size,
      searchQueries,
    };

    this.emitProgress('complete', `Found ${inScopeCount} matching companies, ${outOfScopeCount} rejected`, undefined, {
      topCompanies: finalCompanies.slice(0, 5).map(c => ({ name: c.name, score: c.relevanceScore }))
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }

  /**
   * Generate diverse search queries optimized for company discovery
   */
  private async generateSearchQueries(criteria: string): Promise<string[]> {
    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    const response = await client.messages.create({
      model: MODELS.queryGeneration,
      max_tokens: 1024,
      tools: [{
        name: 'submit_queries',
        description: 'Submit the generated search queries',
        input_schema: z.toJSONSchema(searchQueriesSchema, { target: 'draft-7' }) as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: 'submit_queries' },
      messages: [{
        role: 'user',
        content: `Generate 8-10 strategic web search queries to find companies matching:

"${criteria}"

Create queries optimized for finding COMPANY WEBSITES and COMPANY PROFILES, not just news.

Required query types:
1. Direct company search: "[industry] companies [key differentiator]"
2. Database search: "site:crunchbase.com [industry terms]"
3. Funding/investment: "[industry] startup funding raised"
4. Competitor analysis: If example companies mentioned, "[company] competitors alternatives"
5. Market landscape: "[industry] market companies list"
6. News/launches: "[industry] company launches 2024 2025"
7. Professional: "[industry] company founders CEO"
8. Product-specific: "[product/service type] provider platform"

Tips:
- Use industry-specific jargon
- Include product/service keywords
- Add geographic qualifiers if mentioned

Use the submit_queries tool.`,
      }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUse) {
      const parsed = searchQueriesSchema.safeParse(toolUse.input);
      if (parsed.success) {
        return parsed.data.queries;
      }
    }

    // Fallback queries
    return [
      criteria,
      `${criteria} companies`,
      `site:crunchbase.com ${criteria}`,
      `${criteria} funding raised`,
      `${criteria} market leaders`,
    ];
  }

  /**
   * Initialize Exa MCP session
   */
  private async initExaSession(): Promise<string | null> {
    if (this.exaSession && Date.now() < this.exaSession.expiresAt) {
      return this.exaSession.sessionId || null;
    }

    const url = new URL(EXA_MCP_ENDPOINT);
    url.searchParams.set('exaApiKey', this.exaApiKey);
    url.searchParams.set('tools', 'web_search_exa');

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: 'scout', version: '2.0.0' },
          },
        }),
      });

      const sessionId = response.headers.get('Mcp-Session-Id') || '';
      await response.text();

      this.exaSession = {
        sessionId,
        expiresAt: Date.now() + 4 * 60 * 1000,
      };

      return sessionId || null;
    } catch (error) {
      logger.mcp.warn('Failed to init Exa session', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Run parallel searches with staggering and progress reporting
   */
  private async runParallelSearchesWithProgress(queries: string[]): Promise<ExaSearchResult[][]> {
    const STAGGER_DELAY_MS = 600;
    const sessionId = await this.initExaSession();
    let completedCount = 0;

    const searchPromises = queries.map((query, index) =>
      new Promise<ExaSearchResult[]>(resolve => {
        setTimeout(async () => {
          try {
            const results = await this.searchExa(query, { sessionId: sessionId || undefined });
            completedCount++;
            this.emitProgress('search', `Searching... (${completedCount}/${queries.length})`, {
              current: completedCount,
              total: queries.length,
            });
            resolve(results);
          } catch (error) {
            logger.mcp.warn('Search failed', { query, error: error instanceof Error ? error.message : String(error) });
            completedCount++;
            this.emitProgress('search', `Searching... (${completedCount}/${queries.length})`, {
              current: completedCount,
              total: queries.length,
            });
            resolve([]);
          }
        }, index * STAGGER_DELAY_MS);
      })
    );

    return Promise.all(searchPromises);
  }

  /**
   * Exa search with retry logic
   */
  private async searchExa(query: string, options: {
    sessionId?: string;
    numResults?: number;
    retryCount?: number;
  } = {}): Promise<ExaSearchResult[]> {
    const { sessionId, numResults = 15, retryCount = 0 } = options;
    const MAX_RETRIES = 3;

    const url = new URL(EXA_MCP_ENDPOINT);
    url.searchParams.set('exaApiKey', this.exaApiKey);
    url.searchParams.set('tools', 'web_search_exa');

    const searchArgs: Record<string, unknown> = {
      query,
      numResults,
      type: 'auto',
      useAutoprompt: true,
      text: { maxCharacters: 1000, includeHtmlTags: false },
      highlights: { numSentences: 3, highlightsPerUrl: 2 },
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
        ...(sessionId && { 'Mcp-Session-Id': sessionId }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: 'web_search_exa', arguments: searchArgs },
      }),
    });

    const searchText = await response.text();

    // Handle rate limiting
    if (searchText.includes('429') && retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount + 1) * 1000;
      logger.mcp.info('Rate limited, retrying', { query, delay, attempt: retryCount + 1 });
      await new Promise(resolve => setTimeout(resolve, delay));
      this.exaSession = null;
      return this.searchExa(query, { ...options, retryCount: retryCount + 1 });
    }

    return this.parseExaResponse(searchText, query);
  }

  /**
   * Parse Exa response
   */
  private parseExaResponse(searchText: string, query: string): ExaSearchResult[] {
    let rpcResult: { result?: { content?: Array<{ type: string; text?: string }> }; error?: unknown } | null = null;

    try {
      rpcResult = JSON.parse(searchText);
    } catch {
      const lines = searchText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            rpcResult = JSON.parse(line.slice(5).trim());
            break;
          } catch { continue; }
        }
      }
    }

    if (!rpcResult?.result?.content) return [];

    const textContent = rpcResult.result.content.find(c => c.type === 'text');
    if (!textContent?.text) return [];

    const text = textContent.text;

    // Try JSON first
    try {
      const data = JSON.parse(text);
      if (data.results && Array.isArray(data.results)) {
        return data.results;
      }
    } catch { /* Continue to text parsing */ }

    // Parse plain text format
    const results: ExaSearchResult[] = [];
    const normalizedText = '\n' + text.replace(/\r\n/g, '\n');
    const blocks = normalizedText.split(/\nTitle: /).filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      const result: Partial<ExaSearchResult> = { title: lines[0]?.trim() };

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('URL: ')) result.url = line.slice(5).trim();
        else if (line.startsWith('Text: ')) result.text = line.slice(6).trim();
      }

      if (result.title && result.url) {
        results.push(result as ExaSearchResult);
      }
    }

    if (results.length > 0) return results;

    // Fallback: return raw text as single result
    if (text.length > 100) {
      return [{ title: `Search: ${query}`, url: '', text }];
    }

    return [];
  }

  /**
   * Extract initial candidate companies from search results
   */
  private async extractCandidates(criteria: string, results: ExaSearchResult[]): Promise<CandidateCompany[]> {
    if (results.length === 0) return [];

    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    const resultsText = results
      .slice(0, 80) // Limit to avoid token overflow
      .map((r, i) => {
        const parts = [`[${i + 1}] ${r.title}`, `URL: ${r.url}`];
        if (r.text) parts.push(`Content: ${r.text.slice(0, 600)}`);
        return parts.join('\n');
      })
      .join('\n\n---\n\n');

    const response = await client.messages.create({
      model: MODELS.candidateExtraction,
      max_tokens: 8192,
      tools: [{
        name: 'submit_candidates',
        description: 'Submit extracted candidate companies',
        input_schema: z.toJSONSchema(candidatesSchema, { target: 'draft-7' }) as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: 'submit_candidates' },
      messages: [{
        role: 'user',
        content: `Extract CANDIDATE companies from search results for verification.

SEARCH CRITERIA: "${criteria}"

SEARCH RESULTS:
${resultsText}

INSTRUCTIONS:
1. Extract ALL distinct companies mentioned that might match the criteria
2. Include companies even if you're uncertain - we'll verify later
3. For each company, provide your best guess at their website
4. Score 1-10 based on how likely they match (will be verified)
5. Include the source URLs where you found them

SCORING GUIDE:
- 8-10: Highly likely match based on context
- 5-7: Possibly matches, needs verification
- 1-4: Unlikely but mentioned in relevant context

Extract as many candidates as possible (aim for 20-40). Better to over-include.

Use submit_candidates tool.`,
      }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUse) {
      const parsed = candidatesSchema.safeParse(toolUse.input);
      if (parsed.success) {
        // Normalize and dedupe
        const seen = new Set<string>();
        return parsed.data.candidates
          .map(c => ({
            ...c,
            domain: this.extractDomain(c.website || c.domain),
            website: this.normalizeUrl(c.website),
          }))
          .filter(c => {
            const key = c.domain.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      }
      logger.mcp.warn('Failed to parse candidates', { error: parsed.error?.issues });
    }

    return [];
  }

  /**
   * Verify candidates with parallel batched processing and progress
   */
  private async verifyAndEnrichWithProgress(
    criteria: string,
    candidates: CandidateCompany[],
    originalResults: ExaSearchResult[],
    minRelevanceScore: number
  ): Promise<{ verified: Company[]; rejected: Company[] }> {
    const BATCH_SIZE = 8;
    const MAX_CONCURRENT = 3;

    // Run verification searches for all candidates (with progress)
    this.emitProgress('verification', 'Running verification searches...', { current: 0, total: candidates.length });
    const verificationSearches = await this.runVerificationSearchesWithProgress(criteria, candidates);

    // Prepare verification context for all candidates
    const verificationContext = candidates.map((candidate, i) => {
      const verifyResults = verificationSearches[i] || [];
      const originalMentions = originalResults.filter(r =>
        r.title?.toLowerCase().includes(candidate.name.toLowerCase()) ||
        r.text?.toLowerCase().includes(candidate.name.toLowerCase()) ||
        r.url?.includes(candidate.domain)
      );

      return {
        candidate,
        verificationResults: verifyResults.slice(0, 5),
        originalMentions: originalMentions.length,
        originalSources: originalMentions.slice(0, 3).map(r => r.url),
      };
    });

    // Batch candidates for parallel scoring
    const batches: number[][] = [];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      batches.push(Array.from({ length: Math.min(BATCH_SIZE, candidates.length - i) }, (_, j) => i + j));
    }

    const allVerified: Company[] = [];
    const allRejected: Company[] = [];
    let completedCount = 0;

    // Process batches with controlled concurrency
    for (let batchGroupStart = 0; batchGroupStart < batches.length; batchGroupStart += MAX_CONCURRENT) {
      const batchGroup = batches.slice(batchGroupStart, batchGroupStart + MAX_CONCURRENT);

      const results = await Promise.all(
        batchGroup.map(async (batchIndices) => {
          const batchCandidates = batchIndices.map(i => candidates[i]);
          const batchContexts = batchIndices.map(i => verificationContext[i]);
          return this.scoreBatch(criteria, batchCandidates, batchContexts, minRelevanceScore);
        })
      );

      // Collect results and emit progress
      for (const { verified, rejected } of results) {
        allVerified.push(...verified);
        allRejected.push(...rejected);
        completedCount += verified.length + rejected.length;

        this.emitProgress(
          'verification',
          `Verified ${completedCount}/${candidates.length} candidates`,
          { current: completedCount, total: candidates.length },
          {
            latestVerified: verified.map(c => ({ name: c.name, score: c.relevanceScore })),
            verifiedCount: allVerified.length,
            rejectedCount: allRejected.length,
          }
        );
      }
    }

    return { verified: allVerified, rejected: allRejected };
  }

  /**
   * Score a batch of candidates using Claude
   */
  private async scoreBatch(
    criteria: string,
    batchCandidates: CandidateCompany[],
    batchContexts: Array<{
      candidate: CandidateCompany;
      verificationResults: ExaSearchResult[];
      originalMentions: number;
      originalSources: string[];
    }>,
    minRelevanceScore: number
  ): Promise<{ verified: Company[]; rejected: Company[] }> {
    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    const contextText = batchContexts.map((ctx, i) => {
      const verifyText = ctx.verificationResults
        .map(r => `- ${r.title}\n  URL: ${r.url}\n  ${r.text?.slice(0, 300) || ''}`)
        .join('\n');

      return `
### Candidate ${i + 1}: ${ctx.candidate.name}
Initial Website: ${ctx.candidate.website}
Initial Score: ${ctx.candidate.initialScore}/10
Initial Reason: ${ctx.candidate.reason}
Mentions in original search: ${ctx.originalMentions}

VERIFICATION SEARCH RESULTS:
${verifyText || 'No additional results found'}
`;
    }).join('\n---\n');

    const response = await client.messages.create({
      model: MODELS.verification,
      max_tokens: 4096,
      tools: [{
        name: 'submit_verifications',
        description: 'Submit verification results',
        input_schema: z.toJSONSchema(verificationsSchema, { target: 'draft-7' }) as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: 'submit_verifications' },
      messages: [{
        role: 'user',
        content: `Verify each candidate company against the search criteria.

SEARCH CRITERIA: "${criteria}"

CANDIDATES TO VERIFY:
${contextText}

For each candidate, determine:
1. urlConfirmed: Is the website URL correct?
2. correctUrl: If URL is wrong, provide the correct one.
3. matchesScope: Does this company ACTUALLY match the criteria?
4. scopeEvidence: Cite specific evidence.
5. adjustedScore: Final score 1-10.
6. description: Accurate 1-2 sentence description.

SCORING:
- 9-10: Confirmed perfect match
- 7-8: Confirmed match
- 5-6: Partial match
- 1-4: Does not match

Use submit_verifications tool.`,
      }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUse) {
      // Fallback: return as unverified with initial scores
      return this.fallbackBatch(batchCandidates, batchContexts, minRelevanceScore);
    }

    const parsed = verificationsSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      return this.fallbackBatch(batchCandidates, batchContexts, minRelevanceScore);
    }

    const verified: Company[] = [];
    const rejected: Company[] = [];

    for (let i = 0; i < batchCandidates.length; i++) {
      const candidate = batchCandidates[i];
      const ctx = batchContexts[i];
      const verification = parsed.data.verifications.find(
        v => v.companyName.toLowerCase() === candidate.name.toLowerCase()
      ) || parsed.data.verifications[i];

      if (!verification) continue;

      const website = verification.correctUrl || candidate.website;
      const domain = this.extractDomain(website);

      const allSources = [
        ...ctx.originalSources,
        ...ctx.verificationResults.map(r => r.url),
      ].filter((url, idx, arr) => url && arr.indexOf(url) === idx);

      const meetsThreshold = verification.adjustedScore >= minRelevanceScore;
      const company: Company = {
        name: candidate.name,
        website: this.normalizeUrl(website),
        domain,
        description: verification.description,
        relevanceScore: verification.adjustedScore,
        relevanceLevel: verification.adjustedScore >= 7 ? 'High' : verification.adjustedScore >= 5 ? 'Medium' : 'Low',
        status: meetsThreshold ? 'Accepted' : 'Rejected',
        reason: verification.scopeEvidence,
        sources: allSources.slice(0, 5),
        mentions: ctx.originalMentions + ctx.verificationResults.length,
        verified: verification.urlConfirmed && verification.matchesScope,
      };

      if (meetsThreshold) {
        verified.push(company);
      } else {
        rejected.push(company);
      }
    }

    return { verified, rejected };
  }

  /**
   * Fallback for batch when verification fails
   */
  private fallbackBatch(
    candidates: CandidateCompany[],
    contexts: Array<{ originalMentions: number; verificationResults: ExaSearchResult[]; originalSources: string[] }>,
    minRelevanceScore: number
  ): { verified: Company[]; rejected: Company[] } {
    const verified: Company[] = [];
    const rejected: Company[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const ctx = contexts[i];
      const meetsThreshold = c.initialScore >= minRelevanceScore;
      const company: Company = {
        name: c.name,
        website: this.normalizeUrl(c.website),
        domain: this.extractDomain(c.website),
        description: c.reason,
        relevanceScore: c.initialScore,
        relevanceLevel: c.initialScore >= 7 ? 'High' : c.initialScore >= 5 ? 'Medium' : 'Low',
        status: meetsThreshold ? 'Accepted' : 'Rejected',
        reason: c.reason,
        sources: c.sources,
        mentions: Math.max(ctx.originalMentions, 1),
        verified: false,
      };

      if (meetsThreshold) {
        verified.push(company);
      } else {
        rejected.push(company);
      }
    }

    return { verified, rejected };
  }

  /**
   * Run verification searches with progress
   */
  private async runVerificationSearchesWithProgress(
    criteria: string,
    candidates: CandidateCompany[]
  ): Promise<ExaSearchResult[][]> {
    const sessionId = await this.initExaSession();
    let completedCount = 0;

    const keyTerms = criteria
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 3)
      .join(' ');

    const searches = candidates.map((candidate, index) =>
      new Promise<ExaSearchResult[]>(resolve => {
        setTimeout(async () => {
          try {
            const query = `"${candidate.name}" ${keyTerms}`;
            const results = await this.searchExa(query, {
              sessionId: sessionId || undefined,
              numResults: 5,
            });
            completedCount++;
            if (completedCount % 5 === 0) {
              this.emitProgress('verification', `Running verification searches... (${completedCount}/${candidates.length})`, {
                current: completedCount,
                total: candidates.length,
              });
            }
            resolve(results);
          } catch {
            completedCount++;
            resolve([]);
          }
        }, index * 400);
      })
    );

    return Promise.all(searches);
  }

  /**
   * Helper: Normalize URL
   */
  private normalizeUrl(url: string): string {
    if (!url) return '';
    url = url.trim();
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }
    return url;
  }

  /**
   * Helper: Extract domain from URL
   */
  private extractDomain(urlOrDomain: string): string {
    if (!urlOrDomain) return '';
    try {
      const url = urlOrDomain.startsWith('http') ? urlOrDomain : `https://${urlOrDomain}`;
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return urlOrDomain.replace(/^www\./, '').split('/')[0];
    }
  }

  /**
   * Empty result helper
   */
  private emptyResult(queries: string[]): MCPToolCallResult {
    const result = {
      companies: [],
      inScopeCount: 0,
      outOfScopeCount: 0,
      queriesRun: queries.length,
      totalSourcesProcessed: 0,
      searchQueries: queries,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }

  /**
   * Self-test: Run test cases and validate results
   */
  async runSelfTest(): Promise<{ passed: boolean; results: Array<{ name: string; passed: boolean; details: string }> }> {
    const results: Array<{ name: string; passed: boolean; details: string }> = [];

    for (const testCase of scoutTestCases) {
      logger.mcp.info('Running test case', { name: testCase.name });

      try {
        const result = await this.scoutCompanies({
          criteria: testCase.criteria,
          maxResults: 20,
          minRelevanceScore: 5,
        });

        const structuredResult = (result as { structuredContent?: { companies: Company[] } }).structuredContent;
        const companies = structuredResult?.companies || [];
        const companyNames = companies.map(c => c.name.toLowerCase());

        // Check if expected companies are found
        const foundExpected = testCase.expectedCompanies.filter(
          exp => companyNames.some(name => name.includes(exp.toLowerCase()))
        );

        const meetsMinCount = companies.length >= testCase.minExpectedCount;
        const foundEnoughExpected = foundExpected.length >= Math.min(testCase.expectedCompanies.length, 2);

        const passed = meetsMinCount && (testCase.expectedCompanies.length === 0 || foundEnoughExpected);

        results.push({
          name: testCase.name,
          passed,
          details: `Found ${companies.length} companies. Expected: ${testCase.expectedCompanies.join(', ') || 'any'}. Found expected: ${foundExpected.join(', ') || 'N/A'}`,
        });
      } catch (error) {
        results.push({
          name: testCase.name,
          passed: false,
          details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const allPassed = results.every(r => r.passed);
    logger.mcp.info('Self-test complete', { allPassed, results });

    return { passed: allPassed, results };
  }
}
