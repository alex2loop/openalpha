import type { Logger } from '@/core/logging/logger'
import type {
  BuiltPublicBriefRow,
  PublicBriefDeps,
  PublicBriefInput,
  PublicBriefRender,
  PublicBriefStore,
} from '@/trading/features/brief/public/types'
import type { ScreenRowForm } from '@/trading/features/market-data/render/screen-evidence'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { isAbortError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildPublicBrief } from '@/trading/features/brief/public/build'
import {
  createPublicBriefReads,
  PUBLIC_HOME_MARKET,
  PUBLIC_US_MARKET,
  publicBriefMarkets,
} from '@/trading/features/brief/public/reads'
import { perLocale, renderPublicBrief } from '@/trading/features/brief/public/render'
import { runBookFreeScreen } from '@/trading/features/market-data/ops/book-free-screen'
import { renderScreenRows } from '@/trading/features/market-data/render/screen-evidence'
import { defaultProfile, toSegmentDescriptors } from '@/trading/features/profile/policy'
import { disabledSegments } from '@/trading/kernel/operator/profile'

/** A name's rank and score and its price: no verdict, no operator mark, no factor reading. */
const PUBLIC_ROW_FORM: ScreenRowForm = Object.freeze({ rated: false, factors: false })

interface PublicBriefParts {
  readonly config: TradingConfig
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
  readonly marketData: MarketDataService
  readonly store: PublicBriefStore
  /** Read for one fact: whether the operator's US segment is on. */
  readonly profiles: Pick<ProfileService, 'get'>
  readonly logger: Logger
  refreshMarketData(
    options: RefreshAllMarketDataOptions
  ): Promise<readonly RefreshMarketDataResult[]>
}

/** The public brief, built from reads that hold no book: the market data service, its own store and
 *  a seeded default profile. Nothing the operator holds or watches reaches it. The one bit of the
 *  profile it takes is whether the US segment is on: US stocks are in the brief only while it is. */
export interface PublicBrief {
  build(input: PublicBriefInput): Promise<BuiltPublicBriefRow | null>
  render(row: BuiltPublicBriefRow): PublicBriefRender
}

export function createPublicBrief(parts: PublicBriefParts): PublicBrief {
  const { config, markets } = parts
  const profile = defaultProfile({
    baseCurrency: config.baseCurrency,
    segments: toSegmentDescriptors(
      markets.list().map(({ manifest }) => manifest),
      { heldMarkets: parts.venues.heldMarkets(), homeRegion: config.defaultRegion }
    ),
  })
  const home = (): Market => homeMarket(markets)

  return {
    build: async (input) =>
      buildPublicBrief(
        briefDeps(parts, profile, publicBriefMarkets(await isUsSegmentOn(parts, input.signal))),
        input
      ),
    // The VPS is often on UTC: the brief is dated and timed on the Vietnam calendar.
    render: (row) => renderPublicBrief(row, { timezone: home().manifest.calendar.timezone }),
  }
}

function briefDeps(
  parts: PublicBriefParts,
  profile: UserProfile,
  markets: readonly MarketRef[]
): PublicBriefDeps {
  const { config, store } = parts
  const home = homeMarket(parts.markets)

  return {
    market: home,
    markets,
    reads: createPublicBriefReads({ marketData: parts.marketData, store, profile, markets }),
    store,
    toggles: config.publicBrief,
    limit: config.briefs.maximumItemsPerSection,
    topScreen: config.publicBrief.topScreen,
    logger: parts.logger,
    refresh: (options) => parts.refreshMarketData(options),
    screen: (request) => readScreen(parts, home.manifest.calendar.timezone, request),
  }
}

/** Whether the operator's cap leaves the US segment room, as the daemon's refresh reads it. A
 *  profile that cannot be read leaves the US out, which is the direction of fewer markets. */
async function isUsSegmentOn(parts: PublicBriefParts, signal: AbortSignal): Promise<boolean> {
  const us = parts.markets.find(PUBLIC_US_MARKET)

  if (us === null) {
    return false
  }

  try {
    const { caps } = await parts.profiles.get({ signal })

    return !disabledSegments(caps).has(us.manifest.segment)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    parts.logger.warn('trading.public_brief_profile_unreadable', { err: formatErrForLog(err) })

    return false
  }
}

/** The lists are timed on the brief's clock, as the rest of it is. */
async function readScreen(
  parts: PublicBriefParts,
  timezone: string,
  request: Parameters<PublicBriefDeps['screen']>[0]
): ReturnType<PublicBriefDeps['screen']> {
  const view = await runBookFreeScreen({ markets: parts.markets, logger: parts.logger }, request)

  if (view === undefined || view.candidates.length === 0) {
    return undefined
  }

  const clocked = { ...view, timezone }

  return {
    asOf: view.dataThroughDay ?? view.asOf,
    rows: perLocale((locale) => renderScreenRows(locale, clocked, PUBLIC_ROW_FORM)),
  }
}

export function homeMarket(markets: MarketRegistry): Market {
  const market = markets.find(PUBLIC_HOME_MARKET)

  if (market === null) {
    throw new ValidationError(
      `no registered market ${PUBLIC_HOME_MARKET} composes the public brief`
    )
  }

  return market
}
