import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { AgentFocusStore } from '@/trading/features/suggestion/store/agent-focus'
import type {
  ActionableStoredSuggestion,
  SuggestionOutcome,
} from '@/trading/features/suggestion/types'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { CallScoredPayload, TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { Market } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY } from '@/core/utils/time'
import { formatDay, t } from '@/i18n'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'
import { isBookCall } from '@/trading/kernel/operator/focus'
import { formatSignedFraction, renderDeclaredValue } from '@/trading/render/format'

/** The first pass after this ships scores calls that waited a long time; a call whose window ended
 *  longer ago than this is history, and would otherwise flood the bell. */
const CALL_SCORED_MAX_AGE_MS = 2 * MS_PER_DAY

/** Where a scored call is told: the daemon's sender, the chat it would use, and the language; a
 *  focus call goes to the agents' page feed instead. */
export interface CallScoredNotices {
  readonly sender: TradingNoticeSender
  recipient(): DeliveryAddress | undefined
  readonly locale: Locale
  /** Called synchronously with the agents that have called under the focus, for the operator's
   *  own page only: never a chat, never the bell. */
  onFocusScored(scored: {
    readonly agentIds: readonly string[]
    readonly locale: Locale
    readonly payload: CallScoredPayload
  }): void
}

interface ScoredCall {
  readonly suggestion: ActionableStoredSuggestion
  readonly market: Market
  readonly outcome: SuggestionOutcome
}

interface ScoredNoticeDeps extends CallScoredNotices {
  readonly logger: Logger
  readonly agentFocuses: Pick<AgentFocusStore, 'agentsOf'>
}

/** Tells a call was just scored, once: the caller asks only when the store took the result, so a
 *  retried tick never repeats it. The operator's own call is told as a notice; a refusal is logged
 *  and not retried. A focus call is a second opinion scored apart from their record, so it goes
 *  only to the page feed of each agent that called under that focus: a daily agent would otherwise
 *  fill the bell and the chats with lines nobody asked for. */
export async function notifyCallScored(
  deps: ScoredNoticeDeps,
  scored: ScoredCall,
  at: { readonly now: number; readonly signal: AbortSignal }
): Promise<void> {
  const { suggestion, market, outcome } = scored
  const windowEndedAt = market.manifest.calendar.sessionCloseAt(outcome.exitDay)

  if (at.now - windowEndedAt > CALL_SCORED_MAX_AGE_MS) {
    return
  }

  const payload = toPayload(scored)

  if (!isBookCall(suggestion)) {
    await showFocusCall(deps, { focusKey: suggestion.focusKey, payload }, at.signal)

    return
  }

  const target = deps.recipient()

  if (target === undefined) {
    return
  }

  const sent = await sendCaught(deps.sender, { target, locale: deps.locale, payload }, at.signal)

  if (sent !== 'accepted') {
    deps.logger.warn('trading.call_scored_undelivered', { id: suggestion.id, outcome: sent })
  }
}

// The score is already stored, so a failed read of who called it costs only the page line.
async function showFocusCall(
  deps: ScoredNoticeDeps,
  call: { readonly focusKey: FocusKey; readonly payload: CallScoredPayload },
  signal: AbortSignal
): Promise<void> {
  const { payload } = call

  try {
    const agentIds = await deps.agentFocuses.agentsOf(call.focusKey, signal)

    if (agentIds.length > 0) {
      deps.onFocusScored({ agentIds, locale: deps.locale, payload })
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.call_scored_unshown', {
      id: payload.suggestionId,
      err: formatErrForLog(err),
    })
  }
}

function toPayload({ suggestion, market, outcome }: ScoredCall): CallScoredPayload {
  const { benchmark } = market.manifest

  return {
    kind: 'call-scored',
    suggestionId: suggestion.id,
    instrument: suggestion.instrument,
    action: suggestion.action,
    status: outcome.status,
    returnPct: outcome.returnPct,
    ...(benchmark === undefined || outcome.benchmarkReturnPct === undefined
      ? {}
      : { benchmark: { instrument: benchmark, returnPct: outcome.benchmarkReturnPct } }),
    focusKey: suggestion.focusKey,
    day: suggestion.at,
  }
}

/** The verdict on one scored call, and how the market's own benchmark did over the same span when
 *  the market names one. Both returns are fractions. */
export function renderCallScoredNotice(locale: Locale, payload: CallScoredPayload): string {
  const { benchmark } = payload
  const verdict = t(locale, `trading.scored.${payload.status}`, {
    action: renderDeclaredValue(locale, `trading.action.${payload.action}`),
    ticker: payload.instrument.ticker,
    day: formatDay(locale, payload.day),
    return: formatSignedFraction(locale, payload.returnPct),
  })

  if (benchmark === undefined) {
    return verdict
  }

  const comparison = t(locale, 'trading.scored.benchmark', {
    benchmark: benchmark.instrument.ticker,
    benchmarkReturn: formatSignedFraction(locale, benchmark.returnPct),
  })

  return `${verdict} ${comparison}`
}
