// The /v1 market contract: the screen board, instrument search, the market overview and the macro
// regime. Same rules as `wire/trading.ts`. `changePct` is a percent, as on `/v1/quotes`.

import type { InstrumentRefWire, TradingWireCaveat } from '@/app/server/wire/trading'
import type { SessionPhase, TypedPrice } from '@/app/server/wire/vocab'

/** A ranked name's identity and live price; what the board says about it is in `card`. */
interface ScreenCandidateWire {
  readonly instrument: InstrumentRefWire
  readonly name?: string
  readonly price?: number
  readonly changePct?: number
}

/** One ranked name as `/screen` prints it: its row, then the caution, prices and top factors. */
interface ScreenCardRowWire {
  readonly key: string
  readonly line: string
  readonly evidence: readonly string[]
}

interface ScreenCardWire {
  readonly title: string
  readonly notes: readonly string[]
  readonly rows: readonly ScreenCardRowWire[]
  readonly metrics: readonly string[]
  readonly provenance: readonly string[]
  readonly rejections: readonly string[]
  readonly movers: readonly string[]
  readonly caveats: readonly string[]
}

/** GET /v1/screen?market&kind&limit — ranked best first; no limit is the board `/screen` prints.
 *  `board: 'gate'` states per name whether it cleared, with no rank. */
export interface ScreenResponse {
  readonly market: string
  readonly asOf: string
  readonly dataThroughDay?: string
  readonly board: 'rank' | 'gate'
  readonly universeSize: number
  readonly candidates: readonly ScreenCandidateWire[]
  /** The lines `/screen` prints for this board, in the operator's language; the app shows them as
   *  is, so the board reads the same in the app, the CLI and Telegram. */
  readonly card: ScreenCardWire
}

/** GET /v1/instruments?q&limit — an exact symbol first, then catalog matches. Debounce typing: an
 *  exact crypto symbol asks the provider. */
export interface InstrumentSearchResponse {
  readonly matches: readonly {
    readonly instrument: InstrumentRefWire
    readonly name?: string
    readonly kind?: string
  }[]
}

interface OverviewRowWire {
  readonly instrument: InstrumentRefWire
  /** The live reading while the market trades, else the settled close. */
  readonly price?: number
  readonly changePct?: number
  /** The session `price` closed in; absent on a live reading. */
  readonly closedOn?: string
  /** When the live reading was taken. */
  readonly observedAt?: number
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
    /** The same figure as the CLI prints it, signed and in the market's currency. */
    readonly foreignNetText?: string
    readonly leaders?: OverviewLeadersWire
    readonly movers?: OverviewMoversWire
    readonly caveats: readonly TradingWireCaveat[]
  }[]
}

/** GET /v1/macro?region — the risk regime and the drivers behind it. A driver's position runs from
 *  `bearishAt` (defensive) to `bullishAt` (risk-on); `contribution`s sum to `score`. */
export type MacroResponse =
  | {
      readonly region: string
      readonly status: 'ready'
      readonly asOf: string
      /** When the sources were read (epoch ms); absent when none reported a read time. */
      readonly readAt?: number
      readonly regime: 'risk-on' | 'neutral' | 'risk-off'
      /** The regime the score alone implies; differs when a market lowered it. */
      readonly scoreRegime: 'risk-on' | 'neutral' | 'risk-off'
      readonly score: number
      /** The CLI's sentence for this lean (the regime and the two drivers pulling hardest). */
      readonly lean?: string
      /** The composite's scale and the cuts that name its regimes, for drawing the score. */
      readonly scoreRange: {
        readonly min: number
        readonly max: number
        readonly riskOffAt: number
        readonly riskOnAt: number
      }
      /** 0 to 1: share of the model's weight that had a reading. */
      readonly coverage: number
      readonly drivers: readonly {
        readonly id: string
        /** The driver's name in the operator's language. */
        readonly label: string
        readonly unit: 'percent' | 'level'
        readonly value: number
        readonly asOf: string
        readonly weight: number
        readonly bearishAt: number
        readonly bullishAt: number
        readonly contribution: number
      }[]
      /** The drivers with no reading, left out of the score; `label` in the operator's language. */
      readonly missing: readonly {
        readonly id: string
        readonly label: string
        readonly reason: 'no-observation' | 'observation-only' | 'fetch-error'
      }[]
      readonly caveats: readonly TradingWireCaveat[]
    }
  | {
      readonly region: string
      readonly status: 'unavailable'
      readonly caveats: readonly TradingWireCaveat[]
    }

/** GET /v1/market?region — what `/market` prints for the region's last closed session and the next
 *  report, in the daemon's language, one entry per line. It reads the sources, so it may take
 *  seconds; no model runs. */
export interface MarketSessionResponse {
  readonly region: string
  readonly text: readonly string[]
}

interface AlertWireBase {
  readonly id: string
  readonly instrument: InstrumentRefWire
  readonly condition: 'above' | 'below'
  readonly threshold: number
  /** `you` set it; `plan` is a suggestion's own stop or target (`level`), re-armed by the daemon;
   *  `screen` is a mover band. Only `you` alerts are worth a turn-off control: the daemon re-arms the
   *  others. */
  readonly source: 'you' | 'plan' | 'screen'
  readonly level?: 'stop' | 'target'
  /** Where it fires to: `api` is this app. */
  readonly channel: string
  readonly createdAt: number
}

export type AlertWire =
  | (AlertWireBase & { readonly state: 'active' })
  | (AlertWireBase & {
      readonly state: 'triggered' | 'fired'
      readonly triggeredAt: number
      readonly observedPrice: number
      /** Set once the notice reached its channel. */
      readonly firedAt?: number
    })
  | (AlertWireBase & { readonly state: 'disabled'; readonly disabledAt: number })

/** GET /v1/alerts?limit&cursor — newest first. */
export interface AlertsResponse {
  readonly alerts: readonly AlertWire[]
  readonly nextCursor?: string
  /** Active alerts in all, not on this page. */
  readonly activeCount: number
}

/** POST /v1/alerts body. The alert fires to this app. `market` may be left off where the ticker
 *  is unambiguous. Returns the created `AlertWire`. */
export interface AlertCreateBody {
  readonly instrument: { readonly ticker: string; readonly market?: string }
  readonly condition: 'above' | 'below'
  readonly threshold: number
  /** `unconfirmed` refuses a threshold far from the market with `price_unconfirmed`; absent never
   *  checks. */
  readonly typedPrice?: TypedPrice
}

/** DELETE /v1/alerts/:id — turns the alert off; it stays in the list. */
export interface AlertDisableResponse {
  readonly result: 'disabled' | 'already-disabled' | 'already-fired' | 'not-found'
}

/** GET /v1/markets: every registered market, in registration order. How it prints a price, so the
 *  app prints it the way the CLI does: a board-scaled market (`priceDisplay`) prints
 *  `price / divisor` at `decimals` and no currency; any other prints in `currency`, with `quoteUnit`
 *  naming the measure it is per. The labels are in the daemon's language. */
export interface MarketWire {
  readonly market: string
  readonly currency: string
  readonly quoteUnit: string
  readonly priceDisplay?: { readonly divisor: number; readonly decimals: number }
  readonly region: string
  /** Its calendar is its region's trading day; the owner of `homeRegion` is the default market. */
  readonly ownsRegion: boolean
  /** The profile segment it fills. */
  readonly segment: string
  /** The operator has that segment switched on. A market that is registered but off still trades
   *  and is listed here; world gold, read for reference only, is always off. */
  readonly enabled: boolean
  readonly label: string
  readonly segmentLabel: string
  readonly regionLabel: string
  readonly icon: string
  /** The index its suggestions are measured against. */
  readonly benchmark?: InstrumentRefWire
  /** When it trades, as `HH:MM` on `timeZone`'s clock, and its day at the request; absent for a
   *  market that never closes. */
  readonly session?: MarketSessionWire
  /** It answers `/v1/screen`, a morning brief, and `/v1/events`. */
  readonly hasBoard: boolean
  readonly hasBrief: boolean
  readonly hasEvents: boolean
}

/** `today` is the market's trading day on its own clock and `nextTradingDay` the next one it
 *  trades, both `YYYY-MM-DD`. A closure past the market's holiday table reads as a session. */
export interface MarketSessionWire {
  readonly timeZone: string
  readonly open: string
  readonly close: string
  readonly breaks?: readonly { readonly from: string; readonly to: string }[]
  /** The closing call auction, inside `open`: absent where the market closes without one. */
  readonly closeAuction?: { readonly from: string; readonly to: string }
  readonly today: string
  readonly tradesToday: boolean
  readonly nextTradingDay: string
  readonly phase: SessionPhase
}

export interface MarketsResponse {
  /** The operator's region (`[locale] region`). */
  readonly homeRegion: string
  readonly markets: readonly MarketWire[]
}

/** One sector's standing against its market's index. The returns are fractions (`0.05` is 5%):
 *  `sessionReturn` is today, the two excess returns lead the index over 20 and 60 sessions. */
interface SectorWire {
  readonly sector: string
  /** The sector's name in the daemon's language. */
  readonly label: string
  readonly memberCount: number
  readonly sessionReturn?: number
  readonly excessReturnShort?: number
  readonly excessReturnLong?: number
  readonly score?: number
}

/** GET /v1/sectors?market — strongest first. A market that files no sectors answers an empty list
 *  and says why in `caveats`. */
export interface SectorsResponse {
  readonly market: string
  readonly asOf: string
  readonly sectors: readonly SectorWire[]
  readonly caveats: readonly TradingWireCaveat[]
}

interface SourceWire {
  readonly id: string
  readonly kind: string
  readonly lastSuccessAt?: number
  /** Why its last call failed, in the daemon's language; absent when it has not failed. */
  readonly failure?: string
  /** `open` means the daemon stopped calling it for now. */
  readonly breaker: 'closed' | 'open'
}

/** GET /v1/sources — every data source the daemon reads. What it reports is this process's memory
 *  of its own calls, so a daemon that has called nothing yet reports no success either. */
export interface SourcesResponse {
  readonly sources: readonly SourceWire[]
}
