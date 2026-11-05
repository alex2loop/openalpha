const MARKS = /\p{M}/gu
const NON_WORD = /[^\p{L}\p{N}]+/gu

/** The order the glossary lists its groups in. */
export const GLOSSARY_GROUPS = Object.freeze([
  'index',
  'valuation',
  'flow',
  'derivatives',
  'technical',
  'banking',
] as const)

export type GlossaryGroup = (typeof GLOSSARY_GROUPS)[number]

/** What a term is known by outside the glossary: the ids of the facts and readings that carry it,
 *  the tickers that name it, the markets it is the name of and the instrument kinds it explains.
 *  Matching is by id, never by a label's translated text. */
interface GlossaryTerm {
  readonly id: string
  readonly group: GlossaryGroup
  readonly facts?: readonly string[]
  readonly tickers?: readonly string[]
  readonly markets?: readonly string[]
  readonly kinds?: readonly string[]
}

/** Every term, in the order its group lists it. A term's text lives in the catalogs under
 *  `trading.glossary.term.<id>`; `facts` are the ids the screen board and `/overview` give their
 *  readings (`FactorMetricId` for a board, the section field for an overview section). */
export const GLOSSARY_TERMS = [
  { id: 'vn-index', group: 'index', tickers: ['VNINDEX'] },
  { id: 'vn30', group: 'index', tickers: ['VN30'] },
  { id: 'vn100', group: 'index', tickers: ['VN100'] },
  { id: 'vnmidcap', group: 'index', tickers: ['VNMIDCAP'] },
  { id: 'vnx50', group: 'index', tickers: ['VNX50'] },
  { id: 'vndiamond', group: 'index', tickers: ['VNDIAMOND'] },
  { id: 'vnfinlead', group: 'index', tickers: ['VNFINLEAD'] },
  { id: 'vnfinselect', group: 'index', tickers: ['VNFINSELECT'] },
  { id: 'vnmitech', group: 'index', tickers: ['VNMITECH'] },
  { id: 'vnshine', group: 'index', tickers: ['VNSHINE'] },
  { id: 'hnx-index', group: 'index', tickers: ['HNX'] },
  { id: 'etf', group: 'index', kinds: ['etf'] },
  { id: 'spy', group: 'index', tickers: ['SPY'] },
  { id: 'ndx', group: 'index', tickers: ['NDX'] },
  { id: 'world-gold', group: 'index', tickers: ['XAUUSD'], markets: ['gold'] },
  { id: 'gold-premium', group: 'index', facts: ['premium', 'world-gold-premium'] },
  { id: 'pe', group: 'valuation', facts: ['pe', 'average-profit-pe', 'sector-pe'] },
  { id: 'pb', group: 'valuation', facts: ['pb'] },
  { id: 'roe', group: 'valuation', facts: ['return-on-equity'] },
  { id: 'dividend-yield', group: 'valuation' },
  { id: 'debt-to-equity', group: 'valuation', facts: ['debt-to-equity'] },
  { id: 'market-cap', group: 'valuation', facts: ['market-cap'] },
  { id: 'foreign-net', group: 'flow', facts: ['foreign-net-flow'] },
  { id: 'foreign-room', group: 'flow', facts: ['foreign-room-left'] },
  { id: 'proprietary-flow', group: 'flow', facts: ['proprietary-net-flow'] },
  { id: 'funding-rate', group: 'derivatives', facts: ['funding-daily', 'funding'] },
  {
    id: 'open-interest',
    group: 'derivatives',
    facts: ['open-interest-change', 'openInterest', 'oiRatio'],
  },
  {
    id: 'long-short-ratio',
    group: 'derivatives',
    facts: ['long-short-ratio', 'longShortRatio', 'long-short'],
  },
  { id: 'taker-buy', group: 'derivatives', facts: ['takerBuyPct'] },
  { id: 'fear-greed', group: 'derivatives', facts: ['sentimentScore'] },
  { id: 'ma50', group: 'technical', facts: ['trend-average'] },
  { id: 'range', group: 'technical', facts: ['average-range', 'daily-volatility'] },
  { id: 'breadth', group: 'technical' },
  { id: 'turnover', group: 'technical', facts: ['median-turnover', 'volume-24h'] },
  { id: 'relative-volume', group: 'technical', facts: ['relative-volume'] },
  { id: 'npl', group: 'banking', facts: ['bad-debt-ratio'] },
  { id: 'casa', group: 'banking', facts: ['casa-share'] },
  { id: 'capital-adequacy', group: 'banking', facts: ['capital-adequacy'] },
  { id: 'provision-cover', group: 'banking', facts: ['provision-cover'] },
] as const satisfies readonly GlossaryTerm[]

export type GlossaryTermId = (typeof GLOSSARY_TERMS)[number]['id']

/** A term as a reader meets it, in one locale. */
export interface GlossaryEntry {
  readonly id: GlossaryTermId
  readonly name: string
  readonly definition: string
  /** The tickers that name it, so a search for `VNINDEX` finds the term. */
  readonly tickers: readonly string[]
}

/** A group's heading and what it covers, over its terms in listing order. */
export interface GlossaryGroupEntry {
  readonly group: GlossaryGroup
  readonly title: string
  readonly about: string
  readonly terms: readonly GlossaryEntry[]
}

/** The group whose description a heading explains, by the heading's own id: a screen board's group
 *  or an overview section's kind. A heading not listed has no definition. */
const HEADING_GROUPS: Readonly<Record<string, GlossaryGroup>> = Object.freeze({
  price: 'technical',
  valuation: 'valuation',
  flow: 'flow',
  derivatives: 'derivatives',
  'taker-flow': 'flow',
  sentiment: 'derivatives',
})

/** The term a market is the name of (world gold). */
export function termOfMarket(marketId: string): GlossaryTermId | undefined {
  return termWhere((term) => term.markets, marketId)
}

/** The term a board or overview fact carries, by the fact's id. */
export function termOfFact(factId: string): GlossaryTermId | undefined {
  return termWhere((term) => term.facts, factId)
}

/** The term a ticker names (an index, an ETF, world gold). */
export function termOfTicker(ticker: string): GlossaryTermId | undefined {
  return termWhere((term) => term.tickers, ticker)
}

/** The term an instrument kind is (a fund), for a name the glossary does not list by ticker. */
export function termOfKind(kind: string): GlossaryTermId | undefined {
  return termWhere((term) => term.kinds, kind)
}

/** The tickers that name a term; none for a term no ticker names. */
export function tickersOfTerm(id: GlossaryTermId): readonly string[] {
  const term: GlossaryTerm | undefined = GLOSSARY_TERMS.find((candidate) => candidate.id === id)

  return term?.tickers ?? []
}

/** The glossary group a heading explains, by the heading's id. */
export function groupOfHeading(headingId: string): GlossaryGroup | undefined {
  return Object.hasOwn(HEADING_GROUPS, headingId) ? HEADING_GROUPS[headingId] : undefined
}

function termWhere(
  idsOf: (term: GlossaryTerm) => readonly string[] | undefined,
  id: string
): GlossaryTermId | undefined {
  return GLOSSARY_TERMS.find((term) => idsOf(term)?.includes(id) === true)?.id
}

/** Lower case, accents and `đ` folded, separators collapsed to one space: what a reader types
 *  (`room ngoai`) compares equal to what the catalog writes (`Room ngoại`). */
export function foldGlossaryText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(MARKS, '')
    .replaceAll('đ', 'd')
    .replace(NON_WORD, ' ')
    .trim()
}

/** True when the folded query is empty or sits inside any of the folded fields. */
export function matchesGlossaryQuery(fields: readonly string[], query: string): boolean {
  const needle = foldGlossaryText(query)

  return needle === '' || fields.some((field) => foldGlossaryText(field).includes(needle))
}
