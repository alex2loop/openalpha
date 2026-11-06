import type {
  BuiltPublicBriefRow,
  PublicBriefRow,
  PublicBriefStore,
} from '@/trading/features/brief/public/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, StorageError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { briefSectionsSchema, toBriefSections } from '@/trading/kernel/store/brief-section-payload'
import { parseJson } from '@/trading/kernel/store/store-row'
import { shiftCalendarDay } from '@/trading/markets/calendar'

export const PUBLIC_BRIEF_SCHEMA = 1

/** Days kept in the table; the public side keeps the history. */
const PUBLIC_BRIEF_KEEP_DAYS = 30
/** Attempts a day is allowed. A closed day is counted as having used them all. */
const PUBLIC_BRIEF_MAX_ATTEMPTS = 4

interface PublicBriefDbRow {
  readonly day: string
  readonly schema_version: number
  readonly sections: string | null
  readonly built_at: number | null
  readonly published_at: number | null
  readonly attempts: number
  readonly last_attempt_at: number | null
}

export function createPublicBriefStore(deps: StoreDeps): PublicBriefStore {
  return {
    find: (day, signal) => find(deps, day, signal),
    findPrevious: (before, signal) => findPrevious(deps, before, signal),
    saveBuilt: (built, signal) => saveBuilt(deps, built, signal),
    recordAttempt: (attempt, signal) => recordAttempt(deps, attempt, signal),
  }
}

async function find(
  deps: StoreDeps,
  day: TradingDay,
  signal: AbortSignal
): Promise<PublicBriefRow | null> {
  assertNotAborted(signal)

  const rows = await deps.db.query<PublicBriefDbRow>(
    `SELECT * FROM public_briefs WHERE day = ${deps.dialect.param(1)}`,
    [day]
  )
  const [row] = rows

  return row === undefined ? null : toRow(row)
}

async function findPrevious(
  deps: StoreDeps,
  before: TradingDay,
  signal: AbortSignal
): Promise<BuiltPublicBriefRow | null> {
  assertNotAborted(signal)

  const rows = await deps.db.query<PublicBriefDbRow>(
    'SELECT * FROM public_briefs ' +
      `WHERE day < ${deps.dialect.param(1)} AND sections IS NOT NULL ORDER BY day DESC LIMIT 1`,
    [before]
  )
  const [row] = rows
  const previous = row === undefined ? null : toRow(row)

  return previous === null || !isBuilt(previous) ? null : previous
}

/** Only the build's own columns change: a day rebuilt after a failed post keeps its attempts. */
async function saveBuilt(
  deps: StoreDeps,
  built: Pick<BuiltPublicBriefRow, 'day' | 'sections' | 'builtAt'>,
  signal: AbortSignal
): Promise<BuiltPublicBriefRow> {
  assertNotAborted(signal)

  const p = deps.dialect.param

  await deps.db.transaction(async (tx) => {
    await tx.execute(
      'INSERT INTO public_briefs (day, schema_version, sections, built_at, attempts) ' +
        `VALUES (${deps.dialect.paramList(4)}, 0) ` +
        'ON CONFLICT (day) DO UPDATE SET schema_version = excluded.schema_version, ' +
        'sections = excluded.sections, built_at = excluded.built_at',
      [built.day, PUBLIC_BRIEF_SCHEMA, JSON.stringify(built.sections), built.builtAt]
    )
    await tx.execute(`DELETE FROM public_briefs WHERE day < ${p(1)}`, [
      shiftCalendarDay(built.day, -PUBLIC_BRIEF_KEEP_DAYS),
    ])
  })

  const saved = await find(deps, built.day, signal)

  if (saved === null || !isBuilt(saved)) {
    throw new StorageError('public brief row missing after its build was saved')
  }

  return saved
}

async function recordAttempt(
  deps: StoreDeps,
  attempt: Parameters<PublicBriefStore['recordAttempt']>[0],
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  const closed = attempt.closed === true
  const attempts = closed ? PUBLIC_BRIEF_MAX_ATTEMPTS : 1

  await deps.db.execute(
    'INSERT INTO public_briefs (day, schema_version, attempts, last_attempt_at, published_at) ' +
      `VALUES (${deps.dialect.paramList(5)}) ` +
      'ON CONFLICT (day) DO UPDATE SET ' +
      `attempts = ${closed ? 'excluded.attempts' : 'public_briefs.attempts + 1'}, ` +
      'last_attempt_at = excluded.last_attempt_at, ' +
      'published_at = COALESCE(excluded.published_at, public_briefs.published_at)',
    [attempt.day, PUBLIC_BRIEF_SCHEMA, attempts, attempt.at, attempt.publishedAt ?? null]
  )
}

function isBuilt(row: PublicBriefRow): row is BuiltPublicBriefRow {
  return row.sections !== undefined && row.builtAt !== undefined
}

function toRow(row: PublicBriefDbRow): PublicBriefRow {
  const sections = readSections(row)

  return {
    day: tradingDay(row.day),
    ...(sections === undefined || row.built_at === null ? {} : { sections, builtAt: row.built_at }),
    ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
    attempts: row.attempts,
    ...(row.last_attempt_at === null ? {} : { lastAttemptAt: row.last_attempt_at }),
  }
}

/** A row written under another schema, or one that no longer parses, reads as unbuilt: the day is
 *  rebuilt rather than served from a vocabulary this build cannot name. */
function readSections(row: PublicBriefDbRow): readonly BriefSectionResult[] | undefined {
  if (row.sections === null || row.schema_version !== PUBLIC_BRIEF_SCHEMA) {
    return undefined
  }

  try {
    return toBriefSections(
      parseJson(row.sections, 'public brief', (value) => briefSectionsSchema.parse(value))
    )
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      return undefined
    }

    throw err
  }
}
