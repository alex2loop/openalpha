import type { ProgressWire } from '@/app/server/wire/live'

const MAX_RUN_TICKERS = 20

/** The run's tickers with the one a progress line names added: deduped, first seen first, and
 *  never past MAX_RUN_TICKERS. Undefined while a run has named none. */
export function withTicker(
  tickers: readonly string[] | undefined,
  progress: ProgressWire
): readonly string[] | undefined {
  const named = progress.params?.ticker

  if (typeof named !== 'string' || named === '') {
    return tickers
  }

  const seen = tickers ?? []

  return seen.includes(named) || seen.length >= MAX_RUN_TICKERS ? tickers : [...seen, named]
}
