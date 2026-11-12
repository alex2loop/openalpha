// The /v1 market contract: the screen board, instrument search and the macro regime. Same rules as
// `wire/trading.ts`. `changePct` is a percent, as on `/v1/quotes`.

import type { InstrumentRefWire, TradingWireCaveat } from '@/app/server/wire/trading'
import type { SessionPhase, TypedPrice } from '@/app/server/wire/vocab'

/** One measured quantity of a name: what it is, over how many sessions where it is a window, and
 *  its value in the unit the market publishes it in (a percent as a percent, an amount in the
 *  market's currency), so a page can order and filter on it. */
interface ScreenFigureWire {
  readonly id: string
  readonly sessions?: number
  readonly value: number
}

/** A plain value a market states beside a name's factors, with the words the CLI writes for it. */
interface ScreenReadingWire extends ScreenFigureWire {
  readonly text: string
}

/** What one factor read for a name of a `list` board. */
interface ScreenFactorWire {
  readonly id: string
  /** The factor's name in the operator's language. */
  readonly label: string
  /** What the factor read for this name, in the quantities it was scored on, as the CLI writes
   *  them (`P/E 12,3`); absent where the factor states none. Never its score. */
  readonly reading?: string
  /** Percent-valued, 0-100: the share of the board's names this reading is above. Absent where
   *  fewer than two names carry the factor, which leaves nothing to place it against. */
  readonly percentile?: number
  /** The quantities behind `reading`, as numbers. Absent where the factor states none. */
  readonly metrics?: readonly ScreenFigureWire[]
}

/** Where a fact of a name is listed: price and liquidity, valuation and quality, money flow, and
 *  derivatives, in that order. */
type ScreenFactGroup =
  | 'valuation'
  | 'profitability'
  | 'growth'
  | 'health'
  | 'price'
  | 'flow'
  | 'derivatives'

/** One thing a board reads for a name, written as the CLI lists it: the label capitalized, the
 *  value with its unit. A factor's place among the board's names joins the reading of the same name,
 *  else it is a fact of its own, labeled with the factor and valued in plain words. Each reading
 *  once, in a fixed order. */
export interface ScreenFactWire {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly group: ScreenFactGroup
}

/** A name's identity and live price; on a ranked board what the board says about it is in `card`,
 *  on a `list` board its factors are here. */
interface ScreenCandidateWire {
  readonly instrument: InstrumentRefWire
  readonly name?: string
  readonly price?: number
  readonly changePct?: number
  /** `list` boards only, each absent where the market holds no such figure: the market's sector
   *  slug, the market value, the median daily traded value (both in the market's currency), the
   *  move over about a month (a percent) and the foreign desk's net over that month (currency). */
  readonly sector?: string
  readonly marketCap?: number
  readonly turnover?: number
  readonly monthChangePct?: number
  readonly foreignNet?: number
  /** What the board reads for the name, grouped and each reading once, as the CLI lists them. */
  readonly facts?: readonly ScreenFactWire[]
  /** The factors that had nothing to read for the name, in the operator's language. */
  readonly missing?: readonly string[]
  /** `list` boards only: the factors that fired for the name, in a fixed order. */
  readonly factors?: readonly ScreenFactorWire[]
  /** `list` boards only: the plain values the market states beside the factors (where the name
   *  stands in its year, how far it swings, its size, its move over a week), in a fixed order.
   *  Never a score. */
  readonly readings?: readonly ScreenReadingWire[]
  /** `list` boards only: the name is on the operator's exclusion list. */
  readonly excluded?: true
  /** `list` boards only: the share (0-1) of the model's factors that had data for the name; absent
   *  when every one did. */
  readonly coverage?: number
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

/** GET /v1/screen?market&kind&limit&cursor&ticker — ranked best first; no limit is the board `/screen`
 *  prints. `board: 'gate'` states per name whether it cleared, with no rank. `board: 'list'` is an
 *  edition that ranks nothing: every priced name in ticker order, a page of `limit` names from
 *  `cursor` with `next` for the one after, each with its factors' readings and percentiles, and no
 *  composite, rating or rank anywhere, `card` included. */
export interface ScreenResponse {
  readonly market: string
  readonly asOf: string
  readonly dataThroughDay?: string
  readonly board: 'rank' | 'gate' | 'list'
  readonly universeSize: number
  readonly candidates: readonly ScreenCandidateWire[]
  /** `list` boards only: the names on the whole board, not just this page. */
  readonly total?: number
  /** `list` boards only: the cursor of the next page; absent on the last. */
  readonly next?: string
  /** `list` boards only: names that cleared the gates but had no price, so are not listed. */
  readonly unpriced?: number
  /** The kinds the market's screen can be narrowed to, named in the operator's language, where it
   *  has more than one; the first is the board served when `kind` is not asked. */
  readonly kinds?: readonly { readonly kind: string; readonly label: string }[]
  /** The market's first load still runs: the board is what is stored so far (see CONTRACT.md). */
  readonly isLoading?: true
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
      /** Every series the read carried by id (`deposit-rate-12m` in percent, `usd-vnd` in dong per
       *  dollar), drivers or not; a series with no reading is absent. */
      readonly readings: Readonly<Record<string, number>>
      readonly drivers: readonly {
        readonly id: string
        /** The driver's name in the operator's language. */
        readonly label: string
        readonly unit: 'percent' | 'level'
        readonly value: number
        readonly asOf: string
        /** A share of 0 to 1, rounded across the drivers to whole percents that still sum as the
         *  chat prints them. */
        readonly weight: number
        readonly bearishAt: number
        readonly bullishAt: number
        /** Rounded across the drivers to two decimals that still sum as the chat prints them. */
        readonly contribution: number
      }[]
      /** The drivers with no reading, left out of the score; `label` in the operator's language. */
      readonly missing: readonly {
        readonly id: string
        readonly label: string
        readonly reason: 'no-observation' | 'observation-only' | 'fetch-error' | 'unserved'
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
  /** Some venue can hold it; world gold, a reference read, cannot, so a page lists it although it is
   *  never enabled. */
  readonly holdable: boolean
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
  /** It answers `/v1/index-contributors` and `/v1/index-valuation`. */
  readonly hasIndexes: boolean
  /** It answers `/v1/ohlcv` with its own price history; VN gold's bars are world gold in USD, a
   *  reference series, so it has none. */
  readonly hasBars: boolean
}

/** `today` is the market's trading day on its own clock and `nextTradingDay` the next one it
 *  trades, both `YYYY-MM-DD`. */
export interface MarketSessionWire {
  /** The exchange whose hours these are, as a proper noun printed as is (`HOSE`); absent where no
   *  one exchange sets them. */
  readonly exchange?: string
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
