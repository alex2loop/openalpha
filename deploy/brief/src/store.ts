const INSERT_SQL =
  'INSERT INTO briefs (day, schema, body, published_at) VALUES (?1, ?2, ?3, ?4) ' +
  'ON CONFLICT (day) DO NOTHING'
const PRUNE_SQL = 'DELETE FROM briefs WHERE day < ?1'
const BODY_OF_DAY_SQL = 'SELECT body FROM briefs WHERE day = ?1'
const LATEST_BODY_SQL = 'SELECT body FROM briefs ORDER BY day DESC LIMIT 1'

export const MS_PER_DAY = 86_400_000
const RETENTION_DAYS = 30
const DAY_LENGTH = 10

export type SaveResult = 'inserted' | 'same' | 'conflict'

export interface StoredBrief {
  readonly day: string
  readonly schema: number
  readonly body: string
  readonly publishedAt: number
}

/** A day is written once, and a new day drops the days past the retention. Racing publishes of one day cannot both insert; the loser finds the
 *  winner's body and is answered by comparing it. */
export async function saveBrief(db: D1Database, brief: StoredBrief): Promise<SaveResult> {
  const insert = await db
    .prepare(INSERT_SQL)
    .bind(brief.day, brief.schema, brief.body, brief.publishedAt)
    .run()

  if (insert.meta.changes === 1) {
    await db.prepare(PRUNE_SQL).bind(oldestKeptDay(brief.publishedAt)).run()

    return 'inserted'
  }

  const held = await db.prepare(BODY_OF_DAY_SQL).bind(brief.day).first<{ body: string }>()

  return held?.body === brief.body ? 'same' : 'conflict'
}

// The first day a new insert still keeps; older rows go with it, so the table holds a month.
function oldestKeptDay(now: number): string {
  return new Date(now - RETENTION_DAYS * MS_PER_DAY).toISOString().slice(0, DAY_LENGTH)
}

export async function findLatestBody(db: D1Database): Promise<string | undefined> {
  const latest = await db.prepare(LATEST_BODY_SQL).first<{ body: string }>()

  return latest?.body
}
