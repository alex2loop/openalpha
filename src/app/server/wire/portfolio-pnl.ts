/** GET /v1/portfolio: what the book has made, in `baseCurrency`. Every figure is the engine's own,
 *  the ones `/portfolio` prints. */
export interface PortfolioPnlWire {
  /** What the operator put in, net of what they took out. */
  readonly netDepositsBase?: number
  /** What closed trades made or lost, dividends and fees inside it. Sent while a holding is unpriced
   *  too: closed trades need no price. */
  readonly realizedPnlBase?: number
  /** Every dividend received; already inside `realizedPnlBase`. */
  readonly dividendsBase?: number
  /** `navBase - netDepositsBase`; absent with `navBase`. */
  readonly totalPnlBase?: number
  /** The trading fees inside the cost of what is held, not every fee paid; absent with `navBase`. */
  readonly feesBase?: number
  /** What every holding cost, fees inside; absent with `navBase`. */
  readonly investedBase?: number
  /** What the holdings are worth above `investedBase`, unpriced ones counted at cost; absent with
   *  `navBase`. */
  readonly unrealizedPnlBase?: number
}
