import { DurableObject } from 'cloudflare:workers';

// ============================================
// TYPES
// ============================================

export type RoadmapColumn = 'ideas' | 'prototyping' | 'building' | 'shipped';
export type ItemSize = 'S' | 'M' | 'L';

export interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  column: RoadmapColumn;
  position: number;
  ownerEmail: string | null;
  targetWeek: string | null; // ISO date string (Monday of target week)
  size: ItemSize;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoadmapState {
  items: RoadmapItem[];
}

// ============================================
// SCHEMA
// ============================================

function initRoadmapSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS roadmap_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      column TEXT NOT NULL DEFAULT 'ideas',
      position INTEGER NOT NULL DEFAULT 0,
      owner_email TEXT,
      target_week TEXT,
      size TEXT NOT NULL DEFAULT 'M',
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_roadmap_column ON roadmap_items(column);
    CREATE INDEX IF NOT EXISTS idx_roadmap_target_week ON roadmap_items(target_week);
  `);
}

// ============================================
// ROADMAP DURABLE OBJECT
// ============================================

export class RoadmapDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    initRoadmapSchema(this.sql);
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
  // ROADMAP RPC METHODS
  // ============================================

  async getItems(): Promise<RoadmapItem[]> {
    const rows = this.sql.exec(`
      SELECT * FROM roadmap_items ORDER BY column, position
    `).toArray();

    return rows.map(this.rowToItem);
  }

  async getItem(id: string): Promise<RoadmapItem | null> {
    const rows = this.sql.exec(`
      SELECT * FROM roadmap_items WHERE id = ?
    `, id).toArray();

    if (rows.length === 0) return null;
    return this.rowToItem(rows[0]);
  }

  async createItem(data: {
    title: string;
    description?: string;
    column?: RoadmapColumn;
    ownerEmail?: string;
    targetWeek?: string;
    size?: ItemSize;
    notes?: string;
    createdBy: string;
  }): Promise<RoadmapItem> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const column = data.column || 'ideas';

    // Get next position in column
    const posResult = this.sql.exec(`
      SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM roadmap_items WHERE column = ?
    `, column).toArray();
    const position = (posResult[0] as { next_pos: number }).next_pos;

    this.sql.exec(`
      INSERT INTO roadmap_items (id, title, description, column, position, owner_email, target_week, size, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      data.title,
      data.description || null,
      column,
      position,
      data.ownerEmail || null,
      data.targetWeek || null,
      data.size || 'M',
      data.notes || null,
      data.createdBy,
      now,
      now
    );

    const item = await this.getItem(id);
    this.broadcast('roadmap_item_created', { item });
    return item!;
  }

  async updateItem(id: string, data: {
    title?: string;
    description?: string;
    ownerEmail?: string | null;
    targetWeek?: string | null;
    size?: ItemSize;
    notes?: string | null;
  }): Promise<RoadmapItem> {
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
    if (data.ownerEmail !== undefined) {
      updates.push('owner_email = ?');
      values.push(data.ownerEmail);
    }
    if (data.targetWeek !== undefined) {
      updates.push('target_week = ?');
      values.push(data.targetWeek);
    }
    if (data.size !== undefined) {
      updates.push('size = ?');
      values.push(data.size);
    }
    if (data.notes !== undefined) {
      updates.push('notes = ?');
      values.push(data.notes);
    }

    values.push(id);

    this.sql.exec(`
      UPDATE roadmap_items SET ${updates.join(', ')} WHERE id = ?
    `, ...values);

    const item = await this.getItem(id);
    this.broadcast('roadmap_item_updated', { item });
    return item!;
  }

  async moveItem(id: string, data: { column: RoadmapColumn; position: number }): Promise<RoadmapItem> {
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
          UPDATE roadmap_items
          SET position = position - 1, updated_at = ?
          WHERE column = ? AND position > ? AND position <= ?
        `, now, newColumn, oldPosition, newPosition);
      } else if (newPosition < oldPosition) {
        // Moving up: shift items between new and old position down
        this.sql.exec(`
          UPDATE roadmap_items
          SET position = position + 1, updated_at = ?
          WHERE column = ? AND position >= ? AND position < ?
        `, now, newColumn, newPosition, oldPosition);
      }
    } else {
      // Moving to different column
      // Shift items in old column up
      this.sql.exec(`
        UPDATE roadmap_items
        SET position = position - 1, updated_at = ?
        WHERE column = ? AND position > ?
      `, now, oldColumn, oldPosition);

      // Shift items in new column down
      this.sql.exec(`
        UPDATE roadmap_items
        SET position = position + 1, updated_at = ?
        WHERE column = ? AND position >= ?
      `, now, newColumn, newPosition);
    }

    // Update the item itself
    this.sql.exec(`
      UPDATE roadmap_items SET column = ?, position = ?, updated_at = ? WHERE id = ?
    `, newColumn, newPosition, now, id);

    const item = await this.getItem(id);
    this.broadcast('roadmap_item_moved', { item, oldColumn, oldPosition });
    return item!;
  }

  async deleteItem(id: string): Promise<{ success: boolean }> {
    const item = await this.getItem(id);
    if (!item) throw new Error('Item not found');

    const now = new Date().toISOString();

    // Shift items in same column up
    this.sql.exec(`
      UPDATE roadmap_items
      SET position = position - 1, updated_at = ?
      WHERE column = ? AND position > ?
    `, now, item.column, item.position);

    this.sql.exec(`DELETE FROM roadmap_items WHERE id = ?`, id);

    this.broadcast('roadmap_item_deleted', { id, column: item.column });
    return { success: true };
  }

  // ============================================
  // HELPERS
  // ============================================

  private rowToItem(row: Record<string, unknown>): RoadmapItem {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | null,
      column: row.column as RoadmapColumn,
      position: row.position as number,
      ownerEmail: row.owner_email as string | null,
      targetWeek: row.target_week as string | null,
      size: row.size as ItemSize,
      notes: row.notes as string | null,
      createdBy: row.created_by as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
