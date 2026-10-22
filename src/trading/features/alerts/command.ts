import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { AlertService } from '@/trading/features/alerts/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { InstrumentRef, MarketRef, TickerRequest } from '@/trading/kernel/instrument'
import type { AlertCondition } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { MarketRegistry } from '@/trading/markets/types'
import type { QuoteConvention } from '@/trading/render/money'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'
import { renderAlertListText } from '@/trading/features/alerts/render'
import { runWithPriceConfirm } from '@/trading/features/market-data/command/price-confirm'
import { resolveMarketIcons } from '@/trading/features/market-data/reads/describe'
import { resolveInstrument } from '@/trading/features/market-data/resolve'
import { buildInstrumentKey, toIdHandle } from '@/trading/kernel/instrument'
import { ALERT_CONDITIONS } from '@/trading/kernel/operator/alert'
import {
  parseFiniteNumber,
  parseMember,
  parsePositiveInteger,
  parseTickerRequest,
  SYNTAX_POINTER_KEY,
  usage,
} from '@/trading/kernel/surface/surface'
import { renderCaveatLines } from '@/trading/render/caveat'
import { joinSections } from '@/trading/render/layout'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const ACTIONS = Object.freeze(['list', 'create', 'disable'] as const)
const USAGE: 'slash.tradingAlertUsage' = 'slash.tradingAlertUsage'
/** The most ids an ambiguous short id lists. */
const MAXIMUM_LISTED_IDS = 3
/** Ticker, condition, threshold. */
const CREATE_ARGUMENTS = 3
const ALERT_COMMAND = 'alert'

type AlertIssueKey = 'slash.tradingAlertCondition' | 'slash.tradingAlertThreshold'

interface AlertCommandDeps {
  readonly alerts: AlertService
  /** Qualifies a ticker the operator did not attach a market to, the way `/price` does. */
  readonly markets: MarketRegistry
  readonly marketData: Pick<
    MarketDataService,
    'describeMarkets' | 'instrumentQuoteConvention' | 'quoteBoard' | 'quoteConvention'
  >
}

export function createAlertCommand(deps: AlertCommandDeps): SlashCommand {
  return {
    name: ALERT_COMMAND,
    description: { kind: 'localized', key: 'slash.tradingAlertHelp' },
    messageKeys: [
      USAGE,
      'slash.tradingAlertCreated',
      'slash.tradingAlertDisabled',
      'slash.tradingAlertAmbiguous',
      'slash.tradingAlertCondition',
      'slash.tradingAlertThreshold',
      SYNTAX_POINTER_KEY,
    ],
    policy: { surfaces: ['channel', 'repl'], role: 'operator', action: 'mutate' },
    // The verb only: everything after it is the name being typed and its condition.
    completeFor: (args) => (args.length === 1 ? ACTIONS : []),
    usage: () => ({ key: USAGE, values: buildUsageValues(deps) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: AlertCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [raw, ...rest] = ctx.args
  const action = raw === undefined ? 'list' : parseMember(raw, ACTIONS)

  if (action === 'list') {
    return runList(deps, ctx, rest)
  }

  if (action === 'create') {
    return runWithPriceConfirm(
      ctx,
      { command: ALERT_COMMAND, marketData: deps.marketData },
      (typed, typedPrice) => runCreate(deps, typed, typedPrice)
    )
  }

  return action === 'disable' ? runDisable(deps, ctx, rest) : alertUsage(deps)
}

async function runList(
  deps: AlertCommandDeps,
  ctx: SlashContext,
  rest: readonly string[]
): Promise<SlashResult> {
  if (rest.length > 1) {
    return alertUsage(deps)
  }

  const limit =
    rest.length === 0
      ? SURFACE_LIMITS.maximumAlertItems
      : parsePositiveInteger(rest[0], SURFACE_LIMITS.maximumAlertItems)

  if (limit === null) {
    return alertUsage(deps)
  }

  const page = await deps.alerts.list({ limit, signal: ctx.signal })
  const instruments = [
    ...new Map(
      page.items.map((alert) => [buildInstrumentKey(alert.instrument), alert.instrument])
    ).values(),
  ]
  const [prices, conventions] = await Promise.all([
    priceByInstrument(deps, instruments, ctx),
    conventionByInstrument(deps, instruments, ctx),
  ])

  return {
    kind: 'text',
    text: renderAlertListText(ctx.locale, page, {
      priceByInstrument: prices,
      quoteConventions: conventions,
      marketIcons: resolveMarketIcons(deps.marketData),
    }),
  }
}

/** Per instrument rather than per market: an index on a board-scaled market is a level, and the
 *  market's convention would print it a thousand times too small. */
async function conventionByInstrument(
  deps: AlertCommandDeps,
  instruments: readonly InstrumentRef[],
  ctx: SlashContext
): Promise<ReadonlyMap<string, QuoteConvention>> {
  const entries = await Promise.all(
    instruments.map(async (instrument) => {
      const convention = await deps.marketData.instrumentQuoteConvention({
        ticker: instrument.ticker,
        market: instrument.market,
        signal: ctx.signal,
      })

      return convention === undefined ? [] : [[buildInstrumentKey(instrument), convention] as const]
    })
  )

  return new Map(entries.flat())
}

/** One batched read for the page's names, keyed the way instruments are keyed everywhere else: two
 *  markets can list the same ticker, and keying on the symbol alone collapsed their rows onto one
 *  price. `quoteBoard` carries its own caveats and never throws for a missing name, so an instrument it
 *  could not answer for simply renders without its distance. */
async function priceByInstrument(
  deps: AlertCommandDeps,
  instruments: readonly InstrumentRef[],
  ctx: SlashContext
): Promise<ReadonlyMap<string, number>> {
  if (instruments.length === 0) {
    return new Map()
  }

  const quoteBoard = await deps.marketData.quoteBoard({ instruments, signal: ctx.signal })

  return new Map(
    quoteBoard.items.map((item) => [
      buildInstrumentKey({ market: item.market, ticker: item.ticker }),
      item.last,
    ])
  )
}

/** Three words name the instrument the way `/price` does and let the registry qualify it; a
 *  `market:ticker` names the market itself. The market is checked against the registry, not merely
 *  against the shape of a slug: an unregistered one would arm an alert on a market nothing polls.
 *  Resolution runs here for the message rather than for the write — the service resolves again as
 *  its arming guard, and only this surface can render the registry's caveats for a name it refused. */
async function runCreate(
  deps: AlertCommandDeps,
  ctx: SlashContext,
  typedPrice: TypedPrice
): Promise<SlashResult> {
  const parsed = parseCreate(deps, ctx.args.slice(1))

  if (parsed.kind === 'refused') {
    return parsed.result
  }

  const { request, condition, threshold } = parsed
  const resolved = await resolveInstrument(deps.markets, {
    ...request,
    signal: ctx.signal,
  })

  if (resolved.kind === 'unresolved') {
    const lines = renderCaveatLines(ctx.locale, resolved.result.caveats)

    return lines.length === 0 ? alertUsage(deps) : { kind: 'text', text: joinSections([lines]) }
  }

  const origin = { channel: ctx.channel, chatId: ctx.chatId }

  const alert = await deps.alerts.create({
    draft: {
      instrument: resolved.instrument,
      condition,
      threshold,
      delivery: origin,
    },
    typedPrice,
    now: Date.now(),
    signal: ctx.signal,
  })

  const created = {
    key: 'slash.tradingAlertCreated',
    values: { id: toIdHandle(alert.id) },
  } as const

  if (isSameAddress(alert.delivery, origin)) {
    return { kind: 'message', messages: [created] }
  }

  // Armed from a terminal: say where the alert will actually arrive, since this chat is not it.
  return {
    kind: 'text',
    text: [
      t(ctx.locale, created.key, created.values),
      t(ctx.locale, 'trading.alert.deliverTo', {
        channel: alert.delivery.channel,
        brand: BRAND.name,
      }),
    ].join('\n'),
  }
}

type CreateParse =
  | {
      readonly kind: 'parsed'
      readonly request: TickerRequest
      readonly condition: AlertCondition
      readonly threshold: number
    }
  | { readonly kind: 'refused'; readonly result: SlashResult }

/** A wrong word count or an unreadable name earns the usage; a bad condition or threshold on a line
 *  of the right shape names the token, as `/record` does. */
function parseCreate(deps: AlertCommandDeps, rest: readonly string[]): CreateParse {
  const [rawTicker, rawCondition, rawThreshold] = rest
  const request = parseTickerRequest(rawTicker, registeredMarkets(deps))
  const condition = parseMember(rawCondition, ALERT_CONDITIONS)
  const threshold = parseFiniteNumber(rawThreshold)

  if (rest.length !== CREATE_ARGUMENTS || request === null) {
    return { kind: 'refused', result: alertUsage(deps) }
  }

  if (condition === null) {
    return { kind: 'refused', result: alertIssue('slash.tradingAlertCondition', rawCondition) }
  }

  if (threshold === null || threshold <= 0) {
    return { kind: 'refused', result: alertIssue('slash.tradingAlertThreshold', rawThreshold) }
  }

  return { kind: 'parsed', request, condition, threshold }
}

async function runDisable(
  deps: AlertCommandDeps,
  ctx: SlashContext,
  rest: readonly string[]
): Promise<SlashResult> {
  const [ref] = rest

  if (rest.length !== 1 || ref === undefined) {
    return alertUsage(deps)
  }

  const resolved = await deps.alerts.resolveAlertRef(ref, ctx.signal)

  if (resolved.kind === 'several') {
    // Full ids: two alerts can share a handle.
    const ids = resolved.ids.slice(0, MAXIMUM_LISTED_IDS).join(', ')

    return { kind: 'message', messages: [{ key: 'slash.tradingAlertAmbiguous', values: { ids } }] }
  }

  const result =
    resolved.kind === 'none'
      ? 'not-found'
      : await deps.alerts.disable({ alertId: resolved.id, now: Date.now(), signal: ctx.signal })

  return {
    kind: 'message',
    messages: [
      {
        key: 'slash.tradingAlertDisabled',
        values: { result: { key: `trading.disable.alert.${result}` } },
      },
    ],
  }
}

/** A line whose shape is right but one token is not names that token, as `/record` does. */
function alertIssue(key: AlertIssueKey, token: string | undefined): SlashResult {
  return {
    kind: 'message',
    messages: [
      { key, values: { token: token ?? '' } },
      { key: SYNTAX_POINTER_KEY, values: { command: ALERT_COMMAND } },
    ],
  }
}

function alertUsage(deps: AlertCommandDeps): SlashResult {
  return usage(USAGE, buildUsageValues(deps))
}

function buildUsageValues(deps: AlertCommandDeps): CommandMessageValues {
  return { markets: registeredMarkets(deps).join(', ') }
}

/** The set a qualifier is checked against, and the set the usage line names — one derivation, so
 *  the message can never offer a market the parser would reject. */
function registeredMarkets(deps: AlertCommandDeps): readonly MarketRef[] {
  return deps.markets.list().map((entry) => entry.manifest.id)
}

function isSameAddress(left: DeliveryAddress, right: DeliveryAddress): boolean {
  return left.channel === right.channel && left.chatId === right.chatId
}
