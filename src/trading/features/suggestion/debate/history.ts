import type { DebateDeps } from '@/trading/features/suggestion/debate/call'
import type { DebateInput } from '@/trading/features/suggestion/pipeline/types'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import { independentCalls } from '@/trading/features/suggestion/pipeline/reporting'
import { promptRatio, promptSignedPercent, promptWholePercent } from '@/trading/prompt-text'

const CALIBRATION_HEADER =
  'YOUR REALIZED CALIBRATION ON THIS MARKET (do NOT inflate conviction past what this supports):'
const RECENT_HEADER = 'YOUR LAST CALLS ON THIS NAME (outcomes already known):'
const MAXIMUM_RECENT_OUTCOMES = 3
/** Enough rows that a run of daily re-issues folded away still leaves three distinct calls. */
const RECENT_OUTCOMES_READ = 20
const BLOCK_SEPARATOR = '\n\n'

/** A band that cleared the reporting minimum on resolved rows. The beat rate rides the same line
 *  when its own sample cleared it too. Named for the band rather than the bucket: `RatedBucket` in
 *  `track-record/render.ts` is a stricter narrowing, and one name may not mean two contracts. */
type RatedBand = CalibrationBucket & { readonly winRate: number }

/** What the store can tell the personas about their own past, as plain prompt text. Scoped to the
 *  market being argued and to the strategy version arguing it: a hit rate blended across markets
 *  describes no population that ever traded, and one blended across versions describes a scorer
 *  that no longer exists. A version bump empties this block until the new version resolves its own
 *  rows, which is the honest reading: an empty block says nothing rather than something stale. */
export async function buildHistoryBlock(
  deps: DebateDeps,
  input: DebateInput,
  signal: AbortSignal
): Promise<string> {
  const { market, ticker } = input.draft.instrument
  // Unpinned by version on purpose: three rows on one name are already a thin read, and pinning
  // them to the current scorer would empty the paragraph on every version bump. What a past call
  // returned is the same fact whichever version authored it. Only this focus's calls are its own,
  // and a re-issue of a still-open call is the same call.
  const onName = await deps.store.listResolved({
    market,
    ticker,
    focusKeys: [input.request.focus.key],
    limit: RECENT_OUTCOMES_READ,
    signal,
  })
  const recent = independentCalls(onName).slice(0, MAXIMUM_RECENT_OUTCOMES)

  return [calibrationParagraph(input.calibration), recentParagraph(recent)]
    .filter((paragraph) => paragraph !== '')
    .join(BLOCK_SEPARATOR)
}

function calibrationParagraph(calibration: readonly CalibrationBucket[]): string {
  const lines = calibration.filter(isRated).map(toCalibrationLine)

  return lines.length === 0 ? '' : [CALIBRATION_HEADER, ...lines].join('\n')
}

function isRated(bucket: CalibrationBucket): bucket is RatedBand {
  return bucket.winRate !== undefined
}

function toCalibrationLine(bucket: RatedBand): string {
  const win = `${promptWholePercent(bucket.winRate)} win rate`
  const beat =
    bucket.benchmarkBeatRate === undefined
      ? ''
      : `, ${promptWholePercent(bucket.benchmarkBeatRate)} beat the index`
  const stated =
    bucket.brier === undefined || bucket.meanStatedProbability === undefined
      ? ''
      : `, you stated ${promptWholePercent(bucket.meanStatedProbability)} on average (Brier ${promptRatio(bucket.brier)})`

  return `${bucket.convictionBand}: ${win}${beat}${stated} over ${bucket.resolvedCount} resolved`
}

/** Most recently settled first, as the store returns them: a call made earlier can settle later
 *  than one made after it, and each line carries its own day. Each is one settled call — what it
 *  was rated, how it ended, and what it returned against the index where the market names one. */
function recentParagraph(rows: readonly ResolvedActionableSuggestion[]): string {
  return rows.length === 0 ? '' : [RECENT_HEADER, ...rows.map(toRecentLine)].join('\n')
}

function toRecentLine(row: ResolvedActionableSuggestion): string {
  const { benchmarkReturnPct, returnPct, status } = row.outcome
  const against =
    benchmarkReturnPct === undefined ? '' : ` (index ${promptSignedPercent(benchmarkReturnPct)})`
  const settled = `${status} ${promptSignedPercent(returnPct)}${against}`

  return `${row.at}: ${row.conviction} ${row.action} · ${settled}`
}
