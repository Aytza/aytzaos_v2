/**
 * AccountMCPRegistry - Pluggable registry for accounts with multiple MCPs
 *
 * Defines accounts (Google, future: Microsoft, etc.) and their associated MCPs.
 * Makes adding new account integrations straightforward.
 *
 * Used by:
 * - Board settings UI (which MCPs to enable)
 * - AgentWorkflow (tool execution and credential management)
 */

import { HostedMCPServer, type MCPToolSchema } from './MCPClient';
import { GmailMCPServer } from '../google/GmailMCP';
import { DocsMCPServer } from '../google/DocsMCP';
import { SheetsMCPServer } from '../google/SheetsMCP';
import { SandboxMCPServer } from '../sandbox/SandboxMCP';
import { GitHubMCPServer } from '../github/GitHubMCP';
import { ExaMCPServer } from '../exa/ExaMCP';
import { ScoutMCPServer } from '../scout/ScoutMCP';
import { AskUserMCPServer } from '../askUser/AskUserMCP';
import { refreshAccessToken } from '../google/oauth';
import { CREDENTIAL_TYPES } from '../constants';
import type { Sandbox } from '@cloudflare/sandbox';

// ============================================================================
// Types
// ============================================================================

/** How authentication is handled for this account */
export type CredentialAuthType = 'oauth' | 'api_key' | 'env_binding' | 'none';

/** Artifact types that can be created by MCP tools */
export type ArtifactType = 'google_doc' | 'google_sheet' | 'gmail_message' | 'github_pr' | 'file' | 'other';

/** URL pattern types for link enrichment */
export type UrlPatternType = 'google_doc' | 'google_sheet' | 'github_pr' | 'github_issue' | 'github_repo';

/** URL pattern definition for link pills */
export interface MCPUrlPattern {
  /** Regex pattern to match URLs */
  pattern: string;
  /** Type of resource this pattern matches */
  type: UrlPatternType;
  /** Tool name to call for fetching metadata */
  fetchTool: string;
}

/** Environment bindings that may be needed by MCP factories */
export interface MCPEnvBindings {
  Sandbox?: DurableObjectNamespace<Sandbox>;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  [key: string]: unknown;
}

/** Progress event emitted by MCP tools during execution */
export interface MCPProgress {
  /** Tool emitting the progress */
  toolName: string;
  /** Current stage of execution */
  stage: string;
  /** Human-readable progress message */
  message: string;
  /** Numeric progress for progress bars */
  progress?: { current: number; total: number };
  /** Additional stage-specific data */
  data?: Record<string, unknown>;
}

/** Credentials passed to factories and refresh functions */
export interface MCPCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  apiKey?: string;
  /** Optional progress callback for MCP tools that support streaming progress */
  onProgress?: (progress: MCPProgress) => void;
  [key: string]: unknown;
}

/**
 * Definition for an individual MCP within an account
 */
export interface MCPDefinition {
  /** Unique identifier for the MCP (e.g., 'gmail', 'google-docs') */
  id: string;
  /** Display name (e.g., 'Gmail', 'Google Docs') */
  name: string;
  /** Server name used in tool names (e.g., 'Gmail', 'Google_Docs' for 'Gmail__sendMessage') */
  serverName: string;
  /** Short description of what this MCP does */
  description: string;
  /** Factory function to create the MCP server instance */
  factory: (credentials: MCPCredentials, env?: MCPEnvBindings) => HostedMCPServer;
  /** Type of artifact this MCP produces (for UI display) */
  artifactType?: ArtifactType;
  /**
   * How artifact content is stored:
   * - 'url': External link (default) - artifact has url field
   * - 'inline': Content stored in artifact - artifact has content field
   */
  artifactContentType?: 'url' | 'inline';
  /** URL patterns this MCP can enrich for link pills */
  urlPatterns?: MCPUrlPattern[];
  /**
   * Workflow guidance for the agent system prompt.
   * Explains how to use this MCP's tools effectively.
   * This is injected into the agent's system prompt when the MCP is enabled.
   */
  workflowGuidance?: string;
}

/**
 * Definition for an account that has multiple MCPs
 */
export interface AccountDefinition {
  /** Unique identifier for the account (e.g., 'google', 'microsoft') */
  id: string;
  /** Display name (e.g., 'Google', 'Microsoft') */
  name: string;
  /** The credential type used for this account (e.g., 'google_oauth') */
  credentialType: string;
  /** How authentication is handled */
  authType: CredentialAuthType;
  /** Icon identifier for the account */
  icon?: string;
  /** MCPs available for this account */
  mcps: MCPDefinition[];
  /**
   * Token refresh function for OAuth accounts.
   * Returns new access token and optional expiry.
   */
  refreshToken?: (
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ) => Promise<{ access_token: string; expires_in?: number }>;
  /**
   * If true, this account's MCPs are always available (injected automatically).
   * Used for system MCPs like Sandbox that don't require user configuration.
   */
  alwaysEnabled?: boolean;
  /**
   * Environment binding keys required by this account's MCPs.
   * These are passed from the workflow env to the MCP factory.
   * Example: ['SANDBOX'] for Sandbox MCP, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] for Google
   */
  envBindingKeys?: string[];
  /**
   * Additional credential keys to pass to MCP factories beyond the main accessToken.
   * Example: ['githubToken', 'anthropicApiKey'] for Sandbox MCP
   */
  additionalCredentialKeys?: string[];
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Registry of all accounts with multiple MCPs
 *
 * To add a new account:
 * 1. Create MCP server classes extending HostedMCPServer
 * 2. Add a new AccountDefinition to this array
 * 3. Implement OAuth flow in worker/index.ts (if needed)
 */
// ============================================================================
// Workflow Guidance Templates
// These are injected into the agent's system prompt when the MCP is enabled.
// ============================================================================

const GMAIL_GUIDANCE = `## Gmail Workflow
Always request approval before sending emails.

**Sending an email:**
\`\`\`
request_approval({
  tool: "Gmail__sendEmail",
  action: "Send Email",
  data: {
    to: "recipient@example.com",
    subject: "Email Subject",
    body: "Email body content..."
  }
})
\`\`\`
After approval, call: \`Gmail__sendEmail({ to: "...", subject: "...", body: "..." })\``;

const GOOGLE_DOCS_GUIDANCE = `## Google Docs Workflow

**Creating a new document:**
\`\`\`
request_approval({
  tool: "Google_Docs__createDocument",
  action: "Create Document",
  data: {
    title: "Document Title",
    content: "The full document content to create..."
  }
})
\`\`\`
After approval, call: \`Google_Docs__createDocument({ title: "...", content: "..." })\`

**Modifying existing documents (append or replace):**
1. **Get current content first**:
   \`\`\`
   Google_Docs__getDocument({ documentId: "..." })
   \`\`\`
2. **Request approval with both old and new content**:
   \`\`\`
   request_approval({
     tool: "Google_Docs__replaceDocumentContent",  // or appendToDocument
     action: "Replace Document Content",
     data: {
       documentId: "...",
       title: "Document Title",
       currentContent: "<content from getDocument>",
       newContent: "<the new content to write>",
       action: "replace"  // or "append"
     }
   })
   \`\`\`
3. **After approval**, call the actual tool:
   \`\`\`
   Google_Docs__replaceDocumentContent({ documentId: "...", content: "..." })
   \`\`\``;

const GOOGLE_SHEETS_GUIDANCE = `## Google Sheets Workflow
For creating or modifying spreadsheets, ALWAYS request approval first.

**Creating a new spreadsheet:**
\`\`\`
request_approval({
  tool: "Google_Sheets__createSpreadsheet",
  action: "Create Spreadsheet",
  data: {
    title: "Spreadsheet Title",
    rows: [
      ["Column 1", "Column 2", "Column 3"],  // Header row
      ["Value 1", "Value 2", "Value 3"],     // Data rows
    ]
  }
})
\`\`\`

**Modifying an existing spreadsheet (append/update/replace):**
1. First search/get the spreadsheet to get its title
2. Get current data: \`Google_Sheets__getSheetData({ spreadsheetId: "...", range: "Sheet1" })\`
3. Request approval - CRITICAL: You MUST include both currentRows AND title:
\`\`\`
request_approval({
  tool: "Google_Sheets__appendRows",  // or updateCells, replaceSheetContent
  action: "Append Rows to Spreadsheet",
  data: {
    spreadsheetId: "...",
    title: "ACTUAL spreadsheet title from search",  // REQUIRED - use real title!
    currentRows: [[...], [...], ...],  // REQUIRED - copy the rows array from getSheetData result
    newRows: [[...], [...], ...]       // the new rows to add
  }
})
\`\`\`

IMPORTANT for approval to show diff correctly:
- \`title\` must be the actual spreadsheet title (not "Spreadsheet Title")
- \`currentRows\` must contain the actual current data from getSheetData (the \`rows\` array)
- \`newRows\` contains only the NEW rows being added

After approval, call the actual tool with the approved data.`;

const SANDBOX_GUIDANCE = `## Code Change Workflow (Sandbox + GitHub)
For ANY task requiring code changes, you MUST use Sandbox. Here's the exact flow:

1. **Clone the repository**:
   \`\`\`
   Sandbox__createSession({ repoUrl: "https://github.com/owner/repo.git", branch: "main" })
   \`\`\`
   This returns a sessionId you'll use for all subsequent calls.

2. **Create a feature branch** (REQUIRED - never commit directly to main):
   \`\`\`
   Sandbox__exec({ sessionId: "...", command: "git checkout -b feature/descriptive-branch-name" })
   \`\`\`
   Use a descriptive branch name like "feature/improve-readme" or "fix/typo-in-docs".

3. **Make changes** - Use runClaude to let Claude Code make the edits:
   \`\`\`
   Sandbox__runClaude({ sessionId: "...", task: "description of what to change" })
   \`\`\`

4. **Get the diff** - REQUIRED before approval:
   \`\`\`
   Sandbox__getDiff({ sessionId: "..." })
   \`\`\`
   This returns a JSON object with \`structuredContent.diff\` (the unified diff string) and \`structuredContent.stats\` (files, additions, deletions counts).

5. **Request PR approval** - Include the diff from step 4:
   \`\`\`
   request_approval({
     tool: "GitHub__create_pr",
     action: "Create Pull Request",
     data: {
       owner, repo, baseBranch: "main", headBranch: "feature/your-branch-name",
       title, body,
       diff: structuredContent.diff,  // REQUIRED: extract from getDiff result
       stats: structuredContent.stats  // REQUIRED: extract from getDiff result
     }
   })
   \`\`\`
   IMPORTANT: You MUST extract the diff and stats from the getDiff result's structuredContent field.

6. **After user approval** - Commit, push, AND create PR (ALL THREE REQUIRED):
   \`\`\`
   Sandbox__commit({ sessionId, message: "..." })
   Sandbox__push({ sessionId, branch: "feature/your-branch-name" })
   GitHub__create_pr({ owner, repo, title, head: "feature/your-branch-name", base: "main", body })
   \`\`\`
   **CRITICAL: You MUST call GitHub__create_pr after pushing. The task is NOT complete until the PR is created.**

IMPORTANT RULES:
- createSession requires repoUrl parameter to clone the repo
- ALWAYS create a feature branch before making changes (step 2)
- Do NOT call request_approval without first calling getDiff
- When calling request_approval, parse the getDiff JSON result and extract:
  - \`structuredContent.diff\` → put in the \`diff\` field
  - \`structuredContent.stats\` → put in the \`stats\` field
- The "diff" and "stats" fields in approval data are REQUIRED
- Use the SAME branch name in: checkout, push, and create_pr
- After approval, you MUST: commit → push → create_pr (in that order, all three)`;

const GITHUB_GUIDANCE = `## GitHub Workflow
Use GitHub tools to read repository information, issues, and pull requests.
For creating PRs with code changes, use Sandbox to make the changes first.

**Reading repository info:**
\`\`\`
GitHub__get_repository({ owner: "...", repo: "..." })
GitHub__list_issues({ owner: "...", repo: "...", state: "open" })
GitHub__get_pull_request({ owner: "...", repo: "...", pull_number: 123 })
\`\`\``;

const EXA_GUIDANCE = `## Exa Web Search
Use Exa tools to search the web and find code examples.

**Web search:**
\`\`\`
Exa__web_search_exa({ query: "your search query", numResults: 10 })
\`\`\`

**Code context search (for programming questions):**
\`\`\`
Exa__get_code_context_exa({ query: "how to use React hooks with TypeScript" })
\`\`\`

Use code context search for:
- Finding code examples and documentation
- Looking up API usage patterns
- Getting implementation examples from real codebases`;

const ASK_USER_GUIDANCE = `## Asking Users Questions
**IMPORTANT: Always start tasks by asking clarifying questions.** Before doing any work, use AskUser to confirm what the user wants - output format, specific requirements, preferences, and scope.

**CRITICAL: AskUser ONLY works via request_approval**
Do NOT call AskUser__askQuestions directly - it will not work. You MUST use request_approval:
\`\`\`
request_approval({
  tool: "AskUser__askQuestions",
  action: "User Input Required",
  data: {
    questions: [
      {
        question: "What format would you prefer for the output?",
        header: "Format",
        options: [
          { label: "JSON", description: "Structured JSON format" },
          { label: "Markdown", description: "Human-readable markdown" },
          { label: "Plain Text", description: "Simple text output" }
        ],
        multiSelect: false,
        allowOther: true
      }
    ]
  }
})
\`\`\`

After the user responds, you'll receive their answers in the approval result. Use the selected options to proceed with the task.

**Question format:**
- Keep questions clear and concise
- Provide 2-4 meaningful options per question
- Use multiSelect: true when multiple choices make sense
- allowOther: true (default) lets users provide custom responses
- Maximum 4 questions per request`;

const SCOUT_GUIDANCE = `## Company Scouting
**For ANY task involving finding, researching, or listing companies:**

1. **First: Ask clarifying questions** using AskUser to understand:
   - What specific criteria matter (funding stage, geography, business model, etc.)
   - How many results they want
   - What output format they prefer (list, spreadsheet, etc.)
   - Any exclusions or filters

2. **Then: Use Scout__scout_companies** with the refined criteria

This includes queries like:
- "Find me [type] companies"
- "List companies in [industry]"
- "Research companies that [criteria]"
- "Who are the players in [market]"

Scout automatically:
1. Generates 7-10 diverse search queries from your criteria
2. Runs all searches in parallel (much faster than manual searches)
3. Extracts structured company data (name, website, reason)
4. Deduplicates by domain
5. Scores and ranks by relevance

**Usage (after clarifying questions):**
\`\`\`
Scout__scout_companies({
  criteria: "DTC GLP-1 companies that have raised more than $10M, US-based",
  maxResults: 20,
  minRelevanceScore: 70
})
\`\`\`

Tips:
- Incorporate user's answers into the criteria string
- Use minRelevanceScore 70+ for stricter filtering
- Results include: company name, website, domain, reason, relevance score
- Do NOT use Exa__web_search_exa for company research - Scout is 10x more efficient`;

// ============================================================================
// Registry
// ============================================================================

export const ACCOUNT_REGISTRY: AccountDefinition[] = [
  {
    id: 'google',
    name: 'Google',
    credentialType: CREDENTIAL_TYPES.GOOGLE_OAUTH,
    authType: 'oauth',
    icon: 'google',
    refreshToken: refreshAccessToken,
    envBindingKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    mcps: [
      {
        id: 'gmail',
        name: 'Gmail',
        serverName: 'Gmail',
        description: 'Read, send, and search emails',
        factory: (creds) => new GmailMCPServer(creds.accessToken || ''),
        artifactType: 'gmail_message',
        artifactContentType: 'inline',
        workflowGuidance: GMAIL_GUIDANCE,
      },
      {
        id: 'google-docs',
        name: 'Google Docs',
        serverName: 'Google_Docs',
        description: 'Create and edit documents',
        factory: (creds) => new DocsMCPServer(creds.accessToken || ''),
        artifactType: 'google_doc',
        urlPatterns: [{
          pattern: 'docs\\.google\\.com/document/d/([a-zA-Z0-9_-]+)',
          type: 'google_doc',
          fetchTool: 'getDocument',
        }],
        workflowGuidance: GOOGLE_DOCS_GUIDANCE,
      },
      {
        id: 'google-sheets',
        name: 'Google Sheets',
        serverName: 'Google_Sheets',
        description: 'Create and edit spreadsheets',
        factory: (creds) => new SheetsMCPServer(creds.accessToken || ''),
        artifactType: 'google_sheet',
        urlPatterns: [{
          pattern: 'docs\\.google\\.com/spreadsheets/d/([a-zA-Z0-9_-]+)',
          type: 'google_sheet',
          fetchTool: 'getSpreadsheet',
        }],
        workflowGuidance: GOOGLE_SHEETS_GUIDANCE,
      },
    ],
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    credentialType: 'none',
    authType: 'env_binding',
    alwaysEnabled: true,
    envBindingKeys: ['SANDBOX'],
    additionalCredentialKeys: ['githubToken', 'anthropicApiKey'],
    mcps: [
      {
        id: 'sandbox',
        name: 'Sandbox',
        serverName: 'Sandbox',
        description: 'Execute code in isolated environment',
        factory: (creds, env) => new SandboxMCPServer(
          env?.SANDBOX as DurableObjectNamespace<Sandbox>,
          {
            githubToken: creds.githubToken as string | undefined,
            anthropicApiKey: creds.anthropicApiKey as string | undefined,
          }
        ),
        workflowGuidance: SANDBOX_GUIDANCE,
      },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    credentialType: CREDENTIAL_TYPES.GITHUB_OAUTH,
    authType: 'oauth',
    icon: 'github',
    // GitHub tokens don't expire, so no refreshToken needed
    mcps: [
      {
        id: 'github',
        name: 'GitHub',
        serverName: 'GitHub',
        description: 'Manage repositories, issues, and pull requests',
        factory: (creds) => new GitHubMCPServer(creds.accessToken || ''),
        artifactType: 'github_pr',
        urlPatterns: [
          {
            pattern: 'github\\.com/([^/]+)/([^/]+)/pull/(\\d+)',
            type: 'github_pr',
            fetchTool: 'get_pull_request',
          },
          {
            pattern: 'github\\.com/([^/]+)/([^/]+)/issues/(\\d+)',
            type: 'github_issue',
            fetchTool: 'get_issue',
          },
          {
            // Match repo URLs but exclude PR/issue/blob/tree paths
            pattern: 'github\\.com/([^/]+)/([^/]+)/?$',
            type: 'github_repo',
            fetchTool: 'get_repository',
          },
        ],
        workflowGuidance: GITHUB_GUIDANCE,
      },
    ],
  },
  {
    id: 'exa',
    name: 'Exa',
    credentialType: 'none',
    authType: 'env_binding',
    alwaysEnabled: true,
    envBindingKeys: ['EXA_API_KEY'],
    mcps: [
      {
        id: 'exa',
        name: 'Exa Search',
        serverName: 'Exa',
        description: 'Web search and code context powered by Exa AI',
        factory: (_creds, env) => new ExaMCPServer(env?.EXA_API_KEY as string || ''),
        workflowGuidance: EXA_GUIDANCE,
      },
    ],
  },
  {
    id: 'scout',
    name: 'Scout',
    credentialType: 'none',
    authType: 'env_binding',
    alwaysEnabled: true,
    envBindingKeys: ['EXA_API_KEY'],
    additionalCredentialKeys: ['anthropicApiKey'],
    mcps: [
      {
        id: 'scout',
        name: 'Scout',
        serverName: 'Scout',
        description: 'Find and research companies matching specific criteria',
        factory: (creds, env) => new ScoutMCPServer(
          env?.EXA_API_KEY as string || '',
          creds.anthropicApiKey as string || '',
          creds.onProgress
        ),
        workflowGuidance: SCOUT_GUIDANCE,
      },
    ],
  },
  {
    id: 'askuser',
    name: 'AskUser',
    credentialType: 'none',
    authType: 'none',
    alwaysEnabled: true,
    mcps: [
      {
        id: 'askuser',
        name: 'AskUser',
        serverName: 'AskUser',
        description: 'Ask users questions with structured options',
        factory: () => new AskUserMCPServer(),
        workflowGuidance: ASK_USER_GUIDANCE,
      },
    ],
  },
];

/**
 * Get an account definition by its ID
 */
export function getAccountById(id: string): AccountDefinition | undefined {
  return ACCOUNT_REGISTRY.find((a) => a.id === id);
}

/**
 * Get an account definition by its credential type
 */
export function getAccountByCredentialType(credentialType: string): AccountDefinition | undefined {
  return ACCOUNT_REGISTRY.find((a) => a.credentialType === credentialType);
}

/**
 * Get all MCPs for an account by account ID
 */
export function getMCPsForAccount(accountId: string): MCPDefinition[] {
  return getAccountById(accountId)?.mcps ?? [];
}

/**
 * Get a specific MCP definition by account ID and MCP ID
 */
export function getMCPDefinition(accountId: string, mcpId: string): MCPDefinition | undefined {
  const account = getAccountById(accountId);
  return account?.mcps.find((m) => m.id === mcpId);
}

/**
 * Find which account an MCP belongs to by MCP name
 */
export function getAccountForMCPName(mcpName: string): AccountDefinition | undefined {
  return ACCOUNT_REGISTRY.find((account) =>
    account.mcps.some((mcp) => mcp.name === mcpName)
  );
}

/**
 * Get an MCP definition by its display name
 */
export function getMCPByName(mcpName: string): MCPDefinition | undefined {
  for (const account of ACCOUNT_REGISTRY) {
    const mcp = account.mcps.find((m) => m.name === mcpName);
    if (mcp) return mcp;
  }
  return undefined;
}

/**
 * Get MCP and its parent account by server name (e.g., 'Gmail', 'Google_Docs')
 * Used by AgentWorkflow to look up MCPs when executing tools
 */
export function getMCPByServerName(serverName: string): {
  account: AccountDefinition;
  mcp: MCPDefinition;
} | undefined {
  for (const account of ACCOUNT_REGISTRY) {
    const mcp = account.mcps.find((m) => m.serverName === serverName);
    if (mcp) {
      return { account, mcp };
    }
  }
  return undefined;
}

/**
 * Get credential requirements for a list of server names
 * Returns unique credential types needed (excluding 'none')
 */
export function getCredentialRequirements(serverNames: string[]): Array<{
  credentialType: string;
  authType: CredentialAuthType;
  accountId: string;
}> {
  const seen = new Set<string>();
  const requirements: Array<{
    credentialType: string;
    authType: CredentialAuthType;
    accountId: string;
  }> = [];

  for (const serverName of serverNames) {
    const lookup = getMCPByServerName(serverName);
    if (lookup && lookup.account.credentialType !== 'none' && !seen.has(lookup.account.credentialType)) {
      seen.add(lookup.account.credentialType);
      requirements.push({
        credentialType: lookup.account.credentialType,
        authType: lookup.account.authType,
        accountId: lookup.account.id,
      });
    }
  }

  return requirements;
}

/**
 * Get all account IDs
 */
export function getAllAccountIds(): string[] {
  return ACCOUNT_REGISTRY.map((a) => a.id);
}

/**
 * Check if a credential type belongs to a registered account
 */
export function isAccountCredentialType(credentialType: string): boolean {
  return ACCOUNT_REGISTRY.some((a) => a.credentialType === credentialType);
}

/**
 * Get tools for an MCP by creating a temporary instance
 * Useful for caching tools without needing a real token
 */
export function getMCPTools(accountId: string, mcpId: string): MCPToolSchema[] {
  const mcp = getMCPDefinition(accountId, mcpId);
  if (!mcp) return [];
  // Create instance with empty credentials just to get tool schemas
  const instance = mcp.factory({});
  return instance.getTools();
}

/**
 * Get all accounts that are always enabled (system MCPs like Sandbox)
 */
export function getAlwaysEnabledAccounts(): AccountDefinition[] {
  return ACCOUNT_REGISTRY.filter((a) => a.alwaysEnabled);
}

/**
 * Get all accounts that require OAuth credentials
 */
export function getOAuthAccounts(): AccountDefinition[] {
  return ACCOUNT_REGISTRY.filter((a) => a.authType === 'oauth');
}

/**
 * Get workflow guidance for a list of enabled MCP server names
 * Returns concatenated guidance sections for the agent system prompt
 */
export function getWorkflowGuidance(serverNames: string[]): string {
  const guidanceSections: string[] = [];
  const seen = new Set<string>();

  for (const serverName of serverNames) {
    const lookup = getMCPByServerName(serverName);
    if (lookup?.mcp.workflowGuidance && !seen.has(lookup.mcp.id)) {
      seen.add(lookup.mcp.id);
      guidanceSections.push(lookup.mcp.workflowGuidance);
    }
  }

  return guidanceSections.join('\n\n');
}

/**
 * Get all required env binding keys for enabled accounts
 * Used to build the env bindings object for MCP factories
 */
export function getRequiredEnvBindingKeys(serverNames: string[]): string[] {
  const keys = new Set<string>();

  for (const serverName of serverNames) {
    const lookup = getMCPByServerName(serverName);
    if (lookup?.account.envBindingKeys) {
      for (const key of lookup.account.envBindingKeys) {
        keys.add(key);
      }
    }
  }

  return Array.from(keys);
}

/**
 * Get additional credential keys needed for enabled accounts
 * Used to pass extra credentials (like githubToken) to MCP factories
 */
export function getAdditionalCredentialKeys(serverNames: string[]): string[] {
  const keys = new Set<string>();

  for (const serverName of serverNames) {
    const lookup = getMCPByServerName(serverName);
    if (lookup?.account.additionalCredentialKeys) {
      for (const key of lookup.account.additionalCredentialKeys) {
        keys.add(key);
      }
    }
  }

  return Array.from(keys);
}

/**
 * Get credential type for a URL pattern type.
 * Finds which account's MCP has this pattern and returns that account's credentialType.
 */
export function getCredentialTypeForUrlPattern(patternType: UrlPatternType): string | undefined {
  for (const account of ACCOUNT_REGISTRY) {
    for (const mcp of account.mcps) {
      if (mcp.urlPatterns?.some(p => p.type === patternType)) {
        return account.credentialType;
      }
    }
  }
  return undefined;
}
