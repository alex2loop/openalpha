import type { DefaultVenues } from '@/trading/kernel/config'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceKind } from '@/trading/kernel/source/source-result'
import { marketRef } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'

const CRYPTO_MARKET = marketRef('crypto')

export type SourceRouteTable = Readonly<
  Record<SourceKind, Readonly<Record<string, readonly SourceId[]>>>
>

/** Routing: which providers serve a scope, in order. Scope is the request's market, or its region
 *  for the cross-market kinds, or `ANY_SCOPE` where the kind has no owning scope at all. Sources
 *  never restate this — `covers` answers request shape, this answers routing. */
export const ANY_SCOPE = '*'

export const SOURCE_ROUTES: SourceRouteTable = Object.freeze({
  quote: {
    'equity-us': [sourceId('nasdaq')],
    // vndirect leads for shares: its session row is written while the market trades. It declines a
    // level outright, so an index or a future falls to `vietcap-chart`, whose intraday series keeps
    // advancing through the session where entrade's truncates its newest bars for some windows and
    // answers hours behind without failing. Neither miss is visible to a failover, which is why the
    // market ages every reading it is handed.
    'equity-vn': [sourceId('vndirect'), sourceId('vietcap-chart'), sourceId('entrade')],
    // Listing order; `withVenueQuoteLead` moves the market's default venue to the front. All four
    // are keyless and unmetered by the month, which matters because the alert loop reads a quote
    // per watched coin every tick. coinbase is last: it prices in dollars and converts through
    // USDT, so it costs two requests a coin, and it is the one a US operator can always reach.
    crypto: [sourceId('binance'), sourceId('okx'), sourceId('mexc'), sourceId('coinbase')],
    gold: [sourceId('yahoo'), sourceId('binance')],
  },
  bars: {
    'equity-us': [sourceId('nasdaq')],
    // vndirect declines an index outright, so `vndirect-index` is the first provider an index
    // reaches: its closes matched vps over 953 sessions and vietcap-chart and the stored entrade
    // series over 120, on every index measured, from the deepest history and with no frozen bar.
    // entrade charts only the four headline indices and freezes a newest bar, so it stands behind;
    // the ETF benchmarks it declines reach vietcap-chart, then vps, last because its turnover counts
    // matched orders only.
    'equity-vn': [
      sourceId('vndirect'),
      sourceId('vndirect-index'),
      sourceId('entrade'),
      sourceId('vietcap-chart'),
      sourceId('vps'),
    ],
    crypto: [
      sourceId('binance'),
      sourceId('bybit'),
      sourceId('mexc'),
      sourceId('coinbase'),
      sourceId('yahoo'),
    ],
    gold: [sourceId('yahoo'), sourceId('binance')],
  },
  instruments: { 'equity-us': [sourceId('nasdaq')], 'equity-vn': [sourceId('vndirect')] },
  // The whole board in one read, so the count is a request rather than a fan-out. vndirect leads:
  // its rows are the same ones the settled evidence is built from, so a count off them and a count
  // off the stored session measure one population. The fallback registers under its own id: a
  // market-wide read must not open the breaker on the per-name kinds that share its host.
  sessionQuotes: { 'equity-vn': [sourceId('vndirect'), sourceId('vietcap-board')] },
  fundamentals: { 'equity-us': [sourceId('nasdaq')], 'equity-vn': [sourceId('vndirect')] },
  accounts: { 'equity-us': [sourceId('sec-data')], 'equity-vn': [sourceId('vietcap-statements')] },
  // Fills a quarter's missing cash flow and is not a failover for `accounts`: the refresh asks for it
  // only where the primary reply lacks that statement.
  cashFlowToDate: { 'equity-vn': [sourceId('cafef-statements')] },
  events: {
    'equity-us': [sourceId('nasdaq'), sourceId('sec-data')],
    'equity-vn': [sourceId('vndirect')],
  },
  flows: { 'equity-vn': [sourceId('vndirect')] },
  // Not a failover for `flows`: cafef publishes the proprietary desk alone, and two sessions ahead
  // of the endpoint that carries both legs. The flows reader asks for it only where that leg is
  // still unset.
  proprietaryFlows: { 'equity-vn': [sourceId('cafef')] },
  tradeSides: { 'equity-vn': [sourceId('kbsec'), sourceId('vietcap')] },
  foreignRoom: { 'equity-vn': [sourceId('vndirect'), sourceId('vietcap-board')] },
  // Merged, not failed over: hsx is HOSE's own listing service and ssi's broker board is the only
  // free endpoint that also carries HNX, so the union is what covers the market. Each read states
  // the boards it covered, and a board no read covered leaves its names unknown rather than clear.
  supervision: { 'equity-vn': [sourceId('hsx'), sourceId('ssi')] },
  // Failed over: vietcap's baskets nest and its VN100 list is current. vps-board's VN30 list is the
  // same, but its VN100 list ran behind (four of its own VN30 names missing, nine names apart), so it
  // answers only a pair that nests and otherwise leaves the stored tiers standing.
  indexMembership: { 'equity-vn': [sourceId('vietcap'), sourceId('vps-board')] },
  recommendations: { 'equity-vn': [sourceId('vndirect')] },
  // Merged, not failed over: no provider serves every series, and route order is precedence where
  // two publish the same one. The keyless pair leads so an unkeyed install still reads macro.
  macro: {
    us: [sourceId('treasury'), sourceId('bls'), sourceId('fred')],
    vn: [sourceId('vndirect')],
  },
  // The issuer itself: the State Bank sets the policy rates and publishes the interbank averages.
  policyRates: { vn: [sourceId('sbv')] },
  // The office itself. It is intermittently unreachable from abroad; the extraction loop retries
  // on its next tick, and a monthly report stays online for weeks.
  statReports: { vn: [sourceId('nso')] },
  // Each source covers only the commodities it maps, so the order never ranks two answers for one
  // commodity: vndirect's exchange feed is daily, FRED's statistics series monthly.
  commodityPrices: { [ANY_SCOPE]: [sourceId('vndirect'), sourceId('fred-csv')] },
  valuationRatios: { 'equity-vn': [sourceId('vndirect')] },
  // An index's own breakdown: the ratios are what the daemon stores a day at a time, and the
  // contributors are read when asked, from the broker's market-watch host.
  indexValuation: { 'equity-vn': [sourceId('vndirect')] },
  indexContributors: { 'equity-vn': [sourceId('vndirect-mkw')] },
  sentiment: { crypto: [sourceId('alternative-me')] },
  funding: { crypto: [sourceId('binance-futures')] },
  // CoinMarketCap leads: its keyless listing answers the whole ranked window in one request.
  // CoinPaprika answers the same window in one request on a published monthly quota, so it is the
  // first fallback. coinlore serves 100 rows and covers only the ranks that carry a screen.
  // CoinGecko sits last because its keyless band is shared per IP and refuses in bursts, but it is
  // the one provider that looks a symbol up, so a coin past every board still resolves there.
  marketCap: {
    crypto: [
      sourceId('coinmarketcap'),
      sourceId('coinpaprika'),
      sourceId('coinlore'),
      sourceId('coingecko'),
    ],
  },
  // Merged, not failed over: no vendor quotes every domestic form, so the first usable board would
  // drop whichever form only a later vendor carries. Route order is row precedence.
  goldBoard: {
    'gold-vn': [sourceId('giavang'), sourceId('pnj')],
  },
  // The only vendor with a dated history of the bar. Never merge a second one: two vendors sample at
  // different hours, and a window measured two ways ranks a day by which vendor answered.
  goldBoardHistory: {
    'gold-vn': [sourceId('giavang')],
  },
  // The coin providers lead and self-select: they cover only a pair whose base is a coin they can
  // price, and yahoo and er-api split a pair into two ISO codes so they never cover one. A fiat
  // pair therefore reaches yahoo untouched, and a coin pair never reaches it at all. coinbase leads
  // the pair it trades: the crypto book is valued through that rate, and a venue quoting its own
  // tape is neither metered nor an index. okx backs it for the same reason, and backs rather than
  // leads because coinbase's book in the pair is the deeper one.
  fx: {
    [ANY_SCOPE]: [
      sourceId('coinbase'),
      sourceId('okx'),
      sourceId('coingecko'),
      sourceId('yahoo'),
      sourceId('er-api'),
    ],
  },
  // Yahoo leads: the coin providers quote a pair's spot, not its dated history, and er-api
  // publishes today's board only; Yahoo also dates a coin's dollar leg (`USDT-USD`). vietcombank
  // backs it for the VND pairs alone: the bank's board is set once or twice a day, so a day's rate
  // is not the market's close, and it reaches a pair only when Yahoo failed to answer. A pair nobody
  // carries history for leaves the confirmer silent.
  fxHistory: { [ANY_SCOPE]: [sourceId('yahoo'), sourceId('vietcombank')] },
  // Per market, not ANY_SCOPE: rss serves only the markets RSS_FEEDS names a feed for. The
  // ANY_SCOPE arm is the macro tape, which is nobody's market. The two providers in a market that
  // has both partition the requests rather than failing over: one serves an instrument, the other
  // refuses to, so a market read never stands in for a name's own coverage.
  news: {
    'equity-us': [sourceId('google-news'), sourceId('rss')],
    'equity-vn': [sourceId('vndirect'), sourceId('rss')],
    crypto: [sourceId('google-news'), sourceId('rss')],
    gold: [sourceId('rss')],
    'gold-vn': [sourceId('rss')],
    [ANY_SCOPE]: [sourceId('rss')],
  },
  positioning: {
    gold: [sourceId('cftc')],
  },
  // Unrouted: no provider verified against a live response. Consumers treat the absence as normal.
  etfFlows: {},
  // One provider and no scope: a judgment over supplied text belongs to no market. Registered only
  // when the OpenRouter key resolves, so an unkeyed install reads `unconfigured` and abstains.
} as const satisfies SourceRouteTable)

/** A plan priced anywhere but the venue its orders go to names a number the operator cannot fill
 *  at, so crypto's quote leads with its default venue when that venue is also a provider. Gold is
 *  not one: its quote is the futures reference, not the token a venue fills. */
export function withVenueQuoteLead(
  routes: SourceRouteTable,
  venues: DefaultVenues
): SourceRouteTable {
  const venue: string | undefined = venues[CRYPTO_MARKET]
  const route = routes.quote[CRYPTO_MARKET] ?? []

  if (!route.some((id) => id === venue)) {
    return routes
  }

  const led = [...route.filter((id) => id === venue), ...route.filter((id) => id !== venue)]

  return Object.freeze({
    ...routes,
    quote: Object.freeze({ ...routes.quote, [CRYPTO_MARKET]: led }),
  })
}

/** The table a page serves: only providers a browser can reach, in the same order. A scope left
 *  with none is dropped, which reads as not served and never as failed. */
export function toBrowserRoutes(
  routes: SourceRouteTable,
  reachable: ReadonlySet<SourceId>
): SourceRouteTable {
  const kinds = Object.entries(routes).map(([kind, scopes]) => [
    kind,
    reachableScopes(scopes, reachable),
  ])

  // why-safe: the entries are the table's own kinds, each mapped to a scope table.
  return Object.freeze(Object.fromEntries(kinds)) as SourceRouteTable
}

function reachableScopes(
  scopes: Readonly<Record<string, readonly SourceId[]>>,
  reachable: ReadonlySet<SourceId>
): Readonly<Record<string, readonly SourceId[]>> {
  const kept = Object.entries(scopes)
    .map(([scope, ids]) => [scope, ids.filter((id) => reachable.has(id))] as const)
    .filter(([, ids]) => ids.length > 0)

  return Object.freeze(Object.fromEntries(kept))
}

/** A plugin may open a scope no built-in serves, or stand behind one that exists. It can never be
 *  tried before a first-party provider, so a plugin cannot quietly become the primary for a market
 *  the runtime already covers. */
