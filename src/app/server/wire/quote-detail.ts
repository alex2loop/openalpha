// What a quote carries beyond its price. Same rules as `wire/trading.ts`.

/** Both sides of a dealer's board (a VN gold shop), which states no last trade: `sellPrice` is what
 *  you pay and `buyPrice` what you get selling back, both in the market's currency per its quote
 *  unit. `spread` is (sell - buy) / sell, a fraction (`0.02` is 2%); absent when the board gives no
 *  sell price to measure against. A quote or overview row carrying one has the sell price as its
 *  price. */
export interface DealerBoardWire {
  readonly buyPrice: number
  readonly sellPrice: number
  readonly spread?: number
}

/** The lowest and highest price a session has printed so far, with the trading day it belongs to
 *  (`YYYY-MM-DD`: a provider whose series has not opened today answers with the previous
 *  session's). `volume` is what has traded, absent where the provider's series carries none. */
export interface SessionRangeWire {
  readonly day: string
  readonly low: number
  readonly high: number
  readonly volume?: number
}

/** What a quote carries beyond its price: the board of a dealer, whose `last` is then the sell
 *  price, and the range of a live session from a provider that serves an intraday series. */
export interface QuoteDetailWire {
  readonly board?: DealerBoardWire
  readonly session?: SessionRangeWire
}
