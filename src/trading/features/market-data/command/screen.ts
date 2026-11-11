import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { MarketDataService, ScreenForm } from '@/trading/features/market-data/types'
import type { MarketRef, Ticker } from '@/trading/kernel/instrument'
import { renderScreenText } from '@/trading/features/market-data/render/screen'
import { renderScreenNameText } from '@/trading/features/market-data/render/screen-name'
import {
  INSTRUMENT_KINDS,
  type InstrumentKind,
  screenableKindList,
  screenableKindsText,
} from '@/trading/kernel/instrument'
import {
  parseFiniteNumber,
  parseMember,
  parsePositiveInteger,
  parseRegisteredMarket,
  parseTickerRequest,
  usage,
} from '@/trading/kernel/surface/surface'
import { answerSurfaceOf, resolveRenderContext } from '@/trading/render/format'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const USAGE: 'slash.tradingScreenUsage' = 'slash.tradingScreenUsage'

interface ScreenCommandDeps {
  readonly marketData: Pick<
    MarketDataService,
    'screen' | 'markets' | 'screenableKinds' | 'quoteConvention'
  >
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
  /** Screened when the operator names no market: the one whose sessions define their trading day,
   *  which is what `[locale] region` already selects. Absent where that region owns no calendar, so
   *  the market stays required rather than being guessed. */
  readonly defaultMarket?: MarketRef
  /** How the board answers; absent is the ranked board. */
  readonly form?: ScreenForm
}

export function createScreenCommand(deps: ScreenCommandDeps): SlashCommand {
  return {
    name: 'screen',
    description: { kind: 'localized', key: 'slash.tradingScreenHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'member',
      action: 'read',
      execution: { progressKey: 'slash.tradingScreenProgress' },
      selfContained: true,
      transcript: 'echo',
    },
    // Slots are classified rather than positional, so both closed classes are offered at every
    // position. A limit is a number and can prefix-match neither.
    completeFor: () => [
      ...deps.marketData.markets(),
      ...screenableKindList(deps.marketData.screenableKinds()),
    ],
    usage: () => ({ key: USAGE, values: buildUsageValues(deps) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: ScreenCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const parsed = parseScreenArgs(ctx.args, {
    markets: deps.marketData.markets(),
    ...(deps.defaultMarket === undefined ? {} : { defaultMarket: deps.defaultMarket }),
  })

  if (parsed === null) {
    return usage(USAGE, buildUsageValues(deps))
  }

  const { market, limit, instrumentKind, ticker } = parsed
  const result = await deps.marketData.screen({
    market,
    limit,
    ...(ticker === undefined ? {} : { ticker }),
    now: Date.now(),
    signal: ctx.signal,
    ...(deps.form === undefined ? {} : { form: deps.form }),
    ...(ctx.progress === undefined ? {} : { progress: ctx.progress }),
    ...(instrumentKind === undefined ? {} : { instrumentKind }),
  })

  const display = deps.marketData.quoteConvention(market)?.display
  const request = {
    market,
    context: resolveRenderContext(deps.timezone, answerSurfaceOf(ctx)),
    // A board lists every priced name; the argument says how many of them the chat prints.
    shown: limit,
    ...(display === undefined ? {} : { display }),
    ...(instrumentKind === undefined ? {} : { instrumentKind }),
  }

  return {
    kind: 'text',
    text:
      ticker === undefined
        ? renderScreenText(ctx.locale, request, result)
        : renderScreenNameText(ctx.locale, { ...request, ticker }, result),
  }
}

function buildUsageValues(deps: ScreenCommandDeps): CommandMessageValues {
  return {
    markets: deps.marketData.markets().join(', '),
    kinds: screenableKindsText(deps.marketData.screenableKinds()),
  }
}

interface ScreenArgsContext {
  readonly markets: readonly MarketRef[]
  readonly defaultMarket?: MarketRef
}

interface ScreenArgs {
  readonly market: MarketRef
  readonly limit: number
  readonly instrumentKind?: InstrumentKind
  /** Prints only this name's row. */
  readonly ticker?: Ticker
}

interface ScreenSlots {
  readonly market?: MarketRef
  readonly instrumentKind?: InstrumentKind
  readonly limit?: number
  readonly ticker?: Ticker
}

/** Classified rather than positional: with the market optional, a bare number could be either it or
 *  the limit, and a reader cannot tell which slot an argument fell into by counting commas. */
function parseScreenArgs(args: readonly string[], context: ScreenArgsContext): ScreenArgs | null {
  let slots: ScreenSlots | null = {}

  for (const arg of args) {
    slots = slots === null ? null : fillSlot(slots, arg, context)
  }

  const market = slots?.market ?? context.defaultMarket

  return slots === null || market === undefined
    ? null
    : {
        market,
        limit: slots.limit ?? SURFACE_LIMITS.defaultScreenCandidates,
        ...(slots.instrumentKind === undefined ? {} : { instrumentKind: slots.instrumentKind }),
        ...(slots.ticker === undefined ? {} : { ticker: slots.ticker }),
      }
}

/** `null` for a token that names nothing, or names a class already filled — either is a usage line
 *  rather than a silent overwrite. */
function fillSlot(slots: ScreenSlots, raw: string, context: ScreenArgsContext): ScreenSlots | null {
  const market = parseRegisteredMarket(raw, context.markets)

  // `crypto` names both a market and an instrument kind. The market claims it first, so
  // `/screen crypto` still means the crypto board and a second `crypto` falls through to the kind.
  if (market !== null && slots.market === undefined) {
    return { ...slots, market }
  }

  const instrumentKind = parseMember(raw, INSTRUMENT_KINDS)

  if (instrumentKind !== null && slots.instrumentKind === undefined) {
    return { ...slots, instrumentKind }
  }

  const limit = parsePositiveInteger(raw, SURFACE_LIMITS.maximumScreenCandidates)

  if (limit !== null) {
    return slots.limit === undefined ? { ...slots, limit } : null
  }

  // A number outside the limits is a mistyped limit: no listed name is only digits.
  return parseFiniteNumber(raw) === null ? fillTicker(slots, raw, context) : null
}

/** Anything else is a name, `market:ticker` when it says where it lists; a second name, or a market
 *  that disagrees with the one already given, is a usage line. */
function fillTicker(
  slots: ScreenSlots,
  raw: string,
  context: ScreenArgsContext
): ScreenSlots | null {
  const request = parseTickerRequest(raw, context.markets)

  if (request === null || slots.ticker !== undefined) {
    return null
  }

  const market = request.market ?? slots.market

  if (slots.market !== undefined && market !== slots.market) {
    return null
  }

  return { ...slots, ticker: request.ticker, ...(market === undefined ? {} : { market }) }
}
