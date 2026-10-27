import type { LocalizedMessageParam } from '@/core/stream-events'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'

/** The command the operator types, and the run a scheduled pass shows as, so both read as one. */
export const REFRESH_COMMAND_NAME = 'refresh'
export const REFRESH_DATA_KINDS = Object.freeze([
  'instruments',
  'bars',
  'fundamentals',
  'flows',
  'macro',
  'accounts',
  'premium',
] as const)
export type RefreshDataKind = (typeof REFRESH_DATA_KINDS)[number]

/** The subject a refresh line names. `/refresh` sweeps every market concurrently through one
 *  reporter, so a line that does not name its market flickers between them. */
interface RefreshStage {
  readonly market: MarketRef
  readonly kind: RefreshDataKind
}

interface StageCounts {
  readonly done: number
  readonly total: number
}

interface RefreshProgress {
  /** Called once per target the pass finished, by however many names that target stood for. */
  advance(completed: number): void
}

/** A pass with nothing to fetch still runs; it just has no reading to report. */
const NO_REFRESH_PROGRESS: RefreshProgress = Object.freeze({ advance: () => undefined })

/** One owner for what a refresh line says: the key a surface shows and the prefix the locale
 *  manifest validates cannot drift apart, and no kind can be reported without its market. The
 *  market travels as a nested message so each surface resolves it in its own locale. */
export function reportRefreshStage(
  report: StageReporter | undefined,
  stage: RefreshStage,
  counts?: StageCounts
): void {
  report?.(`trading.progress.refresh.${stage.kind}`, {
    market: marketParam(stage.market),
    ...counts,
  })
}

/** A caller that joins a sweep already in flight waits for that market, not for the one it asked
 *  about, so the line names it for the same reason every other refresh line does. */
export function reportRefreshJoined(report: StageReporter | undefined, market: MarketRef): void {
  report?.('trading.progress.refreshJoined', { market: marketParam(market) })
}

function marketParam(market: MarketRef): LocalizedMessageParam {
  return { key: `trading.market.${market}` }
}

/** A kind that fans out over instruments reports how far it has got, because the alternative is one
 *  label held for minutes. Reports at zero on construction, so the pass's opening label is already
 *  the counted one and no surface ever paints an uncounted version of it. */
export function createRefreshProgress(
  report: StageReporter | undefined,
  stage: RefreshStage,
  total: number
): RefreshProgress {
  // An empty target list is reached on every ordinary refresh — the backfill pass a tail-only run
  // leaves with nothing to do — and "0 of 0" is not a reading.
  if (total <= 0) {
    return NO_REFRESH_PROGRESS
  }

  let done = 0

  reportRefreshStage(report, stage, { done, total })

  return {
    advance(completed): void {
      done += completed
      reportRefreshStage(report, stage, { done, total })
    },
  }
}

export interface RefreshMarketDataOptions {
  readonly market: MarketRef
  readonly now: number
  /** Fetch even when a stored attempt already covers the settled session. */
  readonly forced?: boolean
  readonly signal: AbortSignal
  /** Present when a surface is waiting; dropped when this request joins one already in flight,
   *  whose own reporter is the one the coordinator kept. */
  readonly progress?: StageReporter
}

export interface RefreshAllMarketDataOptions {
  /** Fetch even when a stored attempt already covers the settled session. */
  readonly forced?: boolean
  /** Which registered markets to sweep. Absent is every market the operator still reads — what
   *  boot and the scheduled tick always mean, and what an unqualified command means too. */
  readonly markets?: readonly MarketRef[]
  readonly signal: AbortSignal
  readonly progress?: StageReporter
  /** Started by the daemon rather than typed: a pass with a market to sweep shows as the `/refresh`
   *  run would, on the schedule's channel. */
  readonly scheduled?: boolean
}

export const REFRESH_ANCHOR_KINDS = Object.freeze(['tape-final', 'pre-open'] as const)
type RefreshAnchorKind = (typeof REFRESH_ANCHOR_KINDS)[number]

/** One scheduled instant the refresh loop anchors on: the tape-settle close or the pre-open
 *  warm-up for the session `day` names. `at` is epoch-ms; `day` is the session it belongs to. */
export interface RefreshAnchor {
  readonly kind: RefreshAnchorKind
  readonly at: number
  readonly day: TradingDay
}

export interface RefreshMarketDataResult {
  readonly market: MarketRef
  /** The one clock read the whole operation was planned against — not proof that every kind was
   *  refreshed, which only each kind's own status reports. */
  readonly startedAt: number
  /** The newest session this market's stored data can stand for. A run before the close leaves
   *  today forming, so a healthy result still covers only the previous session. */
  readonly dataThroughDay: TradingDay
  readonly elapsedMs: number
  readonly results: readonly RefreshKindResult[]
  readonly caveats: readonly Caveat[]
  /** The upcoming schedule anchors for this market, so the command names when the loop fires next. */
  readonly anchors: readonly RefreshAnchor[]
}

export const REFRESH_KIND_STATUSES = Object.freeze([
  'fresh',
  'replaced',
  'upserted',
  'partial',
  'retained',
  'unavailable',
] as const)
export type RefreshKindStatus = (typeof REFRESH_KIND_STATUSES)[number]

/** `targetCount` counts the required provider subjects attempted, never returned rows;
 *  `recordCount` is the durable population the result stands for. A policy skip is `fresh` with
 *  zero targets, while `retained` is an attempted replacement that failed and kept the old scope.
 *  The two count different things and only the second has a catalog unit
 *  (`trading.refresh.record-unit.<kind>`): a subject is a ticker the pass asked a provider about,
 *  which is what a progress line counts, and a record is a row the pass stored. */
export interface RefreshKindResult {
  readonly kind: RefreshDataKind
  readonly status: RefreshKindStatus
  readonly targetCount: number
  readonly successfulTargetCount: number
  /** The subjects that returned nothing usable, named so a shortfall reads as a list rather than a
   *  count. A market that cannot name them reports none. */
  readonly missingTargets: readonly string[]
  /** The subjects whose stored history the provider re-adjusted, so a later reader knows the levels
   *  priced against the old basis no longer describe this series. */
  readonly restatedTargets?: readonly string[]
  readonly recordCount: number
  /** The earliest session the stored population now reaches. It is what tells a later pass whether
   *  a deepened window has been fetched, which the newest stored day cannot. */
  readonly coveredFrom?: TradingDay
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
  /** Time this pass spent on the kind, set by a market that runs several kinds; one that runs a
   *  single kind leaves it to the market's own `elapsedMs`. Never stored. */
  readonly elapsedMs?: number
}

/** A refresh pass as the store kept it: `asOf` is the settled session it stood for, `attemptedAt`
 *  when it ran. A kind skipped as fresh writes no row, so this always describes the last pass that
 *  actually fetched, never the last run that considered the kind. */
export interface MarketRefreshAttempt {
  readonly market: MarketRef
  readonly asOf: TradingDay
  readonly attemptedAt: number
  readonly result: RefreshKindResult
}
