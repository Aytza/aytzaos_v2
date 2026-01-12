/**
 * UserDO - Durable Object for user data
 *
 * Keyed by user ID (from Cloudflare Access JWT `sub` claim)
 * Stores: user info, list of projects user has access to
 *
 * Uses RPC for all operations (no HTTP routing needed)
 */

import { DurableObject } from 'cloudflare:workers';

// Response types for RPC methods
export interface UserInfo {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProject {
  id: string;
  projectId: string;
  name: string;
  role: string;
  createdAt: string;
  addedAt: string;
}

export interface AccessResult {
  hasAccess: boolean;
  role?: string;
}

export class UserDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initSchema();
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS user_info (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        added_at TEXT NOT NULL
      );
    `);

    // Migrate old user_boards table if it exists
    this.migrateUserBoards();
  }

  private migrateUserBoards(): void {
    try {
      const oldBoards = this.sql.exec('SELECT * FROM user_boards').toArray();
      if (oldBoards.length === 0) return;

      const newProjects = this.sql.exec('SELECT project_id FROM user_projects').toArray();
      if (newProjects.length > 0) return; // Already migrated

      for (const board of oldBoards) {
        const b = board as { board_id: string; name: string; role: string; added_at: string };
        this.sql.exec(
          'INSERT INTO user_projects (project_id, name, role, added_at) VALUES (?, ?, ?, ?)',
          b.board_id, b.name, b.role, b.added_at
        );
      }
    } catch {
      // Old table doesn't exist, nothing to migrate
    }
  }

  // ============================================
  // RPC METHODS (called directly from worker)
  // ============================================

  /**
   * Initialize or update user info
   */
  async initUser(id: string, email: string): Promise<{ success: boolean }> {
    const now = new Date().toISOString();

    const existing = this.sql.exec(
      'SELECT id, email FROM user_info WHERE id = ?',
      id
    ).toArray()[0] as { id: string; email: string } | undefined;

    if (existing) {
      if (existing.email !== email) {
        this.sql.exec(
          'UPDATE user_info SET email = ?, updated_at = ? WHERE id = ?',
          email,
          now,
          id
        );
      }
    } else {
      this.sql.exec(
        'INSERT INTO user_info (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)',
        id,
        email,
        now,
        now
      );
    }

    return { success: true };
  }

  /**
   * Get user info
   */
  async getUserInfo(): Promise<UserInfo | null> {
    const user = this.sql.exec(
      'SELECT id, email, created_at, updated_at FROM user_info'
    ).toArray()[0] as { id: string; email: string; created_at: string; updated_at: string } | undefined;

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }

  /**
   * Get user's projects
   */
  async getProjects(): Promise<UserProject[]> {
    const projects = this.sql.exec(
      'SELECT project_id, name, role, added_at FROM user_projects ORDER BY added_at DESC'
    ).toArray() as Array<{ project_id: string; name: string; role: string; added_at: string }>;

    return projects.map((p) => ({
      id: p.project_id,
      projectId: p.project_id,
      name: p.name,
      role: p.role,
      createdAt: p.added_at,
      addedAt: p.added_at,
    }));
  }

  // Alias for backward compatibility during migration
  async getBoards(): Promise<UserProject[]> {
    return this.getProjects();
  }

  /**
   * Add a project to user's list
   */
  async addProject(projectId: string, name: string, role?: string): Promise<{ success: boolean }> {
    const now = new Date().toISOString();

    const existing = this.sql.exec(
      'SELECT project_id FROM user_projects WHERE project_id = ?',
      projectId
    ).toArray()[0];

    if (existing) {
      return { success: true }; // Already exists
    }

    this.sql.exec(
      'INSERT INTO user_projects (project_id, name, role, added_at) VALUES (?, ?, ?, ?)',
      projectId,
      name,
      role || 'owner',
      now
    );

    return { success: true };
  }

  // Alias for backward compatibility during migration
  async addBoard(projectId: string, name: string, role?: string): Promise<{ success: boolean }> {
    return this.addProject(projectId, name, role);
  }

  /**
   * Check if user has access to a project
   */
  async hasAccess(projectId: string): Promise<AccessResult> {
    const project = this.sql.exec(
      'SELECT project_id, role FROM user_projects WHERE project_id = ?',
      projectId
    ).toArray()[0] as { project_id: string; role: string } | undefined;

    if (!project) {
      return { hasAccess: false };
    }

    return { hasAccess: true, role: project.role };
  }

  /**
   * Update project name in user's list
   */
  async updateProjectName(projectId: string, name: string): Promise<{ success: boolean }> {
    this.sql.exec(
      'UPDATE user_projects SET name = ? WHERE project_id = ?',
      name,
      projectId
    );
    return { success: true };
  }

  // Alias for backward compatibility during migration
  async updateBoardName(projectId: string, name: string): Promise<{ success: boolean }> {
    return this.updateProjectName(projectId, name);
  }

  /**
   * Remove a project from user's list
   */
  async removeProject(projectId: string): Promise<{ success: boolean }> {
    this.sql.exec('DELETE FROM user_projects WHERE project_id = ?', projectId);
    return { success: true };
  }

  // Alias for backward compatibility during migration
  async removeBoard(projectId: string): Promise<{ success: boolean }> {
    return this.removeProject(projectId);
  }
}
