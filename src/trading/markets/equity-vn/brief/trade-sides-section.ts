import type { Ticker } from '@/trading/kernel/instrument'
import type {
  BriefAggressorSide,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { absent, omitted, ready } from '@/trading/markets/equity-vn/brief/sections'
import { RELATIVE_VOLUME_SESSIONS, VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { aggressorBalance } from '@/trading/markets/equity-vn/tape/trade-sides'
import { relativeVolume } from '@/trading/markets/timeseries'

const PERCENT_PER_UNIT = 100
const EVEN_SPLIT = 0.5

interface AggressorRow {
  readonly ticker: Ticker
  /** Sorted on, never printed: the row states the dominant side and its share instead, which reads
   *  without knowing the sign convention this orders by. */
  readonly balance: number
  readonly relativeVolume?: number
}

/** Most sold-into first: a name the operator holds that was distributed yesterday is the row that
 *  changes what they do this morning, and a name that was bought is not news. */
export async function buildTradeSides(context: BriefContext): Promise<BriefSectionResult> {
  if (!context.calendar.isTradingDay(context.request.asOf)) {
    return omitted('trade-sides')
  }

  const rows = await readRows(context)

  if (rows.length === 0) {
    return absent('trade-sides', [
      { code: 'market-data.trade-sides-empty', detail: { day: context.request.asOf } },
    ])
  }

  return ready(
    'trade-sides',
    rows
      .toSorted((left, right) => left.balance - right.balance)
      .slice(0, context.policy.maximumItemsPerSection)
      .map(toRow)
  )
}

/** Whatever the sweep recorded for the session, rather than a name list of this section's own. The
 *  sweep already decides which names it can reach - holdings and the watchlist - and a second list
 *  here would drift from it silently. One indexed read, so a single name cannot fail the section. */
async function readRows(context: BriefContext): Promise<readonly AggressorRow[]> {
  const stored = await context.deps.marketDataStore.listTradeSidesDay({
    market: VN_MARKET_REF,
    day: context.request.asOf,
    signal: context.request.signal,
  })

  return stored.flatMap((snapshot): readonly AggressorRow[] => {
    const balance = aggressorBalance(snapshot)

    if (balance === undefined) {
      return []
    }

    const volume = sessionRelativeVolume(context, snapshot.instrument.ticker)

    return [
      {
        ticker: snapshot.instrument.ticker,
        balance,
        ...(volume === undefined ? {} : { relativeVolume: volume }),
      },
    ]
  })
}

/** The dominant side as a share of classified volume, where 50% is the neutral point: a reader gets
 *  the side in words and never has to know which way a signed balance points. A session that
 *  classified as much buying as selling has no dominant side, and claiming one at 50% would invent
 *  a lean nobody took. */
function toRow(row: AggressorRow): BriefSectionRow {
  const side = sideOf(row.balance)

  return {
    ticker: row.ticker,
    aggressorSide: side,
    ...(side === 'balanced'
      ? {}
      : { aggressorSharePct: (EVEN_SPLIT + Math.abs(row.balance) / 2) * PERCENT_PER_UNIT }),
    ...(row.relativeVolume === undefined
      ? {}
      : { relativeVolume: row.relativeVolume, sessions: RELATIVE_VOLUME_SESSIONS }),
  }
}

function sideOf(balance: number): BriefAggressorSide {
  if (balance === 0) {
    return 'balanced'
  }

  return balance > 0 ? 'buy' : 'sell'
}

/** The share says which way the session leaned, never how much was behind it: the same reading on a
 *  quiet tape and on a distribution day are different events, and no other row in the brief carries
 *  this name's own volume. Absent for a name the cross-section did not cover. */
function sessionRelativeVolume(context: BriefContext, ticker: Ticker): number | undefined {
  const name = context.cross?.byTicker.get(ticker)

  if (name === undefined) {
    return undefined
  }

  return relativeVolume(
    name.bars.map((bar) => bar.candle.volume),
    RELATIVE_VOLUME_SESSIONS
  )
}
