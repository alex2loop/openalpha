import type { Dialect, Storage } from '@/core/types/storage'
import type { NoticeRow, NoticeStore } from '@/persistence/types'
import { SQL_MAX_BIND_PARAMS } from '@/persistence/sql/syntax'

const DELIVERED_SEPARATOR = ','

const NOTICE_COLUMNS = [
  'id',
  'kind',
  'weight',
  'wake',
  'run_id',
  'delivered_to',
  'event',
  'created_at',
  'read_at',
] as const

interface DbNoticeRow {
  readonly id: string
  readonly kind: string
  readonly weight: string
  readonly wake: number
  readonly run_id: string | null
  readonly delivered_to: string
  readonly event: string
  readonly created_at: number
  readonly read_at: number | null
}

export function createNoticeLogStore(db: Storage, dialect: Dialect): NoticeStore {
  const sql = buildSql(dialect)

  return {
    record: async (row) => {
      await db.execute(sql.insert, toParams(row))
    },
    list: async (beforeMs, limit) =>
      (beforeMs === undefined
        ? await db.query<DbNoticeRow>(sql.latest, [limit])
        : await db.query<DbNoticeRow>(sql.before, [beforeMs, limit])
      ).map(toNoticeRow),
    listOfKind: async (kind, range, limit) =>
      (await db.query<DbNoticeRow>(sql.ofKind, [kind, range.fromMs, range.toMs, limit])).map(
        toNoticeRow
      ),
    unreadCount: async () => (await db.query<{ readonly n: number }>(sql.unread))[0]?.n ?? 0,
    unreadCountOfKind: async (kind) =>
      (await db.query<{ readonly n: number }>(sql.unreadOfKind, [kind]))[0]?.n ?? 0,
    markRead: async (ids, at) => {
      if (ids === undefined) {
        await db.execute(sql.markAll, [at])

        return
      }

      // One bind is the read time, so a chunk holds one fewer id than the ceiling.
      for (let from = 0; from < ids.length; from += SQL_MAX_BIND_PARAMS - 1) {
        const chunk = ids.slice(from, from + SQL_MAX_BIND_PARAMS - 1)

        await db.execute(buildMarkSql(dialect, chunk.length), [at, ...chunk])
      }
    },
  }
}

function toNoticeRow(row: DbNoticeRow): NoticeRow {
  return {
    id: row.id,
    kind: row.kind,
    weight: row.weight,
    wake: row.wake !== 0,
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    deliveredTo: row.delivered_to === '' ? [] : row.delivered_to.split(DELIVERED_SEPARATOR),
    event: row.event,
    createdAt: row.created_at,
    ...(row.read_at === null ? {} : { readAt: row.read_at }),
  }
}

function toParams(row: NoticeRow): readonly unknown[] {
  return [
    row.id,
    row.kind,
    row.weight,
    row.wake ? 1 : 0,
    row.runId ?? null,
    row.deliveredTo.join(DELIVERED_SEPARATOR),
    row.event,
    row.createdAt,
    row.readAt ?? null,
  ]
}

function buildSql(d: Dialect) {
  const columns = NOTICE_COLUMNS.join(', ')

  return {
    insert:
      `INSERT INTO notices (${columns}) VALUES (${d.paramList(NOTICE_COLUMNS.length)}) ` +
      `ON CONFLICT (id) DO NOTHING`,
    latest: `SELECT ${columns} FROM notices ORDER BY created_at DESC, id DESC LIMIT ${d.param(1)}`,
    before:
      `SELECT ${columns} FROM notices WHERE created_at < ${d.param(1)} ` +
      `ORDER BY created_at DESC, id DESC LIMIT ${d.param(2)}`,
    ofKind:
      `SELECT ${columns} FROM notices WHERE kind = ${d.param(1)} ` +
      `AND created_at >= ${d.param(2)} AND created_at < ${d.param(3)} ` +
      `ORDER BY created_at DESC, id DESC LIMIT ${d.param(4)}`,
    unread: 'SELECT COUNT(*) AS n FROM notices WHERE read_at IS NULL',
    unreadOfKind: `SELECT COUNT(*) AS n FROM notices WHERE read_at IS NULL AND kind = ${d.param(1)}`,
    markAll: `UPDATE notices SET read_at = ${d.param(1)} WHERE read_at IS NULL`,
  }
}

function buildMarkSql(d: Dialect, count: number): string {
  return (
    `UPDATE notices SET read_at = ${d.param(1)} ` +
    `WHERE read_at IS NULL AND id IN (${d.paramList(count, 2)})`
  )
}
