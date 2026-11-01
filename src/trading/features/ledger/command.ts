import type {
  Affordance,
  CommandMessage,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { FxStageDeps } from '@/trading/features/ledger/confirm'
import type { LedgerFieldIssue } from '@/trading/features/ledger/draft'
import type { VenueSyncDeps } from '@/trading/features/ledger/sync-run'
import type { LedgerTxnDraftInput } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { CurrencyCode, Region, VenueRef } from '@/trading/kernel/instrument'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import { isWord } from '@/core/utils/text'
import { t } from '@/i18n'
import { stageForFxRate } from '@/trading/features/ledger/confirm'
import {
  buildInvalidLineMessages,
  LEDGER_ISSUE_KEYS,
  parseLedgerDraft,
  parseSyncRequest,
  SYNC_ACTION,
} from '@/trading/features/ledger/draft'
import { renderWriteConfirmation } from '@/trading/features/ledger/render'
import { SHORTHAND_KEYS, toFullRecordLine } from '@/trading/features/ledger/shorthand'
import { runVenueSync } from '@/trading/features/ledger/sync-run'
import { LEDGER_TXN_KINDS } from '@/trading/features/ledger/types'
import { runWithPriceConfirm } from '@/trading/features/market-data/command/price-confirm'

const RECORD_COMMAND = 'record'
const USAGE: 'slash.tradingRecordUsage' = 'slash.tradingRecordUsage'
const CONFIRM_ACTION = 'confirm'

type Recorder = Pick<PortfolioService, 'record' | 'remove' | 'previewRecord' | 'recordVenues'>

interface RecordCommandDeps extends FxStageDeps, VenueSyncDeps {
  readonly portfolio: Recorder
  readonly marketData: Pick<MarketDataService, 'quoteConvention' | 'trailsStop' | 'boardLot'>
  readonly costs: TradingCosts
  readonly defaultRegion: Region
}

export function createRecordCommand(deps: RecordCommandDeps): SlashCommand {
  return {
    name: RECORD_COMMAND,
    description: { kind: 'localized', key: 'slash.tradingRecordHelp' },
    messageKeys: [USAGE, ...SHORTHAND_KEYS, ...LEDGER_ISSUE_KEYS],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      idempotencyKey: (ctx) => ctx.requestId,
    },
    completeFor: (args) =>
      args.length === 1 ? [...LEDGER_TXN_KINDS, SYNC_ACTION, CONFIRM_ACTION] : [],
    usage: () => buildUsageMessage(deps),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

type RecordRequest =
  | { readonly venue: VenueRef }
  | { readonly draft: LedgerTxnDraftInput }
  | { readonly invalid: LedgerFieldIssue | undefined }

async function run(deps: RecordCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  if (ctx.args.length === 1 && isWord(ctx.args[0], CONFIRM_ACTION)) {
    return { kind: 'text', text: await confirmStaged(deps, ctx) }
  }

  return runWithPriceConfirm(
    ctx,
    { command: RECORD_COMMAND, marketData: deps.marketData },
    (typed, typedPrice) => runRecord(deps, typed, typedPrice)
  )
}

async function runRecord(
  deps: RecordCommandDeps,
  ctx: SlashContext,
  typedPrice: TypedPrice
): Promise<SlashResult> {
  // One clock read for the shorthand's "today" and the write's validator, so they agree.
  const now = Date.now()
  const expanded = await toFullRecordLine(deps, { tokens: ctx.args, now, signal: ctx.signal })

  if (expanded.kind === 'refused') {
    return { kind: 'message', messages: expanded.messages }
  }

  const request = parseRecordRequest(expanded.tokens, deps.baseCurrency)

  if ('invalid' in request) {
    return recordUsage(deps, request.invalid)
  }

  const held = deps.staged.peek(ctx.sessionId) !== undefined
  const outcome =
    'venue' in request
      ? { text: await syncText(deps, ctx, request.venue), staged: false }
      : await recordDraft(deps, ctx, { draft: request.draft, typedPrice, now })

  // Dropped only once the new command went through: a typo or a refusal leaves the held row
  // confirmable, and a newly held row has already replaced it.
  if (held && !outcome.staged) {
    deps.staged.discard(ctx.sessionId)
  }

  const text = held ? withDroppedNotice(ctx.locale, outcome.text) : outcome.text

  return outcome.staged
    ? { kind: 'text', text, affordances: [buildBookAffordance(ctx.locale)] }
    : { kind: 'text', text }
}

function buildBookAffordance(locale: Locale): Affordance {
  return {
    label: t(locale, 'trading.render.affordance.bookRecord'),
    command: `/${RECORD_COMMAND} ${CONFIRM_ACTION}`,
  }
}

function parseRecordRequest(args: readonly string[], baseCurrency: CurrencyCode): RecordRequest {
  const venue = parseSyncRequest(args)

  if (venue !== null) {
    return { venue }
  }

  const parsed = parseLedgerDraft(args, baseCurrency)

  return parsed.kind === 'draft' ? { draft: parsed.draft } : { invalid: parsed.issue }
}

async function recordDraft(
  deps: RecordCommandDeps,
  ctx: SlashContext,
  input: {
    readonly draft: LedgerTxnDraftInput
    readonly typedPrice: TypedPrice
    readonly now: number
  }
): Promise<{ readonly text: string; readonly staged: boolean }> {
  const preview = await stageForFxRate(deps, ctx, input)

  if (preview !== undefined) {
    return { text: preview, staged: true }
  }

  const result = await deps.portfolio.record({
    ...input,
    idempotencyKey: ctx.requestId,
    signal: ctx.signal,
  })

  return { text: renderWriteConfirmation(ctx.locale, result, deps), staged: false }
}

/** Writes the held row under the request id it was previewed with, then lets it go. A write that
 *  throws keeps the row for another try; a repeated confirm replays the same key, so the row is
 *  booked once. `fillSource` stops the write path from asking the venue again. */
async function confirmStaged(deps: RecordCommandDeps, ctx: SlashContext): Promise<string> {
  const staged = deps.staged.peek(ctx.sessionId)

  if (staged === undefined) {
    return t(ctx.locale, 'trading.render.ledger.confirmNothing')
  }

  const result = await deps.portfolio.record({
    draft: staged.draft,
    fillSource: staged.fillSource,
    // The preview asked any price question before the row was held.
    typedPrice: 'confirmed',
    idempotencyKey: staged.requestId,
    now: Date.now(),
    signal: ctx.signal,
  })

  deps.staged.discard(ctx.sessionId)

  return renderWriteConfirmation(ctx.locale, result, deps)
}

function withDroppedNotice(locale: Locale, text: string): string {
  return `${t(locale, 'trading.render.ledger.stagedDiscarded')}\n\n${text}`
}

function recordUsage(deps: RecordCommandDeps, issue: LedgerFieldIssue | undefined): SlashResult {
  return {
    kind: 'message',
    messages: buildInvalidLineMessages(issue, buildUsageMessage(deps), RECORD_COMMAND),
  }
}

/** Only markets a venue holds: the ledger refuses a row in any other, so the usage never offers
 *  one. */
function buildUsageMessage(deps: RecordCommandDeps): CommandMessage {
  const held = deps.venues.heldMarkets()
  const markets = deps.markets
    .list()
    .map((entry) => entry.manifest.id)
    .filter((market) => held.has(market))

  return { key: USAGE, values: { markets: markets.join(', ') } }
}

async function syncText(
  deps: RecordCommandDeps,
  ctx: SlashContext,
  venue: VenueRef
): Promise<string> {
  const outcome = await runVenueSync(deps, { venue, locale: ctx.locale, signal: ctx.signal })

  return outcome.text
}
