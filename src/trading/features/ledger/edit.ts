import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { TradingCosts } from '@/trading/kernel/config'
import { isResolvedDraft, parseLedgerDraft } from '@/trading/features/ledger/draft'
import { renderWriteConfirmation } from '@/trading/features/ledger/render'
import { usage } from '@/trading/kernel/surface/surface'
import { resolveRenderContext } from '@/trading/render/format'

const UPDATE_USAGE: 'slash.tradingUpdateUsage' = 'slash.tradingUpdateUsage'
const DELETE_USAGE: 'slash.tradingDeleteUsage' = 'slash.tradingDeleteUsage'

type Editor = Pick<PortfolioService, 'update' | 'remove'>

interface EditCommandDeps {
  readonly portfolio: Editor
  readonly marketData: Pick<MarketDataService, 'quoteConvention' | 'trailsStop' | 'boardLot'>
  readonly costs: TradingCosts
  readonly timezone: string
}

/** Both commands name an entry by the handle `/transactions` prints beside it, so an operator never
 *  has to copy a UUID out of a chat line. */
export function createUpdateCommand(deps: EditCommandDeps): SlashCommand {
  return {
    name: 'update',
    description: { kind: 'localized', key: 'slash.tradingUpdateHelp' },
    messageKeys: [UPDATE_USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      idempotencyKey: (ctx) => ctx.requestId,
    },
    run: async (ctx): Promise<SlashResult> => runUpdate(deps, ctx),
  }
}

export function createDeleteCommand(deps: EditCommandDeps): SlashCommand {
  return {
    name: 'delete',
    description: { kind: 'localized', key: 'slash.tradingDeleteHelp' },
    messageKeys: [DELETE_USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      idempotencyKey: (ctx) => ctx.requestId,
    },
    run: async (ctx): Promise<SlashResult> => runDelete(deps, ctx),
  }
}

async function runUpdate(deps: EditCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [ref, ...rest] = ctx.args
  const draft = parseLedgerDraft(rest)

  if (ref === undefined || draft === null || !isResolvedDraft(draft)) {
    return usage(UPDATE_USAGE)
  }

  const result = await deps.portfolio.update({ ref, draft, now: Date.now(), signal: ctx.signal })

  return {
    kind: 'text',
    text: renderWriteConfirmation(ctx.locale, result, {
      ...deps,
      context: resolveRenderContext(deps.timezone, ctx.surface),
    }),
  }
}

async function runDelete(deps: EditCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [ref] = ctx.args

  if (ref === undefined || ctx.args.length !== 1) {
    return usage(DELETE_USAGE)
  }

  const result = await deps.portfolio.remove({ ref, now: Date.now(), signal: ctx.signal })

  return {
    kind: 'text',
    text: renderWriteConfirmation(ctx.locale, result, {
      ...deps,
      context: resolveRenderContext(deps.timezone, ctx.surface),
    }),
  }
}
