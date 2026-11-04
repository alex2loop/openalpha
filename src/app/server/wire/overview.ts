// The /v1 market overview contract: one block per market, its rows, flows, movers and readings.
// Same rules as `wire/trading.ts`. `changePct` is a percent, as on `/v1/quotes`.

import type { DealerBoardWire } from '@/app/server/wire/quote-detail'
import type { InstrumentRefWire, TradingWireCaveat } from '@/app/server/wire/trading'

interface OverviewRowWire {
  readonly instrument: InstrumentRefWire
  /** The live reading while the market trades, else the settled close. */
  readonly price?: number
  readonly changePct?: number
  /** The session `price` closed in; absent on a live reading. */
  readonly closedOn?: string
  /** When the live reading was taken. */
  readonly observedAt?: number
  /** Both sides of a dealer's board; `price` is then its sell price. */
  readonly board?: DealerBoardWire
}

/** A ranked name and the session figure it is ranked by, in the market's currency. */
export interface OverviewLeaderWire {
  readonly instrument: InstrumentRefWire
  readonly value: number
  /** Its share of the list's total, as a percent. */
  readonly sharePct?: number
  /** Its own move this session, as a percent. */
  readonly changePct?: number
}

/** Where the session's money went, each list strongest first. A list the market does not measure is
 *  absent, never empty. */
export interface OverviewLeadersWire {
  /** The window every list was measured over: a closed board reports its session, a market that
   *  never closes its provider's rolling day. */
  readonly window: 'session' | 'rolling-24h'
  /** How many sessions the lists sum over; absent on a rolling window. */
  readonly sessions?: number
  readonly foreignBuys?: readonly OverviewLeaderWire[]
  readonly foreignSells?: readonly OverviewLeaderWire[]
  readonly proprietaryBuys?: readonly OverviewLeaderWire[]
  readonly proprietarySells?: readonly OverviewLeaderWire[]
  /** The session (`YYYY-MM-DD`) the proprietary lists were ranked over; present only when it is an
   *  earlier one than the block's own, because that session's figures are not out yet. */
  readonly proprietaryDay?: string
  readonly mostTraded?: readonly OverviewLeaderWire[]
}

/** The session's biggest movers above the market's liquidity floor, each strongest first. */
export interface OverviewMoversWire {
  readonly window: 'session' | 'rolling-24h'
  readonly gainers: readonly OverviewMoverWire[]
  readonly losers: readonly OverviewMoverWire[]
}

export interface OverviewMoverWire {
  readonly instrument: InstrumentRefWire
  /** Percent. */
  readonly changePct: number
  /** Traded value in the market's currency. */
  readonly turnover: number
}

/** One reading, written as the CLI lists it: the label capitalised and the value with its unit.
 *  Where it stands against its own history is left out: this wire states readings, not placings. */
interface OverviewFactWire {
  readonly id: string
  readonly label: string
  readonly value: string
}

/** A group of readings `/overview` prints under one heading, as the CLI words it: the heading,
 *  the date the group was read at (`note`, once, where the group states one) and its facts in the
 *  CLI's order. Never a score, rank, label or advice. */
interface OverviewSectionWire {
  readonly kind: string
  readonly heading: string
  readonly note?: string
  readonly facts: readonly OverviewFactWire[]
}

/** GET /v1/overview — one block per registered market. */
export interface OverviewResponse {
  readonly markets: readonly {
    readonly market: string
    readonly asOf: string
    readonly sessionState?: string
    readonly currency: string
    /** What the rows' prices are quoted in; absent where they are index levels, which print bare. */
    readonly priceCurrency?: string
    readonly rows: readonly OverviewRowWire[]
    readonly breadth?: {
      readonly advancers: number
      readonly decliners: number
      readonly measured: number
    }
    /** Foreign investors' net buying in the market's currency; negative is net selling. */
    readonly foreignNetValue?: number
    readonly leaders?: OverviewLeadersWire
    readonly movers?: OverviewMoversWire
    /** The readings the CLI prints under the rows, in its order; absent where the market has none. */
    readonly sections?: readonly OverviewSectionWire[]
    /** Which sources `sections` came from and when, as the CLI words it; present only with them. */
    readonly sources?: string
    readonly caveats: readonly TradingWireCaveat[]
  }[]
}
