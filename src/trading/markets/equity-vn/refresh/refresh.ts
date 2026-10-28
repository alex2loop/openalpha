import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type {
  MarketRefreshAttempt,
  RefreshDataKind,
  RefreshKindResult,
  StaleKindsRequest,
} from '@/trading/kernel/market/refresh'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  CrossSectionInvalidator,
  EvidenceScope,
} from '@/trading/markets/equity-vn/evidence/evidence'
import type { VnMacroCrossSection } from '@/trading/markets/equity-vn/evidence/macro-evidence'
import type { UniverseRefreshOutcome } from '@/trading/markets/equity-vn/refresh/universe'
import type {
  MarketDataRefreshRequest,
  MarketManifest,
  TradingCalendar,
} from '@/trading/markets/types'
import { assertNotAborted } from '@/core/errors'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { reportRefreshStage } from '@/trading/kernel/market/refresh'
import { isSettled, resolveSettledDay } from '@/trading/markets/calendar'
import { refreshBars } from '@/trading/markets/equity-vn/evidence/bar-evidence'
import { refreshFlows, refreshFundamentals } from '@/trading/markets/equity-vn/evidence/evidence'
import {
  FOREIGN_ROOM_LOOKBACK_SESSIONS,
  REFRESH_STALE_SESSIONS,
  REFRESH_WALL_CLOCK_MS,
  VN_EVIDENCE_SESSIONS,
  VN_FLOW_SESSIONS,
  VN_MARKET_REF,
  VN_REPAIR_COOLDOWN_MS,
} from '@/trading/markets/equity-vn/policy'
import { refreshAccounts } from '@/trading/markets/equity-vn/refresh/accounts'
import { refreshIndexValuation } from '@/trading/markets/equity-vn/refresh/index-valuation'
import { refreshMacro } from '@/trading/markets/equity-vn/refresh/macro'
import {
  isForeignRoomUnstamped,
  isUniverseStale,
  loadUniverse,
  refreshUniverse,
} from '@/trading/markets/equity-vn/refresh/universe'
import {
  buildReplayedResult,
  buildSkippedResult,
  emptyKindResult,
} from '@/trading/markets/refresh-result'

/** Instruments are absent: the universe follows its own cadence and must settle before any target
 *  set can be built. */
const EVIDENCE_KINDS: readonly RefreshDataKind[] = Object.freeze([
  'bars',
  'fundamentals',
  'flows',
  'macro',
  'accounts',
])

/** How much history each kind's readers need. A kind absent here keeps a single snapshot, so
 *  recency alone decides whether a stored attempt stands in for it. */
const KIND_HISTORY_SESSIONS: Readonly<Partial<Record<RefreshDataKind, number>>> = Object.freeze({
  bars: VN_EVIDENCE_SESSIONS,
  flows: VN_FLOW_SESSIONS,
})

interface EvidenceRun {
  readonly kind: RefreshDataKind
  run(scope: EvidenceScope): Promise<RefreshKindResult>
}

/** Kinds that run together; the stages after it wait for all of them. */
type EvidenceStage = readonly EvidenceRun[]

/** One pass over the evidence kinds: the scope they read and the stored attempts they may replay
 *  instead of fetching. */
interface EvidencePass extends RefreshMarketDataInput {
  readonly scope: EvidenceScope
  readonly attempts: readonly MarketRefreshAttempt[]
}

/** Both halves of the cross-section cache: read through for the macro confirmers, dropped once
 *  evidence has been rewritten. */
interface RefreshCrossSection extends CrossSectionInvalidator, VnMacroCrossSection {}

interface RefreshMarketDataInput {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly crossSection: RefreshCrossSection
  readonly request: MarketDataRefreshRequest
}

/** Bars, fundamentals and flows read nothing of each other, so they run together: the pacer still
 *  meters the vndirect budget they share, and flows spends most of its time on the desk provider.
 *  Macro and accounts read the cross-section those three rewrite, so they run after them. */
export async function refreshMarketData(
  options: RefreshMarketDataInput
): Promise<readonly RefreshKindResult[]> {
  const { deps, request } = options
  const [stored, attempts] = await Promise.all([
    loadUniverse(deps, { signal: request.signal }),
    deps.marketDataStore.listRefreshAttempts({ market: VN_MARKET_REF, signal: request.signal }),
  ])
  const startedTick = performance.now()
  const universe = await resolveUniverse(options, stored, attempts)
  const instruments = { ...universe.result, elapsedMs: performance.now() - startedTick }

  await settle(options, instruments)

  // No stored scope means no provider subject to attempt, so the evidence kinds report an
  // unattempted absence rather than a failed fetch.
  if (universe.universe.length === 0) {
    return [instruments, ...EVIDENCE_KINDS.map((kind) => emptyKindResult(kind, 'unavailable', []))]
  }

  const fromDay = options.manifest.calendar.addTradingDays(request.asOf, -VN_EVIDENCE_SESSIONS)
  const scope: EvidenceScope = {
    deps,
    crossSection: options.crossSection,
    universe: universe.universe,
    fromDay,
    calendar: options.manifest.calendar,
    asOfSettled: isSettled(options.manifest.calendar, request.asOf, request.now),
    request,
  }
  const evidence = await runEvidence({ ...options, scope, attempts }, [
    [
      { kind: 'bars', run: refreshBars },
      { kind: 'fundamentals', run: refreshFundamentals },
      { kind: 'flows', run: refreshFlows },
    ],
    [{ kind: 'macro', run: () => refreshMacro(options) }],
    [{ kind: 'accounts', run: (next) => refreshAccounts(next, options.crossSection) }],
  ])

  return [instruments, ...evidence, await refreshIndexRatios(options)]
}

// Outside the evidence kinds: a replayed pass must still retry a read that failed, and the refresh
// asks the provider at most once a UTC day whatever the pass is.
function refreshIndexRatios(options: RefreshMarketDataInput): Promise<RefreshKindResult> {
  const { deps, crossSection, manifest, request } = options

  reportRefreshStage(request.progress, { market: VN_MARKET_REF, kind: 'index-ratios' })

  return refreshIndexValuation({
    deps,
    crossSection,
    calendar: manifest.calendar,
    asOf: resolveSettledDay(manifest.calendar, request.now),
    forced: request.forced,
    now: request.now,
    signal: request.signal,
  })
}

/** A stage settles every kind in it before the next starts, so a kind that throws never leaves a
 *  sibling still writing after the refresh has failed. */
async function runEvidence(
  pass: EvidencePass,
  stages: readonly EvidenceStage[]
): Promise<readonly RefreshKindResult[]> {
  const results: RefreshKindResult[] = []

  for (const stage of stages) {
    results.push(
      ...(await mapWithConcurrency(stage, stage.length, (entry) => runKind(pass, entry)))
    )
  }

  return results
}

async function runKind(pass: EvidencePass, entry: EvidenceRun): Promise<RefreshKindResult> {
  const startedTick = performance.now()
  const attempt = findAttempt(pass.attempts, entry.kind)
  const scope = buildScope(pass, attempt)
  const result =
    attempt !== null && isReusableAttempt(pass, attempt)
      ? await replayAttempt({ ...pass, scope }, entry, attempt)
      : await settle(pass, await entry.run(scope))

  return { ...result, elapsedMs: performance.now() - startedTick }
}

/** The depth an earlier pass reached travels with the scope, so the kind can tell a stored series
 *  that merely stops short of a deepened window from one that is genuinely current. */
function buildScope(pass: EvidencePass, attempt: MarketRefreshAttempt | null): EvidenceScope {
  const coveredFrom = attempt?.result.coveredFrom

  return { ...pass.scope, ...(coveredFrom === undefined ? {} : { storedFrom: coveredFrom }) }
}

/** A replayed attempt covers only the targets it reached: the names it lost are asked for again on
 *  their own, so a handful of slow reads do not pin the kind until the next session. The cooldown
 *  is what keeps a name no provider can serve from refetching on every command. */
async function replayAttempt(
  pass: EvidencePass,
  entry: EvidenceRun,
  attempt: MarketRefreshAttempt
): Promise<RefreshKindResult> {
  const replayed = buildReplayedResult(attempt.result, attempt.result.recordCount)

  if (
    replayed.missingTargets.length === 0 ||
    pass.request.now - attempt.attemptedAt < VN_REPAIR_COOLDOWN_MS
  ) {
    return replayed
  }

  const repairTargets = new Set(replayed.missingTargets)
  const retried = await entry.run({ ...pass.scope, repairTargets })

  // A name the kind no longer targets — delisted, or no longer of a class it fetches — leaves the
  // repair with nothing to attempt, and an empty attempt says nothing about the stored population.
  return retried.targetCount === 0 ? replayed : await settle(pass, mergeRepaired(replayed, retried))
}

/** Coverage is counted by name, not by sum: the repair attempted a subset, so its own counts stand
 *  for that subset alone. A repair that recovered nothing leaves the population where it was. */
function mergeRepaired(replayed: RefreshKindResult, retried: RefreshKindResult): RefreshKindResult {
  const stillMissing = new Set(retried.missingTargets)
  const missingTargets = replayed.missingTargets.filter((ticker) => stillMissing.has(ticker))
  const recovered = replayed.missingTargets.length - missingTargets.length

  return {
    kind: replayed.kind,
    status: missingTargets.length === 0 ? retried.status : 'partial',
    targetCount: replayed.targetCount,
    successfulTargetCount: replayed.targetCount - missingTargets.length,
    missingTargets,
    recordCount:
      recovered === 0 ? replayed.recordCount : replayed.recordCount + retried.recordCount,
    ...(replayed.coveredFrom === undefined ? {} : { coveredFrom: replayed.coveredFrom }),
    provenance: retried.provenance,
    caveats: retried.caveats,
  }
}

/** Weekly policy decides replacement, except when the operator forced the run: a forced refresh is
 *  someone asking for the provider's current answer, and a universe that answers "not for six more
 *  days" makes the one command that should fix a wrong scope unable to. An attempt that already
 *  covers the settled session is replayed on top of that, so a provider outage is retried once a
 *  session rather than every run — except over an unstamped foreign room, where the attempt being
 *  replayed is the pass that built the unstamped scope, and replaying it repeats the empty stamp
 *  for the rest of the session. */
async function resolveUniverse(
  options: RefreshMarketDataInput,
  stored: readonly InstrumentRecord[],
  attempts: readonly MarketRefreshAttempt[]
): Promise<UniverseRefreshOutcome> {
  const { request } = options

  if (!(request.forced || isUniverseStale(stored, request.now))) {
    return { result: buildSkippedResult('instruments', stored.length), universe: stored }
  }

  const attempt = findAttempt(attempts, 'instruments')
  const replayable =
    attempt !== null && isReusableAttempt(options, attempt) && !isForeignRoomUnstamped(stored)

  if (replayable) {
    return { result: buildReplayedResult(attempt.result, stored.length), universe: stored }
  }

  reportRefreshStage(request.progress, { market: VN_MARKET_REF, kind: 'instruments' })

  return refreshUniverse(options.deps, {
    stored,
    limit: request.limit,
    now: request.now,
    roomFromDay: options.manifest.calendar.addTradingDays(
      request.asOf,
      -FOREIGN_ROOM_LOOKBACK_SESSIONS
    ),
    roomToDay: options.manifest.calendar.dayAt(request.now),
    signal: request.signal,
  })
}

/** A stored attempt stands in for a pass unless the operator forced the run. */
function isReusableAttempt(
  options: RefreshMarketDataInput,
  attempt: MarketRefreshAttempt
): boolean {
  return (
    !options.request.forced &&
    isAttemptCurrent(options.manifest.calendar, options.request.now, attempt)
  )
}

/** Judged by the same predicate a run replays from, so what a refresh skips and what an answer
 *  calls stale cannot disagree. */
export async function vnStaleKinds(
  calendar: TradingCalendar,
  request: StaleKindsRequest
): Promise<readonly RefreshDataKind[]> {
  assertNotAborted(request.signal)

  return request.attempts
    .filter((attempt) => !isKindCurrent(calendar, request.now, attempt))
    .map((attempt) => attempt.result.kind)
}

/** The universe and the annual reports follow wall-clock cadences no session count expresses,
 *  measured from their attempt rather than the records they wrote — one fetch stamps both, and
 *  reading the whole scope to date a caveat is a query no surface asked for. */
function isKindCurrent(
  calendar: TradingCalendar,
  now: number,
  attempt: MarketRefreshAttempt
): boolean {
  const cadenceMs = REFRESH_WALL_CLOCK_MS[attempt.result.kind]

  return cadenceMs === undefined
    ? isAttemptCurrent(calendar, now, attempt)
    : now - attempt.attemptedAt <= cadenceMs
}

/** A stamp alone cannot say whether the pass that wrote it had anything final to store: one that
 *  ran before its own day's tape settled recorded a forming board under that day's name, and every
 *  run after it reads the stamp as current and serves it. So the attempt's instant is held against
 *  the day it claims first, then the stamp against its kind's cadence and the depth its readers
 *  need. */
function isAttemptCurrent(
  calendar: TradingCalendar,
  now: number,
  attempt: MarketRefreshAttempt
): boolean {
  const staleBefore = calendar.addTradingDays(
    resolveSettledDay(calendar, now),
    -(REFRESH_STALE_SESSIONS[attempt.result.kind] - 1)
  )

  return (
    isSettled(calendar, attempt.asOf, attempt.attemptedAt) &&
    attempt.asOf >= staleBefore &&
    coversHistory(calendar, now, attempt)
  )
}

function coversHistory(
  calendar: TradingCalendar,
  now: number,
  attempt: MarketRefreshAttempt
): boolean {
  const sessions = KIND_HISTORY_SESSIONS[attempt.result.kind]

  if (sessions === undefined) {
    return true
  }

  const required = calendar.addTradingDays(calendar.dayAt(now), -sessions)

  return attempt.result.coveredFrom !== undefined && attempt.result.coveredFrom <= required
}

function findAttempt(
  attempts: readonly MarketRefreshAttempt[],
  kind: RefreshDataKind
): MarketRefreshAttempt | null {
  return attempts.find((attempt) => attempt.result.kind === kind) ?? null
}

/** Never from `finally`: a throw or abort must leave no row so the next boot repairs the
 *  interrupted kind. A policy skip and a zero-target no-op attempted nothing, so neither writes
 *  one either. */
async function settle(
  options: RefreshMarketDataInput,
  result: RefreshKindResult
): Promise<RefreshKindResult> {
  if (result.status === 'fresh' || result.targetCount === 0) {
    return result
  }

  await options.deps.marketDataStore.upsertRefreshAttempt(
    {
      market: VN_MARKET_REF,
      asOf: resolveSettledDay(options.manifest.calendar, options.request.now),
      attemptedAt: options.request.now,
      result,
    },
    options.request.signal
  )

  return result
}
