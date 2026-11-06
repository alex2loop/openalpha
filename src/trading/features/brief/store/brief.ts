import { z } from 'zod'

import type { Locale } from '@/core/types/locale'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { LOCALES } from '@/core/types/locale'
import { briefSnapshotId } from '@/trading/features/brief/types'
import { tradingDay } from '@/trading/kernel/instrument'
import { BRIEF_RENDER_VERSION } from '@/trading/kernel/operator/brief-section'
import { briefSectionsSchema, toBriefSections } from '@/trading/kernel/store/brief-section-payload'
import { caveatsSchema, toMember } from '@/trading/kernel/store/store-payload'
import { parseJson } from '@/trading/kernel/store/store-row'

const INSERT_SQL =
  'INSERT INTO brief_snapshots (id, day, authored_locale, created_at, payload) ' + 'VALUES '

const payloadSchema = z.strictObject({
  renderVersion: z.number().optional(),
  profileRevision: z.string().optional(),
  sections: briefSectionsSchema,
  caveats: caveatsSchema,
  scorecardMonth: z.string().optional(),
})

interface BriefSnapshotRow {
  readonly id: string
  readonly day: string
  readonly authored_locale: string
  readonly created_at: number
  readonly payload: string
}

interface ExactBriefOptions {
  readonly asOf: TradingDay
  readonly authoredLocale: Locale
  readonly signal: AbortSignal
}

interface LatestBriefOptions {
  readonly authoredLocale: Locale
  readonly signal: AbortSignal
}

interface PreviousBriefOptions {
  readonly before: TradingDay
  readonly authoredLocale: Locale
  readonly signal: AbortSignal
}

export interface BriefStore {
  /** Whether a brief is stored for one day, whatever languages it was written in. */
  hasOnDay(day: TradingDay, signal: AbortSignal): Promise<boolean>
  upsertSnapshot(snapshot: BriefSnapshot, signal: AbortSignal): Promise<void>
  /** Serves idempotent build and delivery; `findLatest` serves user reads. */
  findExact(options: ExactBriefOptions): Promise<BriefSnapshot | null>
  findLatest(options: LatestBriefOptions): Promise<BriefSnapshot | null>
  /** The snapshot before a day, for the block that says what changed. Once today's snapshot is
   *  written `findLatest` returns today's, which is why this query exists beside it. */
  findPrevious(options: PreviousBriefOptions): Promise<BriefSnapshot | null>
}

export function createBriefStore(deps: StoreDeps): BriefStore {
  return {
    hasOnDay: (day, signal) => hasOnDay(deps, day, signal),
    upsertSnapshot: (snapshot, signal) => upsertSnapshot(deps, snapshot, signal),
    findExact: (options) => findExact(deps, options),
    findLatest: (options) => findLatest(deps, options),
    findPrevious: (options) => findPrevious(deps, options),
  }
}

/** A brief regenerated for a day already snapshotted overwrites that row rather than duplicating
 *  it: unlike market data, no stored suggestion cites a brief, so there is nothing to preserve. */
async function upsertSnapshot(
  deps: StoreDeps,
  snapshot: BriefSnapshot,
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  // The conflict target is the natural key, and the surviving row keeps its original id: a
  // regenerated brief replaces content, not identity.
  await deps.db.execute(
    `${INSERT_SQL}(${deps.dialect.paramList(5)}) ` +
      'ON CONFLICT (day, authored_locale) ' +
      'DO UPDATE SET created_at = excluded.created_at, payload = excluded.payload',
    [
      snapshot.id,
      snapshot.asOf,
      snapshot.authoredLocale,
      snapshot.createdAt,
      JSON.stringify({
        renderVersion: BRIEF_RENDER_VERSION,
        profileRevision: snapshot.profileRevision,
        sections: snapshot.sections,
        caveats: snapshot.caveats,
        ...(snapshot.scorecardMonth === undefined
          ? {}
          : { scorecardMonth: snapshot.scorecardMonth }),
      }),
    ]
  )
}

async function hasOnDay(deps: StoreDeps, day: TradingDay, signal: AbortSignal): Promise<boolean> {
  assertNotAborted(signal)

  const rows = await deps.db.query<{ readonly present: number }>(
    `SELECT 1 AS present FROM brief_snapshots WHERE day = ${deps.dialect.param(1)} LIMIT 1`,
    [day]
  )

  return rows.length > 0
}

async function findExact(
  deps: StoreDeps,
  options: ExactBriefOptions
): Promise<BriefSnapshot | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<BriefSnapshotRow>(
    `SELECT * FROM brief_snapshots WHERE day = ${p(1)} AND authored_locale = ${p(2)}`,
    [options.asOf, options.authoredLocale]
  )
  const row = rows[0]

  return row ? toBriefSnapshot(row) : null
}

async function findLatest(
  deps: StoreDeps,
  options: LatestBriefOptions
): Promise<BriefSnapshot | null> {
  assertNotAborted(options.signal)

  const rows = await deps.db.query<BriefSnapshotRow>(
    `SELECT * FROM brief_snapshots WHERE authored_locale = ${deps.dialect.param(1)} ` +
      'ORDER BY day DESC LIMIT 1',
    [options.authoredLocale]
  )
  const row = rows[0]

  return row ? toBriefSnapshot(row) : null
}

/** Day-ordered like `findLatest`, but strictly before the day being built: once today's snapshot
 *  is written, latest-first would return today's. A row this build no longer speaks comes back
 *  as `null` through the same version gate the other readers share. */
async function findPrevious(
  deps: StoreDeps,
  options: PreviousBriefOptions
): Promise<BriefSnapshot | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<BriefSnapshotRow>(
    `SELECT * FROM brief_snapshots WHERE day < ${p(1)} AND authored_locale = ${p(2)} ` +
      'ORDER BY day DESC LIMIT 1',
    [options.before, options.authoredLocale]
  )
  const row = rows[0]

  return row ? toBriefSnapshot(row) : null
}

/** Null for a snapshot this build cannot answer with: one written against a different render
 *  vocabulary, whose titles may take params the payload never stored and reach a reader as the
 *  literal `{sessions}`, or one written before the profile behind it was recorded, which no reuse
 *  gate can then hold against today's. Absent rather than invalid, so the caller rebuilds the way
 *  it does for one that fails to parse. */
function toBriefSnapshot(row: BriefSnapshotRow): BriefSnapshot | null {
  const payload = parseJson(row.payload, 'brief snapshot', (value) => payloadSchema.parse(value))

  if (payload.renderVersion !== BRIEF_RENDER_VERSION || payload.profileRevision === undefined) {
    return null
  }

  return {
    id: briefSnapshotId(row.id),
    asOf: tradingDay(row.day),
    authoredLocale: toMember(row.authored_locale, LOCALES, 'brief locale'),
    profileRevision: payload.profileRevision,
    sections: toBriefSections(payload.sections),
    caveats: payload.caveats,
    ...(payload.scorecardMonth === undefined ? {} : { scorecardMonth: payload.scorecardMonth }),
    createdAt: row.created_at,
  }
}
