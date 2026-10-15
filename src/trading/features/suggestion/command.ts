import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { RenderView } from '@/trading/features/suggestion/render/view'
import type { SuggestionReportDeps } from '@/trading/features/suggestion/report'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { DebateMode } from '@/trading/kernel/config'
import type { InstrumentRef, MarketRef } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { VenueRegistry } from '@/trading/venues/types'
import { renderSuggestionText } from '@/trading/features/suggestion/render/suggestion'
import { renderBatchVerdicts } from '@/trading/features/suggestion/render/verdict'
import { resolveRenderView, storedOf } from '@/trading/features/suggestion/report'
import { DEBATE_MODES } from '@/trading/kernel/config'
import { dedupeInstruments } from '@/trading/kernel/instrument'
import { DEFAULT_RUN_FOCUS } from '@/trading/kernel/operator/focus'
import { parseMember, parseTickerRequest, usage } from '@/trading/kernel/surface/surface'

const USAGE: 'slash.tradingSuggestUsage' = 'slash.tradingSuggestUsage'
const STOPS_EMPTY: 'slash.tradingSuggestStopsEmpty' = 'slash.tradingSuggestStopsEmpty'
const STOPS_ARG = 'stops'
const STOPS_DEBATE_MODE = 'lean' satisfies DebateMode
const DEBATE_MODE_OPTIONS = DEBATE_MODES.join('|')
/** Re-runs past today's stored verdict instead of returning it. Operator-only: the gates exist to
 *  stop churn and spend, so no tool exposes this. */
const FORCE_ARG = 'force'
const OPTIONS: readonly string[] = Object.freeze([FORCE_ARG, ...DEBATE_MODES])

interface StopsCoverage {
  unwatchedPositions(options: {
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<readonly InstrumentRef[]>
  stalePositions(options: {
    readonly now: number
    readonly profile: UserProfile
    readonly signal: AbortSignal
  }): Promise<readonly InstrumentRef[]>
}

interface SuggestCommandDeps extends SuggestionReportDeps {
  readonly suggestions: Pick<
    SuggestionService,
    'run' | 'runBatch' | 'summarize' | 'listResolved' | 'get'
  >
  readonly coverage: StopsCoverage
  readonly marketData: SuggestionReportDeps['marketData'] & Pick<MarketDataService, 'markets'>
  readonly profiles: SuggestionReportDeps['profiles']
  readonly venues: VenueRegistry
}

/** Everything a `/suggest` line carries beside its subject. Both paths read the same two, so the
 *  stops batch takes what the parser produced rather than a shape of its own. */
interface SuggestOptions {
  readonly mode: DebateMode | null
  readonly force: boolean
}

export function createSuggestCommand(deps: SuggestCommandDeps): SlashCommand {
  return {
    name: 'suggest',
    description: { kind: 'localized', key: 'slash.tradingSuggestHelp' },
    messageKeys: [USAGE, STOPS_EMPTY],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'costly',
      execution: { progressKey: 'slash.tradingSuggestProgress' },
    },
    // The subject is a ticker and `stops` is its exception, so only the options complete.
    completeFor: (args) => (args.length === 1 ? [] : OPTIONS),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: SuggestCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  // The subject stays first and positional: `ticker` upper-cases what it parses, so every option
  // word is also a well-formed ticker and no classifier could tell `/suggest force` from a name.
  // Lower-cased once: every option and `stops` is a lower-case word, a market ref is lower-case,
  // and the ticker brand canonicalizes its own case.
  const [subject, ...rest] = ctx.args.map((arg) => arg.toLowerCase())
  const options = parseSuggestOptions(rest)

  if (subject === undefined || options === null) {
    return suggestUsage(deps)
  }

  if (subject === STOPS_ARG) {
    return runStops(deps, ctx, options)
  }

  const { mode, force } = options
  const request = parseTickerRequest(subject, deps.marketData.markets())

  if (request === null) {
    return suggestUsage(deps)
  }

  const result = await deps.suggestions.run({
    locale: ctx.locale,
    channel: ctx.channel,
    billingSessionId: ctx.sessionId,
    focus: DEFAULT_RUN_FOCUS,
    ...request,
    ...(mode === null ? {} : { debateMode: mode }),
    force,
    now: Date.now(),
    signal: ctx.signal,
    ...(ctx.progress === undefined ? {} : { progress: ctx.progress }),
  })

  return renderRun(deps, ctx, { result, mode })
}

function suggestUsage(deps: SuggestCommandDeps): SlashResult {
  return usage(USAGE, {
    modes: DEBATE_MODE_OPTIONS,
    force: FORCE_ARG,
    stops: STOPS_ARG,
    markets: deps.marketData.markets().join(', '),
  })
}

interface SuggestSlots {
  readonly mode?: DebateMode
  readonly force?: true
}

/** Every word after the subject names itself, so they may arrive in any order. Reading them off the
 *  tail instead made `/suggest FPT force lean` a usage line. */
function parseSuggestOptions(args: readonly string[]): SuggestOptions | null {
  let slots: SuggestSlots | null = {}

  for (const arg of args) {
    slots = slots === null ? null : fillSlot(slots, arg)
  }

  return slots === null ? null : { mode: slots.mode ?? null, force: slots.force === true }
}

/** `null` for a word that names nothing, or names a slot already filled. */
function fillSlot(slots: SuggestSlots, raw: string): SuggestSlots | null {
  if (raw === FORCE_ARG) {
    return slots.force === undefined ? { ...slots, force: true } : null
  }

  const mode = parseMember(raw, DEBATE_MODES)

  return mode === null || slots.mode !== undefined ? null : { ...slots, mode }
}

/** One batch, so every name shares the run budget rather than minting one apiece, and the service
 *  bounds the list and warms each market once. */
async function runStops(
  deps: SuggestCommandDeps,
  ctx: SlashContext,
  options: SuggestOptions
): Promise<SlashResult> {
  const now = Date.now()
  const profile = await deps.profiles.get({ defaultLocale: ctx.locale, signal: ctx.signal })

  // Independent reads over one book, and a name can be both: nothing is watching it and its window
  // has passed. One batch either way, so the union is deduped before it is charged for.
  const [unwatched, stale] = await Promise.all([
    deps.coverage.unwatchedPositions({ now, signal: ctx.signal }),
    deps.coverage.stalePositions({ now, profile, signal: ctx.signal }),
  ])
  const refs = dedupeInstruments([...unwatched, ...stale])

  if (refs.length === 0) {
    return usage(STOPS_EMPTY)
  }

  const batch = await deps.suggestions.runBatch({
    scope: {
      kind: 'items',
      items: refs.map((ref) => ({
        locale: ctx.locale,
        ticker: ref.ticker,
        market: ref.market,
        force: options.force,
      })),
    },
    channel: ctx.channel,
    billingSessionId: ctx.sessionId,
    focus: DEFAULT_RUN_FOCUS,
    ...stopsDebateMode(options),
    now,
    signal: ctx.signal,
    ...(ctx.progress === undefined ? {} : { progress: ctx.progress }),
  })
  const text = renderBatchVerdicts(ctx.locale, batch)

  return text === undefined ? usage(STOPS_EMPTY) : { kind: 'text', text }
}

/** A typed depth stands. Otherwise coverage runs lean, except when forced: the pipeline reads an
 *  untyped `force` as the full argument, and sending `lean` in its place would quietly downgrade it. */
function stopsDebateMode(options: SuggestOptions): { readonly debateMode?: DebateMode } {
  if (options.mode !== null) {
    return { debateMode: options.mode }
  }

  return options.force ? {} : { debateMode: STOPS_DEBATE_MODE }
}

/** The report the tools relay too, plus the two lines only an operator at this surface can act on:
 *  where to record the fill, and the command that moves a stop resting at an exchange. */
async function renderRun(
  deps: SuggestCommandDeps,
  ctx: SlashContext,
  completed: { readonly result: SuggestionRunResult; readonly mode: DebateMode | null }
): Promise<SlashResult> {
  const { result, mode } = completed
  const market = storedOf(result)?.instrument.market
  // Detail follows the depth the operator typed, never the one the run ended at: a book-hold runs
  // lean on its own, and that cost decision must not shorten what the operator reads.
  const view = await resolveRenderView(deps, {
    result,
    detail: mode === 'lean' ? 'compact' : 'full',
    locale: ctx.locale,
    surface: ctx.surface,
    signal: ctx.signal,
  })

  return {
    kind: 'text',
    text: renderSuggestionText({
      ...view,
      result,
      operatorFigures: 'shown',
      ...(market === undefined ? {} : venueFields(deps.venues, market)),
    }),
  }
}

/** Every venue holding the market, manual ones included, because a ledger row names the custodian
 *  and not the exchange an order was routed to. */
function venueFields(
  venues: VenueRegistry,
  market: MarketRef
): Pick<RenderView, 'recordVenues' | 'placesOrders'> {
  const serving = venues.serving(market)

  return {
    recordVenues: serving.map((venue) => venue.manifest.id),
    placesOrders: serving.some((venue) => venue.adapter !== undefined),
  }
}
