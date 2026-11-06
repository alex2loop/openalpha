export type SaveResult = 'inserted' | 'same' | 'conflict'

export interface StoredBrief {
  readonly day: string
  readonly schema: number
  readonly body: string
  readonly publishedAt: number
}

const INSERT_SQL =
  'INSERT INTO briefs (day, schema, body, published_at) VALUES (?1, ?2, ?3, ?4) ' +
  'ON CONFLICT (day) DO NOTHING'
const BODY_OF_DAY_SQL = 'SELECT body FROM briefs WHERE day = ?1'
const LATEST_BODY_SQL = 'SELECT body FROM briefs ORDER BY day DESC LIMIT 1'

/** A day is written once. Racing publishes of one day cannot both insert; the loser finds the
 *  winner's body and is answered by comparing it. */
export async function saveBrief(db: D1Database, brief: StoredBrief): Promise<SaveResult> {
  const insert = await db
    .prepare(INSERT_SQL)
    .bind(brief.day, brief.schema, brief.body, brief.publishedAt)
    .run()

  if (insert.meta.changes === 1) {
    return 'inserted'
  }

  const held = await db.prepare(BODY_OF_DAY_SQL).bind(brief.day).first<{ body: string }>()

  return held?.body === brief.body ? 'same' : 'conflict'
}

export async function findLatestBody(db: D1Database): Promise<string | undefined> {
  const latest = await db.prepare(LATEST_BODY_SQL).first<{ body: string }>()

  return latest?.body
}
