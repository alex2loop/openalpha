import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { renderSourcesText } from '@/trading/features/market-data/render/sources'
import { usage } from '@/trading/kernel/surface/surface'

const USAGE: 'slash.tradingSourcesUsage' = 'slash.tradingSourcesUsage'

interface SourcesCommandDeps {
  readonly marketData: Pick<MarketDataService, 'listSources'>
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
}

/** Breaker state is this process's memory, so the answer is only meaningful from inside the process
 *  that made the requests — which is why this is a command and not a doctor probe. */
export function createSourcesCommand(deps: SourcesCommandDeps): SlashCommand {
  return {
    name: 'sources',
    description: { kind: 'localized', key: 'slash.tradingSourcesHelp' },
    messageKeys: [USAGE],
    policy: { surfaces: ['channel', 'repl'], role: 'member', action: 'read' },
    usage: () => ({ key: USAGE }),
    run: (ctx: SlashContext): Promise<SlashResult> => Promise.resolve(run(deps, ctx)),
  }
}

function run(deps: SourcesCommandDeps, ctx: SlashContext): SlashResult {
  if (ctx.args.length > 0) {
    return usage(USAGE)
  }

  return {
    kind: 'text',
    text: renderSourcesText({
      summaries: deps.marketData.listSources(),
      locale: ctx.locale,
      timezone: deps.timezone,
    }),
  }
}
