/** The macro series catalogue: which series the composite can weight, the field each renders
 *  through, and the version of the formula that folds them. Reference data with no dependencies of
 *  its own, so the record shapes and the risk view can both read it without importing each other. */

export const MACRO_SERIES_IDS = Object.freeze([
  'us-real-rate',
  'us-inflation-yoy',
  'usd-index',
  'us-10y-yield',
  'us-volatility',
  'deposit-rate-12m',
  'usd-vnd',
  'vn-index-trend',
  'vn-breadth',
  'btc-trend',
  'eth-btc-trend',
  'alt-breadth',
] as const)
export type MacroSeriesId = (typeof MACRO_SERIES_IDS)[number]

/** Which brief field carries each series' value, because the unit differs per series: percent
 *  series render as fractions, index levels as plain amounts, money as compact flow. */
export const MACRO_SERIES_FIELDS = Object.freeze({
  'us-real-rate': 'valuePct',
  'us-inflation-yoy': 'valuePct',
  'usd-index': 'index',
  'us-10y-yield': 'valuePct',
  'us-volatility': 'index',
  'deposit-rate-12m': 'valuePct',
  'usd-vnd': 'value',
  'vn-index-trend': 'valuePct',
  'vn-breadth': 'valuePct',
  'btc-trend': 'valuePct',
  'eth-btc-trend': 'valuePct',
  'alt-breadth': 'valuePct',
} as const satisfies Record<MacroSeriesId, 'valuePct' | 'index' | 'value'>)

export const MACRO_FORMULA_VERSION = '1.0.0'
