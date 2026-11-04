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

/** What a quote carries beyond its price: the board of a dealer, whose `last` is then the sell
 *  price. */
export interface QuoteDetailWire {
  readonly board?: DealerBoardWire
}
