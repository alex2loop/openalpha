import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import { renderReconcileText } from '@/trading/features/portfolio/render/reconcile'
import { resolveRenderContext } from '@/trading/render/format'

/** Holds the book against what the custodians actually report. Read-only and venue-by-venue: a
 *  venue the operator trades by hand carries no adapter and has nothing to be held against. */
interface ReconcileCommandDeps {
  readonly portfolio: Pick<PortfolioService, 'reconcile'>
  readonly timezone: string
}

export function createReconcileCommand(deps: ReconcileCommandDeps): SlashCommand {
  return {
    name: 'reconcile',
    description: { kind: 'localized', key: 'slash.tradingReconcileHelp' },
    messageKeys: [],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'read',
      execution: { progressKey: 'slash.tradingReconcileProgress' },
      selfContained: true,
    },
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: ReconcileCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const reconciled = await deps.portfolio.reconcile({ now: Date.now(), signal: ctx.signal })

  return {
    kind: 'text',
    text: renderReconcileText(
      ctx.locale,
      reconciled,
      resolveRenderContext(deps.timezone, ctx.surface)
    ),
  }
}
