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
import { routeProjectRequest } from './handlers/projects';
import type { BoardDO } from './BoardDO';
import type { UserDO } from './UserDO';

export { BoardDO } from './BoardDO';
export { UserDO } from './UserDO';
export { Sandbox };
export { AgentWorkflow };

// Type for DO stubs with RPC methods
type BoardDOStub = DurableObjectStub<BoardDO>;
type UserDOStub = DurableObjectStub<UserDO>;

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

      // GET /api/projects - List user's projects (from UserDO)
      if (url.pathname === '/api/projects' && request.method === 'GET') {
        const projects = await userStub.getProjects();
        return jsonResponse({ success: true, data: projects });
      }

      // POST /api/projects - Create a new project
      if (url.pathname === '/api/projects' && request.method === 'POST') {
        const data = await request.json() as { name: string };
        const projectId = crypto.randomUUID();

        // Initialize BoardDO for this project
        const boardDoId = env.BOARD_DO.idFromName(projectId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        try {
          const project = await boardStub.initProject({ id: projectId, name: data.name, ownerId: user.id });
          // Add project to user's list
          await userStub.addProject(projectId, data.name, 'owner');
          return jsonResponse({ success: true, data: project });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: { code: 'INIT_FAILED', message: error instanceof Error ? error.message : 'Failed to create project' },
          }, 500);
        }
      }

      // Project-specific routes - extract projectId and verify access
      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
      if (projectMatch) {
        const projectId = projectMatch[1];
        const subPath = projectMatch[2] || '';

        // Check user has access to this project
        const accessResult = await userStub.hasAccess(projectId);

        if (!accessResult.hasAccess) {
          return jsonResponse({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied to this project' },
          }, 403);
        }

        // Get BoardDO stub with RPC
        const boardDoId = env.BOARD_DO.idFromName(projectId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        // Route to project handler
        return routeProjectRequest(request, boardStub, userStub, projectId, subPath, env, user);
      }

      // WebSocket upgrade route - forward to BoardDO (still uses fetch)
      if (url.pathname === '/api/ws' && request.headers.get('Upgrade') === 'websocket') {
        // Support both projectId and boardId for backward compatibility
        const projectId = url.searchParams.get('projectId') || url.searchParams.get('boardId');
        if (!projectId) {
          return jsonResponse({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'projectId is required for WebSocket' },
          }, 400);
        }

        // Check access
        const accessResult = await userStub.hasAccess(projectId);

        if (!accessResult.hasAccess) {
          return jsonResponse({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied to this project' },
          }, 403);
        }

        const boardDoId = env.BOARD_DO.idFromName(projectId);
        const boardStub = env.BOARD_DO.get(boardDoId);

        const doUrl = new URL(request.url);
        doUrl.pathname = '/ws';

        // WebSocket upgrade requires fetch (can't use RPC)
        return boardStub.fetch(new Request(doUrl.toString(), {
          method: request.method,
          headers: request.headers,
        }));
      }

      // ============================================
      // STANDALONE TASKS ROUTES (/api/tasks)
      // ============================================

      // GET /api/tasks - List user's standalone tasks
      if (url.pathname === '/api/tasks' && request.method === 'GET') {
        // Use a per-user BoardDO for standalone tasks
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        // Initialize if needed (silent init for standalone tasks container)
        try {
          await boardStub.initProject({
            id: userTasksId,
            name: 'My Tasks',
            ownerId: user.id,
            isUserTasksContainer: true
          });
        } catch {
          // Already initialized, ignore
        }

        const tasks = await boardStub.getTasks();
        return jsonResponse({ success: true, data: tasks });
      }

      // POST /api/tasks - Create task (projectId optional for standalone)
      if (url.pathname === '/api/tasks' && request.method === 'POST') {
        const body = await request.json() as { projectId?: string; columnId?: string; title: string; description?: string; priority?: string; context?: object };

        let boardStub: BoardDOStub;

        if (body.projectId) {
          // Task belongs to a project - verify access
          const accessResult = await userStub.hasAccess(body.projectId);
          if (!accessResult.hasAccess) {
            return jsonResponse({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Access denied to this project' },
            }, 403);
          }
          const boardDoId = env.BOARD_DO.idFromName(body.projectId);
          boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;
        } else {
          // Standalone task - use user's personal tasks container
          const userTasksId = `user-tasks-${user.id}`;
          const boardDoId = env.BOARD_DO.idFromName(userTasksId);
          boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

          // Initialize if needed
          try {
            await boardStub.initProject({
              id: userTasksId,
              name: 'My Tasks',
              ownerId: user.id,
              isUserTasksContainer: true
            });
          } catch {
            // Already initialized, ignore
          }
        }

        try {
          const task = await boardStub.createTask({
            ...body,
            userId: user.id,
          });
          return jsonResponse({ success: true, data: task });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create task' },
          }, 500);
        }
      }

      // Task-specific routes for standalone tasks
      const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const taskId = taskMatch[1];
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        if (request.method === 'GET') {
          try {
            const task = await boardStub.getTask(taskId);
            return jsonResponse({ success: true, data: task });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Task not found' },
            }, 404);
          }
        }

        if (request.method === 'PUT' || request.method === 'PATCH') {
          const body = await request.json() as { title?: string; description?: string; priority?: string };
          try {
            const task = await boardStub.updateTask(taskId, body);
            return jsonResponse({ success: true, data: task });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'UPDATE_FAILED', message: 'Failed to update task' },
            }, 500);
          }
        }

        if (request.method === 'DELETE') {
          try {
            await boardStub.deleteTask(taskId);
            return jsonResponse({ success: true });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'DELETE_FAILED', message: 'Failed to delete task' },
            }, 500);
          }
        }
      }

      // ============================================
      // PROJECT-SPECIFIC ROUTES
      // ============================================

      return jsonResponse({ error: 'Not found' }, 404);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
