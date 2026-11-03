import type { BrowserKeyring } from '@/app/browser/keys'
import type { App } from '@/core/container'
import type { SlashContext, SlashResult } from '@/core/types/command'
import type {
  BookReads,
  BriefActionCode,
  BriefSectionKind,
  ProfileSetField,
  TradingEdition,
} from '@/trading/api'
import { hasAiKey, readModelProvider } from '@/app/browser/keys'
import {
  AnalysisError,
  marketRef,
  renderAnalysisFailure,
  renderAnalysisText,
  type SuggestionRequest,
} from '@/trading/api'

/** The commands a visitor has: the ledger and the book, the market reads, `/suggest` as an
 *  analysis and the brief while the page is open. Nothing that places an order, reads a
 *  venue, watches while the tab is closed or runs the full suggestion pipeline. */
const COMMANDS: ReadonlySet<string> = new Set([
  'market',
  'overview',
  'price',
  'screen',
  'watchlist',
  'record',
  'update',
  'delete',
  'transactions',
  'portfolio',
  'profile',
  'rebalance',
  'refresh',
  'suggest',
  'brief',
])

/** VN equities, crypto and gold read from sources a browser reaches; VN gold prices a premium over
 *  gold. US equities need sources it cannot. */
const MARKETS: ReadonlySet<ReturnType<typeof marketRef>> = new Set([
  marketRef('equity-vn'),
  marketRef('crypto'),
  marketRef('gold'),
  marketRef('gold-vn'),
])

/** Brief sections that rank names by composite (the watchlist ordered by score, which names
 *  entered or left the top of the board) or state what the web has none of: the standing rules for
 *  stops, entries and tranches, and the cash posture a plan would leave. */
const BRIEF_OMITS: ReadonlySet<BriefSectionKind> = new Set([
  'watchlist-leading',
  'screen-delta',
  'discipline',
  'deposit-rate',
])

/** The next action that tells the reader when to buy. The others name a record to make or a
 *  command to read. */
const BRIEF_ACTION_OMITS: ReadonlySet<BriefActionCode> = new Set(['avoid-chasing'])

/** Statements come from a source no browser reaches, so a refresh does not ask for them. */
const REFRESH_OMITS: NonNullable<TradingEdition['refreshOmits']> = new Set(['accounts'])

/** The settings the page reads: the risk level, goal and horizon it states, the cash reserve and
 *  the sector cap its findings measure against, and the targets and caps the gaps are measured
 *  against. */
const PROFILE_FIELDS: ReadonlySet<ProfileSetField> = new Set([
  'risk-level',
  'goal',
  'horizon',
  'reserve-pct-nav',
  'maximum-sector-pct-nav',
  'segment-target',
  'segment-cap',
  'position-cap',
])

const NEEDS_KEY = 'slash.tradingSuggestAnalysisNeedsKey'

/** Nothing here stores a suggestion or plans an exit, so every read of one answers empty: no
 *  verdict closes a name, no plan is written when a trade is recorded, no stop distance is listed,
 *  and the brief's sweep, resolved calls, fired alerts and exit watch have nothing to say. */
const EMPTY_READS: BookReads = {
  reduceVerdicts: { standing: async () => new Map() },
  exitPlans: { plan: async () => ({ kind: 'unplanned', reason: 'no-levels' }) },
  stopDistances: { stopDistances: async () => [] },
  brief: {
    runSuggestions: async () => [],
    listResolvedSuggestions: async () => [],
    listFiredAlerts: async () => [],
    positionExits: async () => [],
    unwatchedPositions: async () => [],
    stalePositions: async () => [],
  },
}

export function createBrowserEdition(app: App, keyring: BrowserKeyring): TradingEdition {
  return {
    markets: MARKETS,
    commands: COMMANDS,
    suggest: {
      run: (request, ctx) => analyse(app, keyring, { request, ctx }),
      keys: {
        help: 'slash.tradingSuggestAnalysisHelp',
        usage: 'slash.tradingSuggestAnalysisUsage',
        progress: 'slash.tradingSuggestAnalysisProgress',
        stopsRefusal: 'slash.tradingSuggestAnalysisStopsRefused',
        answers: [NEEDS_KEY],
      },
    },
    rebalance: 'gaps',
    overviewOmitsDeployment: true,
    screen: 'board',
    briefOmits: BRIEF_OMITS,
    briefActionOmits: BRIEF_ACTION_OMITS,
    profile: {
      fields: PROFILE_FIELDS,
      usage: 'slash.tradingProfileAnalysisUsage',
    },
    reads: EMPTY_READS,
    pagedBackfill: true,
    refreshOmits: REFRESH_OMITS,
  }
}

interface AnalysisCall {
  readonly request: SuggestionRequest
  readonly ctx: SlashContext
}

// Without a key nothing is sent: the answer is the line that says which key unlocks it.
async function analyse(
  app: App,
  keyring: BrowserKeyring,
  call: AnalysisCall
): Promise<SlashResult> {
  const { request, ctx } = call

  if (!hasAiKey(keyring.env(), readModelProvider(app.config))) {
    return { kind: 'message', messages: [{ key: NEEDS_KEY }] }
  }

  try {
    const record = await app.resolve('tradingServices').analyses.run(request, ctx.signal)

    return { kind: 'text', text: renderAnalysisText(ctx.locale, record) }
  } catch (err: unknown) {
    if (err instanceof AnalysisError) {
      return { kind: 'text', text: renderAnalysisFailure(ctx.locale, err.failure) }
    }

    throw err
  }
}
