import type {
  SuggestionBatchItem,
  SuggestionBatchOptions,
  SuggestionBatchResult,
} from '@/trading/features/suggestion/batch-types'
import type {
  OpenRisk,
  SuggestionPortfolioContext,
  SuggestionPortfolioReader,
  SuggestionRunDeps,
} from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionRequest, SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { DebateMode } from '@/trading/kernel/config'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import { isAbortError, StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { createBudgetSlicesWithin } from '@/engine/api'
import { AGENT_BUDGET_FRACTION } from '@/trading/features/suggestion/debate/debate'
import { breachedCaps } from '@/trading/features/suggestion/pipeline/exposure'
import { openRiskOf } from '@/trading/features/suggestion/pipeline/open-risk'
import { overcommittedBook } from '@/trading/features/suggestion/pipeline/overcommit'
import { runSuggestion } from '@/trading/features/suggestion/pipeline/suggestion'
import { DEBATE_MODE_ROLES } from '@/trading/kernel/config'
import { isBookFocus } from '@/trading/kernel/operator/focus'

export interface SuggestionBatchInput {
  /** Everything the run needs but the policy: that one is the options', resolved per batch. */
  readonly deps: Omit<SuggestionRunDeps, 'policy'>
  readonly options: SuggestionBatchOptions
}

/** One `now` for the whole logical batch: every item's `createdAt` and every omitted-day input use
 *  the same instant, because reading the clock per item produces rows that disagree about what day
 *  it is. The parent budget is sliced exactly once, before any concurrent work starts, and no item
 *  ever reads `remainingUsd()` during the concurrent phase. */
export async function runSuggestionBatch(
  input: SuggestionBatchInput
): Promise<SuggestionBatchResult> {
  const { options } = input
  const roleCount = DEBATE_MODE_ROLES[ceilingDebateMode(options)].length
  const roleBudgets = createBudgetSlicesWithin(
    options.budget,
    options.budget.remainingUsd() * AGENT_BUDGET_FRACTION,
    options.items.length * roleCount
  )
  const deps: SuggestionRunDeps = {
    ...input.deps,
    policy: options.policy,
    portfolio: sharedReader(input.deps.portfolio, options.segments),
  }
  const results = await mapWithConcurrency(
    options.items,
    options.policy.batchConcurrency,
    (item, index) =>
      runSuggestion({
        deps,
        request: requestFor(item, options),
        roleBudgets: roleBudgets.slice(index * roleCount, (index + 1) * roleCount),
      }).catch((err: unknown) => errorResult(deps, item, err))
  )
  options.budget.charge(decisionSpend(results))

  return { results, ...(await batchExposure(deps, options, results)) }
}

/** The facts about the set that no row carries: the segments its buys cross together, and the cash
 *  and open-risk room they spend past. Advisory both ways. A second opinion is never an order
 *  against the book, so it has neither. */
async function batchExposure(
  deps: SuggestionRunDeps,
  options: SuggestionBatchOptions,
  results: readonly SuggestionRunResult[]
): Promise<Pick<SuggestionBatchResult, 'breaches' | 'overcommit'>> {
  if (!isBookFocus(options.focus)) {
    return { breaches: [], overcommit: [] }
  }

  const readContext = (): Promise<SuggestionPortfolioContext> =>
    deps.portfolio.read({ now: options.now, signal: options.signal, segments: options.segments })
  const breaches = await breachedCaps({ results, markets: deps.markets, readContext })
  const overcommit = await overcommittedBook({
    results,
    markets: deps.markets,
    readContext,
    readOpenRisk: (context) => readOpenRisk(deps, options.signal, context),
  })

  return { breaches, overcommit }
}

/** The ceilings the batch is weighed against are advisory, so an outage reading the plans of the
 *  held names costs that one finding and never the verdicts the items already produced. */
async function readOpenRisk(
  deps: SuggestionRunDeps,
  signal: AbortSignal,
  context: SuggestionPortfolioContext
): Promise<OpenRisk | undefined> {
  try {
    return await openRiskOf({ store: deps.store, signal }, context)
  } catch (err: unknown) {
    if (!(err instanceof StorageError)) {
      throw err
    }

    deps.logger.warn('trading.batch_open_risk_unread', { err: formatErrForLog(err) })

    return undefined
  }
}

/** A persist outage (or any other post-guard throw) is that item's own result, never a synthesized
 *  hold and never the whole batch's failure: the other items' completed work must survive. An abort
 *  is not an item failure — cancellation propagates out of the batch untouched. */
/** The decision provider bills outside the run budget, so the parent is charged once the
 *  concurrent phase is over. A reused row was served from storage and a shared one
 *  was paid for by the caller that started its run; neither spent anything here. */
function decisionSpend(results: readonly SuggestionRunResult[]): number {
  let total = 0

  for (const result of results) {
    if (result.kind === 'completed' && !result.reused && result.shared !== true) {
      total += result.suggestion.headlinesRead?.costUsd ?? 0
    }
  }

  return total
}

function errorResult(
  deps: SuggestionRunDeps,
  item: SuggestionBatchItem,
  err: unknown
): SuggestionRunResult {
  if (isAbortError(err)) {
    throw err
  }

  deps.logger.warn('trading.suggestion_item_failed', {
    ticker: item.ticker,
    err: formatErrForLog(err),
  })

  return {
    kind: 'error',
    ticker: item.ticker,
    ...(item.market === undefined ? {} : { market: item.market }),
    message: err instanceof Error ? err.message : String(err),
  }
}

/** One portfolio read per batch, shared across it. The reuse and cooldown
 *  gates run before `runSuggestion` asks for a context at all, so a batch over a fifty-name
 *  watchlist where forty-five are already suggested today performs the reads the remaining five
 *  need — not fifty. The map lives for one batch call, so it is bounded by the batch. Every item
 *  asks for its own segment; the one read is scoped to the batch's, which covers each of them. */
function sharedReader(
  reader: SuggestionPortfolioReader,
  segments: readonly PortfolioSegment[]
): SuggestionPortfolioReader {
  const inFlight = new Map<string, Promise<SuggestionPortfolioContext>>()

  return {
    read(options) {
      const key = String(options.now)
      const existing = inFlight.get(key)

      if (existing !== undefined) {
        return existing
      }

      const pending = reader.read({ ...options, segments })

      inFlight.set(key, pending)

      return pending
    },

    bookChangeSince: (instrument, from, signal) => reader.bookChangeSince(instrument, from, signal),
  }
}

/** The deepest debate any item in the batch can run, which is what the slices must cover. A run
 *  that ends up shallower leaves its slices unspent; one that needs more than was cut has none. */
function ceilingDebateMode(options: SuggestionBatchOptions): DebateMode {
  const forced = options.items.some((item) => item.force === true)

  return options.debateMode ?? (forced ? 'full' : options.policy.debateMode)
}

function requestFor(item: SuggestionBatchItem, options: SuggestionBatchOptions): SuggestionRequest {
  return {
    locale: item.locale,
    ticker: item.ticker,
    channel: options.channel,
    billingSessionId: options.billingSessionId,
    focus: options.focus,
    now: options.now,
    signal: options.signal,
    ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
    ...(options.billingAgentId === undefined ? {} : { billingAgentId: options.billingAgentId }),
    ...(item.market === undefined ? {} : { market: item.market }),
    ...(item.force === undefined ? {} : { force: item.force }),
    ...(options.debateMode === undefined ? {} : { debateMode: options.debateMode }),
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  }
}
