/**
 * ScoutMCP - Company Scouting MCP Server
 *
 * Provides efficient company research by:
 * 1. Using Claude to generate diverse search queries from criteria
 * 2. Running all Exa searches in parallel
 * 3. Using Claude to extract structured company data
 * 4. Deduplicating by domain
 * 5. Scoring and ranking by relevance
 */

import { HostedMCPServer, type MCPToolSchema, type MCPToolCallResult } from '../mcp/MCPClient';
import { scoutTools, type Company } from './scoutTools';
import { toolsToMCPSchemas, parseToolArgs } from '../utils/zodTools';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';

// Exa MCP endpoint for direct API calls
const EXA_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';

interface ExaSearchResult {
  title: string;
  url: string;
  text?: string;
  highlights?: string[];
  score?: number;
}

interface ExaResponse {
  results: ExaSearchResult[];
}

/**
 * Scout MCP Server - provides company scouting capabilities
 */
export class ScoutMCPServer extends HostedMCPServer {
  readonly name = 'Scout';
  readonly description = 'Find and research companies matching specific criteria';

  private exaApiKey: string;
  private anthropicApiKey: string;

  constructor(exaApiKey: string, anthropicApiKey: string) {
    super();
    this.exaApiKey = exaApiKey;
    this.anthropicApiKey = anthropicApiKey;
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
   * Main company scouting flow
   */
  private async scoutCompanies(args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const parsed = parseToolArgs(scoutTools.scout_companies.input, args);
    const { criteria, maxResults, minRelevanceScore } = parsed;

    logger.mcp.info('Starting company scout', { criteria, maxResults });

    // Step 1: Generate diverse search queries using Claude
    const searchQueries = await this.generateSearchQueries(criteria);
    logger.mcp.info('Generated search queries', { count: searchQueries.length });

    // Step 2: Run all Exa searches in parallel
    const searchResults = await this.runParallelSearches(searchQueries);
    const totalResults = searchResults.flat().length;
    logger.mcp.info('Search complete', { totalResults });

    // Step 3: Extract structured company data using Claude
    const extractedCompanies = await this.extractCompanies(criteria, searchResults);
    logger.mcp.info('Extracted companies', { count: extractedCompanies.length });

    // Step 4: Deduplicate by domain
    const deduped = this.deduplicateByDomain(extractedCompanies);
    logger.mcp.info('After deduplication', { count: deduped.length });

    // Step 5: Filter by relevance score and limit results
    const filtered = deduped
      .filter(c => c.relevanceScore >= minRelevanceScore)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults);

    logger.mcp.info('Scout complete', { finalCount: filtered.length });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            companies: filtered,
            queriesRun: searchQueries.length,
            totalResultsProcessed: totalResults,
            searchQueries,
          }, null, 2),
        },
      ],
      structuredContent: {
        companies: filtered,
        queriesRun: searchQueries.length,
        totalResultsProcessed: totalResults,
        searchQueries,
      },
    };
  }

  /**
   * Use Claude to generate diverse search queries from criteria
   */
  private async generateSearchQueries(criteria: string): Promise<string[]> {
    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Generate 7-10 diverse web search queries to find companies matching this criteria:

"${criteria}"

Think about different angles:
- Industry-specific terms and jargon
- Funding/investment related queries
- News and press release angles
- Competitor/market analysis angles
- Technology/product specific queries
- Geographic variations if relevant

Return ONLY a JSON array of search query strings. No explanation, just the JSON array.
Example: ["query 1", "query 2", "query 3"]`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    try {
      // Extract JSON array from response
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]) as string[];
      }
    } catch {
      logger.mcp.warn('Failed to parse queries, using fallback');
    }

    // Fallback: simple query variations
    return [
      criteria,
      `${criteria} startups`,
      `${criteria} companies funding`,
      `${criteria} market leaders`,
      `${criteria} news 2024`,
    ];
  }

  /**
   * Run all Exa searches in parallel
   */
  private async runParallelSearches(queries: string[]): Promise<ExaSearchResult[][]> {
    const searchPromises = queries.map(query => this.searchExa(query));
    const results = await Promise.allSettled(searchPromises);

    return results
      .filter((r): r is PromiseFulfilledResult<ExaSearchResult[]> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Direct Exa API search (bypasses MCP for efficiency)
   */
  private async searchExa(query: string): Promise<ExaSearchResult[]> {
    const url = new URL(EXA_MCP_ENDPOINT);
    url.searchParams.set('exaApiKey', this.exaApiKey);
    url.searchParams.set('tools', 'web_search_exa');

    // Use JSON-RPC to call Exa MCP
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
          clientInfo: { name: 'scout', version: '1.0.0' },
        },
      }),
    });

    // Get session ID from response
    const sessionId = response.headers.get('Mcp-Session-Id');
    await response.text(); // Consume response

    // Now call the search tool
    const searchResponse = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
        ...(sessionId && { 'Mcp-Session-Id': sessionId }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: { query, numResults: 10 },
        },
      }),
    });

    const searchText = await searchResponse.text();

    // Parse response (could be SSE or JSON)
    try {
      // Try direct JSON first
      const parsed = JSON.parse(searchText);
      if (parsed.result?.content) {
        const textContent = parsed.result.content.find((c: { type: string }) => c.type === 'text');
        if (textContent?.text) {
          const data = JSON.parse(textContent.text) as ExaResponse;
          return data.results || [];
        }
      }
    } catch {
      // Try parsing SSE
      const lines = searchText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          try {
            const parsed = JSON.parse(data);
            if (parsed.result?.content) {
              const textContent = parsed.result.content.find((c: { type: string }) => c.type === 'text');
              if (textContent?.text) {
                const exaData = JSON.parse(textContent.text) as ExaResponse;
                return exaData.results || [];
              }
            }
          } catch {
            continue;
          }
        }
      }
    }

    return [];
  }

  /**
   * Use Claude to extract structured company data from search results
   */
  private async extractCompanies(
    criteria: string,
    searchResults: ExaSearchResult[][]
  ): Promise<Company[]> {
    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    // Flatten and format results for Claude
    const allResults = searchResults.flat();
    const resultsText = allResults
      .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.text?.slice(0, 500) || r.highlights?.join(' ') || ''}`)
      .join('\n\n---\n\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Extract company information from these search results. The original search criteria was:

"${criteria}"

Search results:
${resultsText}

For each distinct company found, extract:
1. name: Company name
2. website: Company website URL (the main domain, not article URLs)
3. domain: Just the domain (e.g., "company.com")
4. reason: Why this company matches the search criteria (1-2 sentences)
5. relevanceScore: How well it matches (0-100)

Rules:
- Only include actual companies, not news sites or directories
- Extract the company's actual website, not the article URL
- If you can't determine the company website, use the most likely domain
- Score based on how well they match: "${criteria}"
- Be strict with relevance scoring - only high matches should get 80+

Return ONLY a JSON array of company objects. No explanation.
Example: [{"name": "Company", "website": "https://company.com", "domain": "company.com", "reason": "...", "relevanceScore": 85, "sources": ["url1"]}]`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const companies = JSON.parse(match[0]) as Company[];
        // Add sources from original results
        return companies.map(c => ({
          ...c,
          sources: c.sources || allResults
            .filter(r => r.url.includes(c.domain) || r.title.toLowerCase().includes(c.name.toLowerCase()))
            .map(r => r.url)
            .slice(0, 3),
        }));
      }
    } catch (e) {
      logger.mcp.warn('Failed to parse companies', { error: e instanceof Error ? e.message : String(e) });
    }

    return [];
  }

  /**
   * Deduplicate companies by domain, keeping highest relevance score
   */
  private deduplicateByDomain(companies: Company[]): Company[] {
    const byDomain = new Map<string, Company>();

    for (const company of companies) {
      // Normalize domain
      const domain = company.domain.toLowerCase().replace(/^www\./, '');
      const existing = byDomain.get(domain);

      if (!existing || company.relevanceScore > existing.relevanceScore) {
        byDomain.set(domain, {
          ...company,
          domain,
          // Merge sources if we're updating
          sources: existing
            ? [...new Set([...existing.sources, ...company.sources])]
            : company.sources,
        });
      }
    }

    return Array.from(byDomain.values());
  }
}
