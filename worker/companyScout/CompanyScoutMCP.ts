/**
 * CompanyScoutMCP - MCP Server for Company Scout functionality
 *
 * Provides tools for:
 * - Reporting discovered companies with structured data
 * - Updating scouting progress/status
 * - Creating Google Sheets exports
 *
 * This MCP works alongside Exa (for web search) to provide
 * a complete company research experience.
 */

import { HostedMCPServer, type MCPToolSchema, type MCPToolCallResult } from '../mcp/MCPClient';
import { companyScoutTools } from './companyScoutTools';
import { logger } from '../utils/logger';

// Env bindings for Google Sheets access
interface CompanyScoutEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

// Credentials for the MCP
interface CompanyScoutCredentials {
  accessToken?: string; // Google OAuth token for Sheets
}

/**
 * Company Scout MCP Server
 */
export class CompanyScoutMCPServer extends HostedMCPServer {
  readonly name = 'CompanyScout';
  readonly description = 'Tools for company research, verification, and scoring';

  private credentials: CompanyScoutCredentials;

  // Store reported companies for the session
  private reportedCompanies: Array<{
    name: string;
    website: string;
    reasoning: string;
    fitScore: number;
    reportedAt: string;
  }> = [];

  constructor(credentials: CompanyScoutCredentials, _env?: CompanyScoutEnv) {
    super();
    this.credentials = credentials;
  }

  /**
   * Get all tools provided by this MCP server
   * Note: Company Scout primarily uses existing MCPs (Exa, Google Sheets)
   * with a specialized system prompt. These tools are for future expansion.
   */
  getTools(): MCPToolSchema[] {
    // Return simplified tool schemas
    return Object.entries(companyScoutTools).map(([name, def]) => ({
      name,
      description: def.description,
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    }));
  }

  /**
   * Call a tool with the given arguments
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    try {
      switch (name) {
        case 'reportCompany':
          return this.handleReportCompany(args);

        case 'updateScoutStatus':
          return this.handleUpdateScoutStatus(args);

        case 'createCompanySheet':
          return this.handleCreateCompanySheet(args);

        default:
          return this.errorContent(`Unknown tool: ${name}`);
      }
    } catch (error) {
      logger.mcp.error('CompanyScout tool call failed', {
        tool: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.errorContent(
        `Tool call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle reportCompany tool
   */
  private handleReportCompany(args: Record<string, unknown>): MCPToolCallResult {
    const companies = args.companies as Array<{
      name: string;
      website: string;
      reasoning: string;
      fitScore: number;
    }>;

    if (!Array.isArray(companies)) {
      return this.errorContent('companies must be an array');
    }

    const now = new Date().toISOString();

    for (const company of companies) {
      this.reportedCompanies.push({
        ...company,
        reportedAt: now,
      });
    }

    // Return structured content that the workflow can parse
    return {
      content: [
        {
          type: 'text',
          text: `Reported ${companies.length} company(ies)`,
        },
      ],
      structuredContent: {
        type: 'company_report',
        companies: companies.map((c) => ({
          name: c.name,
          website: c.website,
          reasoning: c.reasoning,
          fitScore: c.fitScore,
        })),
      },
    };
  }

  /**
   * Handle updateScoutStatus tool
   */
  private handleUpdateScoutStatus(args: Record<string, unknown>): MCPToolCallResult {
    const phase = args.phase as string;
    const message = args.message as string | undefined;
    const progress = args.progress as { found: number; verified: number; scored: number } | undefined;

    logger.mcp.info('Scout status update', { phase, message, progress });

    return {
      content: [
        {
          type: 'text',
          text: `Status updated: ${phase}${message ? ` - ${message}` : ''}`,
        },
      ],
      structuredContent: {
        type: 'status_update',
        phase,
        message,
        progress,
      },
    };
  }

  /**
   * Handle createCompanySheet tool
   * Creates a Google Sheet with company results
   */
  private async handleCreateCompanySheet(args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const title = args.title as string;
    const companies = args.companies as Array<{
      name: string;
      website: string;
      reasoning: string;
      fitScore: number;
    }>;

    if (!this.credentials.accessToken) {
      return this.errorContent('Google account not connected. Please connect Google to export.');
    }

    try {
      // Create spreadsheet
      const createResponse = await fetch(
        'https://sheets.googleapis.com/v4/spreadsheets',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              title,
            },
            sheets: [
              {
                properties: {
                  title: 'Companies',
                },
              },
            ],
          }),
        }
      );

      if (!createResponse.ok) {
        throw new Error(`Failed to create sheet: ${await createResponse.text()}`);
      }

      const spreadsheet = (await createResponse.json()) as {
        spreadsheetId: string;
        spreadsheetUrl: string;
      };
      const spreadsheetId = spreadsheet.spreadsheetId;

      // Prepare data rows
      const headers = ['Company Name', 'Website', 'Reasoning', 'Fit Score', 'Status'];
      const rows = [
        headers,
        ...companies.map((c) => [
          c.name,
          c.website,
          c.reasoning,
          c.fitScore.toString(),
          c.fitScore >= 5 ? 'Included' : 'Excluded',
        ]),
      ];

      // Add data to sheet
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Companies!A1:E${rows.length}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: rows,
          }),
        }
      );

      // Format header row (bold)
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: {
                        bold: true,
                      },
                    },
                  },
                  fields: 'userEnteredFormat.textFormat.bold',
                },
              },
              {
                autoResizeDimensions: {
                  dimensions: {
                    sheetId: 0,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: 5,
                  },
                },
              },
            ],
          }),
        }
      );

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      return {
        content: [
          {
            type: 'text',
            text: `Created Google Sheet with ${companies.length} companies: ${sheetUrl}`,
          },
        ],
        structuredContent: {
          type: 'google_sheet',
          url: sheetUrl,
          title,
        },
      };
    } catch (error) {
      return this.errorContent(
        `Failed to create sheet: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Factory function for creating CompanyScout MCP server
 */
export function createCompanyScoutMCP(
  credentials: CompanyScoutCredentials,
  env: CompanyScoutEnv
): CompanyScoutMCPServer {
  return new CompanyScoutMCPServer(credentials, env);
}
