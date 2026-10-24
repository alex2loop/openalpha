import { z } from 'zod'

import type { Locale } from '@/core/types/locale'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { LOCALES } from '@/core/types/locale'
import { briefSnapshotId } from '@/trading/features/brief/types'
import { currencyCode, marketRef, tradingDay } from '@/trading/kernel/instrument'
import {
  BRIEF_FIELDS,
  BRIEF_RENDER_VERSION,
  BRIEF_SECTION_ORDER,
} from '@/trading/kernel/operator/brief-section'
import {
  caveatsSchema,
  provenanceSchema,
  toMember,
  toProvenance,
} from '@/trading/kernel/store/store-payload'
import { parseJson } from '@/trading/kernel/store/store-row'

const INSERT_SQL =
  'INSERT INTO brief_snapshots (id, day, authored_locale, created_at, payload) ' + 'VALUES '

const readySectionSchema = z.strictObject({
  kind: z.enum(BRIEF_SECTION_ORDER),
  status: z.literal('ready'),
  market: z.string().optional(),
  icon: z.string().optional(),
  asOf: z.string().optional(),
  // `partialRecord`, not `record`: a row carries whichever fields its section fills, and Zod v4's
  // `record` with an enum key requires every one of them. The enum is the point — a row naming a
  // field this build no longer has is a snapshot from an older vocabulary, and rejecting it here is
  // what sends the service back to rebuild instead of rendering a field the catalog cannot name.
  rows: z.array(z.partialRecord(z.enum(BRIEF_FIELDS), z.union([z.string(), z.number()]))),
  currency: z.string().optional(),
  titleParams: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  provenance: z.array(provenanceSchema),
  caveats: caveatsSchema,
})

const absentSectionSchema = z.strictObject({
  kind: z.enum(BRIEF_SECTION_ORDER),
  status: z.enum(['unavailable', 'omitted-by-policy']),
  market: z.string().optional(),
  icon: z.string().optional(),
  asOf: z.string().optional(),
  caveats: caveatsSchema,
})

// Section order is the stored order: the composer decides it once and a reader never re-sorts.
const payloadSchema = z.strictObject({
  renderVersion: z.number().optional(),
  profileRevision: z.string().optional(),
  sections: z.array(z.union([readySectionSchema, absentSectionSchema])),
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
  /** The snapshots stored for one day, whatever language each was written in. */
  countOnDay(day: TradingDay, signal: AbortSignal): Promise<number>
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
    countOnDay: (day, signal) => countOnDay(deps, day, signal),
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

async function countOnDay(deps: StoreDeps, day: TradingDay, signal: AbortSignal): Promise<number> {
  assertNotAborted(signal)

  const rows = await deps.db.query<{ readonly count: number }>(
    `SELECT COUNT(*) AS count FROM brief_snapshots WHERE day = ${deps.dialect.param(1)}`,
    [day]
  )

  // Postgres returns COUNT as a bigint, which arrives as a string.
  return Number(rows[0]?.count ?? 0)
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
    sections: payload.sections.map(toSection),
    caveats: payload.caveats,
    ...(payload.scorecardMonth === undefined ? {} : { scorecardMonth: payload.scorecardMonth }),
    createdAt: row.created_at,
  }
}

function toSection(raw: z.infer<typeof payloadSchema>['sections'][number]): BriefSectionResult {
  if (raw.status === 'ready') {
    return {
      kind: raw.kind,
      status: raw.status,
      ...(raw.market === undefined ? {} : { market: marketRef(raw.market) }),
      ...(raw.icon === undefined ? {} : { icon: raw.icon }),
      ...(raw.asOf === undefined ? {} : { asOf: tradingDay(raw.asOf) }),
      rows: raw.rows,
      ...(raw.currency === undefined ? {} : { currency: currencyCode(raw.currency) }),
      ...(raw.titleParams === undefined ? {} : { titleParams: raw.titleParams }),
      provenance: raw.provenance.map(toProvenance),
      caveats: raw.caveats,
    }
  }

  return {
    kind: raw.kind,
    status: raw.status,
    ...(raw.market === undefined ? {} : { market: marketRef(raw.market) }),
    ...(raw.icon === undefined ? {} : { icon: raw.icon }),
    ...(raw.asOf === undefined ? {} : { asOf: tradingDay(raw.asOf) }),
    caveats: raw.caveats,
  }
}
