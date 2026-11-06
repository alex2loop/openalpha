import type { BriefSectionKind } from '@/trading/kernel/operator/brief-section'

type BriefSectionScope = 'book' | 'market'

/** Whether a kind is tied to the operator's own holdings or watchlist (`book`) or describes only a
 *  market (`market`). A `Record` over every kind, so a new kind fails typecheck until it is
 *  classified; the public brief publishes `market` kinds alone. */
export const BRIEF_SECTION_SCOPE = Object.freeze({
  'thesis-review': 'market',
  story: 'market',
  'session-delta': 'market',
  // Values the owner's ledger.
  'book-summary': 'book',
  // The owner's own suggestion outcomes.
  'resolved-suggestions': 'book',
  // Alerts the owner armed on held and watched names.
  'fired-alerts': 'book',
  // Held names against the stops and targets of their plans.
  'position-exits': 'book',
  // Held names the exit watch does not protect.
  'unwatched-positions': 'book',
  // Held names past their scoring window with the price gone nowhere.
  'stale-positions': 'book',
  // Held names under water, read from the valued book.
  'positions-in-loss': 'book',
  // Quotes the held and watched names outside the home market.
  'cross-asset-pulse': 'book',
  // Reads the trade-side rows the sweep stored for held and watched names.
  'trade-sides': 'book',
  // Reads the rebalance plan's segment drift.
  'drift-nudge': 'book',
  // Scores the owner's resolved suggestions.
  'monthly-scorecard': 'book',
  'regime-shift': 'market',
  macro: 'market',
  // Reads the rebalance plan's cash posture.
  'deposit-rate': 'book',
  'macro-headlines': 'market',
  'economy-headlines': 'market',
  reading: 'market',
  'market-prices': 'market',
  'market-quotes': 'market',
  'market-board': 'market',
  tape: 'market',
  breadth: 'market',
  turnover: 'market',
  range: 'market',
  'market-cap': 'market',
  'sector-rotation': 'market',
  'foreign-desk-flow': 'market',
  'proprietary-flow': 'market',
  derivatives: 'market',
  'taker-flow': 'market',
  'etf-flows': 'market',
  positioning: 'market',
  premium: 'market',
  leaders: 'market',
  'leaders-24h': 'market',
  'movers-session': 'market',
  'movers-24h': 'market',
  sentiment: 'market',
  basis: 'market',
  fx: 'market',
  // Ranks the owner's watchlist.
  'watchlist-leading': 'book',
  // Names the watchlist names that left the screen.
  'watchlist-dropped': 'book',
  'screen-delta': 'market',
  disclosures: 'market',
  'index-review': 'market',
  events: 'market',
  recent: 'market',
  headlines: 'market',
  // States what the owner's brief spent on the model.
  cost: 'book',
  // Model-written calls on held and watched names.
  suggestions: 'book',
  'cross-asset-suggestions': 'book',
  // Reads the held names, the watchlist and the book.
  'next-actions': 'book',
  // Restates the owner's profile limits.
  discipline: 'book',
} as const satisfies Record<BriefSectionKind, BriefSectionScope>)
