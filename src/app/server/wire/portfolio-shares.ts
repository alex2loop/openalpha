/** GET /v1/portfolio `shares`: each segment held against the policy it answers to, as fractions of
 *  NAV (`0.1425` is 14.25%) rounded together as `/portfolio` prints them, so the page shows the
 *  chat's digits. `gap` is `weight - target`; positive is over. A segment held at zero with a zero
 *  target is left out. */
export interface PortfolioSharesWire {
  readonly segments: readonly {
    readonly segment: string
    readonly weight: number
    readonly target: number
    readonly gap: number
  }[]
}
