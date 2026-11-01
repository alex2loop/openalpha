import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { NavService } from '@/trading/features/portfolio/nav/types'
import type { UpcomingEvent } from '@/trading/features/portfolio/render/portfolio'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { StopCover, StopDistance } from '@/trading/kernel/operator/alert'
import type { VenueRegistry } from '@/trading/venues/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { isWord } from '@/core/utils/text'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { resolveMarketIcons } from '@/trading/features/market-data/reads/describe'
import { DEFAULT_NAV_WINDOW, NAV_WINDOWS } from '@/trading/features/portfolio/nav/types'
import { renderNavText } from '@/trading/features/portfolio/render/nav'
import { renderPortfolioText } from '@/trading/features/portfolio/render/portfolio'
import { marksByInstrument } from '@/trading/features/portfolio/view'
import { buildInstrumentKey, CASH_SEGMENT } from '@/trading/kernel/instrument'
import { toProfileStamp } from '@/trading/kernel/operator/profile'
import { parseMember, usage } from '@/trading/kernel/surface/surface'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { bookAffordances } from '@/trading/render/affordance'
import { answerSurfaceOf, resolveRenderContext } from '@/trading/render/format'
import { SURFACE_LIMITS } from '@/trading/surface-limits'
import { minimumSizesByInstrument } from '@/trading/venues/holdings'

const USAGE: 'slash.tradingPortfolioUsage' = 'slash.tradingPortfolioUsage'
const NAV_ARG = 'nav'
/** How far ahead the book names what is coming, in calendar days: a dated corporate event is
 *  published against the calendar, and the command holds no market calendar of its own. */
const UPCOMING_HORIZON_DAYS = 14
/** An install with no exchange places nothing, so every planned stop is a plan and the rows say
 *  only that. Frozen and shared: the map is read and never written. */
const EMPTY_PLACEMENTS: ReadonlyMap<string, StopCover> = new Map()

/** What the book needs from the exit watch, declared here rather than imported: the alert stack
 *  implements it, and a consumer that named the provider's whole service would depend on all of it. */
interface StopDistanceReader {
  stopDistances(options: {
    readonly now: number
    readonly signal: AbortSignal
    /** The mark per instrument in the quoting market's own currency, keyed by `buildInstrumentKey`. */
    readonly marks: ReadonlyMap<string, number>
  }): Promise<readonly StopDistance[]>
}

/** Whether a planned stop has an order standing behind it, declared here for the same reason the
 *  distance is: the order path implements it, and a book that named the whole service would depend
 *  on all of it. Absent on an install with no exchange, where nothing could rest anywhere. */
interface StopPlacementReader {
  restingStops(options: {
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<ReadonlyMap<string, StopCover>>
}

/** `role: 'operator'` — a book is the operator's own money, unlike a public quote. */
interface PortfolioCommandDeps {
  readonly portfolio: Pick<PortfolioService, 'viewAbsoluteWithKinds'>
  readonly nav: Pick<NavService, 'history'>
  readonly profiles: Pick<ProfileService, 'get' | 'isSaved'>
  readonly marketData: Pick<MarketDataService, 'describeMarkets' | 'events' | 'quoteConvention'>
  readonly alerts: StopDistanceReader
  readonly orders?: StopPlacementReader
  readonly venues: VenueRegistry
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
}

export function createPortfolioCommand(deps: PortfolioCommandDeps): SlashCommand {
  return {
    name: 'portfolio',
    description: { kind: 'localized', key: 'slash.tradingPortfolioHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'read',
      execution: { progressKey: 'slash.tradingPortfolioProgress' },
      selfContained: true,
    },
    completeFor: completePortfolioArgs,
    usage: () => ({ key: USAGE, values: buildUsageValues() }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

function completePortfolioArgs(args: readonly string[]): readonly string[] {
  if (args.length === 1) {
    return [NAV_ARG]
  }

  return args.length === 2 && isWord(args[0], NAV_ARG) ? NAV_WINDOWS : []
}

function portfolioUsage(): SlashResult {
  return usage(USAGE, buildUsageValues())
}

function buildUsageValues(): CommandMessageValues {
  return {
    nav: NAV_ARG,
    windows: NAV_WINDOWS.join('|'),
    fallback: DEFAULT_NAV_WINDOW,
  }
}

async function runNav(
  deps: PortfolioCommandDeps,
  ctx: SlashContext,
  choice: string | undefined
): Promise<SlashResult> {
  const window = choice === undefined ? DEFAULT_NAV_WINDOW : parseMember(choice, NAV_WINDOWS)

  if (window === null) {
    return portfolioUsage()
  }

  const history = await deps.nav.history({ window, now: Date.now(), signal: ctx.signal })

  return {
    kind: 'text',
    affordances: bookAffordances(ctx.locale),
    text: renderNavText(
      ctx.locale,
      history,
      resolveRenderContext(deps.timezone, answerSurfaceOf(ctx))
    ),
  }
}

async function run(deps: PortfolioCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [action, choice, ...rest] = ctx.args.map((arg) => arg.toLowerCase())

  if (action === NAV_ARG && rest.length === 0) {
    return runNav(deps, ctx, choice)
  }

  if (action !== undefined) {
    return portfolioUsage()
  }

  const now = Date.now()
  const { valued: book, instrumentKinds } = await deps.portfolio.viewAbsoluteWithKinds({
    now,
    signal: ctx.signal,
  })
  const profileOptions = { defaultLocale: ctx.locale, signal: ctx.signal }
  const [profile, profileSaved, distances, minimumSizes, restingStops] = await Promise.all([
    deps.profiles.get(profileOptions),
    deps.profiles.isSaved(profileOptions),
    deps.alerts.stopDistances({ now, signal: ctx.signal, marks: marksByInstrument(book) }),
    minimumSizesByInstrument(deps.venues, book.book.positions, ctx.signal),
    deps.orders?.restingStops({ now, signal: ctx.signal }) ?? EMPTY_PLACEMENTS,
  ])

  return {
    kind: 'text',
    affordances: bookAffordances(ctx.locale),
    text: renderPortfolioText(ctx.locale, book, {
      context: resolveRenderContext(deps.timezone, answerSurfaceOf(ctx)),
      cashTargetPctNav: profile.segmentTargets[CASH_SEGMENT] ?? 0,
      sectorCapPctNav: profile.maximumSectorPctNav,
      profile: toProfileStamp({ profile, saved: profileSaved }),
      segmentCaps: profile.caps,
      instrumentKinds,
      quoteConventions: quoteConventionsFor(
        deps.marketData,
        book.positions.map((valued) => valued.position.instrument)
      ),
      marketIcons: resolveMarketIcons(deps.marketData),
      stopDistances: distancesByInstrument(distances),
      restingStops,
      minimumSizes,
      upcoming: await upcoming(deps, {
        instruments: book.positions.map((valued) => valued.position.instrument),
        asOf: book.book.asOf,
        now,
        signal: ctx.signal,
      }),
    }),
  }
}

interface UpcomingRequest {
  readonly instruments: readonly InstrumentRef[]
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

function distancesByInstrument(
  distances: readonly StopDistance[]
): ReadonlyMap<string, StopDistance> {
  return new Map(distances.map((distance) => [buildInstrumentKey(distance.instrument), distance]))
}

/** An enrichment, never the answer: a calendar that could not be read costs the book a section, not
 *  its caveats. */
async function upcoming(
  deps: PortfolioCommandDeps,
  request: UpcomingRequest
): Promise<readonly UpcomingEvent[]> {
  const subjects = request.instruments.slice(0, SURFACE_LIMITS.maximumCalendarNames)

  if (subjects.length === 0) {
    return []
  }

  const toDay = shiftCalendarDay(request.asOf, UPCOMING_HORIZON_DAYS)
  const found = await mapWithConcurrency(
    subjects,
    SURFACE_LIMITS.calendarConcurrency,
    async (instrument): Promise<readonly UpcomingEvent[]> => {
      const result = await deps.marketData.events({
        market: instrument.market,
        ticker: instrument.ticker,
        fromDay: request.asOf,
        toDay,
        now: request.now,
        signal: request.signal,
      })

      return result.kind === 'unavailable'
        ? []
        : result.value.map((event) => ({ instrument, event }))
    }
  )

  return found.flat().sort((left, right) => left.event.at.localeCompare(right.event.at))
}
