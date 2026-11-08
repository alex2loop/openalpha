const HELD_SQL = 'UPDATE subscriptions SET failures = 0 WHERE endpoint = ?1'
const INSERT_SQL =
  'INSERT INTO subscriptions (endpoint, created_at) SELECT ?1, ?2 ' +
  'WHERE (SELECT COUNT(*) FROM subscriptions) < ?3 ON CONFLICT (endpoint) DO NOTHING'
const DELETE_SQL = 'DELETE FROM subscriptions WHERE endpoint = ?1'
const COUNT_SQL = 'SELECT COUNT(*) AS total FROM subscriptions'
const LIST_SQL = 'SELECT endpoint FROM subscriptions ORDER BY created_at LIMIT ?1'
const ADD_FAILURE_SQL = 'UPDATE subscriptions SET failures = failures + 1 WHERE endpoint = ?1'
const DROP_FAILED_SQL = 'DELETE FROM subscriptions WHERE failures >= ?1'

// Bounded by the free plan's 50 fetch and cache calls per invocation: 45 sends and one cache purge.
export const SUBSCRIPTION_CAP = 45
export const MAX_SUBSCRIBE_BYTES = 1_024
const PUSH_FAILURES_TO_DROP = 3
const PUSH_HOSTS: readonly string[] = ['fcm.googleapis.com', 'updates.push.services.mozilla.com']
const PUSH_HOST_SUFFIXES: readonly string[] = ['.push.apple.com', '.notify.windows.com']
// What each outcome does to its row. A refused push is our key being turned away, not the phone's
// fault, so it counts for nothing.
const SQL_BY_OUTCOME = {
  sent: HELD_SQL,
  gone: DELETE_SQL,
  failed: ADD_FAILURE_SQL,
  refused: undefined,
}

export type SendOutcome = keyof typeof SQL_BY_OUTCOME

export interface SendResult {
  readonly endpoint: string
  readonly outcome: SendOutcome
}

/** The push address of a subscribe body, normalised, or undefined when it is not one: an `https:`
 *  address on a known push service's host, so the Worker never posts to a host a caller picked. */
export function toPushEndpoint(value: unknown): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('endpoint' in value) ||
    typeof value.endpoint !== 'string'
  ) {
    return undefined
  }

  const url = parseUrl(value.endpoint)

  return url?.protocol === 'https:' && isPushHost(url.hostname) ? url.href : undefined
}

function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text)
  } catch {
    // Not an address is a 400 for the caller to read, not a failure of the Worker.
    return undefined
  }
}

function isPushHost(host: string): boolean {
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

/** A held address is saved at any count, and its failures start over. A new one is saved only while
 *  the table is under the cap: D1 runs writes one at a time, so racing posts cannot pass it. */
export async function saveSubscription(
  db: D1Database,
  endpoint: string,
  now: number
): Promise<'saved' | 'full'> {
  if (await resetFailures(db, endpoint)) {
    return 'saved'
  }

  const insert = await db.prepare(INSERT_SQL).bind(endpoint, now, SUBSCRIPTION_CAP).run()

  if (insert.meta.changes === 1) {
    return 'saved'
  }

  // No row added: the cap, or a racing post of this same address that landed first.
  return (await resetFailures(db, endpoint)) ? 'saved' : 'full'
}

async function resetFailures(db: D1Database, endpoint: string): Promise<boolean> {
  const held = await db.prepare(HELD_SQL).bind(endpoint).run()

  return held.meta.changes === 1
}

export async function deleteSubscription(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare(DELETE_SQL).bind(endpoint).run()
}

export async function countSubscriptions(db: D1Database): Promise<number> {
  const count = await db.prepare(COUNT_SQL).first<{ total: number }>()

  return count?.total ?? 0
}

/** The oldest subscriptions first, never more than the cap. */
export async function listSubscriptions(db: D1Database): Promise<readonly string[]> {
  const listed = await db.prepare(LIST_SQL).bind(SUBSCRIPTION_CAP).all<{ endpoint: string }>()

  return listed.results.map((row) => row.endpoint)
}

/** One batch for a day's sends: a sent push clears the count, a gone address is deleted, a failed
 *  one adds a failure and the rows that reach the limit are dropped. Every send failing is a push
 *  service or network outage, not dead phones, so it records nothing. */
export async function recordSends(db: D1Database, results: readonly SendResult[]): Promise<void> {
  if (results.every((result) => result.outcome === 'failed')) {
    return
  }

  const statements = results.flatMap((result) => toStatements(db, result))

  if (results.some((result) => result.outcome === 'failed')) {
    statements.push(db.prepare(DROP_FAILED_SQL).bind(PUSH_FAILURES_TO_DROP))
  }

  if (statements.length > 0) {
    await db.batch(statements)
  }
}

function toStatements(db: D1Database, result: SendResult): D1PreparedStatement[] {
  const sql = SQL_BY_OUTCOME[result.outcome]

  return sql === undefined ? [] : [db.prepare(sql).bind(result.endpoint)]
}
