import type { SuggestionRunOptions } from '@/trading/features/suggestion/pipeline/types'
import type {
  StoredSuggestion,
  Suggestion,
  SuggestionIdentity,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { MarketResolution } from '@/trading/markets/types'
import { StorageError } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { resolveDay } from '@/trading/features/market-data/resolve'
import {
  findStandingBuy,
  readBarsSince,
  resolveStanding,
} from '@/trading/features/suggestion/pipeline/standing'
import {
  isStandingAnswer,
  lookbackOf,
} from '@/trading/features/suggestion/pipeline/standing-answer'
import { buildSuggestionId, isInconclusive } from '@/trading/features/suggestion/types'
import { strategyId } from '@/trading/kernel/instrument'
import { resolveSessionOnOrBefore } from '@/trading/markets/calendar'

export async function reuseOrCooldown(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
): Promise<SuggestionRunResult | undefined> {
  const { deps, request } = options

  if (request.force === true) {
    return undefined
  }

  const asOf = resolveDay(resolution.market, request.now)
  const identity = identityOf(resolution, asOf, request.focus.key)
  const existing = await findReusable(options, resolution, identity)
  // An undecided row is not an answer, so it neither satisfies the gate nor starts a cooldown:
  // serving it back would let one outage stand as today's decision for this name.
  const answered = existing !== null && isStandingAnswer(existing, options)
  const superseded = answered && (await hasNewerEvidence(options, resolution, existing))

  if (answered && !superseded) {
    const standing = await resolveStanding(options, resolution, existing)

    return { kind: 'completed', suggestion: standing, reused: true }
  }

  const standingBuy = await findStandingBuy(options, resolution, identity)

  if (standingBuy !== undefined) {
    return { kind: 'completed', suggestion: standingBuy, reused: true }
  }

  const sessions = deps.policy.cooldownSessions

  if (sessions <= 0 || superseded) {
    return undefined
  }

  const calendar = resolution.market.manifest.calendar
  // Inclusive lookback, so it stops one session short: a row exactly `sessions` old names today as
  // `eligibleAfter`, and must not also be refused today. Counted from the latest session, so a
  // weekend run still reaches the last one.
  const recent = await deps.store.findRecentCompleted({
    ...lookbackOf(
      identity,
      calendar.addTradingDays(resolveSessionOnOrBefore(calendar, asOf), -sessions + 1)
    ),
    signal: request.signal,
  })

  if (recent === null || !isStandingAnswer(recent, options)) {
    return undefined
  }

  return {
    kind: 'cooldown',
    previous: await resolveStanding(options, resolution, recent),
    eligibleAfter: calendar.addTradingDays(recent.at, sessions),
  }
}

/** One insert. A conflict means another writer won the same economic identity, so the winner is
 *  re-read and returned as a reuse rather than retried. An insert that wrote nothing and left
 *  nothing to read back is a lost write, not a completed suggestion. */
export async function persistSuggestion(
  options: SuggestionRunOptions,
  suggestion: Suggestion
): Promise<SuggestionRunResult> {
  const { deps, request } = options
  const stored: StoredSuggestion = {
    ...suggestion,
    id: buildSuggestionId(request.now),
    createdAt: request.now,
  }

  if (isInconclusive(stored)) {
    return { kind: 'completed', suggestion: stored, reused: false }
  }

  const created = await deps.store.create(stored, request.signal)

  if (created) {
    return { kind: 'completed', suggestion: stored, reused: false }
  }

  const existing = await readHolder(options, stored)

  // The identity is held by a row this run outranks — never decided, a shallower debate, forced past,
  // or read off an older close — so this run takes it over; a lost race means another writer did.
  const outranked = request.force === true || !isStandingAnswer(existing, options)
  const fresher =
    isStandingAnswer(stored, options) && evidenceDayOf(stored) > evidenceDayOf(existing)

  if (outranked || fresher) {
    const replaced = await deps.store.replace({
      previousId: existing.id,
      suggestion: stored,
      signal: request.signal,
    })

    if (replaced) {
      return { kind: 'completed', suggestion: stored, reused: false }
    }

    // The row read above is gone: its id was deleted by the writer that won the takeover.
    return { kind: 'completed', suggestion: await readHolder(options, stored), reused: true }
  }

  return { kind: 'completed', suggestion: existing, reused: true }
}

async function readHolder(
  options: SuggestionRunOptions,
  stored: StoredSuggestion
): Promise<StoredSuggestion> {
  const holder = await options.deps.store.findCompleted(
    {
      strategyId: stored.strategyId,
      strategyVersion: stored.strategyVersion,
      focusKey: stored.focusKey,
      market: stored.instrument.market,
      ticker: stored.instrument.ticker,
      asOf: stored.at,
    },
    options.request.signal
  )

  if (holder === null) {
    throw new StorageError(`suggestion ${stored.id} was neither written nor readable back`)
  }

  return holder
}

/** Today's row, or - where the day boundary is only a charting convention - the last one still
 *  inside the reuse window. Crossing 00:00 UTC an hour after a run must not turn that run's own
 *  suggestion into a cooldown notice. */
async function findReusable(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  identity: SuggestionIdentity
): Promise<StoredSuggestion | null> {
  const { deps, request } = options
  const calendar = resolution.market.manifest.calendar
  const today = await deps.store.findCompleted(identity, request.signal)

  if (today !== null || !calendar.continuous) {
    return today
  }

  // The window is read in days here because the store cursors on one: a window wider than a day
  // reaches a row the previous day alone would leave to the cooldown it has not earned yet.
  const windowDays = Math.ceil(deps.policy.reuseWindowMs / MS_PER_DAY)
  const recent = await deps.store.findRecentCompleted({
    ...lookbackOf(identity, calendar.addTradingDays(identity.asOf, -windowDays)),
    signal: request.signal,
  })

  return recent !== null && request.now - recent.createdAt < deps.policy.reuseWindowMs
    ? recent
    : null
}

/** A call that read an earlier close stops answering for its day once a later close is stored. */
async function hasNewerEvidence(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<boolean> {
  const through = evidenceDayOf(suggestion)
  const bars = await readBarsSince(options, resolution, through)

  return bars?.kind === 'available' && bars.value.some((candle) => candle.at > through)
}

function evidenceDayOf(suggestion: Suggestion): TradingDay {
  return suggestion.evidenceThrough ?? suggestion.at
}

export function identityOf(
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  asOf: TradingDay,
  focusKey: FocusKey
): SuggestionIdentity {
  return {
    asOf,
    strategyId: strategyId(resolution.market.manifest.id),
    strategyVersion: resolution.market.manifest.strategyVersion,
    focusKey,
    market: resolution.instrument.market,
    ticker: resolution.instrument.ticker,
  }
}
