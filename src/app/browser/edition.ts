import type { BrowserKeyring } from '@/app/browser/keys'
import type { App } from '@/core/container'
import type { SlashContext, SlashResult } from '@/core/types/command'
import type { BookReads, BriefSectionKind, InstrumentRef, TradingEdition } from '@/trading/api'
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

/** Brief sections that rank names by composite: the watchlist ordered by score, and which names
 *  entered or left the top of the board. The web ranks nothing. */
const BRIEF_OMITS: ReadonlySet<BriefSectionKind> = new Set(['watchlist-leading', 'screen-delta'])

const NEEDS_KEY = 'slash.tradingSuggestAnalysisNeedsKey'

/** How many of the newest analyses name the instruments the visitor looked at. */
const VIEWED_ANALYSES = 30

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
    screen: 'board',
    briefOmits: BRIEF_OMITS,
    reads: EMPTY_READS,
    pagedBackfill: true,
    viewed: ({ signal }) => viewedInstruments(app, signal),
  }
}

// What the visitor asked an analysis of: the one record of a name looked at that outlives the tab.
async function viewedInstruments(app: App, signal: AbortSignal): Promise<readonly InstrumentRef[]> {
  const page = await app
    .resolve('tradingStores')
    .analysis.listPage({ limit: VIEWED_ANALYSES, signal })

  return page.items.map((record) => record.instrument)
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
