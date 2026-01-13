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
import { handleGeneratePlan, handleResolveCheckpoint, handleCancelWorkflow, handleResumeWorkflow } from './handlers/workflows';
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
            config: {
              anthropicApiKeyConfigured: !!env.ANTHROPIC_API_KEY,
            },
          },
        });
      }

      // GET /api/projects - List user's projects (from UserDO)
      if (url.pathname === '/api/projects' && request.method === 'GET') {
        const projects = await userStub.getProjects();
        return jsonResponse({ success: true, data: projects });
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

      // POST /api/projects - Create a new project (also supports /api/boards for backward compatibility)
      if ((url.pathname === '/api/projects' || url.pathname === '/api/boards') && request.method === 'POST') {
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

        // Check access - allow user's own task container or projects they have access to
        const userTasksId = `user-tasks-${user.id}`;
        const isOwnTaskContainer = projectId === userTasksId;

        if (!isOwnTaskContainer) {
          const accessResult = await userStub.hasAccess(projectId);
          if (!accessResult.hasAccess) {
            return jsonResponse({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Access denied to this project' },
            }, 403);
          }
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
      // STANDALONE TASK WORKFLOW ROUTES
      // ============================================

      // POST /api/tasks/:taskId/generate-plan - Generate plan for standalone task
      const standaloneGeneratePlanMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/generate-plan$/);
      if (standaloneGeneratePlanMatch && request.method === 'POST') {
        const taskId = standaloneGeneratePlanMatch[1];
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;
        const body = await request.json() as { agentId?: string };
        return handleGeneratePlan(env, boardStub, userTasksId, taskId, user.id, body.agentId);
      }

      // GET /api/tasks/:taskId/plan - Get workflow plan for standalone task
      const standaloneTaskPlanMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/plan$/);
      if (standaloneTaskPlanMatch && request.method === 'GET') {
        const taskId = standaloneTaskPlanMatch[1];
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;
        try {
          const plan = await boardStub.getTaskWorkflowPlan(taskId);
          return jsonResponse({ success: true, data: plan });
        } catch {
          return jsonResponse({ success: true, data: null });
        }
      }

      // Standalone task plan-specific routes: /api/tasks/:taskId/plans/:planId/*
      const standalonePlanMatch = url.pathname.match(/^\/api\/tasks\/[^/]+\/plans\/([^/]+)(\/.*)?$/);
      if (standalonePlanMatch) {
        const planId = standalonePlanMatch[1];
        const planAction = standalonePlanMatch[2] || '';
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        // POST /api/tasks/:taskId/plans/:planId/checkpoint - Resolve checkpoint
        if (planAction === '/checkpoint' && request.method === 'POST') {
          return handleResolveCheckpoint(request, env, boardStub, userTasksId, planId);
        }

        // POST /api/tasks/:taskId/plans/:planId/cancel - Cancel workflow
        if (planAction === '/cancel' && request.method === 'POST') {
          return handleCancelWorkflow(env, boardStub, userTasksId, planId);
        }

        // POST /api/tasks/:taskId/plans/:planId/resume - Resume workflow with feedback
        if (planAction === '/resume' && request.method === 'POST') {
          return handleResumeWorkflow(request, env, boardStub, userTasksId, planId, user.id);
        }

        // GET /api/tasks/:taskId/plans/:planId - Get workflow plan
        if (!planAction && request.method === 'GET') {
          try {
            const plan = await boardStub.getWorkflowPlan(planId);
            return jsonResponse({ success: true, data: plan });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Plan not found' },
            }, 404);
          }
        }

        // DELETE /api/tasks/:taskId/plans/:planId - Delete workflow plan
        if (!planAction && request.method === 'DELETE') {
          try {
            await boardStub.deleteWorkflowPlan(planId);
            return jsonResponse({ success: true });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'DELETE_FAILED', message: 'Failed to delete plan' },
            }, 500);
          }
        }

        // GET /api/tasks/:taskId/plans/:planId/logs - Get workflow logs
        if (planAction === '/logs' && request.method === 'GET') {
          const limit = parseInt(url.searchParams.get('limit') || '100', 10);
          const offset = parseInt(url.searchParams.get('offset') || '0', 10);
          try {
            const logs = await boardStub.getWorkflowLogs(planId, limit, offset);
            return jsonResponse({ success: true, data: logs });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'FETCH_FAILED', message: 'Failed to get logs' },
            }, 500);
          }
        }
      }

      // ============================================
      // AGENTS ROUTES (/api/agents)
      // ============================================

      // GET /api/agents - List user's agents (global or project-specific)
      if (url.pathname === '/api/agents' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');

        let boardStub: BoardDOStub;

        if (projectId) {
          // Project-specific agents - verify access
          const accessResult = await userStub.hasAccess(projectId);
          if (!accessResult.hasAccess) {
            return jsonResponse({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Access denied to this project' },
            }, 403);
          }
          const boardDoId = env.BOARD_DO.idFromName(projectId);
          boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;
        } else {
          // Global agents - use user's personal container
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

        const agents = await boardStub.getAgents(projectId);
        return jsonResponse({ success: true, data: agents });
      }

      // POST /api/agents - Create agent
      if (url.pathname === '/api/agents' && request.method === 'POST') {
        const body = await request.json() as {
          projectId?: string;
          name: string;
          description?: string;
          systemPrompt: string;
          model?: string;
          icon?: string;
        };

        let boardStub: BoardDOStub;

        if (body.projectId) {
          // Project-specific agent - verify access
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
          // Global agent - use user's personal container
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
          const agent = await boardStub.createAgent(body);
          return jsonResponse({ success: true, data: agent });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create agent' },
          }, 500);
        }
      }

      // Agent-specific routes
      const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch) {
        const agentId = agentMatch[1];
        const projectId = url.searchParams.get('projectId');

        let boardStub: BoardDOStub;

        if (projectId) {
          // Project-specific agent
          const accessResult = await userStub.hasAccess(projectId);
          if (!accessResult.hasAccess) {
            return jsonResponse({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Access denied to this project' },
            }, 403);
          }
          const boardDoId = env.BOARD_DO.idFromName(projectId);
          boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;
        } else {
          // Global agent
          const userTasksId = `user-tasks-${user.id}`;
          const boardDoId = env.BOARD_DO.idFromName(userTasksId);
          boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;
        }

        if (request.method === 'GET') {
          try {
            const agent = await boardStub.getAgent(agentId);
            return jsonResponse({ success: true, data: agent });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Agent not found' },
            }, 404);
          }
        }

        if (request.method === 'PUT' || request.method === 'PATCH') {
          const body = await request.json() as {
            name?: string;
            description?: string;
            systemPrompt?: string;
            model?: string;
            icon?: string;
            enabled?: boolean;
          };
          try {
            const agent = await boardStub.updateAgent(agentId, body);
            return jsonResponse({ success: true, data: agent });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'UPDATE_FAILED', message: 'Failed to update agent' },
            }, 500);
          }
        }

        if (request.method === 'DELETE') {
          try {
            await boardStub.deleteAgent(agentId);
            return jsonResponse({ success: true });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'DELETE_FAILED', message: 'Failed to delete agent' },
            }, 500);
          }
        }
      }

      // ============================================
      // GLOBAL MCP ROUTES (/api/mcp-servers)
      // User-level MCPs available across all projects
      // ============================================

      // GET /api/mcp-servers - List user's global MCP servers
      if (url.pathname === '/api/mcp-servers' && request.method === 'GET') {
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

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

        // Use a special "global" project ID for user-level MCPs
        const servers = await boardStub.getMCPServers('__global__');
        return jsonResponse({ success: true, data: servers });
      }

      // POST /api/mcp-servers - Create global MCP server
      if (url.pathname === '/api/mcp-servers' && request.method === 'POST') {
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

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

        const body = await request.json() as {
          name: string;
          type: 'remote' | 'hosted';
          endpoint?: string;
          authType?: string;
          credentialId?: string;
          status?: string;
          transportType?: 'streamable-http' | 'sse';
          urlPatterns?: Array<{ pattern: string; type: string; fetchTool: string }>;
        };

        try {
          const server = await boardStub.createMCPServer('__global__', body);
          return jsonResponse({ success: true, data: server });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create MCP server' },
          }, 500);
        }
      }

      // Global MCP server-specific routes
      const globalMcpMatch = url.pathname.match(/^\/api\/mcp-servers\/([^/]+)$/);
      if (globalMcpMatch) {
        const serverId = globalMcpMatch[1];
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        if (request.method === 'GET') {
          try {
            const server = await boardStub.getMCPServer(serverId);
            return jsonResponse({ success: true, data: server });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'NOT_FOUND', message: 'MCP server not found' },
            }, 404);
          }
        }

        if (request.method === 'PUT' || request.method === 'PATCH') {
          const body = await request.json() as {
            name?: string;
            endpoint?: string;
            authType?: string;
            credentialId?: string;
            enabled?: boolean;
            status?: string;
            transportType?: 'streamable-http' | 'sse';
          };
          try {
            const server = await boardStub.updateMCPServer(serverId, body);
            return jsonResponse({ success: true, data: server });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'UPDATE_FAILED', message: 'Failed to update MCP server' },
            }, 500);
          }
        }

        if (request.method === 'DELETE') {
          try {
            await boardStub.deleteMCPServer(serverId);
            return jsonResponse({ success: true });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'DELETE_FAILED', message: 'Failed to delete MCP server' },
            }, 500);
          }
        }
      }

      // Global MCP tools routes
      const globalMcpToolsMatch = url.pathname.match(/^\/api\/mcp-servers\/([^/]+)\/tools$/);
      if (globalMcpToolsMatch) {
        const serverId = globalMcpToolsMatch[1];
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        if (request.method === 'GET') {
          try {
            const tools = await boardStub.getMCPServerTools(serverId);
            return jsonResponse({ success: true, data: tools });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Failed to get MCP tools' },
            }, 500);
          }
        }

        if (request.method === 'PUT' || request.method === 'POST') {
          const body = await request.json() as {
            tools: Array<{
              name: string;
              description?: string;
              inputSchema: object;
              approvalRequiredFields?: string[];
            }>;
          };
          try {
            const tools = await boardStub.cacheMCPServerTools(serverId, body);
            return jsonResponse({ success: true, data: tools });
          } catch {
            return jsonResponse({
              success: false,
              error: { code: 'CACHE_FAILED', message: 'Failed to cache MCP tools' },
            }, 500);
          }
        }
      }

      // Global MCP connect route
      const globalMcpConnectMatch = url.pathname.match(/^\/api\/mcp-servers\/([^/]+)\/connect$/);
      if (globalMcpConnectMatch && request.method === 'POST') {
        const serverId = globalMcpConnectMatch[1];
        const userTasksId = `user-tasks-${user.id}`;
        const boardDoId = env.BOARD_DO.idFromName(userTasksId);
        const boardStub = env.BOARD_DO.get(boardDoId) as BoardDOStub;

        try {
          const result = await boardStub.connectMCPServer(serverId);
          return jsonResponse({ success: true, data: result });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: { code: 'CONNECT_FAILED', message: error instanceof Error ? error.message : 'Failed to connect MCP server' },
          }, 500);
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
