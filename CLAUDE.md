# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aytza is an AI-powered task management application where autonomous AI agents work on tasks. Built on Cloudflare's Developer Platform with a React frontend and TypeScript backend.

**Architecture Flow:**
```
Browser ←→ Worker ←→ Durable Objects ←→ Workflows
   │      (HTTP)   (BoardDO, UserDO)  (AgentWorkflow)
   │                     │                    │
   └─ WebSocket ─────────┘              Anthropic + Tools
```

## Common Commands

```bash
# Development
npm run dev              # Start local dev server (Vite + Wrangler)
npm run dev:wrangler     # Wrangler dev server only

# Building
npm run build            # TypeScript compilation + Vite build
npm run preview          # Preview production build locally
npm run cf-typegen       # Generate Cloudflare types

# Testing
npm run test             # Watch mode tests
npm run test:run         # One-time test run
npm run test:coverage    # Coverage report
npm run test:integration # Integration tests with Cloudflare sandbox

# Linting
npm run lint             # ESLint with TypeScript

# Deployment
npm run deploy           # Deploy to staging
npm run deploy:prod      # Deploy to production
```

## Architecture

### Backend (worker/)

- **index.ts** - HTTP routing & auth dispatcher
- **BoardDO.ts** - Durable Object for board state (SQLite backend)
- **UserDO.ts** - Durable Object for user isolation
- **workflows/AgentWorkflow.ts** - Main agent execution loop (Cloudflare Workflow)
- **mcp/AccountMCPRegistry.ts** - Pluggable registry for MCP tool integrations
- **handlers/** - HTTP request handlers
- **services/** - Business logic (BoardService, CredentialService, MCPService, WorkflowService)

### Frontend (src/)

- **context/BoardContext.tsx** - Board state & WebSocket connection
- **context/boardReducer.ts** - State management reducer
- **api/client.ts** - RPC-style API client
- **components/** - Feature-based component folders (Board/, Task/, Column/, Workflow/, etc.)

### Key Patterns

- **MCP Integration**: Add new integrations by registering in AccountMCPRegistry - no changes needed to agent workflow
- **Credentials**: All credentials encrypted at rest via CredentialService using ENCRYPTION_KEY
- **Real-time Updates**: WebSocket connection from BoardContext to BoardDO for live state sync
- **Auth Modes**: `AUTH_MODE=none` (single-user) or `AUTH_MODE=access` (Cloudflare Access JWT)

## Environment Variables

Key variables (see .env.example):
- `AUTH_MODE`: "none" or "access"
- `ENCRYPTION_KEY`: For credential encryption (min 32 chars)
- `GOOGLE_CLIENT_ID/SECRET`: Google OAuth
- `GITHUB_CLIENT_ID/SECRET`: GitHub OAuth

## Database

SQLite in Durable Objects with tables: `boards`, `columns`, `tasks`, `board_credentials`, `mcp_servers`, `mcp_tool_schemas`

## Testing

- Unit tests: `tests/` directory with Vitest
- Integration tests use `@cloudflare/vitest-pool-workers` for Cloudflare sandbox
- Run specific test: `npx vitest run path/to/test.ts`

## Built-in MCP Servers

Gmail, Google Docs, Google Sheets, GitHub, Sandbox (code execution), and Remote MCP servers via HTTP.
