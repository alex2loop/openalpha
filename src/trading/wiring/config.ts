import type { z } from 'zod'

import type {
  BriefPolicy,
  CostRates,
  DefaultVenues,
  IntradayPolicy,
  MarketConfig,
  MarketConfigs,
  OperationsPolicy,
  OrderPolicy,
  TradingConfig,
  TradingCosts,
  VenueConfig,
  VenueConfigs,
} from '@/trading/kernel/config'
import type { MarketRef, VenueRef } from '@/trading/kernel/instrument'
import type { SourceId } from '@/trading/kernel/source/source-id'
import { OperatorConfigError, toInvalidConfigError } from '@/core/config/resolve'
import { ValidationError } from '@/core/errors'
import { freezeDeep } from '@/core/utils/freeze'
import { currencyCode, marketRef, region, tradingDay, venueRef } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { BUILT_IN_VENUES, DEFAULT_TRADING_CONFIG } from '@/trading/wiring/config-defaults'
import { tradingConfigPatchSchema, VENUES_CONFIG_KEY } from '@/trading/wiring/config-schema'

/** This module is the section's only claimant, so it owns the name. `app` reads it to assert no
 *  unclaimed section boots in silence rather than repeating the literal. */
export const TRADING_CONFIG_SECTION = 'trading'

const LOCALE_CONFIG_SECTION = 'locale'

type TradingConfigPatch = z.infer<typeof tradingConfigPatchSchema>

interface ResolveTradingConfigOptions {
  readonly extensions: Readonly<Record<string, unknown>>
  /** The operator's `[locale]` section owns timezone, currency and region — they describe where the
   *  operator is, not how trading behaves. Trading brands them at this edge. */
  readonly locale: {
    readonly timezone?: string
    readonly currency?: string
    readonly region?: string
  }
}

export function resolveTradingConfig(options: ResolveTradingConfigOptions): TradingConfig {
  const raw = options.extensions[TRADING_CONFIG_SECTION]
  const localized = localize(options.locale)

  if (raw === undefined) {
    return freezeDeep({ ...localized })
  }

  const parsed = tradingConfigPatchSchema.safeParse(raw)

  if (!parsed.success) {
    throw toInvalidConfigError(parsed.error, tradingConfigPatchSchema, {
      section: TRADING_CONFIG_SECTION,
    })
  }

  try {
    return freezeDeep(merge(parsed.data, localized))
  } catch (err: unknown) {
    rethrowAsConfigError(err, TRADING_CONFIG_SECTION)
  }
}

function localize(locale: ResolveTradingConfigOptions['locale']): TradingConfig {
  return {
    ...DEFAULT_TRADING_CONFIG,
    ...(locale.timezone === undefined ? {} : { displayTimezone: locale.timezone }),
    ...(locale.currency === undefined
      ? {}
      : { baseCurrency: localeValue(currencyCode, locale.currency, 'currency') }),
    ...(locale.region === undefined
      ? {}
      : { defaultRegion: localeValue(region, locale.region, 'region') }),
  }
}

function localeValue<T>(parse: (raw: string) => T, raw: string, field: 'currency' | 'region'): T {
  try {
    return parse(raw)
  } catch (err: unknown) {
    if (!(err instanceof ValidationError)) {
      throw err
    }

    throw new OperatorConfigError(
      `invalid [${LOCALE_CONFIG_SECTION}] ${field}: ${raw}`,
      { key: `errors.configLocaleValue.${field}`, params: { value: raw } },
      { path: [LOCALE_CONFIG_SECTION, field], cause: err }
    )
  }
}

function rethrowAsConfigError(err: unknown, section: string): never {
  if (err instanceof ValidationError) {
    throw new OperatorConfigError(
      `invalid [${section}] configuration: ${err.message}`,
      err.operator ?? {
        key: 'errors.configSectionValue',
        params: { section, detail: err.message },
      },
      { path: [section] }
    )
  }

  throw err
}

function merge(patch: TradingConfigPatch, base: TradingConfig): TradingConfig {
  return {
    ...base,
    suggestions: {
      ...base.suggestions,
      cooldownSessions: patch.suggestions?.cooldown_sessions ?? base.suggestions.cooldownSessions,
      debateMode: patch.suggestions?.debate_mode ?? base.suggestions.debateMode,
    },
    briefs: mergeBriefs(patch.briefs, base.briefs),
    intraday: mergeIntraday(patch.intraday, base.intraday),
    operations: mergeOperations(patch, base.operations),
    alerts: {
      breakoutRange: patch.alerts?.breakout_range ?? base.alerts.breakoutRange,
      breakoutSessions: patch.alerts?.breakout_sessions ?? base.alerts.breakoutSessions,
    },
    typedPrices: {
      confirmMultiple: patch.typed_prices?.confirm_multiple ?? base.typedPrices.confirmMultiple,
    },
    orders: mergeOrders(patch.orders, base.orders),
    ledger: base.ledger,
    themes: { maximumCostUsd: patch.themes?.max_cost_usd ?? base.themes.maximumCostUsd },
    markets: mergeMarkets(patch.markets, base.markets),
    venues: mergeVenues(patch.venues, base.venues),
    sourceCredentialEnv: mergeSourceCredentialEnv(patch.sources, base.sourceCredentialEnv),
    costs: mergeCosts(patch.venues, base.costs),
    defaultVenues: mergeDefaultVenues(patch.venues, base.defaultVenues),
  }
}

function mergeBriefs(patch: TradingConfigPatch['briefs'], base: BriefPolicy): BriefPolicy {
  if (!patch) {
    return base
  }

  return { ...base, sendTime: patch.send_time ?? base.sendTime }
}

function mergeIntraday(
  patch: TradingConfigPatch['intraday'],
  base: IntradayPolicy
): IntradayPolicy {
  if (!patch) {
    return base
  }

  // `??`, never a length check: an empty `send_times` is the operator's off switch, so it has to
  // reach the config as an empty list rather than falling back to the defaults.
  return { ...base, sendTimes: patch.send_times ?? base.sendTimes }
}

function mergeOperations(patch: TradingConfigPatch, base: OperationsPolicy): OperationsPolicy {
  return { ...base, refresh: { intervalMs: patch.refresh?.interval_ms ?? base.refresh.intervalMs } }
}

function mergeOrders(patch: TradingConfigPatch['orders'], base: OrderPolicy): OrderPolicy {
  if (!patch) {
    return base
  }

  return {
    maximumStakeQuote: patch.maximum_stake_quote ?? base.maximumStakeQuote,
    maximumOpenTrades: patch.maximum_open_trades ?? base.maximumOpenTrades,
    maximumPriceDrift: patch.maximum_price_drift ?? base.maximumPriceDrift,
    allowUnattended: patch.allow_unattended ?? base.allowUnattended,
    requireStopLoss: patch.require_stop_loss ?? base.requireStopLoss,
  }
}

/** A declared list replaces rather than extends the one below it: a corrected holiday must not keep
 *  the typo. A key the patch leaves out keeps the one below. */
function mergeMarkets(patch: TradingConfigPatch['markets'], base: MarketConfigs): MarketConfigs {
  if (!patch) {
    return base
  }

  const merged: Partial<Record<MarketRef, MarketConfig>> = { ...base }

  for (const [id, settings] of Object.entries(patch)) {
    const ref = marketRef(id)

    merged[ref] = Object.freeze(mergeMarket(settings, base[ref]))
  }

  return merged
}

type MarketPatch = NonNullable<TradingConfigPatch['markets']>[string]

function mergeMarket(settings: MarketPatch, below: MarketConfig | undefined): MarketConfig {
  const maximumStopLoss = settings.maximum_stop_loss ?? below?.maximumStopLoss
  const stopLossAtr = settings.stop_loss_atr ?? below?.stopLossAtr
  const rewardRisk = settings.reward_risk ?? below?.rewardRisk

  return {
    holidays: Object.freeze(settings.holidays?.map(tradingDay) ?? below?.holidays ?? []),
    ...(maximumStopLoss === undefined ? {} : { maximumStopLoss }),
    ...(stopLossAtr === undefined ? {} : { stopLossAtr }),
    ...(rewardRisk === undefined ? {} : { rewardRisk }),
  }
}

type VenuePatch = NonNullable<TradingConfigPatch['venues']>[string]

const NO_ORDERS_VENUE: VenueConfig = Object.freeze({
  simulated: false,
  credentialEnv: Object.freeze({}),
})

function venueError(
  id: string,
  message: string,
  operator: OperatorConfigError['operator']
): OperatorConfigError {
  return new OperatorConfigError(
    `invalid [${TRADING_CONFIG_SECTION}.${VENUES_CONFIG_KEY}.${id}] configuration: ${message}`,
    operator,
    { path: [TRADING_CONFIG_SECTION, VENUES_CONFIG_KEY, id] }
  )
}

/** Per venue and whole: a section names everything that venue is configured with, so a patch
 *  declaring only `simulated` does not leave the credentials it did not mention behind.
 *
 *  An id the build does not ship is a broker traded by hand and carries its own markets; a built-in
 *  venue's markets are code-owned. A venue with no entry below places no orders, so `credentials`
 *  and `simulated` are refused on it rather than left inert. */
function mergeVenues(patch: TradingConfigPatch['venues'], base: VenueConfigs): VenueConfigs {
  if (!patch) {
    return base
  }

  const merged: Partial<Record<VenueRef, VenueConfig>> = { ...base }

  for (const [id, settings] of Object.entries(patch)) {
    const ref = venueRef(id)

    merged[ref] = BUILT_IN_VENUES.includes(ref)
      ? mergeBuiltInVenue(id, settings, base[ref])
      : customVenue(id, settings)
  }

  return merged
}

function mergeBuiltInVenue(
  id: string,
  settings: VenuePatch,
  current: VenueConfig | undefined
): VenueConfig {
  if (settings.markets !== undefined) {
    throw venueError(id, `markets is not settable; ${id} is built in and holds its own markets`, {
      key: 'errors.configVenueBuiltInMarkets',
      params: { venue: id },
    })
  }

  if (current === undefined) {
    assertPlacesOrders(id, settings)

    return NO_ORDERS_VENUE
  }

  return Object.freeze({
    simulated: settings.simulated ?? current.simulated,
    credentialEnv: Object.freeze({ ...(settings.credentials ?? current.credentialEnv) }),
  })
}

function customVenue(id: string, settings: VenuePatch): VenueConfig {
  assertPlacesOrders(id, settings)

  const markets = (settings.markets ?? settings.default_for ?? []).map(marketRef)

  if (markets.length === 0) {
    throw venueError(id, 'holds no market: set default_for or markets', {
      key: 'errors.configVenueNoMarket',
      params: { venue: id },
    })
  }

  return Object.freeze({ ...NO_ORDERS_VENUE, markets: Object.freeze(markets) })
}

function assertPlacesOrders(id: string, settings: VenuePatch): void {
  if (settings.credentials !== undefined || settings.simulated !== undefined) {
    throw venueError(id, 'credentials and simulated apply only to venues that place orders', {
      key: 'errors.configVenueNoOrders',
      params: { venue: id },
    })
  }
}

function mergeSourceCredentialEnv(
  patch: TradingConfigPatch['sources'],
  base: TradingConfig['sourceCredentialEnv']
): TradingConfig['sourceCredentialEnv'] {
  if (!patch) {
    return base
  }

  const merged: Partial<Record<SourceId, string>> = { ...base }

  for (const [id, variable] of Object.entries(patch)) {
    merged[sourceId(id)] = variable
  }

  return merged
}

type FeePatch = NonNullable<VenuePatch['fees']>

/** The optional keys the built-in entry sets and the override leaves out, by their TOML names. */
function omittedFeeKeys(fees: FeePatch, builtIn: CostRates | undefined): readonly string[] {
  return [
    ...(builtIn?.sellTax !== undefined && fees.sell_tax === undefined ? ['sell_tax'] : []),
    ...(builtIn?.feeAsset !== undefined && fees.fee_asset === undefined ? ['fee_asset'] : []),
  ]
}

/** `fees` replaces a venue's built-in entry whole, so one that drops a key the built-in entry sets
 *  would silently lose it: vps without `sell_tax` books every sale untaxed, okx without `fee_asset`
 *  books a buy's fee against the wrong coin. It is refused instead, naming the keys to restate. A
 *  venue the build does not ship must declare `fees` at all: no entry would book a zero rate, which
 *  understates every basis.
 *
 *  Rebuilt field by field rather than spread: the TOML surface is snake_case and the resolved shape
 *  is camelCase, so a spread would carry `sell_tax` onto a config object that never declares it. */
function mergeCosts(patch: TradingConfigPatch['venues'], base: TradingCosts): TradingCosts {
  if (!patch) {
    return base
  }

  const merged: Partial<Record<VenueRef, CostRates>> = { ...base }

  for (const [id, settings] of Object.entries(patch)) {
    const ref = venueRef(id)
    const { fees } = settings

    if (fees === undefined) {
      if (!BUILT_IN_VENUES.includes(ref)) {
        throw venueError(
          id,
          'declare fees = { buy, sell }; with no rate every fee would book as zero',
          { key: 'errors.configVenueFeesMissing', params: { venue: id } }
        )
      }

      continue
    }

    const omitted = omittedFeeKeys(fees, base[ref])

    if (omitted.length > 0) {
      throw venueError(
        id,
        `restate ${omitted.join(', ')} in fees; ` +
          'fees replaces the built-in entry whole and the built-in one sets it',
        { key: 'errors.configVenueFeesRestate', params: { venue: id, fields: omitted.join(', ') } }
      )
    }

    merged[ref] = {
      buy: fees.buy,
      sell: fees.sell,
      ...(fees.sell_tax === undefined ? {} : { sellTax: fees.sell_tax }),
      ...(fees.fee_asset === undefined ? {} : { feeAsset: fees.fee_asset }),
    }
  }

  return merged
}

/** A venue's `default_for` overrides the built-in default for that market. Two venues claiming one
 *  market is ambiguous, so it is refused rather than settled by whichever was read last. */
function mergeDefaultVenues(
  patch: TradingConfigPatch['venues'],
  base: DefaultVenues
): DefaultVenues {
  if (!patch) {
    return base
  }

  const merged: Partial<Record<MarketRef, VenueRef>> = { ...base }
  const claimed = new Map<string, string>()

  for (const [id, settings] of Object.entries(patch)) {
    for (const market of settings.default_for ?? []) {
      const rival = claimed.get(market)

      if (rival !== undefined) {
        throw venueError(id, `default_for ${market} is claimed by both ${rival} and ${id}`, {
          key: 'errors.configVenueDefaultClaimed',
          params: { market, rival, venue: id },
        })
      }

      claimed.set(market, id)
      merged[marketRef(market)] = venueRef(id)
    }
  }

  return merged
}
