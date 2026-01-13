/**
 * ExaMCP - Hosted MCP wrapper for Exa Web Search
 *
 * Proxies to Exa's remote MCP endpoint at https://mcp.exa.ai/mcp
 * Provides web search and code context search capabilities.
 */

import { HostedMCPServer, type MCPToolSchema, type MCPToolCallResult } from '../mcp/MCPClient';
import { logger } from '../utils/logger';

// Exa MCP endpoint
const EXA_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';

// Default tools to enable (web search and code context)
const DEFAULT_TOOLS = ['web_search_exa', 'get_code_context_exa'];

// JSON-RPC types
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Exa MCP Server - provides web search and code context tools
 */
export class ExaMCPServer extends HostedMCPServer {
  readonly name = 'Exa';
  readonly description = 'Web search and code context powered by Exa AI';

  private apiKey: string;
  private requestId = 0;
  private toolCache: MCPToolSchema[] | null = null;
  private sessionId?: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  /**
   * Build the Exa MCP endpoint URL with API key and tools
   */
  private buildEndpoint(): string {
    const url = new URL(EXA_MCP_ENDPOINT);
    url.searchParams.set('exaApiKey', this.apiKey);
    url.searchParams.set('tools', DEFAULT_TOOLS.join(','));
    return url.toString();
  }

  /**
   * Send a JSON-RPC request to the Exa MCP endpoint
   */
  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const response = await fetch(this.buildEndpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    // Capture session ID from response headers
    const newSessionId = response.headers.get('Mcp-Session-Id');
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exa MCP error: ${response.status} ${errorText}`);
    }

    const contentType = response.headers.get('Content-Type') || '';

    if (contentType.includes('text/event-stream')) {
      // Parse SSE response
      return this.parseSSEResponse(response.body!, request.id);
    } else {
      // Direct JSON response
      const jsonResponse = await response.json() as JSONRPCResponse;
      if (jsonResponse.error) {
        throw new Error(`Exa MCP error: ${jsonResponse.error.message}`);
      }
      return jsonResponse.result;
    }
  }

  /**
   * Parse SSE stream to extract JSON-RPC response
   */
  private async parseSSEResponse(
    body: ReadableStream<Uint8Array>,
    requestId: string | number
  ): Promise<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          throw new Error('SSE stream ended before response received');
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              try {
                const response = JSON.parse(data) as JSONRPCResponse;
                if (response.id === requestId) {
                  if (response.error) {
                    throw new Error(`Exa MCP error: ${response.error.message}`);
                  }
                  return response.result;
                }
              } catch (e) {
                if (e instanceof Error && e.message.startsWith('Exa MCP error')) {
                  throw e;
                }
                // Not valid JSON-RPC, continue
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Initialize the connection and fetch available tools
   */
  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'aytza',
        version: '1.0.0',
      },
    });

    // Send initialized notification (fire and forget)
    try {
      await this.sendRequest('notifications/initialized', {});
    } catch {
      // Notifications may not return a response, ignore errors
    }
  }

  /**
   * Fetch tools from the remote Exa MCP server
   */
  private async fetchToolsFromRemote(): Promise<MCPToolSchema[]> {
    await this.initialize();
    const result = await this.sendRequest('tools/list', {}) as { tools: MCPToolSchema[] };
    return result.tools || [];
  }

  /**
   * Get all tools provided by this MCP server.
   * Returns cached tools if available, otherwise returns static definitions.
   */
  getTools(): MCPToolSchema[] {
    // Return cached tools if available
    if (this.toolCache) {
      return this.toolCache;
    }

    // Return static tool definitions (these will be updated when callTool is first invoked)
    return [
      {
        name: 'web_search_exa',
        description: 'Search the web using Exa AI. Returns relevant web pages with content.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query',
            },
            numResults: {
              type: 'number',
              description: 'Number of results to return (default: 10)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_code_context_exa',
        description: 'Search for code examples, documentation, and programming context from GitHub repos, docs pages, and StackOverflow.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The code/programming query',
            },
            numResults: {
              type: 'number',
              description: 'Number of results to return (default: 10)',
            },
          },
          required: ['query'],
        },
      },
    ];
  }

  /**
   * Call a tool with the given arguments
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    try {
      // Ensure we're initialized
      if (!this.toolCache) {
        try {
          this.toolCache = await this.fetchToolsFromRemote();
        } catch (e) {
          logger.mcp.warn('Failed to fetch tools from Exa, using static definitions', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Call the tool on the remote server
      const result = await this.sendRequest('tools/call', {
        name,
        arguments: args,
      });

      return result as MCPToolCallResult;
    } catch (error) {
      logger.mcp.error('Exa tool call failed', {
        tool: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.errorContent(
        `Exa search failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
