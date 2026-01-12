/**
 * Cloudflare Worker entry point - thin dispatcher
 */

import { Sandbox } from '@cloudflare/sandbox';
import { AgentWorkflow } from './workflows/AgentWorkflow';
import { getAuthenticatedUser, getLogoutUrl, type AuthEnv } from './auth';
import { jsonResponse } from './utils/response';
import { logger } from './utils/logger';
import {
  handleGitHubOAuthUrl,
  handleGitHubOAuthExchange,
  handleGitHubOAuthCallback,
  handleGoogleOAuthUrl,
  handleGoogleOAuthExchange,
} from './handlers/oauth';
import { routeBoardRequest } from './handlers/boards';
import type { BoardDO } from './BoardDO';
import type { UserDO } from './UserDO';
import type { RoadmapDO } from './RoadmapDO';
import type { BugBoardDO } from './BugBoardDO';

export { BoardDO } from './BoardDO';
export { UserDO } from './UserDO';
export { RoadmapDO } from './RoadmapDO';
export { BugBoardDO } from './BugBoardDO';
export { Sandbox };
export { AgentWorkflow };

// Type for DO stubs with RPC methods
type BoardDOStub = DurableObjectStub<BoardDO>;
type UserDOStub = DurableObjectStub<UserDO>;
type RoadmapDOStub = DurableObjectStub<RoadmapDO>;
type BugBoardDOStub = DurableObjectStub<BugBoardDO>;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    logger.worker.debug('Incoming request', { method: request.method, path: url.pathname });

    // ============================================
    // PUBLIC ROUTES (no auth required)
    // ============================================

    // GitHub OAuth routes
    if (url.pathname === '/api/github/oauth/url') {
      return handleGitHubOAuthUrl(request, env, url);
    }

    if (url.pathname === '/api/github/oauth/exchange') {
      return handleGitHubOAuthExchange(request, env, url);
    }

    // Legacy callback route (for direct browser navigation)
    if (url.pathname === '/api/github/oauth/callback') {
      return handleGitHubOAuthCallback(request, env, url);
    }

    // Google OAuth routes
    if (url.pathname === '/api/google/oauth/url') {
      return handleGoogleOAuthUrl(request, env, url);
    }

    if (url.pathname === '/api/google/oauth/exchange') {
      return handleGoogleOAuthExchange(request, env, url);
    }

    // ============================================
    // PROTECTED ROUTES (auth required)
    // ============================================

    if (url.pathname.startsWith('/api/')) {
      // Authenticate user
      const user = await getAuthenticatedUser(request, env as unknown as AuthEnv);
      if (!user) {
        return jsonResponse({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        }, 401);
      }

      // Get UserDO stub with RPC
      const userDoId = env.USER_DO.idFromName(user.id);
      const userStub = env.USER_DO.get(userDoId) as UserDOStub;

      // Initialize user in UserDO (creates if new, updates email if changed)
      await userStub.initUser(user.id, user.email);

      // GET /api/me - Return current user info
      if (url.pathname === '/api/me' && request.method === 'GET') {
        return jsonResponse({
          success: true,
          data: {
            id: user.id,
            email: user.email,
            logoutUrl: (env as AuthEnv).AUTH_MODE === 'access' && (env as AuthEnv).ACCESS_TEAM ? getLogoutUrl((env as AuthEnv).ACCESS_TEAM!) : null,
          },
        });
      }

      // GET /api/boards - List user's boards (from UserDO)
      if (url.pathname === '/api/boards' && request.method === 'GET') {
        const boards = await userStub.getBoards();
        return jsonResponse({ success: true, data: boards });
      }

      // ============================================
      // ROADMAP ROUTES (single shared instance)
      // ============================================

      if (url.pathname.startsWith('/api/roadmap')) {
        // Use a fixed ID for the single shared roadmap
        const roadmapDoId = env.ROADMAP_DO.idFromName('shared-roadmap');
        const roadmapStub = env.ROADMAP_DO.get(roadmapDoId) as RoadmapDOStub;

        // WebSocket for roadmap
        if (url.pathname === '/api/roadmap/ws' && request.headers.get('Upgrade') === 'websocket') {
          const doUrl = new URL(request.url);
          doUrl.pathname = '/ws';
          return roadmapStub.fetch(new Request(doUrl.toString(), {
            method: request.method,
            headers: request.headers,
          }));
        }

        // GET /api/roadmap/items - List all items
        if (url.pathname === '/api/roadmap/items' && request.method === 'GET') {
          try {
            const items = await roadmapStub.getItems();
            return jsonResponse({ success: true, data: items });
          } catch (error) {
            return jsonResponse({
              success: false,
              error: { code: 'FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed to fetch items' },
            }, 500);
          }
        }

        // POST /api/roadmap/items - Create item
        if (url.pathname === '/api/roadmap/items' && request.method === 'POST') {
          try {
            const body = await request.json() as { title: string; description?: string; column?: 'ideas' | 'prototyping' | 'building' | 'shipped'; ownerEmail?: string; startDate?: string; endDate?: string; size?: 'S' | 'M' | 'L'; notes?: string };
            const item = await roadmapStub.createItem({ ...body, createdBy: user.email });
            return jsonResponse({ success: true, data: item });
          } catch (error) {
            return jsonResponse({
              success: false,
              error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create item' },
            }, 500);
          }
        }

        // Match /api/roadmap/items/:id
        const itemMatch = url.pathname.match(/^\/api\/roadmap\/items\/([^/]+)$/);
        if (itemMatch) {
          const itemId = itemMatch[1];

          // GET - Get single item
          if (request.method === 'GET') {
            try {
              const item = await roadmapStub.getItem(itemId);
              if (!item) {
                return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404);
              }
              return jsonResponse({ success: true, data: item });
            } catch (error) {
              return jsonResponse({
                success: false,
                error: { code: 'FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed to fetch item' },
              }, 500);
            }
          }

          // PATCH - Update item
          if (request.method === 'PATCH') {
            try {
              const body = await request.json() as { title?: string; description?: string; ownerEmail?: string | null; startDate?: string | null; endDate?: string | null; size?: 'S' | 'M' | 'L'; notes?: string | null };
              const item = await roadmapStub.updateItem(itemId, body);
              return jsonResponse({ success: true, data: item });
            } catch (error) {
              return jsonResponse({
                success: false,
                error: { code: 'UPDATE_FAILED', message: error instanceof Error ? error.message : 'Failed to update item' },
              }, 500);
            }
          }

          // DELETE - Delete item
          if (request.method === 'DELETE') {
            try {
              await roadmapStub.deleteItem(itemId);
              return jsonResponse({ success: true });
            } catch (error) {
              return jsonResponse({
                success: false,
                error: { code: 'DELETE_FAILED', message: error instanceof Error ? error.message : 'Failed to delete item' },
              }, 500);
            }
          }
        }

        // POST /api/roadmap/items/:id/move - Move item
        const moveMatch = url.pathname.match(/^\/api\/roadmap\/items\/([^/]+)\/move$/);
        if (moveMatch && request.method === 'POST') {
          const itemId = moveMatch[1];
          try {
            const body = await request.json() as { column: 'ideas' | 'prototyping' | 'building' | 'shipped'; position: number };
            const item = await roadmapStub.moveItem(itemId, body);
            return jsonResponse({ success: true, data: item });
          } catch (error) {
            return jsonResponse({
              success: false,
              error: { code: 'MOVE_FAILED', message: error instanceof Error ? error.message : 'Failed to move item' },
            }, 500);
          }
        }
      }

      // ============================================
      // BUG BOARD ROUTES (single shared instance)
      // ============================================

      if (url.pathname.startsWith('/api/bugs')) {
        // Use a fixed ID for the single shared bug board
        const bugBoardDoId = env.BUGBOARD_DO.idFromName('shared-bugboard');
        const bugBoardStub = env.BUGBOARD_DO.get(bugBoardDoId) as BugBoardDOStub;

        // WebSocket for bug board
        if (url.pathname === '/api/bugs/ws' && request.headers.get('Upgrade') === 'websocket') {
          const doUrl = new URL(request.url);
          doUrl.pathname = '/ws';
          return bugBoardStub.fetch(new Request(doUrl.toString(), {
            method: request.method,
            headers: request.headers,
          }));
        }

        // GET /api/bugs/items - List all items
        if (url.pathname === '/api/bugs/items' && request.method === 'GET') {
          try {
            const items = await bugBoardStub.getItems();
            return jsonResponse({ success: true, data: items });
          } catch (error) {
            return jsonResponse({
              success: false,
              error: { code: 'FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed to fetch items' },
            }, 500);
          }
        }

        // POST /api/bugs/items - Create item
        if (url.pathname === '/api/bugs/items' && request.method === 'POST') {
          try {
            const body = await request.json() as { title: string; description?: string; column?: 'reported' | 'triaged' | 'fixing' | 'fixed'; severity?: 'low' | 'medium' | 'high'; ownerEmail?: string; screenshots?: string[] };
            const item = await bugBoardStub.createItem({ ...body, createdBy: user.email });
            return jsonResponse({ success: true, data: item });
          } catch (error) {
            return jsonResponse({
              success: false,
              error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create item' },
            }, 500);
          }
        }

        // Match /api/bugs/items/:id
        const itemMatch = url.pathname.match(/^\/api\/bugs\/items\/([^/]+)$/);
        if (itemMatch) {
          const itemId = itemMatch[1];

          // GET - Get single item
          if (request.method === 'GET') {
            try {
              const item = await bugBoardStub.getItem(itemId);
              if (!item) {
                return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404);
              }
              return jsonResponse({ success: true, data: item });
            } catch (error) {
              return jsonResponse({
                success: false,
                error: { code: 'FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed to fetch item' },
              }, 500);
            }
          }

          // PATCH - Update item
          if (request.method === 'PATCH') {
            try {
              const body = await request.json() as { title?: string; description?: string; severity?: 'low' | 'medium' | 'high'; ownerEmail?: string | null; screenshots?: string[] };
              const item = await bugBoardStub.updateItem(itemId, body);
              return jsonResponse({ success: true, data: item });
            } catch (error) {
              return jsonResponse({
                success: false,
                error: { code: 'UPDATE_FAILED', message: error instanceof Error ? error.message : 'Failed to update item' },
              }, 500);
            }
          }

          // DELETE - Delete item
          if (request.method === 'DELETE') {
            try {
              await bugBoardStub.deleteItem(itemId);
              return jsonResponse({ success: true });
            } catch (error) {
              return jsonResponse({
                success: false,
                error: { code: 'DELETE_FAILED', message: error instanceof Error ? error.message : 'Failed to delete item' },
              }, 500);
            }
          }
        }

        // POST /api/bugs/items/:id/move - Move item
        const bugMoveMatch = url.pathname.match(/^\/api\/bugs\/items\/([^/]+)\/move$/);
        if (bugMoveMatch && request.method === 'POST') {
          const itemId = bugMoveMatch[1];
          try {
            const body = await request.json() as { column: 'reported' | 'triaged' | 'fixing' | 'fixed'; position: number };
            const item = await bugBoardStub.moveItem(itemId, body);
            return jsonResponse({ success: true, data: item });
          } catch (error) {
            return jsonResponse({
              success: false,
              error: { code: 'MOVE_FAILED', message: error instanceof Error ? error.message : 'Failed to move item' },
            }, 500);
          }
        }
      }

      // POST /api/boards - Create a new board
      if (url.pathname === '/api/boards' && request.method === 'POST') {
        const data = await request.json() as { name: string };
        const boardId = crypto.randomUUID();

        // Initialize BoardDO for this board
        const boardDoId = env.BOARD_DO.idFromName(boardId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        try {
          const board = await boardStub.initBoard({ id: boardId, name: data.name, ownerId: user.id });
          // Add board to user's list
          await userStub.addBoard(boardId, data.name, 'owner');
          return jsonResponse({ success: true, data: board });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: { code: 'INIT_FAILED', message: error instanceof Error ? error.message : 'Failed to create board' },
          }, 500);
        }
      }

      // Board-specific routes - extract boardId and verify access
      const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)(\/.*)?$/);
      if (boardMatch) {
        const boardId = boardMatch[1];
        const subPath = boardMatch[2] || '';

        // Check user has access to this board
        const accessResult = await userStub.hasAccess(boardId);

        if (!accessResult.hasAccess) {
          return jsonResponse({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied to this board' },
          }, 403);
        }

        // Get BoardDO stub with RPC
        const boardDoId = env.BOARD_DO.idFromName(boardId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        // Route to board handler
        return routeBoardRequest(request, boardStub, userStub, boardId, subPath, env, user);
      }

      // WebSocket upgrade route - forward to BoardDO (still uses fetch)
      if (url.pathname === '/api/ws' && request.headers.get('Upgrade') === 'websocket') {
        const boardId = url.searchParams.get('boardId');
        if (!boardId) {
          return jsonResponse({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'boardId is required for WebSocket' },
          }, 400);
        }

        // Check access
        const accessResult = await userStub.hasAccess(boardId);

        if (!accessResult.hasAccess) {
          return jsonResponse({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied to this board' },
          }, 403);
        }

        const boardDoId = env.BOARD_DO.idFromName(boardId);
        const boardStub = env.BOARD_DO.get(boardDoId);

        const doUrl = new URL(request.url);
        doUrl.pathname = '/ws';

        // WebSocket upgrade requires fetch (can't use RPC)
        return boardStub.fetch(new Request(doUrl.toString(), {
          method: request.method,
          headers: request.headers,
        }));
      }

      // POST /api/tasks - Create task (boardId in body)
      if (url.pathname === '/api/tasks' && request.method === 'POST') {
        const body = await request.json() as { boardId: string; columnId: string; title: string; description?: string; priority?: string; context?: object };
        if (!body.boardId) {
          return jsonResponse({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'boardId is required' },
          }, 400);
        }

        // Verify user has access to this board
        const accessResult = await userStub.hasAccess(body.boardId);

        if (!accessResult.hasAccess) {
          return jsonResponse({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied to this board' },
          }, 403);
        }

        // Route to the correct BoardDO
        const boardDoId = env.BOARD_DO.idFromName(body.boardId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        try {
          const task = await boardStub.createTask(body);
          return jsonResponse({ success: true, data: task });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create task' },
          }, 500);
        }
      }

      return jsonResponse({ error: 'Not found' }, 404);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
