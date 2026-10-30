import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { IntradayReportDeps } from '@/trading/features/market-data/intraday/report'
import type { IntradayPlan } from '@/trading/features/market-data/intraday/schedule'
import type { IntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import type { TradingConfig } from '@/trading/kernel/config'
import type { Region } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import { formatDay, t } from '@/i18n'
import { buildIntradayReport } from '@/trading/features/market-data/intraday/report'
import {
  nextIntradayFireAt,
  resolveIntradayPlan,
} from '@/trading/features/market-data/intraday/schedule'
import { renderIntradayText } from '@/trading/features/market-data/render/intraday'
import { parseMember, usage } from '@/trading/kernel/surface/surface'
import { formatClock } from '@/trading/render/datetime'
import { answerSurfaceOf, resolveRenderContext } from '@/trading/render/format'

const BLOCK_SEPARATOR = '\n\n'

const USAGE: 'slash.tradingMarketUsage' = 'slash.tradingMarketUsage'
const ENABLED: 'slash.tradingMarketEnabled' = 'slash.tradingMarketEnabled'
const DISABLED: 'slash.tradingMarketDisabled' = 'slash.tradingMarketDisabled'
const ACTIONS = Object.freeze(['enable', 'disable'] as const)

interface MarketShowRequest {
  readonly region: Region
  readonly locale: Locale
  /** Where it is read, which sets its layout and width. */
  readonly surface: string
  readonly signal: AbortSignal
}

interface MarketCommandDeps {
  readonly report: Omit<IntradayReportDeps, 'locale'>
  readonly markets: MarketRegistry
  readonly config: TradingConfig
  readonly settings: IntradaySettingsStore
}

export function createMarketCommand(deps: MarketCommandDeps): SlashCommand {
  return {
    name: 'market',
    description: { kind: 'localized', key: 'slash.tradingMarketHelp' },
    messageKeys: [USAGE, ENABLED, DISABLED],
    // Operator-gated as a whole, which gates the read-only report too. `policyFor` could split it
    // per subcommand, but `all()` lists a command by its base policy, so the report would advertise
    // itself to members and then be refused. `/brief` and `/alert` make the same trade.
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      execution: { progressKey: 'slash.tradingMarketProgress' },
      selfContained: true,
    },
    completeFor: (args) => (args.length === 1 ? ACTIONS : []),
    usage: () => ({ key: USAGE }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

/** `ctx.locale`, not the configured one: a person typing in a chat reads the reply in their own
 *  language, while the unattended fire has no chat to read a locale from. */
async function run(deps: MarketCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [action, ...rest] = ctx.args

  if (action === undefined) {
    return runShow(deps, ctx)
  }

  const requested = parseMember(action, ACTIONS)

  if (requested === null || rest.length > 0) {
    return usage(USAGE)
  }

  return runSetEnabled(deps, ctx, requested === 'enable')
}

async function runShow(deps: MarketCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const text = await renderMarketShow(deps, {
    region: deps.config.defaultRegion,
    locale: ctx.locale,
    surface: answerSurfaceOf(ctx),
    signal: ctx.signal,
  })

  return { kind: 'text', text }
}

/** What `/market` prints for a region: its intraday report, then whether and when the next one is
 *  sent. The web page reads the same text for any region; the schedule line is the default region's own. */
export async function renderMarketShow(
  deps: MarketCommandDeps,
  request: MarketShowRequest
): Promise<string> {
  const now = Date.now()
  const enabled = await deps.settings.isEnabled(request.signal)
  const plan = resolveIntradayPlan({ markets: deps.markets, config: deps.config }, request.region)
  const report = await buildIntradayReport(
    { ...deps.report, locale: request.locale },
    { plan, now, signal: request.signal }
  )

  const text = renderIntradayText(
    request.locale,
    report,
    resolveRenderContext(deps.report.timezone, request.surface)
  )

  // The schedule is the default region's: another region's page carries no line about it.
  return request.region === deps.config.defaultRegion
    ? [text, nextLine(request.locale, { plan, now, enabled, timezone: deps.report.timezone })].join(
        BLOCK_SEPARATOR
      )
    : text
}

/** Enabling reports the next fire rather than a bare "done": with an empty `send_times`, "enabled"
 *  alone would promise a message that never arrives. */
async function runSetEnabled(
  deps: MarketCommandDeps,
  ctx: SlashContext,
  enabled: boolean
): Promise<SlashResult> {
  const now = Date.now()

  await deps.settings.setEnabled({ enabled, now, signal: ctx.signal })

  if (!enabled) {
    return { kind: 'text', text: t(ctx.locale, DISABLED) }
  }

  const plan = resolveIntradayPlan(
    { markets: deps.markets, config: deps.config },
    deps.config.defaultRegion
  )

  return {
    kind: 'text',
    text: `${t(ctx.locale, ENABLED)}\n${nextLine(ctx.locale, { plan, now, enabled: true, timezone: deps.report.timezone })}`,
  }
}

interface NextLineOptions {
  readonly plan: IntradayPlan
  readonly now: number
  readonly enabled: boolean
  readonly timezone: string
}

/** Also how an operator confirms the schedule without opening their config file. The switch is
 *  reported first, or an operator who disabled it last week reads a next-fire time and believes it. */
function nextLine(locale: Locale, options: NextLineOptions): string {
  const { plan, now, timezone } = options

  if (!options.enabled) {
    return t(locale, 'trading.intraday.next.off')
  }

  const at = nextIntradayFireAt(plan, now)

  if (at === null) {
    return t(locale, 'trading.intraday.next.none')
  }

  const calendar = plan.market.manifest.calendar
  const time = formatClock(locale, at, timezone)
  const day = calendar.dayAt(at)

  // A date the reader has to compare against today is work; the common case is later the same day.
  if (day === calendar.dayAt(now)) {
    return t(locale, 'trading.intraday.next.today', { time })
  }

  return t(locale, 'trading.intraday.next.at', { day: formatDay(locale, day), time })
}
