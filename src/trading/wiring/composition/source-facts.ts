import type { MessageKey } from '@/i18n'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { MacroSourceProfile } from '@/trading/sources/macro-gate'
import { sourceId } from '@/trading/kernel/source/source-id'
import {
  ALTERNATIVE_ME_DEFAULT_ENDPOINT,
  createAlternativeMeSources,
} from '@/trading/sources/adapters/alternative-me'
import {
  BINANCE_DEFAULT_ENDPOINT,
  BINANCE_FUTURES_DEFAULT_ENDPOINT,
} from '@/trading/sources/adapters/binance/client'
import {
  createBinanceFuturesSources,
  createBinanceSources,
} from '@/trading/sources/adapters/binance/sources'
import {
  BLS_DEFAULT_ENDPOINT,
  BLS_MACRO_PROFILE,
  createBlsSources,
} from '@/trading/sources/adapters/bls'
import { BYBIT_DEFAULT_ENDPOINT, createBybitSources } from '@/trading/sources/adapters/bybit'
import { CAFEF_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/cafef/client'
import { createCafefSources } from '@/trading/sources/adapters/cafef/sources'
import { CFTC_DEFAULT_ENDPOINT, createCftcSources } from '@/trading/sources/adapters/cftc'
import {
  COINBASE_DEFAULT_ENDPOINT,
  createCoinbaseSources,
} from '@/trading/sources/adapters/coinbase'
import {
  COINGECKO_DEFAULT_ENDPOINT,
  createCoinGeckoSources,
} from '@/trading/sources/adapters/coingecko'
import {
  COINLORE_DEFAULT_ENDPOINT,
  createCoinLoreSources,
} from '@/trading/sources/adapters/coinlore'
import {
  COINMARKETCAP_DEFAULT_ENDPOINT,
  createCoinMarketCapSources,
} from '@/trading/sources/adapters/coinmarketcap'
import {
  COINPAPRIKA_DEFAULT_ENDPOINT,
  createCoinPaprikaSources,
} from '@/trading/sources/adapters/coinpaprika'
import { createEntradeSources, ENTRADE_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/entrade'
import { createErApiSources, ER_API_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/er-api'
import {
  createFredSources,
  FRED_DEFAULT_ENDPOINT,
  FRED_MACRO_PROFILE,
} from '@/trading/sources/adapters/fred'
import {
  createFredCsvSources,
  FRED_CSV_DEFAULT_ENDPOINT,
} from '@/trading/sources/adapters/fred-csv'
import {
  createGiavangSources,
  GIAVANG_DEFAULT_ENDPOINT,
  GIAVANG_FALLBACK_ENDPOINT,
} from '@/trading/sources/adapters/giavang'
import {
  createGoogleNewsSources,
  GOOGLE_NEWS_DEFAULT_ENDPOINT,
} from '@/trading/sources/adapters/google-news'
import { createHsxSources, HSX_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/hsx'
import { createKbsecSources, KBSEC_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/kbsec'
import { createMexcSources, MEXC_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/mexc'
import { createNsoSources, NSO_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/nso'
import { createOkxSources, OKX_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/okx'
import { createPnjSources, PNJ_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/pnj'
import { createRssSources } from '@/trading/sources/adapters/rss'
import { createSbvSources, SBV_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/sbv'
import { createSsiSources, SSI_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/ssi'
import {
  createTreasurySources,
  TREASURY_DEFAULT_ENDPOINT,
  TREASURY_MACRO_PROFILE,
} from '@/trading/sources/adapters/treasury'
import {
  VIETCAP_DEFAULT_ENDPOINT,
  VIETCAP_STATEMENTS_ENDPOINT,
} from '@/trading/sources/adapters/vietcap/client'
import { createVietcapSources } from '@/trading/sources/adapters/vietcap/sources'
import { VNDIRECT_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/vndirect/client'
import { VNDIRECT_MACRO_PROFILE } from '@/trading/sources/adapters/vndirect/macro'
import { createVndirectSources } from '@/trading/sources/adapters/vndirect/sources'
import { createVpsSources, VPS_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/vps'
import { createYahooSources, YAHOO_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/yahoo'

/** Collected from each adapter module's own constant. An endpoint is a provider fact, not an
 *  operator judgment, so it is code-owned and no config can redirect a source at another host. */
export const SOURCE_ENDPOINTS = Object.freeze({
  [sourceId('alternative-me')]: ALTERNATIVE_ME_DEFAULT_ENDPOINT,
  [sourceId('binance')]: BINANCE_DEFAULT_ENDPOINT,
  [sourceId('binance-futures')]: BINANCE_FUTURES_DEFAULT_ENDPOINT,
  [sourceId('bls')]: BLS_DEFAULT_ENDPOINT,
  [sourceId('bybit')]: BYBIT_DEFAULT_ENDPOINT,
  [sourceId('cafef')]: CAFEF_DEFAULT_ENDPOINT,
  [sourceId('cafef-statements')]: CAFEF_DEFAULT_ENDPOINT,
  [sourceId('cftc')]: CFTC_DEFAULT_ENDPOINT,
  [sourceId('coinbase')]: COINBASE_DEFAULT_ENDPOINT,
  [sourceId('coingecko')]: COINGECKO_DEFAULT_ENDPOINT,
  [sourceId('coinlore')]: COINLORE_DEFAULT_ENDPOINT,
  [sourceId('coinmarketcap')]: COINMARKETCAP_DEFAULT_ENDPOINT,
  [sourceId('coinpaprika')]: COINPAPRIKA_DEFAULT_ENDPOINT,
  [sourceId('entrade')]: ENTRADE_DEFAULT_ENDPOINT,
  [sourceId('er-api')]: ER_API_DEFAULT_ENDPOINT,
  [sourceId('fred')]: FRED_DEFAULT_ENDPOINT,
  [sourceId('fred-csv')]: FRED_CSV_DEFAULT_ENDPOINT,
  [sourceId('giavang')]: [GIAVANG_DEFAULT_ENDPOINT, GIAVANG_FALLBACK_ENDPOINT],
  [sourceId('google-news')]: GOOGLE_NEWS_DEFAULT_ENDPOINT,
  [sourceId('hsx')]: HSX_DEFAULT_ENDPOINT,
  [sourceId('kbsec')]: KBSEC_DEFAULT_ENDPOINT,
  [sourceId('mexc')]: MEXC_DEFAULT_ENDPOINT,
  [sourceId('nso')]: NSO_DEFAULT_ENDPOINT,
  [sourceId('okx')]: OKX_DEFAULT_ENDPOINT,
  [sourceId('pnj')]: PNJ_DEFAULT_ENDPOINT,
  [sourceId('sbv')]: SBV_DEFAULT_ENDPOINT,
  [sourceId('ssi')]: SSI_DEFAULT_ENDPOINT,
  [sourceId('treasury')]: TREASURY_DEFAULT_ENDPOINT,
  [sourceId('vietcap')]: VIETCAP_DEFAULT_ENDPOINT,
  [sourceId('vietcap-board')]: VIETCAP_DEFAULT_ENDPOINT,
  [sourceId('vietcap-chart')]: VIETCAP_DEFAULT_ENDPOINT,
  [sourceId('vietcap-statements')]: VIETCAP_STATEMENTS_ENDPOINT,
  [sourceId('vndirect')]: VNDIRECT_DEFAULT_ENDPOINT,
  [sourceId('vps')]: VPS_DEFAULT_ENDPOINT,
  [sourceId('yahoo')]: YAHOO_DEFAULT_ENDPOINT,
})

/** The provider's published free-tier ceiling, or — where it publishes none — a rate a
 *  universe-wide sweep can sustain without the provider throttling us. Absent means unpaced, not
 *  zero, and unpaced is what turns one refused request into an open breaker; composition refuses
 *  to boot with a routed provider missing from here.
 *
 *  Two figures bound a burst rather than the quota that actually binds them, because a token bucket
 *  cannot express a day or a month: `bls` meters per day and `er-api` per month. Neither is near its
 *  allowance in ordinary use — `bls` is asked once per macro refresh and `er-api` is last in the
 *  `fx` route, reached only when the providers ahead of it decline — so what these numbers stop is a
 *  breaker storm spending an allowance in an afternoon. Set one far above the real peak and it stops
 *  nothing: a runaway at hundreds a minute empties a monthly quota in an hour, where a figure near
 *  the peak leaves half a day for the breaker and a human.
 *
 *  `coinmarketcap` publishes no ceiling for its keyless subset, so this is a rate one board read per
 *  run stays far inside while leaving a runaway somewhere to be caught.
 *
 *  `coinpaprika` publishes 10 a second and 20,000 a month; 60 a minute keeps a runaway sweep under both.
 *
 *  `coingecko` is a different case: keyless access is metered per IP, on a pool shared with
 *  everyone else behind it, and the granted band is 5-15 a minute rather than a fixed figure. No
 *  number here can prevent a refusal another caller on the same address earned, so this one sits
 *  inside the band, just above the busiest minute observed to succeed, and the route's next
 *  provider is what actually covers the refusals.
 *
 *  `typesafe` publishes no ceiling through OpenRouter; one debate asks it once, so sixty a minute
 *  is far above the peak and still catches a runaway.
 *
 *  `cafef-statements` publishes no ceiling. A name costs one page of about 33 KB, asked only for a
 *  name whose newest quarter lacks cash flow, so 60 a minute is far above the peak and still catches
 *  a runaway.
 *
 *  `vietcap-statements` publishes no ceiling. A name costs three requests, four for a bank, and a
 *  refresh asks for the board and the book, about 120 names, only when their reports are due, so
 *  120 a minute keeps the monthly burst near three minutes. */
export const SOURCE_RATE_LIMITS: Readonly<Partial<Record<SourceId, number>>> = Object.freeze({
  [sourceId('alternative-me')]: 30,
  [sourceId('binance')]: 600,
  [sourceId('binance-futures')]: 600,
  [sourceId('bls')]: 20,
  [sourceId('bybit')]: 600,
  [sourceId('cafef')]: 300,
  [sourceId('cafef-statements')]: 60,
  [sourceId('cftc')]: 20,
  [sourceId('coinbase')]: 60,
  [sourceId('coingecko')]: 10,
  [sourceId('coinlore')]: 60,
  [sourceId('coinmarketcap')]: 30,
  [sourceId('coinpaprika')]: 60,
  [sourceId('entrade')]: 60,
  [sourceId('er-api')]: 10,
  [sourceId('fred')]: 120,
  [sourceId('fred-csv')]: 30,
  [sourceId('giavang')]: 30,
  [sourceId('google-news')]: 60,
  [sourceId('hsx')]: 60,
  [sourceId('kbsec')]: 60,
  [sourceId('mexc')]: 600,
  [sourceId('nso')]: 10,
  [sourceId('okx')]: 600,
  [sourceId('pnj')]: 30,
  [sourceId('rss')]: 60,
  [sourceId('sbv')]: 10,
  [sourceId('ssi')]: 60,
  [sourceId('treasury')]: 60,
  [sourceId('vietcap')]: 60,
  [sourceId('vietcap-board')]: 30,
  [sourceId('vietcap-chart')]: 30,
  [sourceId('vietcap-statements')]: 120,
  [sourceId('vndirect')]: 300,
  [sourceId('vps')]: 30,
  [sourceId('yahoo')]: 60,
})

/** The macro sources the gate fronts, each declaring its own series and release cadence. A plugin
 *  macro source declares none and is read as it always was. */
export const MACRO_SOURCE_PROFILES: Readonly<Partial<Record<SourceId, MacroSourceProfile>>> =
  Object.freeze({
    [sourceId('bls')]: BLS_MACRO_PROFILE,
    [sourceId('fred')]: FRED_MACRO_PROFILE,
    [sourceId('treasury')]: TREASURY_MACRO_PROFILE,
    [sourceId('vndirect')]: VNDIRECT_MACRO_PROFILE,
  })

/** The providers that must be told plainly what this process is: FRED's API and its CSV host.
 *  Every other request goes out under `BROWSER_HEADERS`: a bot manager in front of a broker
 *  endpoint serves a browser or nothing, and the ones that do not care are no slower for it.
 *
 *  Re-probed against every provider host both ways on 2026-09-21. FRED's edge resets the stream for
 *  a browser string — curl reports no status at all, so no failover can read it as a refusal — and
 *  it is alone in that. `home.treasury.gov` is the opposite and the reason the default flipped: it
 *  tarpits the plain string at 18,0s against 1,7s, a guaranteed timeout under the attempt
 *  deadline. */
export const PLAIN_USER_AGENT_SOURCES: ReadonlySet<SourceId> = new Set([
  sourceId('fred'),
  sourceId('fred-csv'),
])

interface SourceCredentialFacts {
  readonly variable: string
  /** What setting it adds. Every credentialed source is optional: a keyless provider covers its
   *  kind, so the catalog line says what is lost without it, never that anything is broken. */
  readonly adds: MessageKey
  /** The source registers and serves without the key, on a smaller allowance. */
  readonly keylessTier?: true
}

/** The default variable *name* per source, which `[trading.sources]` may override. The value only
 *  ever comes from the environment, so no key is written to a config file. */
export const SOURCE_CREDENTIALS: Readonly<Record<string, SourceCredentialFacts>> = Object.freeze({
  [sourceId('bls')]: {
    variable: 'BLS_API_KEY',
    adds: 'trading.source.credential.bls',
    keylessTier: true,
  },
  [sourceId('coingecko')]: {
    variable: 'COINGECKO_API_KEY',
    adds: 'trading.source.credential.coingecko',
  },
  [sourceId('fred')]: { variable: 'FRED_API_KEY', adds: 'trading.source.credential.fred' },
})

export const SOURCE_CREDENTIAL_ENV: Readonly<Partial<Record<SourceId, string>>> = Object.freeze(
  Object.fromEntries(Object.entries(SOURCE_CREDENTIALS).map(([id, facts]) => [id, facts.variable]))
)

export function createBuiltInSources(adapters: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    ...createYahooSources(adapters),
    ...createFredSources(adapters),
    ...createFredCsvSources(adapters),
    ...createTreasurySources(adapters),
    ...createBlsSources(adapters),
    ...createRssSources(adapters),
    ...createGoogleNewsSources(adapters),
    ...createVndirectSources(adapters),
    ...createSbvSources(adapters),
    ...createNsoSources(adapters),
    ...createEntradeSources(adapters),
    ...createKbsecSources(adapters),
    ...createCafefSources(adapters),
    ...createVietcapSources(adapters),
    ...createVpsSources(adapters),
    ...createHsxSources(adapters),
    ...createSsiSources(adapters),
    ...createPnjSources(adapters),
    ...createGiavangSources(adapters),
    ...createErApiSources(adapters),
    ...createCoinGeckoSources(adapters),
    ...createCoinLoreSources(adapters),
    ...createCoinMarketCapSources(adapters),
    ...createCoinPaprikaSources(adapters),
    ...createCoinbaseSources(adapters),
    ...createBinanceSources(adapters),
    ...createBybitSources(adapters),
    ...createMexcSources(adapters),
    ...createOkxSources(adapters),
    ...createBinanceFuturesSources(adapters),
    ...createCftcSources(adapters),
    ...createAlternativeMeSources(adapters),
  ]
}
