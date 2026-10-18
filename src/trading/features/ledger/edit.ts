import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import {
  buildInvalidLineMessages,
  isResolvedDraft,
  LEDGER_ISSUE_KEYS,
  parseLedgerDraft,
} from '@/trading/features/ledger/draft'
import { asksForFxRate } from '@/trading/features/ledger/fx-rate'
import { renderWriteConfirmation } from '@/trading/features/ledger/render'
import { usage } from '@/trading/kernel/surface/surface'

const UPDATE_COMMAND = 'update'
const UPDATE_USAGE: 'slash.tradingUpdateUsage' = 'slash.tradingUpdateUsage'
const DELETE_USAGE: 'slash.tradingDeleteUsage' = 'slash.tradingDeleteUsage'

type Editor = Pick<PortfolioService, 'update' | 'remove'>

interface EditCommandDeps {
  readonly portfolio: Editor
  readonly marketData: Pick<MarketDataService, 'quoteConvention' | 'trailsStop' | 'boardLot'>
  readonly costs: TradingCosts
}

interface UpdateCommandDeps extends EditCommandDeps {
  readonly baseCurrency: CurrencyCode
}

/** Both commands name an entry by the handle `/transactions` prints beside it, so an operator never
 *  has to copy a UUID out of a chat line. */
export function createUpdateCommand(deps: UpdateCommandDeps): SlashCommand {
  return {
    name: UPDATE_COMMAND,
    description: { kind: 'localized', key: 'slash.tradingUpdateHelp' },
    messageKeys: [UPDATE_USAGE, ...LEDGER_ISSUE_KEYS],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      idempotencyKey: (ctx) => ctx.requestId,
    },
    usage: () => ({ key: UPDATE_USAGE }),
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
    usage: () => ({ key: DELETE_USAGE }),
    run: async (ctx): Promise<SlashResult> => runDelete(deps, ctx),
  }
}

async function runUpdate(deps: UpdateCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [ref, ...rest] = ctx.args
  const parsed = parseLedgerDraft(rest, deps.baseCurrency)

  if (parsed.kind === 'invalid') {
    return {
      kind: 'message',
      messages: buildInvalidLineMessages(parsed.issue, { key: UPDATE_USAGE }, UPDATE_COMMAND),
    }
  }

  const { draft } = parsed

  if (ref === undefined || !isResolvedDraft(draft)) {
    return usage(UPDATE_USAGE)
  }

  if (asksForFxRate(draft, deps.baseCurrency) && 'currency' in draft) {
    return {
      kind: 'text',
      text: t(ctx.locale, 'trading.render.ledger.updateNeedsFx', { currency: draft.currency }),
    }
  }

  const result = await deps.portfolio.update({ ref, draft, now: Date.now(), signal: ctx.signal })

  return {
    kind: 'text',
    text: renderWriteConfirmation(ctx.locale, result, deps),
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
    text: renderWriteConfirmation(ctx.locale, result, deps),
  }
}
