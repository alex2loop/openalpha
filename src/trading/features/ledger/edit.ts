import type {
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import { t } from '@/i18n'
import {
  buildInvalidLineMessages,
  isResolvedDraft,
  LEDGER_ISSUE_KEYS,
  parseLedgerDraft,
} from '@/trading/features/ledger/draft'
import { asksForFxRate } from '@/trading/features/ledger/fx-rate'
import { resolveEntry } from '@/trading/features/ledger/mutate'
import { renderWriteConfirmation } from '@/trading/features/ledger/render'
import { renderEntry } from '@/trading/features/ledger/rows'
import { runWithPriceConfirm } from '@/trading/features/market-data/command/price-confirm'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { toIdHandle } from '@/trading/kernel/instrument'
import { usage } from '@/trading/kernel/surface/surface'

const UPDATE_COMMAND = 'update'
const UPDATE_USAGE: 'slash.tradingUpdateUsage' = 'slash.tradingUpdateUsage'
const DELETE_USAGE: 'slash.tradingDeleteUsage' = 'slash.tradingDeleteUsage'

const DELETE_COMMAND = 'delete'
const CONFIRM_ACTION = 'confirm'
const DELETE_READ_POLICY = {
  surfaces: ['channel', 'repl'],
  role: 'operator',
  action: 'read',
} as const satisfies SlashInvocationPolicy
const DELETE_CONFIRM_POLICY = {
  ...DELETE_READ_POLICY,
  action: 'mutate',
  idempotencyKey: (ctx) => ctx.requestId,
} as const satisfies SlashInvocationPolicy

type Editor = Pick<PortfolioService, 'update' | 'remove'>

interface EditCommandDeps {
  readonly portfolio: Editor
  readonly marketData: Pick<MarketDataService, 'quoteConvention' | 'trailsStop' | 'boardLot'>
  readonly costs: TradingCosts
}

interface DeleteCommandDeps extends EditCommandDeps {
  readonly ledger: Pick<LedgerStore, 'findById' | 'listIdsMatching'>
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
    run: async (ctx): Promise<SlashResult> =>
      runWithPriceConfirm(
        ctx,
        { command: UPDATE_COMMAND, marketData: deps.marketData },
        (typed, typedPrice) => runUpdate(deps, typed, typedPrice)
      ),
  }
}

export function createDeleteCommand(deps: DeleteCommandDeps): SlashCommand {
  return {
    name: DELETE_COMMAND,
    description: { kind: 'localized', key: 'slash.tradingDeleteHelp' },
    messageKeys: [DELETE_USAGE],
    policy: DELETE_READ_POLICY,
    policyFor: (args) => (args[1] === CONFIRM_ACTION ? DELETE_CONFIRM_POLICY : DELETE_READ_POLICY),
    usage: () => ({ key: DELETE_USAGE }),
    run: async (ctx): Promise<SlashResult> => runDelete(deps, ctx),
  }
}

async function runUpdate(
  deps: UpdateCommandDeps,
  ctx: SlashContext,
  typedPrice: TypedPrice
): Promise<SlashResult> {
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

  const result = await deps.portfolio.update({
    ref,
    draft,
    typedPrice,
    now: Date.now(),
    signal: ctx.signal,
  })

  return {
    kind: 'text',
    text: renderWriteConfirmation(ctx.locale, result, deps),
  }
}

async function runDelete(deps: DeleteCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [ref, action] = ctx.args

  if (
    ref === undefined ||
    ctx.args.length > 2 ||
    (action !== undefined && action !== CONFIRM_ACTION)
  ) {
    return usage(DELETE_USAGE)
  }

  if (action === undefined) {
    return previewDelete(deps, ctx, ref)
  }

  const result = await deps.portfolio.remove({ ref, now: Date.now(), signal: ctx.signal })

  return {
    kind: 'text',
    text: renderWriteConfirmation(ctx.locale, result, deps),
  }
}

/** Shows the row a handle names and the button that deletes it; nothing is held between the two
 *  commands, so a second tap finds no row and says so. */
async function previewDelete(
  deps: DeleteCommandDeps,
  ctx: SlashContext,
  ref: string
): Promise<SlashResult> {
  const entry = await resolveEntry(deps, { ref, signal: ctx.signal })
  const instruments = 'instrument' in entry.transaction ? [entry.transaction.instrument] : []
  const conventions = quoteConventionsFor(deps.marketData, instruments)

  return {
    kind: 'text',
    text: `${renderEntry(ctx.locale, entry, conventions)}\n\n${t(ctx.locale, 'trading.render.ledger.deleteAsk')}`,
    affordances: [
      {
        label: t(ctx.locale, 'trading.render.affordance.deleteRow'),
        command: `/${DELETE_COMMAND} ${toIdHandle(entry.id)} ${CONFIRM_ACTION}`,
      },
    ],
  }
}
