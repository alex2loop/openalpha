/** The macro series catalogue: which series the composite can weight, the field each renders
 *  through, and the version of the formula that folds them. Reference data with no dependencies of
 *  its own, so the record shapes and the risk view can both read it without importing each other. */

export const MACRO_SERIES_IDS = Object.freeze([
  'us-real-rate',
  'us-inflation-yoy',
  'usd-index',
  'us-10y-yield',
  'us-term-spread',
  'us-volatility',
  'us-equity-index',
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
  'us-term-spread': 'valuePct',
  'us-volatility': 'index',
  'us-equity-index': 'index',
  'deposit-rate-12m': 'valuePct',
  'usd-vnd': 'value',
  'vn-index-trend': 'valuePct',
  'vn-breadth': 'valuePct',
  'btc-trend': 'valuePct',
  'eth-btc-trend': 'valuePct',
  'alt-breadth': 'valuePct',
} as const satisfies Record<MacroSeriesId, 'valuePct' | 'index' | 'value'>)

/** Calendar days a series may lag the macro block's day before its row says the reading is old,
 *  sized to how often each one publishes: daily series cover a long weekend, crypto trends only a
 *  day or two, the deposit rate a week and the monthly inflation print a month and a half. */
export const MACRO_SERIES_STALE_AFTER_DAYS = Object.freeze({
  'us-real-rate': 4,
  'us-inflation-yoy': 45,
  'usd-index': 4,
  'us-10y-yield': 4,
  'us-term-spread': 4,
  'us-volatility': 4,
  'us-equity-index': 4,
  'deposit-rate-12m': 7,
  'usd-vnd': 4,
  'vn-index-trend': 4,
  'vn-breadth': 4,
  'btc-trend': 2,
  'eth-btc-trend': 2,
  'alt-breadth': 2,
} as const satisfies Record<MacroSeriesId, number>)

export const MACRO_FORMULA_VERSION = '1.0.0'
