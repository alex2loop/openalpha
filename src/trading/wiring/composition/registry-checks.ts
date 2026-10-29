import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type { CliCommandDef } from '@/core/types/cli-command'
import type { SlashCommand } from '@/core/types/command'
import type { TradingConfig } from '@/trading/kernel/config'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { OperatorConfigError } from '@/core/config/resolve'
import { ConfigError } from '@/core/errors'
import { isValidSendTime } from '@/trading/features/brief/schedule'
import { marketRef } from '@/trading/kernel/instrument'
import { tradingLocaleKeys } from '@/trading/locale-manifest'
import { isWeekendDay } from '@/trading/markets/calendar'
import { TRADING_CONFIG_SECTION } from '@/trading/wiring/config'
import { BUILT_IN_VENUES } from '@/trading/wiring/config-defaults'
import { MARKETS_CONFIG_KEY, VENUES_CONFIG_KEY } from '@/trading/wiring/config-schema'

const YEAR_LENGTH = 4

/** Consumer-side, and deliberately the same shape and name the commands provider already uses:
 *  one key-coverage contract, threaded by both callers rather than restated as a synonym. */
export interface KeyValidator {
  resolvesEverywhere(key: string): boolean
}

/** The built surface definitions. Keys derive from these rather than from a hand-written list,
 *  which could only drift from the definitions it claims to describe. */
export interface TradingContributions {
  readonly tools: readonly ToolDefinition[]
  readonly commands: readonly SlashCommand[]
  /** Terminal commands. Empty until the first one ships. Summary keys are validated by the CLI's
   *  contributed-command gate and run-time texts by the catalog-typed `t` literals inside each
   *  def — deliberately not a second trading locale gate. */
  readonly cliCommands: readonly CliCommandDef[]
}

/** What only a *closed* registry can check. Manifest shape, calendar presence, and `id` /
 *  `(region, assetClass)` / `segment` uniqueness are already enforced by `MarketRegistry.register`
 *  as each market arrives — re-checking them here would be a second owner of the same rule. These
 *  three need the whole set, and all run before the first binding so a misconfigured install fails
 *  during composition rather than at first use. */
export function assertRegistryConsistency(
  markets: MarketRegistry,
  config: TradingConfig,
  presentation: RegistryPresentation
): void {
  assertConfiguredReferencesExist(markets, config, presentation.venues)
  assertVenueMarketsExist(markets, presentation.venues)
  assertDistinctScopeNames(markets, presentation.venues)
  assertLocaleCoverage(markets, presentation)
}

/** Names the markets whose closure table ends before the year they are in: from then on each
 *  holiday reads as a session, so a quote is called stale and an order is dated to a day the
 *  exchange is shut. A warning rather than a refusal, because a stale table only misdates those
 *  days, and the operator closes the gap with `holidays` under `[trading.markets.<id>]`. */
export function reportOutdatedHolidayTables(
  markets: MarketRegistry,
  logger: Logger,
  now: number
): void {
  const outdated = markets.list().flatMap((market) => {
    const { calendar } = market.manifest
    const covered = calendar.lastHoliday?.slice(0, YEAR_LENGTH)

    return covered !== undefined && covered < calendar.dayAt(now).slice(0, YEAR_LENGTH)
      ? [market.manifest.id]
      : []
  })

  if (outdated.length > 0) {
    logger.warn('trading.holidays_outdated', {
      markets: outdated,
      configKey: `${TRADING_CONFIG_SECTION}.${MARKETS_CONFIG_KEY}.<id>.holidays`,
    })
  }
}

interface RegistryPresentation {
  readonly keys: KeyValidator
  readonly contributions: TradingContributions
  readonly venues: VenueRegistry
}

/** A venue claiming a market nobody built holds positions no calendar dates and no source prices.
 *  Every offending pair in one throw, because a half-registered composition must not boot. */
function assertVenueMarketsExist(markets: MarketRegistry, venues: VenueRegistry): void {
  const unbuilt = venues
    .list()
    .flatMap((venue) =>
      venue.manifest.markets
        .filter((market) => markets.find(market) === null)
        .map((market) => `${venue.manifest.id}/${market}`)
    )

  if (unbuilt.length > 0) {
    throw new OperatorConfigError(`venues name unregistered markets: ${unbuilt.join(', ')}`, {
      key: 'errors.configUnknownMarkets',
      params: {
        section: '[trading.venues]',
        markets: unbuilt.join(', '),
        known: knownMarkets(markets),
      },
    })
  }
}

/** Market refs and venue refs share one slug shape and one operator grammar: `<scope>:<ticker>`
 *  reads a market on `/price` and a venue on `/trade`. A name registered as both would mean one
 *  thing on one command and another on the next, so composition refuses it. */
function assertDistinctScopeNames(markets: MarketRegistry, venues: VenueRegistry): void {
  const claimed = new Set<string>(markets.list().map((market) => market.manifest.id))
  const shared = venues.list().filter((venue) => claimed.has(venue.manifest.id))

  if (shared.length > 0) {
    throw new ConfigError(
      `venue ids also name markets: ${shared.map((venue) => venue.manifest.id).join(', ')}`
    )
  }
}

/** A config value naming something that was never built is silently inert otherwise: the refresh
 *  scope never runs. A home region must be one whose owning market a venue holds: a reference-only
 *  owner (world gold) has no brief and seeds no segment of its own. */
function assertConfiguredReferencesExist(
  markets: MarketRegistry,
  config: TradingConfig,
  venues: VenueRegistry
): void {
  const held = venues.heldMarkets()
  const homeOwners = markets
    .list()
    .filter(({ manifest }) => manifest.ownsRegion && held.has(manifest.id))
  const homeRegions = homeOwners.map(({ manifest }) => manifest.region)

  if (!homeRegions.includes(config.defaultRegion)) {
    throw new OperatorConfigError(`defaultRegion ${config.defaultRegion} is not a home region`, {
      key: 'errors.configRegionUnknown',
      params: { region: config.defaultRegion, regions: homeRegions.join(', ') },
    })
  }

  assertBriefSendTimeBeforeOpen(homeOwners, config.briefs.sendTime, Date.now())
  assertConfiguredMarketsExist(markets, config)
  assertConfiguredHolidaysAreSessions(markets, config)
  assertDefaultVenuesHold(config, venues)
}

/** A delivery with no time of its own follows `[trading.briefs] send_time`; at or past the open it
 *  never lands pre-open, so the brief would be skipped every morning. `/brief enable` refuses such
 *  a time on its own row, and this refuses it in config. */
function assertBriefSendTimeBeforeOpen(
  owners: readonly Market[],
  sendTime: string,
  now: number
): void {
  const late = owners
    .filter((market) => !isValidSendTime({ market, sendTime }, now))
    .map((market) => market.manifest.id)
    .join(', ')

  if (late !== '') {
    throw new OperatorConfigError(
      `[${TRADING_CONFIG_SECTION}.briefs] send_time ${sendTime} is not before the open of: ${late}`,
      { key: 'errors.configBriefSendTimeAfterOpen', params: { time: sendTime, markets: late } }
    )
  }
}

/** A configured holiday on the market's own weekend is a mistyped date: that day never traded, so
 *  the closure it was meant to add is still missing. Every offender in one throw. */
function assertConfiguredHolidaysAreSessions(markets: MarketRegistry, config: TradingConfig): void {
  const misplaced = Object.entries(config.markets).flatMap(([ref, settings]) => {
    const policy = markets.find(marketRef(ref))?.manifest.defaultCalendar

    return policy === undefined
      ? []
      : (settings?.holidays ?? [])
          .filter((day) => isWeekendDay(policy, day))
          .map((day) => `${ref} ${day}`)
  })

  if (misplaced.length > 0) {
    throw new OperatorConfigError(
      `[${TRADING_CONFIG_SECTION}.${MARKETS_CONFIG_KEY}] holidays fall on a weekend: ${misplaced.join(', ')}`,
      { key: 'errors.configHolidayOnWeekend', params: { days: misplaced.join(', ') } }
    )
  }
}

/** A candidate list under a market nobody built is a segment that silently never runs. Whether each
 *  *ticker* is listed is a venue read, so it is answered at the market's first refresh rather than
 *  here: a network call at composition would make an offline install unbootable. */
function assertConfiguredMarketsExist(markets: MarketRegistry, config: TradingConfig): void {
  const unregistered = Object.keys(config.markets).filter(
    (ref) => markets.find(marketRef(ref)) === null
  )

  if (unregistered.length > 0) {
    throw new OperatorConfigError(
      `[${TRADING_CONFIG_SECTION}.${MARKETS_CONFIG_KEY}] names unregistered markets: ${unregistered.join(', ')}`,
      {
        key: 'errors.configUnknownMarkets',
        params: {
          section: '[trading.markets]',
          markets: unregistered.join(', '),
          known: knownMarkets(markets),
        },
      }
    )
  }
}

/** A default the ledger would refuse fills every unattended row with a venue the validator then
 *  rejects, so the operator learns at the write rather than at boot. A custom venue's markets come
 *  from its own section, so a `default_for` outside its `markets` lands here too. */
function assertDefaultVenuesHold(config: TradingConfig, venues: VenueRegistry): void {
  const unheld: string[] = []

  for (const [market, ref] of Object.entries(config.defaultVenues)) {
    const venue = ref === undefined ? null : venues.find(ref)

    if (venue === null || !venue.manifest.markets.includes(marketRef(market))) {
      unheld.push(`${market}=${ref}`)
    }
  }

  if (unheld.length > 0) {
    throw new OperatorConfigError(
      `[${TRADING_CONFIG_SECTION}.${VENUES_CONFIG_KEY}] default_for names venues that do not hold the market: ${unheld.join(', ')}`,
      { key: 'errors.configVenueNotHolding', params: { venues: unheld.join(', ') } }
    )
  }
}

function assertLocaleCoverage(markets: MarketRegistry, presentation: RegistryPresentation): void {
  const required = tradingLocaleKeys({
    ...presentation.contributions,
    markets: markets.list().map((market) => market.manifest),
    // A broker the operator declared has no catalog name; it prints under its own id.
    venues: BUILT_IN_VENUES,
    regions: markets.regions(),
    segments: markets.segments(),
  })
  const missing = required.filter((key) => !presentation.keys.resolvesEverywhere(key))

  if (missing.length > 0) {
    throw new ConfigError(`trading keys missing from a locale catalog: ${missing.join(', ')}`)
  }
}

function knownMarkets(markets: MarketRegistry): string {
  return markets
    .list()
    .map((market) => market.manifest.id)
    .join(', ')
}
