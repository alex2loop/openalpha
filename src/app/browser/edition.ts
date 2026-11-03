import type { BrowserKeyring } from '@/app/browser/keys'
import type { App } from '@/core/container'
import type { SlashContext, SlashResult } from '@/core/types/command'
import type { BookReads, TradingEdition } from '@/trading/api'
import { hasAiKey } from '@/app/browser/keys'
import {
  AnalysisError,
  marketRef,
  renderAnalysisFailure,
  renderAnalysisText,
  type SuggestionRequest,
} from '@/trading/api'

/** The commands a visitor has: the ledger and the book, the market reads, `/suggest` as an
 *  analysis, the brief while the page is open, and research. Nothing that places an order, reads a
 *  venue, watches while the tab is closed or runs the full suggestion pipeline. */
const COMMANDS: ReadonlySet<string> = new Set([
  'market',
  'overview',
  'price',
  'screen',
  'watchlist',
  'setup',
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
  'research',
])

/** The tools the chat agent is handed when a command hands it the conversation (`/setup`): the
 *  market reads, the ledger and the profile, and the brief. Not the suggestion pipeline, the
 *  track record, alerts, themes, the brief's schedule or the rebalance and review reads, whose
 *  answers name an order or a verdict. */
const TOOLS: ReadonlySet<string> = new Set([
  'market_price',
  'market_bars',
  'market_overview',
  'market_events',
  'macro_risk',
  'market_screen',
  'market_sector_strength',
  'market_sentiment',
  'market_funding',
  'market_accounts',
  'vn_foreign_flow',
  'vn_futures_basis',
  'market_news',
  'portfolio_view',
  'portfolio_history',
  'profile_view',
  'profile_update',
  'profile_segment',
  'watchlist_update',
  'portfolio_record',
  'portfolio_update',
  'portfolio_remove',
  'brief_build',
])

/** VN equities, crypto and gold read from sources a browser reaches; VN gold prices a premium over
 *  gold. US equities need sources it cannot. */
const MARKETS: ReadonlySet<ReturnType<typeof marketRef>> = new Set([
  marketRef('equity-vn'),
  marketRef('crypto'),
  marketRef('gold'),
  marketRef('gold-vn'),
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
    stopDistances: async () => [],
  },
}

export function createBrowserEdition(app: App, keyring: BrowserKeyring): TradingEdition {
  return {
    markets: MARKETS,
    commands: COMMANDS,
    tools: TOOLS,
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
    reads: EMPTY_READS,
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

  if (!hasAiKey(keyring.env())) {
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
