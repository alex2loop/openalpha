import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { BriefDelivery, BriefResult, BriefService } from '@/trading/features/brief/types'
import type { Region } from '@/trading/kernel/instrument'
import { LOCAL_TIME_RE } from '@/core/utils/time'
import { formatDay, t } from '@/i18n'
import { renderBriefText } from '@/trading/features/brief/render'
import { usage } from '@/trading/kernel/surface/surface'
import { bookAffordances } from '@/trading/render/affordance'
import { formatInstant } from '@/trading/render/datetime'
import { resolveRenderContext } from '@/trading/render/format'
import { joinSections } from '@/trading/render/layout'

const USAGE: 'slash.tradingBriefUsage' = 'slash.tradingBriefUsage'
/** Rebuilds past today's stored snapshot instead of rendering it. Operator-only: a build spends a
 *  run, and nothing else discards a snapshot that a refresh has made stale. */
const FORCE_ARG = 'force'
const ENABLE_ARG = 'enable'
const DISABLE_ARG = 'disable'
const ACTIONS = Object.freeze([FORCE_ARG, ENABLE_ARG, DISABLE_ARG] as const)

/** The default region arrives resolved from configuration; the handler holds no fallback of its
 *  own and never reads config. There is no region argument: only `equity-vn` publishes a brief
 *  capability, so any other region would name a subscription that never delivers — `enable` refuses
 *  one rather than scheduling it. */
interface BriefCommandDeps {
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
  readonly briefs: BriefService
  readonly defaultRegion: Region
}

export function createBriefCommand(deps: BriefCommandDeps): SlashCommand {
  return {
    name: 'brief',
    description: { kind: 'localized', key: 'slash.tradingBriefHelp' },
    messageKeys: [
      USAGE,
      'slash.tradingBriefNone',
      'slash.tradingBriefEnabled',
      'slash.tradingBriefNotEnabled',
      'slash.tradingBriefDisabled',
      'slash.tradingBriefOffHere',
    ],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      execution: { progressKey: 'slash.tradingBriefProgress' },
    },
    completeFor: (args) => (args.length === 1 ? ACTIONS : []),
    usage: () => ({ key: USAGE }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: BriefCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [action, ...rest] = ctx.args

  if (action === undefined) {
    return runShow(deps, ctx, false)
  }

  if (action === FORCE_ARG && rest.length === 0) {
    return runShow(deps, ctx, true)
  }

  if (action === ENABLE_ARG) {
    return runEnable(deps, ctx, rest)
  }

  if (action === DISABLE_ARG && rest.length === 0) {
    return runDisable(deps, ctx)
  }

  return usage(USAGE)
}

/** Builds on a miss rather than reporting nothing. `findOrBuildBrief` is idempotent per
 *  `(day, locale)` — a second call the same day returns the cached snapshot and spends nothing —
 *  so there is no runaway-cost reason to hide composition behind its own verb. `force` is the one
 *  way past that reuse, for a snapshot rendered before a refresh replaced the data under it. */
async function runShow(
  deps: BriefCommandDeps,
  ctx: SlashContext,
  forced: boolean
): Promise<SlashResult> {
  const now = Date.now()
  const latest = forced
    ? null
    : await deps.briefs.getLatest({
        region: deps.defaultRegion,
        locale: ctx.locale,
        now,
        signal: ctx.signal,
      })

  if (latest !== null) {
    return withSchedule(
      deps,
      ctx,
      renderBriefText(ctx.locale, latest, resolveRenderContext(deps.timezone, ctx.surface))
    )
  }

  const built = await buildNow(deps, ctx, { now, forced })

  if (built === null) {
    return withSchedule(deps, ctx, t(ctx.locale, 'slash.tradingBriefNone'))
  }

  return withSchedule(
    deps,
    ctx,
    renderBriefText(ctx.locale, built.snapshot, resolveRenderContext(deps.timezone, ctx.surface))
  )
}

/** Every read of the brief closes with where the next one stands. The question a missing brief
 *  raises is whether it was ever scheduled, and this is the only surface that can answer it. */
async function withSchedule(
  deps: BriefCommandDeps,
  ctx: SlashContext,
  body: string
): Promise<SlashResult> {
  const delivery = await deps.briefs.find(ctx.signal)

  return {
    kind: 'text',
    affordances: bookAffordances(ctx.locale),
    text: joinSections([[body], [scheduleLine(deps, ctx, delivery)]]),
  }
}

/** The next brief reads in the operator's own timezone, because the send time itself is stored in
 *  the market's. A subscription that was never made and one that was turned off read the same to
 *  the operator: it is off. */
function scheduleLine(
  deps: BriefCommandDeps,
  ctx: SlashContext,
  delivery: BriefDelivery | null
): string {
  if (delivery === null || delivery.state === 'disabled') {
    return deps.briefs.canDeliver({ channel: ctx.channel, chatId: ctx.chatId })
      ? t(ctx.locale, 'trading.brief.schedule.disabled')
      : t(ctx.locale, 'slash.tradingBriefOffHere')
  }

  if (delivery.state === 'scheduled') {
    return t(ctx.locale, 'trading.brief.schedule.scheduled', {
      when: formatInstant(ctx.locale, delivery.nextDueAt, deps.timezone),
    })
  }

  return t(ctx.locale, `trading.brief.schedule.${delivery.state}`)
}

type ReadyBrief = Extract<BriefResult, { readonly kind: 'ready' }>

interface BuildNowOptions {
  readonly now: number
  readonly forced: boolean
}

async function buildNow(
  deps: BriefCommandDeps,
  ctx: SlashContext,
  options: BuildNowOptions
): Promise<ReadyBrief | null> {
  const result = await deps.briefs.build({
    region: deps.defaultRegion,
    locale: ctx.locale,
    now: options.now,
    signal: ctx.signal,
    forced: options.forced,
    billingSessionId: ctx.sessionId,
    ...(ctx.progress === undefined ? {} : { progress: ctx.progress }),
  })

  return result.kind === 'ready' ? result : null
}

/** One positional argument, so there is no `vn`-vs-`08:15` ambiguity to parse. Omitting it leaves
 *  `sendTime` NULL, which means "follow `[trading.briefs] send_time`" — editing config later still
 *  moves the brief, which seeding the row at creation would have silently prevented. */
async function runEnable(
  deps: BriefCommandDeps,
  ctx: SlashContext,
  rest: readonly string[]
): Promise<SlashResult> {
  const [sendTime] = rest

  if (rest.length > 1 || (sendTime !== undefined && !LOCAL_TIME_RE.test(sendTime))) {
    return usage(USAGE)
  }

  const result = await deps.briefs.enable({
    region: deps.defaultRegion,
    delivery: { channel: ctx.channel, chatId: ctx.chatId },
    ...(sendTime === undefined ? {} : { sendTime }),
    now: Date.now(),
    signal: ctx.signal,
  })

  if (result.kind === 'rejected') {
    return {
      kind: 'message',
      messages: [
        {
          key: 'slash.tradingBriefNotEnabled',
          values: { reason: { key: `trading.enable.brief.${result.reason}` } },
        },
      ],
    }
  }

  const { delivery } = result

  return {
    kind: 'message',
    messages: [
      {
        key: 'slash.tradingBriefEnabled',
        values: { day: formatDay(ctx.locale, delivery.nextDeliveryDay) },
      },
    ],
  }
}

async function runDisable(deps: BriefCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const result = await deps.briefs.disable({ now: Date.now(), signal: ctx.signal })

  return {
    kind: 'message',
    messages: [
      {
        key: 'slash.tradingBriefDisabled',
        values: { result: { key: `trading.disable.brief.${result}` } },
      },
    ],
  }
}
