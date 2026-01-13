import { DurableObject } from 'cloudflare:workers';

// ============================================
// TYPES
// ============================================

export type BugColumn = 'reported' | 'triaged' | 'fixing' | 'fixed';
export type BugSeverity = 'low' | 'medium' | 'high';

export interface BugItem {
  id: string;
  title: string;
  description: string | null;
  column: BugColumn;
  position: number;
  severity: BugSeverity;
  ownerEmail: string | null;
  screenshots: string[]; // Array of base64 data URLs
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BugBoardState {
  items: BugItem[];
}

// ============================================
// SCHEMA
// ============================================

function initBugBoardSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS bug_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      column TEXT NOT NULL DEFAULT 'reported',
      position INTEGER NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'medium',
      owner_email TEXT,
      screenshots TEXT DEFAULT '[]',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bug_column ON bug_items(column);
    CREATE INDEX IF NOT EXISTS idx_bug_severity ON bug_items(severity);
  `);

  // Migration: Add screenshots column if it doesn't exist
  try {
    sql.exec(`ALTER TABLE bug_items ADD COLUMN screenshots TEXT DEFAULT '[]'`);
  } catch {
    // Column already exists, ignore error
  }
}

// ============================================
// BUG BOARD DURABLE OBJECT
// ============================================

export class BugBoardDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    initBugBoardSchema(this.sql);
  }

  // ============================================
  // WEBSOCKET
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade();
    }

    return new Response('Use RPC methods', { status: 400 });
  }

  private handleWebSocketUpgrade(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === 'string') {
      try {
        const data = JSON.parse(message);
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed messages
      }
    }
  }

  async webSocketClose() {
    // Cleanup handled by runtime
  }

  private broadcast(type: string, data: Record<string, unknown>): void {
    const clients = this.ctx.getWebSockets();
    const message = JSON.stringify({ type, data });

    for (const ws of clients) {
      try {
        ws.send(message);
      } catch {
        // Client may have disconnected
      }
    }
  }

  // ============================================
  // BUG BOARD RPC METHODS
  // ============================================

  async getItems(): Promise<BugItem[]> {
    const rows = this.sql.exec(`
      SELECT * FROM bug_items ORDER BY column, position
    `).toArray();

    return rows.map(this.rowToItem);
  }

  async getItem(id: string): Promise<BugItem | null> {
    const rows = this.sql.exec(`
      SELECT * FROM bug_items WHERE id = ?
    `, id).toArray();

    if (rows.length === 0) return null;
    return this.rowToItem(rows[0]);
  }

  async createItem(data: {
    title: string;
    description?: string;
    column?: BugColumn;
    severity?: BugSeverity;
    ownerEmail?: string;
    screenshots?: string[];
    createdBy: string;
  }): Promise<BugItem> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const column = data.column || 'reported';

    // Get next position in column
    const posResult = this.sql.exec(`
      SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM bug_items WHERE column = ?
    `, column).toArray();
    const position = (posResult[0] as { next_pos: number }).next_pos;

    this.sql.exec(`
      INSERT INTO bug_items (id, title, description, column, position, severity, owner_email, screenshots, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      data.title,
      data.description || null,
      column,
      position,
      data.severity || 'medium',
      data.ownerEmail || null,
      JSON.stringify(data.screenshots || []),
      data.createdBy,
      now,
      now
    );

    const item = await this.getItem(id);
    this.broadcast('bug_item_created', { item });
    return item!;
  }

  async updateItem(id: string, data: {
    title?: string;
    description?: string;
    severity?: BugSeverity;
    ownerEmail?: string | null;
    screenshots?: string[];
  }): Promise<BugItem> {
    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const values: (string | null)[] = [now];

    if (data.title !== undefined) {
      updates.push('title = ?');
      values.push(data.title);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.severity !== undefined) {
      updates.push('severity = ?');
      values.push(data.severity);
    }
    if (data.ownerEmail !== undefined) {
      updates.push('owner_email = ?');
      values.push(data.ownerEmail);
    }
    if (data.screenshots !== undefined) {
      updates.push('screenshots = ?');
      values.push(JSON.stringify(data.screenshots));
    }

    values.push(id);

    this.sql.exec(`
      UPDATE bug_items SET ${updates.join(', ')} WHERE id = ?
    `, ...values);

    const item = await this.getItem(id);
    this.broadcast('bug_item_updated', { item });
    return item!;
  }

  async moveItem(id: string, data: { column: BugColumn; position: number }): Promise<BugItem> {
    const now = new Date().toISOString();
    const currentItem = await this.getItem(id);
    if (!currentItem) throw new Error('Item not found');

    const oldColumn = currentItem.column;
    const oldPosition = currentItem.position;
    const newColumn = data.column;
    const newPosition = data.position;

    // If moving within same column
    if (oldColumn === newColumn) {
      if (newPosition > oldPosition) {
        // Moving down: shift items between old and new position up
        this.sql.exec(`
          UPDATE bug_items
          SET position = position - 1, updated_at = ?
          WHERE column = ? AND position > ? AND position <= ?
        `, now, newColumn, oldPosition, newPosition);
      } else if (newPosition < oldPosition) {
        // Moving up: shift items between new and old position down
        this.sql.exec(`
          UPDATE bug_items
          SET position = position + 1, updated_at = ?
          WHERE column = ? AND position >= ? AND position < ?
        `, now, newColumn, newPosition, oldPosition);
      }
    } else {
      // Moving to different column
      // Shift items in old column up
      this.sql.exec(`
        UPDATE bug_items
        SET position = position - 1, updated_at = ?
        WHERE column = ? AND position > ?
      `, now, oldColumn, oldPosition);

      // Shift items in new column down
      this.sql.exec(`
        UPDATE bug_items
        SET position = position + 1, updated_at = ?
        WHERE column = ? AND position >= ?
      `, now, newColumn, newPosition);
    }

    // Update the item itself
    this.sql.exec(`
      UPDATE bug_items SET column = ?, position = ?, updated_at = ? WHERE id = ?
    `, newColumn, newPosition, now, id);

    const item = await this.getItem(id);
    this.broadcast('bug_item_moved', { item, oldColumn, oldPosition });
    return item!;
  }

  async deleteItem(id: string): Promise<{ success: boolean }> {
    const item = await this.getItem(id);
    if (!item) throw new Error('Item not found');

    const now = new Date().toISOString();

    // Shift items in same column up
    this.sql.exec(`
      UPDATE bug_items
      SET position = position - 1, updated_at = ?
      WHERE column = ? AND position > ?
    `, now, item.column, item.position);

    this.sql.exec(`DELETE FROM bug_items WHERE id = ?`, id);

    this.broadcast('bug_item_deleted', { id, column: item.column });
    return { success: true };
  }

  // ============================================
  // HELPERS
  // ============================================

  private rowToItem(row: Record<string, unknown>): BugItem {
    let screenshots: string[] = [];
    try {
      screenshots = JSON.parse((row.screenshots as string) || '[]');
    } catch {
      screenshots = [];
    }

    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | null,
      column: row.column as BugColumn,
      position: row.position as number,
      severity: row.severity as BugSeverity,
      ownerEmail: row.owner_email as string | null,
      screenshots,
      createdBy: row.created_by as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
