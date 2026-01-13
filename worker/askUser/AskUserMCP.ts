/**
 * AskUserMCP - Hosted MCP wrapper for asking users questions
 *
 * This MCP provides tools for agents to ask users structured questions.
 * The actual interaction happens through the approval/checkpoint flow.
 * When the agent calls askQuestions, it triggers a request_approval that
 * pauses the workflow and shows the user a UI to answer the questions.
 */

import { HostedMCPServer, type MCPToolSchema, type MCPToolCallResult } from '../mcp/MCPClient';
import { toolsToMCPSchemas, parseToolArgs } from '../utils/zodTools';
import { askUserTools } from './askUserTools';

export class AskUserMCPServer extends HostedMCPServer {
  readonly name = 'AskUser';
  readonly description = 'Ask users questions with structured options for gathering input, preferences, or decisions';

  constructor() {
    super();
  }

  getTools(): MCPToolSchema[] {
    return toolsToMCPSchemas(askUserTools);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    try {
      switch (name) {
        case 'askQuestions':
          return await this.askQuestions(args);
        default:
          return this.errorContent(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return this.errorContent(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Ask questions to the user.
   *
   * This tool is designed to work with the request_approval flow.
   * When called directly (after approval), it receives the user's answers
   * from the approval callback via the args.
   *
   * The workflow is:
   * 1. Agent calls request_approval with tool: "AskUser__askQuestions"
   * 2. User sees the questions UI and provides answers
   * 3. After approval, the workflow calls this tool with the answers in userData
   * 4. This returns the answers to the agent
   */
  private async askQuestions(args: Record<string, unknown>): Promise<MCPToolCallResult> {
    // Validate the input
    const { questions } = parseToolArgs(askUserTools.askQuestions.input, args);

    // If answers are provided (from approval callback), return them
    // The answers come through when the user approves the checkpoint
    if (args.answers) {
      const result = {
        success: true,
        answers: args.answers,
        questionsAsked: questions.length,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }

    // If no answers yet, this means the agent should use request_approval
    // Return a message guiding the agent
    const result = {
      success: false,
      message: 'Questions require user interaction. Use request_approval to show questions to the user.',
      questions: questions,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
}
