import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { WatchlistDropReason } from '@/trading/kernel/screen-codes'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { factorComposite } from '@/trading/kernel/factor'
import { absent, omitted, ready } from '@/trading/markets/equity-vn/brief/sections'
import { type CrossSection, scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import {
  DEFAULT_SCREEN_KIND,
  RELATIVE_VOLUME_SESSIONS,
  VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { rankSurvivors, screenCandidate, toScreenInput } from '@/trading/markets/equity-vn/screen'
import { tapeReadings } from '@/trading/markets/equity-vn/tape/signals'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'
import { realizedVolatility, relativeVolume } from '@/trading/markets/timeseries'

// The watchlist half of the brief: sections scoped to the names the operator is already following,
// plus the screen delta that explains what entered and left the board around them.

export function buildWatchlistLeading(context: BriefContext): Promise<BriefSectionResult> {
  const cross = context.cross

  // Omitted rather than absent when nothing is watched: the section does not apply, and a
  // no-coverage caveat would blame the sources for a list the operator never filled.
  if (context.watchlist.length === 0) {
    return Promise.resolve(omitted('watchlist-leading'))
  }

  if (cross === null) {
    return Promise.resolve(absent('watchlist-leading', [{ code: 'market-data.no-coverage' }]))
  }

  const rows = context.watchlist
    .map((ref) => cross.byTicker.get(ref.ticker))
    .filter((name) => name !== undefined)
    .map((name) => ({
      ticker: name.record.instrument.ticker,
      score: scoreNameFactors(name, cross).score,
      volatilityDaily: realizedVolatility(name.closes, VOLATILITY_SESSIONS),
      relativeVolume: relativeVolume(
        name.bars.map((bar) => bar.candle.volume),
        RELATIVE_VOLUME_SESSIONS
      ),
    }))
    .sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker))

  return Promise.resolve(
    rows.length === 0
      ? absent('watchlist-leading', [{ code: 'market-data.no-coverage' }])
      : ready(
          'watchlist-leading',
          rows.slice(0, context.policy.maximumItemsPerSection).map((row) => ({
            ticker: row.ticker,
            score: row.score,
            ...(row.volatilityDaily === undefined ? {} : { volatilityDaily: row.volatilityDaily }),
            ...(row.relativeVolume === undefined
              ? {}
              : { relativeVolume: row.relativeVolume, sessions: RELATIVE_VOLUME_SESSIONS }),
          }))
        )
  )
}

/** Names that left the eligible set carry their current gate code when one is known. */
export function buildWatchlistDropped(context: BriefContext): Promise<BriefSectionResult> {
  const cross = context.cross
  const previous = context.request.previousEligibleWatchlist

  if (previous === undefined || cross === null) {
    return Promise.resolve(omitted('watchlist-dropped'))
  }

  const dropped = previous
    .map((ref) => ({ ref, code: currentGateCode(ref.ticker, cross, context.request.asOf) }))
    .filter((entry) => entry.code !== undefined)

  return Promise.resolve(
    dropped.length === 0
      ? omitted('watchlist-dropped')
      : ready(
          'watchlist-dropped',
          dropped.map((entry) => ({ ticker: entry.ref.ticker, reason: entry.code ?? 'unknown' }))
        )
  )
}

function currentGateCode(
  ticker: BriefContext['watchlist'][number]['ticker'],
  cross: NonNullable<BriefContext['cross']>,
  asOf: BriefContext['request']['asOf']
): WatchlistDropReason | undefined {
  const evidence = cross.byTicker.get(ticker)

  if (evidence === undefined) {
    return 'not-in-universe'
  }

  // The one NameEvidence-to-ScreenInput mapping, not a second one built by hand here: the screen
  // and this drop reason must judge the same name from the same input.
  const verdict = screenCandidate(toScreenInput(evidence, asOf))

  return verdict.kind === 'rejected' ? verdict.code : undefined
}

const DELTA_BOARD_SIZE = 10

/** Yesterday's board and today's, both from `boardTickers`, so the delta can never disagree with
 *  the screen it explains. The two-slot cache keeps yesterday's pass resident while today's screen
 *  runs, so neither evicts the other. */
export async function buildScreenDelta(context: BriefContext): Promise<BriefSectionResult> {
  const today = context.cross

  if (today === null) {
    return absent('screen-delta', [{ code: 'market-data.universe-empty' }])
  }

  const previousDay = context.calendar.addTradingDays(context.request.asOf, -1)
  const previous = await context.crossAt(previousDay)
  const todayBoard = boardTickers(today, context.request.asOf)
  const previousBoard = boardTickers(previous, previousDay)
  const entered = [...todayBoard].filter((entry) => !previousBoard.has(entry))
  const left = [...previousBoard].filter((entry) => !todayBoard.has(entry))

  if (entered.length === 0 && left.length === 0) {
    return omitted('screen-delta')
  }

  return ready('screen-delta', [
    ...entered.map((entry) => ({ ticker: entry, direction: 'entered' as const })),
    ...left.map((entry) => ({ ticker: entry, direction: 'left' as const })),
  ])
}

/** The screen's own board, rebuilt: same kind filter, same gates, same ranking. The kind is what
 *  makes the two agree — the cross-section also carries ETFs, indices and futures, no gate tests
 *  for them, and one taking a slot here reports the tenth stock as having left a board it is on. */
function boardTickers(cross: CrossSection, asOf: TradingDay): ReadonlySet<Ticker> {
  const survivors = cross.names
    .filter((name) => name.record.kind === DEFAULT_SCREEN_KIND)
    .map((name) => toScreenInput(name, asOf))
    .filter((input) => screenCandidate(input).kind === 'accepted')
  const factorsByTicker = new Map(
    survivors.map((survivor) => {
      const evidence = cross.byTicker.get(survivor.instrument.ticker)

      return [
        survivor.instrument.ticker,
        evidence === undefined
          ? { ...UNSCORED_COMPOSITE, factors: [] }
          : // Only the ranking key is read here, so the factor rows behind it stay unbuilt.
            { ...factorComposite(scoreNameFactors(evidence, cross)), factors: [] },
      ] as const
    })
  )
  const signalsByTicker = new Map(
    survivors.map((survivor) => {
      const evidence = cross.byTicker.get(survivor.instrument.ticker)

      return [
        survivor.instrument.ticker,
        evidence === undefined ? [] : tapeReadings(evidence),
      ] as const
    })
  )

  return new Set(
    // The fold keeps tickers alone, so the caution a foreign operator would see is discarded.
    rankSurvivors(survivors, { factorsByTicker, signalsByTicker }, { foreignOperator: false })
      .slice(0, DELTA_BOARD_SIZE)
      .map((candidate) => candidate.instrument.ticker)
  )
}
