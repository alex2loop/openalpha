import { z } from 'zod'

import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  MarketRefreshAttempt,
  RefreshDataKind,
  RefreshKindResult,
} from '@/trading/kernel/market/refresh'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, ValidationError } from '@/core/errors'
import { marketRef, tradingDay } from '@/trading/kernel/instrument'
import { REFRESH_DATA_KINDS, REFRESH_KIND_STATUSES } from '@/trading/kernel/market/refresh'
import { caveatsSchema, toMember } from '@/trading/kernel/store/store-payload'
import { parseJson } from '@/trading/kernel/store/store-row'

const ATTEMPT_KEYS = ['market', 'kind']
const ATTEMPT_COLS = ['as_of', 'attempted_at', 'payload']
/** `fresh` is a policy skip, never an attempt: persisting it would let a skipped kind suppress the
 *  next boot's repair of work no provider performed. */
const SETTLED_STATUSES = REFRESH_KIND_STATUSES.filter((status) => status !== 'fresh')

const outcomeSchema = z.strictObject({
  status: z.enum(SETTLED_STATUSES),
  targetCount: z.number().int().nonnegative(),
  successfulTargetCount: z.number().int().nonnegative(),
  missingTargets: z.array(z.string()).default([]),
  recordCount: z.number().int().nonnegative(),
  coveredFrom: z.string().min(1).optional(),
  caveats: caveatsSchema,
})

interface AttemptRow {
  readonly market: string
  readonly kind: string
  readonly as_of: string
  readonly attempted_at: number
  readonly payload: string
}

export interface ListRefreshAttemptsOptions {
  readonly market: MarketRef
  readonly signal: AbortSignal
}

/** Only the kinds the code still declares are read: an attempt is addressed by kind everywhere it
 *  is consumed, so a row left behind by a removed kind can gate nothing, and reading it would fail
 *  the whole market's refresh over a row nothing can act on. */
export async function listRefreshAttempts(
  deps: StoreDeps,
  options: ListRefreshAttemptsOptions
): Promise<readonly MarketRefreshAttempt[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const kinds = REFRESH_DATA_KINDS.map((_, index) => p(index + 2)).join(', ')
  const rows = await deps.db.query<AttemptRow>(
    `SELECT * FROM market_refresh_attempts WHERE market = ${p(1)} AND kind IN (${kinds}) ORDER BY kind`,
    [options.market, ...REFRESH_DATA_KINDS]
  )

  return rows.map(toAttempt)
}

export async function upsertRefreshAttempt(
  deps: StoreDeps,
  attempt: MarketRefreshAttempt,
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  const sql = deps.dialect.upsert('market_refresh_attempts', {
    keys: ATTEMPT_KEYS,
    cols: ATTEMPT_COLS,
    rowCount: 1,
  })

  await deps.db.execute(sql, [
    attempt.market,
    attempt.result.kind,
    attempt.asOf,
    attempt.attemptedAt,
    JSON.stringify(toOutcome(attempt.result)),
  ])
}

function toOutcome(result: RefreshKindResult): z.infer<typeof outcomeSchema> {
  const parsed = outcomeSchema.safeParse({
    status: result.status,
    targetCount: result.targetCount,
    successfulTargetCount: result.successfulTargetCount,
    missingTargets: result.missingTargets,
    recordCount: result.recordCount,
    coveredFrom: result.coveredFrom,
    caveats: result.caveats,
  })

  if (!parsed.success) {
    throw new ValidationError(
      `refresh result for ${result.kind} is not a settled attempt`,
      undefined,
      parsed.error
    )
  }

  return parsed.data
}

function toAttempt(row: AttemptRow): MarketRefreshAttempt {
  const outcome = parseJson(row.payload, 'refresh attempt', (value) => outcomeSchema.parse(value))

  return {
    market: marketRef(row.market),
    asOf: tradingDay(row.as_of),
    attemptedAt: row.attempted_at,
    result: {
      kind: toMember<RefreshDataKind>(row.kind, REFRESH_DATA_KINDS, 'refresh data kind'),
      status: outcome.status,
      targetCount: outcome.targetCount,
      successfulTargetCount: outcome.successfulTargetCount,
      missingTargets: outcome.missingTargets,
      recordCount: outcome.recordCount,
      ...(outcome.coveredFrom === undefined
        ? {}
        : { coveredFrom: tradingDay(outcome.coveredFrom) }),
      provenance: [],
      caveats: outcome.caveats,
    },
  }
}
