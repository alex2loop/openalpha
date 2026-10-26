import type { Dialect, Storage } from '@/core/types/storage'
import type { BrowserSessionRow, BrowserSessionStore } from '@/persistence/types'

const BROWSER_SESSION_COLUMNS = [
  'id',
  'secret_hash',
  'label',
  'created_at',
  'last_seen_at',
] as const

interface DbBrowserSessionRow {
  readonly id: string
  readonly secret_hash: string
  readonly label: string
  readonly created_at: number
  readonly last_seen_at: number
}

export function createBrowserSessionStore(db: Storage, dialect: Dialect): BrowserSessionStore {
  const sql = buildSql(dialect)

  return {
    insert: async (row, keep) => {
      await db.transaction(async (tx) => {
        await tx.execute(sql.dropIdle, [keep.idleCutoff])
        await tx.execute(sql.insert, toParams(row))
        await tx.execute(sql.keepNewest, [keep.limit])
      })
    },
    findBySecret: async (secretHash, idleCutoff) => {
      const rows = await db.query<DbBrowserSessionRow>(sql.bySecret, [secretHash, idleCutoff])
      const row = rows[0]

      return row === undefined ? undefined : toBrowserSessionRow(row)
    },
    has: async (id) => (await db.query(sql.byId, [id])).length > 0,
    touch: async (id, at) => {
      await db.execute(sql.touch, [at, id])
    },
    list: async (idleCutoff, limit) =>
      (await db.query<DbBrowserSessionRow>(sql.list, [idleCutoff, limit])).map(toBrowserSessionRow),
    // The table has no triggers or foreign keys, so `changes` counts only the rows deleted here.
    remove: async (id) => (await db.execute(sql.remove, [id])).changes > 0,
    removeAll: async () => (await db.execute(sql.removeAll)).changes,
  }
}

function toBrowserSessionRow(row: DbBrowserSessionRow): BrowserSessionRow {
  return {
    id: row.id,
    secretHash: row.secret_hash,
    label: row.label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

function toParams(row: BrowserSessionRow): readonly unknown[] {
  return [row.id, row.secretHash, row.label, row.createdAt, row.lastSeenAt]
}

function buildSql(d: Dialect) {
  const columns = BROWSER_SESSION_COLUMNS.join(', ')

  return {
    insert: `INSERT INTO browser_sessions (${columns}) VALUES (${d.paramList(BROWSER_SESSION_COLUMNS.length)})`,
    dropIdle: `DELETE FROM browser_sessions WHERE last_seen_at < ${d.param(1)}`,
    keepNewest:
      'DELETE FROM browser_sessions WHERE id NOT IN (SELECT id FROM browser_sessions ' +
      `ORDER BY last_seen_at DESC, id DESC LIMIT ${d.param(1)})`,
    bySecret:
      `SELECT ${columns} FROM browser_sessions ` +
      `WHERE secret_hash = ${d.param(1)} AND last_seen_at >= ${d.param(2)}`,
    byId: `SELECT id FROM browser_sessions WHERE id = ${d.param(1)}`,
    touch: `UPDATE browser_sessions SET last_seen_at = ${d.param(1)} WHERE id = ${d.param(2)}`,
    list:
      `SELECT ${columns} FROM browser_sessions WHERE last_seen_at >= ${d.param(1)} ` +
      `ORDER BY last_seen_at DESC, id DESC LIMIT ${d.param(2)}`,
    remove: `DELETE FROM browser_sessions WHERE id = ${d.param(1)}`,
    removeAll: 'DELETE FROM browser_sessions',
  }
}
