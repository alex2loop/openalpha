import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import { renderScreenText } from '@/trading/features/market-data/render/screen'
import {
  INSTRUMENT_KINDS,
  type InstrumentKind,
  screenableKindList,
  screenableKindsText,
} from '@/trading/kernel/instrument'
import {
  parsePositiveInteger,
  parseRegisteredMarket,
  usage,
} from '@/trading/kernel/surface/surface'
import { resolveRenderContext } from '@/trading/render/format'
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
      transcript: 'echo',
    },
    // Slots are classified rather than positional, so both closed classes are offered at every
    // position. A limit is a number and can prefix-match neither.
    completeFor: () => [
      ...deps.marketData.markets(),
      ...screenableKindList(deps.marketData.screenableKinds()),
    ],
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: ScreenCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const parsed = parseScreenArgs(ctx.args, {
    markets: deps.marketData.markets(),
    ...(deps.defaultMarket === undefined ? {} : { defaultMarket: deps.defaultMarket }),
  })

  if (parsed === null) {
    return usage(USAGE, {
      markets: deps.marketData.markets().join(', '),
      kinds: screenableKindsText(deps.marketData.screenableKinds()),
    })
  }

  const { market, limit, instrumentKind } = parsed
  const result = await deps.marketData.screen({
    market,
    limit,
    now: Date.now(),
    signal: ctx.signal,
    ...(ctx.progress === undefined ? {} : { progress: ctx.progress }),
    ...(instrumentKind === undefined ? {} : { instrumentKind }),
  })

  const display = deps.marketData.quoteConvention(market)?.display

  return {
    kind: 'text',
    text: renderScreenText(
      ctx.locale,
      {
        market,
        context: resolveRenderContext(deps.timezone, ctx.surface),
        ...(display === undefined ? {} : { display }),
        ...(instrumentKind === undefined ? {} : { instrumentKind }),
      },
      result
    ),
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
}

interface ScreenSlots {
  readonly market?: MarketRef
  readonly instrumentKind?: InstrumentKind
  readonly limit?: number
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

  const instrumentKind = INSTRUMENT_KINDS.find((kind) => kind === raw)

  if (instrumentKind !== undefined && slots.instrumentKind === undefined) {
    return { ...slots, instrumentKind }
  }

  const limit = parsePositiveInteger(raw, SURFACE_LIMITS.maximumScreenCandidates)

  return limit === null || slots.limit !== undefined ? null : { ...slots, limit }
}
