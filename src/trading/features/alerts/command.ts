import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { AlertService } from '@/trading/features/alerts/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { InstrumentRef, MarketRef } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import type { QuoteConvention } from '@/trading/render/money'
import { renderAlertListText } from '@/trading/features/alerts/render'
import { resolveInstrument } from '@/trading/features/market-data/resolve'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { ALERT_CONDITIONS, alertId } from '@/trading/kernel/operator/alert'
import {
  parseBranded,
  parseFiniteNumber,
  parseMember,
  parsePositiveInteger,
  parseTickerRequest,
  usage,
} from '@/trading/kernel/surface/surface'
import { renderCaveatLines } from '@/trading/render/caveat'
import { joinSections } from '@/trading/render/layout'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const ACTIONS = Object.freeze(['list', 'create', 'disable'] as const)
const USAGE: 'slash.tradingAlertUsage' = 'slash.tradingAlertUsage'
const UNDELIVERABLE: 'slash.tradingAlertUndeliverable' = 'slash.tradingAlertUndeliverable'
/** Ticker, condition, threshold. */
const CREATE_ARGUMENTS = 3

interface AlertCommandDeps {
  readonly alerts: AlertService
  /** Qualifies a ticker the operator did not attach a market to, the way `/price` does. */
  readonly markets: MarketRegistry
  readonly marketData: Pick<MarketDataService, 'quoteBoard' | 'instrumentQuoteConvention'>
}

export function createAlertCommand(deps: AlertCommandDeps): SlashCommand {
  return {
    name: 'alert',
    description: { kind: 'localized', key: 'slash.tradingAlertHelp' },
    messageKeys: [USAGE, UNDELIVERABLE, 'slash.tradingAlertCreated', 'slash.tradingAlertDisabled'],
    policy: { surfaces: ['channel', 'repl'], role: 'operator', action: 'mutate' },
    // The verb only: everything after it is the name being typed and its condition.
    completeFor: (args) => (args.length === 1 ? ACTIONS : []),
    usage: () => ({ key: USAGE, values: buildUsageValues(deps) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: AlertCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [raw, ...rest] = ctx.args
  const action = parseMember(raw, ACTIONS)

  if (action === 'list') {
    return runList(deps, ctx, rest)
  }

  if (action === 'create') {
    return runCreate(deps, ctx, rest)
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
  rest: readonly string[]
): Promise<SlashResult> {
  if (rest.length !== CREATE_ARGUMENTS) {
    return alertUsage(deps)
  }

  const [rawTicker, rawCondition, rawThreshold] = rest
  const request = parseTickerRequest(rawTicker, registeredMarkets(deps))
  const condition = parseMember(rawCondition, ALERT_CONDITIONS)
  const threshold = parseFiniteNumber(rawThreshold)

  if (request === null || condition === null) {
    return alertUsage(deps)
  }

  if (threshold === null || threshold <= 0) {
    return alertUsage(deps)
  }

  const resolved = await resolveInstrument(deps.markets, {
    ...request,
    signal: ctx.signal,
  })

  if (resolved.kind === 'unresolved') {
    const lines = renderCaveatLines(ctx.locale, resolved.result.caveats)

    return lines.length === 0 ? alertUsage(deps) : { kind: 'text', text: joinSections([lines]) }
  }

  const delivery = { channel: ctx.channel, chatId: ctx.chatId }

  // Before the write: an alert armed at an address the router cannot reach would poll, trigger,
  // fail every send, and disable itself without one word reaching the operator.
  if (!deps.alerts.canDeliver(delivery)) {
    return { kind: 'message', messages: [{ key: UNDELIVERABLE }] }
  }

  const alert = await deps.alerts.create({
    draft: {
      instrument: resolved.instrument,
      condition,
      threshold,
      delivery,
    },
    now: Date.now(),
    signal: ctx.signal,
  })

  return {
    kind: 'message',
    messages: [{ key: 'slash.tradingAlertCreated', values: { id: alert.id } }],
  }
}

async function runDisable(
  deps: AlertCommandDeps,
  ctx: SlashContext,
  rest: readonly string[]
): Promise<SlashResult> {
  const id = rest.length === 1 ? parseBranded(rest[0], alertId) : null

  if (id === null) {
    return alertUsage(deps)
  }

  const result = await deps.alerts.disable({
    alertId: id,
    now: Date.now(),
    signal: ctx.signal,
  })

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
