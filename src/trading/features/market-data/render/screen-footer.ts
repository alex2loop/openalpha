import type { Locale } from '@/core/types/locale'
import type { ScreenRejection } from '@/trading/kernel/market/market-capability'
import type { MarketMovers } from '@/trading/kernel/market/market-overview'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import { pluralKey, t } from '@/i18n'
import { MOVER_KIND } from '@/trading/kernel/market/market-overview'
import { formatCount, formatSignedFixedPercent, renderDeclaredValue } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'

/** How many names one gate's rejection line lists before it reports the rest as a count. */
const REJECTED_TICKER_SAMPLE = 12

/** Grouped by gate, never one line per name: a universe of hundreds would otherwise bury the board
 *  it explains, and the useful answer is which gate removed how many. The count states the whole
 *  group, so the ticker list is a sample and says so when it is one. */
export function renderRejectionLines(
  locale: Locale,
  rejections: readonly ScreenRejection[]
): readonly string[] {
  const byCode = new Map<ScreenGateCode, string[]>()

  for (const rejection of rejections) {
    const tickers = byCode.get(rejection.code) ?? []

    tickers.push(rejection.instrument.ticker)
    byCode.set(rejection.code, tickers)
  }

  // The gate and its sample split across two lines: a reason long enough to explain itself plus a
  // dozen tickers is the one row on this board that cannot be read at a terminal's width.
  return [...byCode].flatMap(([code, tickers]) => [
    `${INDENT[1]}${t(
      locale,
      pluralKey(
        tickers.length,
        'trading.render.screen.rejectedOne',
        'trading.render.screen.rejected'
      ),
      {
        reason: renderDeclaredValue(locale, `trading.screen.gate.${code}`),
        count: formatCount(locale, tickers.length),
      }
    )}`,
    `${INDENT[2]}${sampleTickers(tickers)}`,
    ...ceilingHint(locale, code),
  ])
}

/** Gainers then losers in one block: the sign on each row already says which side it is. A ticker
 *  and a signed percent name themselves, so neither takes a label, and the turnover that earned a
 *  row its place is left out - the board above already ranks these names by money. */
export function renderMoverLines(
  locale: Locale,
  movers: MarketMovers | undefined
): readonly string[] {
  if (movers === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, `trading.render.screen.${MOVER_KIND[movers.window]}`)}`,
    ...[...movers.gainers, ...movers.losers].map(
      (mover) =>
        `${INDENT[2]}${mover.instrument.ticker}${INLINE_SEPARATOR}${formatSignedFixedPercent(locale, mover.changePct)}`
    ),
  ]
}

function ceilingHint(locale: Locale, code: ScreenGateCode): readonly string[] {
  if (code !== 'ceiling-locked') {
    return []
  }

  return [`${INDENT[2]}${t(locale, 'trading.render.screen.ceilingHint')}`]
}

function sampleTickers(tickers: readonly string[]): string {
  const shown = tickers.slice(0, REJECTED_TICKER_SAMPLE).join(', ')

  return tickers.length > REJECTED_TICKER_SAMPLE ? `${shown}, ...` : shown
}
