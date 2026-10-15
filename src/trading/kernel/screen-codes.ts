/** A screen's rejection vocabulary. It lives in the kernel rather than inside the market that
 *  currently implements the checks, because the locale manifest must derive its keys without
 *  importing a market internal. Ordered cheapest-and-most-fundamental first, so the recorded
 *  rejection is the *most informative* one rather than whichever check ran first. */
const SCREEN_GATE_CODES = Object.freeze([
  'not-listed-on-venue',
  'venue-price-diverged',
  'no-price-history',
  'insufficient-history',
  'below-minimum-traded-sessions',
  'below-minimum-market-cap',
  'below-minimum-free-float',
  'below-minimum-turnover',
  'abnormal-trading-status',
  'under-trading-restriction',
  'under-supervision',
  'ceiling-locked',
  'recent-limit-hits',
  'volatility-above-maximum',
  'volatility-below-minimum',
  'choppy-range',
  'venue-book-too-thin',
] as const)
export type ScreenGateCode = (typeof SCREEN_GATE_CODES)[number]

/** Why a name the operator follows left the eligible board: a gate it failed, or one of the two
 *  answers the screen itself cannot give. Superset of the gates, so both share one message prefix
 *  while the gate union the screen returns stays closed. */
export const WATCHLIST_DROP_REASONS = Object.freeze([
  ...SCREEN_GATE_CODES,
  'not-in-universe',
  'unknown',
] as const)
export type WatchlistDropReason = (typeof WATCHLIST_DROP_REASONS)[number]

/** What contradicts a rank the settled close was built on: the live price, or a standing fact the
 *  market reads off stored evidence. Kept apart from the gate vocabulary because none of these
 *  removes a name from the board: the rank stands, and only what the row claims about it falls. */
export const SCREEN_CAUTION_CODES = Object.freeze([
  'ceiling-locked',
  'gapped-past-close',
  'foreign-room-exhausted',
] as const)
export type ScreenCautionCode = (typeof SCREEN_CAUTION_CODES)[number]
