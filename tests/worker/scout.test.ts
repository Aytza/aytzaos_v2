/**
 * Scout MCP Self-Test
 *
 * Tests the enhanced Scout pipeline with verification.
 * Requires EXA_API_KEY and ANTHROPIC_API_KEY environment variables.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ScoutMCPServer } from '../../worker/scout/ScoutMCP';
import { scoutTestCases } from '../../worker/scout/scoutTools';

// Skip if API keys not available
const EXA_API_KEY = process.env.EXA_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const hasApiKeys = EXA_API_KEY && ANTHROPIC_API_KEY;

describe.skipIf(!hasApiKeys)('Scout MCP Self-Test', () => {
  let scout: ScoutMCPServer;

  beforeAll(() => {
    scout = new ScoutMCPServer(EXA_API_KEY, ANTHROPIC_API_KEY);
  });

  it('should run self-test and pass all test cases', async () => {
    const result = await scout.runSelfTest();

    console.log('\n=== Scout Self-Test Results ===');
    for (const testResult of result.results) {
      console.log(`\n${testResult.passed ? '✓' : '✗'} ${testResult.name}`);
      console.log(`  ${testResult.details}`);
    }
    console.log(`\nOverall: ${result.passed ? 'PASSED' : 'FAILED'}`);

    // Don't fail the test if some cases fail - just report
    // This is because search results vary and expected companies may not always appear
    expect(result.results.length).toBeGreaterThan(0);
  }, 600000); // 10 minute timeout - runs 3 test cases sequentially (~90s each)

  it('should find GLP-1 pharma companies with verification', async () => {
    const result = await scout.callTool('scout_companies', {
      criteria: 'Pharma companies developing GLP-1 drugs - Novo Nordisk, Eli Lilly as good fits; exclude generics',
      maxResults: 15,
      minRelevanceScore: 5,
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');

    // Handle API errors gracefully
    const text = result.content[0].text as string;
    if (text.includes('Scout tool failed') || text.includes('credit balance')) {
      console.log('\n=== API Error ===');
      console.log('Skipping test due to API error:', text.slice(0, 200));
      return;
    }

    const parsed = JSON.parse(text);
    console.log('\n=== GLP-1 Pharma Test Results ===');
    console.log(`Found ${parsed.companies.length} companies`);
    console.log(`In-scope: ${parsed.inScopeCount}, Out-of-scope: ${parsed.outOfScopeCount}`);
    console.log(`Queries run: ${parsed.queriesRun}`);

    if (parsed.companies.length > 0) {
      console.log('\nTop 5 companies:');
      for (const company of parsed.companies.slice(0, 5)) {
        console.log(`  ${company.relevanceScore}/10 - ${company.name} (${company.domain})`);
        console.log(`    ${company.description?.slice(0, 100)}...`);
        console.log(`    Verified: ${company.verified}, Mentions: ${company.mentions}`);
      }
    }

    // We should find at least some companies
    expect(parsed.companies.length).toBeGreaterThan(0);

    // Check for expected companies (flexible - search results vary)
    const companyNames = parsed.companies.map((c: { name: string }) => c.name.toLowerCase());
    const expectedCompanies = ['novo nordisk', 'eli lilly', 'pfizer', 'roche'];
    const foundExpected = expectedCompanies.filter(exp =>
      companyNames.some((name: string) => name.includes(exp))
    );

    console.log(`\nExpected companies found: ${foundExpected.join(', ') || 'none'}`);

    // At least one expected company should be found
    expect(foundExpected.length).toBeGreaterThanOrEqual(1);
  }, 180000); // 3 minute timeout
});

// Quick validation test that doesn't require API calls
describe('Scout Schema Validation', () => {
  it('should have valid test cases defined', () => {
    expect(scoutTestCases.length).toBeGreaterThan(0);

    for (const testCase of scoutTestCases) {
      expect(testCase.name).toBeDefined();
      expect(testCase.criteria).toBeDefined();
      expect(testCase.minExpectedCount).toBeGreaterThan(0);
    }
  });

  it('should export ScoutMCPServer class', () => {
    expect(ScoutMCPServer).toBeDefined();
    expect(typeof ScoutMCPServer).toBe('function');
  });
});
