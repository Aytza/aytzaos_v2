/**
 * Database schema initialization and migrations for BoardDO
 *
 * Note: The Durable Object is still called BoardDO for Cloudflare binding stability,
 * but the data model uses "projects" terminology.
 */

export function initSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      tool_config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      column_id TEXT,
      project_id TEXT,
      user_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      position INTEGER NOT NULL,
      context TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Project credentials (encrypted OAuth tokens, API keys)
    CREATE TABLE IF NOT EXISTS project_credentials (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_columns_project ON columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_credentials_project ON project_credentials(project_id);

    -- MCP Server configurations
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      endpoint TEXT,
      auth_type TEXT NOT NULL DEFAULT 'none',
      credential_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disconnected',
      transport_type TEXT DEFAULT 'streamable-http',
      oauth_metadata TEXT,
      url_patterns TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (credential_id) REFERENCES project_credentials(id)
    );

    -- Cached MCP tool schemas
    CREATE TABLE IF NOT EXISTS mcp_tool_schemas (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      input_schema TEXT NOT NULL,
      output_schema TEXT,
      approval_required_fields TEXT,
      cached_at TEXT NOT NULL,
      FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE,
      UNIQUE(server_id, name)
    );

    -- Workflow plans
    CREATE TABLE IF NOT EXISTS workflow_plans (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planning',
      summary TEXT,
      generated_code TEXT,
      steps TEXT,
      current_step_index INTEGER,
      checkpoint_data TEXT,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Workflow logs (real-time observability)
    CREATE TABLE IF NOT EXISTS workflow_logs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      step_id TEXT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY (plan_id) REFERENCES workflow_plans(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_servers_project ON mcp_servers(project_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON mcp_tool_schemas(server_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_plans_task ON workflow_plans(task_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_plans_project ON workflow_plans(project_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_logs_plan ON workflow_logs(plan_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_logs_step ON workflow_logs(step_id);

    -- Pending OAuth authorizations (stores PKCE code_verifier)
    CREATE TABLE IF NOT EXISTS mcp_oauth_pending (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      state TEXT NOT NULL,
      resource TEXT NOT NULL,
      scopes TEXT,
      client_id TEXT,
      client_secret TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_oauth_pending_state ON mcp_oauth_pending(state);
  `);

  runMigrations(sql);
}

function runMigrations(sql: SqlStorage): void {
  // Migration: boards -> projects (for existing DOs)
  migrateBoards(sql);

  // Add url_patterns column to mcp_servers if it doesn't exist
  try {
    sql.exec('ALTER TABLE mcp_servers ADD COLUMN url_patterns TEXT');
  } catch {
    // Column already exists
  }

  // Add owner_id column to projects if it doesn't exist
  try {
    sql.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists
  }

  // Add user_id column to tasks if it doesn't exist (for standalone tasks)
  try {
    sql.exec('ALTER TABLE tasks ADD COLUMN user_id TEXT');
  } catch {
    // Column already exists
  }
}

/**
 * Migrate data from old 'boards' table to new 'projects' table
 * This handles existing Durable Objects that were created before the rename
 */
function migrateBoards(sql: SqlStorage): void {
  // Check if old 'boards' table exists and new 'projects' table is empty
  try {
    const oldBoards = sql.exec('SELECT * FROM boards').toArray();
    if (oldBoards.length === 0) return;

    const newProjects = sql.exec('SELECT id FROM projects').toArray();
    if (newProjects.length > 0) return; // Already migrated

    // Migrate boards -> projects
    for (const board of oldBoards) {
      const b = board as Record<string, unknown>;
      sql.exec(
        'INSERT INTO projects (id, name, owner_id, tool_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        b.id, b.name, b.owner_id || '', b.tool_config, b.created_at, b.updated_at
      );
    }

    // Migrate columns (board_id -> project_id)
    const oldColumns = sql.exec('SELECT * FROM columns WHERE board_id IS NOT NULL').toArray();
    for (const col of oldColumns) {
      const c = col as Record<string, unknown>;
      sql.exec(
        'UPDATE columns SET project_id = ? WHERE id = ?',
        c.board_id, c.id
      );
    }

    // Migrate tasks (board_id -> project_id)
    const oldTasks = sql.exec('SELECT id, board_id FROM tasks WHERE board_id IS NOT NULL').toArray();
    for (const task of oldTasks) {
      const t = task as Record<string, unknown>;
      sql.exec(
        'UPDATE tasks SET project_id = ? WHERE id = ?',
        t.board_id, t.id
      );
    }

    // Migrate board_credentials -> project_credentials
    try {
      const oldCreds = sql.exec('SELECT * FROM board_credentials').toArray();
      for (const cred of oldCreds) {
        const c = cred as Record<string, unknown>;
        sql.exec(
          'INSERT INTO project_credentials (id, project_id, type, name, encrypted_value, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          c.id, c.board_id, c.type, c.name, c.encrypted_value, c.metadata, c.created_at, c.updated_at
        );
      }
    } catch {
      // board_credentials table might not exist
    }

    // Migrate mcp_servers (board_id -> project_id)
    try {
      sql.exec('UPDATE mcp_servers SET project_id = board_id WHERE board_id IS NOT NULL AND project_id IS NULL');
    } catch {
      // Column might not exist
    }

    // Migrate workflow_plans (board_id -> project_id)
    try {
      sql.exec('UPDATE workflow_plans SET project_id = board_id WHERE board_id IS NOT NULL AND project_id IS NULL');
    } catch {
      // Column might not exist
    }

    // Migrate mcp_oauth_pending (board_id -> project_id)
    try {
      sql.exec('UPDATE mcp_oauth_pending SET project_id = board_id WHERE board_id IS NOT NULL AND project_id IS NULL');
    } catch {
      // Column might not exist
    }

  } catch {
    // Old 'boards' table doesn't exist, nothing to migrate
  }
}
