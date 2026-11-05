import type {
  CommandMessage,
  CommandMessageKey,
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import type {
  ThemeId,
  ThemeLookupFailure,
  ThemeReport,
  ThemeService,
  ThemeTransition,
  ThemeTransitionOutcome,
} from '@/trading/features/themes/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import { renderAiLabel, t } from '@/i18n'
import { firstProposedTheme, renderThemeReportText } from '@/trading/features/themes/render/report'
import { THEME_MARKET, THEME_TRANSITIONS, themeId } from '@/trading/features/themes/types'
import { parseBranded, parseMember, usage } from '@/trading/kernel/surface/surface'
import { joinSections } from '@/trading/render/layout'

const SHOW_ACTION = 'show'
const RUN_ACTION = 'run'
const ACTIONS = Object.freeze([SHOW_ACTION, RUN_ACTION, ...THEME_TRANSITIONS] as const)
const USAGE: 'slash.tradingThemesUsage' = 'slash.tradingThemesUsage'
const BUSY: 'slash.tradingThemesBusy' = 'slash.tradingThemesBusy'
const NOT_FOUND: 'slash.tradingThemesNotFound' = 'slash.tradingThemesNotFound'
const NOT_ALLOWED: 'slash.tradingThemesNotAllowed' = 'slash.tradingThemesNotAllowed'
const NOT_TRACKED: 'slash.tradingThemesNotTracked' = 'slash.tradingThemesNotTracked'
const TRANSITION_DONE: Readonly<Record<ThemeTransition, CommandMessageKey>> = Object.freeze({
  approve: 'slash.tradingThemesApproved',
  reject: 'slash.tradingThemesRejected',
  retire: 'slash.tradingThemesRetired',
})
const SURFACES = Object.freeze(['channel', 'repl'] as const)
const RUN_POLICY: SlashInvocationPolicy = Object.freeze({
  surfaces: SURFACES,
  role: 'operator',
  action: 'costly',
  execution: { progressKey: 'slash.tradingThemesProgress' as const },
  selfContained: true,
  transcript: 'echo',
})
const SHOW_POLICY: SlashInvocationPolicy = Object.freeze({
  surfaces: SURFACES,
  role: 'operator',
  action: 'read',
  transcript: 'echo',
})
const CHANGE_POLICY: SlashInvocationPolicy = Object.freeze({
  surfaces: SURFACES,
  role: 'operator',
  action: 'mutate',
})

interface ThemesCommandDeps {
  readonly themes: ThemeService
  readonly timezone: string
  /** The market the operator's home region trades in, when it is not the one themes cover. */
  readonly homeMarket?: MarketRef
}

function render(deps: ThemesCommandDeps, ctx: SlashContext, report: ThemeReport): SlashResult {
  const body = renderThemeReportText(report, { locale: ctx.locale, timezone: deps.timezone })
  // The label is for the reader, where the surface does not already show it; the model that is asked
  // about the report next reads the body alone.
  const label =
    report.run === undefined || ctx.hasAiLabel === true ? [] : [renderAiLabel(ctx.locale)]
  const text = joinSections([label, [body]])
  const proposed = firstProposedTheme(report)

  if (proposed === undefined) {
    return { kind: 'text', text, echoText: body }
  }

  return {
    kind: 'text',
    text,
    echoText: body,
    affordances: [
      {
        label: t(ctx.locale, 'trading.render.affordance.approveTheme'),
        command: `/themes approve ${proposed}`,
      },
    ],
  }
}

/** Every tracked theme and a search for new ones, or one tracked theme alone. */
async function runAnalysis(
  deps: ThemesCommandDeps,
  ctx: SlashContext,
  id: ThemeId | undefined
): Promise<SlashResult> {
  const outcome = await deps.themes.run({
    locale: ctx.locale,
    channel: ctx.channel,
    billingSessionId: ctx.sessionId,
    ...(ctx.runId === undefined ? {} : { parentRunId: ctx.runId }),
    signal: ctx.signal,
    ...(ctx.progress === undefined ? {} : { progress: ctx.progress }),
    ...(id === undefined ? {} : { themeId: id }),
  })

  if (outcome.kind === 'busy') {
    return usage(BUSY)
  }

  return outcome.kind === 'report'
    ? render(deps, ctx, outcome.report)
    : renderLookupFailure(outcome, { id: id ?? '', notAllowed: NOT_TRACKED })
}

async function runTransition(
  deps: ThemesCommandDeps,
  ctx: SlashContext,
  request: { readonly action: ThemeTransition; readonly id: ThemeId }
): Promise<SlashResult> {
  const outcome = await deps.themes.transition({ ...request, now: Date.now(), signal: ctx.signal })
  const message = toThemeTransitionMessage(request, outcome)

  return usage(message.key, message.values)
}

/** What a theme move answers, in `/themes`'s words, so the web page says it the same way. */
export function toThemeTransitionMessage(
  request: { readonly action: ThemeTransition; readonly id: ThemeId },
  outcome: ThemeTransitionOutcome
): CommandMessage {
  return outcome.kind === 'done'
    ? { key: TRANSITION_DONE[request.action], values: { id: request.id } }
    : toLookupFailureMessage(outcome, { id: request.id, notAllowed: NOT_ALLOWED })
}

function renderLookupFailure(
  failure: ThemeLookupFailure,
  input: { readonly id: string; readonly notAllowed: CommandMessageKey }
): SlashResult {
  const message = toLookupFailureMessage(failure, input)

  return usage(message.key, message.values)
}

function toLookupFailureMessage(
  failure: ThemeLookupFailure,
  input: { readonly id: string; readonly notAllowed: CommandMessageKey }
): CommandMessage {
  return failure.kind === 'not-found'
    ? { key: NOT_FOUND, values: { id: input.id } }
    : {
        key: input.notAllowed,
        values: { id: input.id, status: { key: `trading.themes.status.${failure.status}` } },
      }
}

async function run(deps: ThemesCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [raw, ...rest] = ctx.args

  if (raw === undefined) {
    return runAnalysis(deps, ctx, undefined)
  }

  const action = parseMember(raw, ACTIONS)

  if (action === SHOW_ACTION) {
    return rest.length === 0 ? render(deps, ctx, await deps.themes.show(ctx.signal)) : usage(USAGE)
  }

  const id = rest.length === 1 ? parseBranded(rest[0], themeId) : null

  if (action === null || id === null) {
    return usage(USAGE)
  }

  return action === RUN_ACTION
    ? runAnalysis(deps, ctx, id)
    : runTransition(deps, ctx, { action, id })
}

/** Themes map onto one market. Where the operator's home is another, the report still prints, but
 *  its first line says it will not line up with the holdings the operator actually has. */
function withHomeNote(
  deps: ThemesCommandDeps,
  ctx: SlashContext,
  result: SlashResult
): SlashResult {
  if (deps.homeMarket === undefined || deps.homeMarket === THEME_MARKET || result.kind !== 'text') {
    return result
  }

  const note = t(ctx.locale, 'trading.themes.homeNotCovered')

  return {
    ...result,
    text: `${note}\n\n${result.text}`,
    ...(result.echoText === undefined ? {} : { echoText: `${note}\n\n${result.echoText}` }),
  }
}

/** One command, three costs: a bare `/themes` or `run <id>` calls the model, `show` reads the
 *  store, a verb moves one theme. All three are the operator's, so the menu lists one role. */
export function createThemesCommand(deps: ThemesCommandDeps): SlashCommand {
  return {
    name: 'themes',
    description: { kind: 'localized', key: 'slash.tradingThemesHelp' },
    messageKeys: [
      USAGE,
      BUSY,
      NOT_FOUND,
      NOT_ALLOWED,
      NOT_TRACKED,
      ...Object.values(TRANSITION_DONE),
    ],
    policy: RUN_POLICY,
    policyFor: (args) => {
      const action = parseMember(args[0], ACTIONS)

      if (args.length === 0 || action === RUN_ACTION) {
        return RUN_POLICY
      }

      return action === SHOW_ACTION ? SHOW_POLICY : CHANGE_POLICY
    },
    completeFor: (args) => (args.length === 1 ? ACTIONS : []),
    usage: () => ({ key: USAGE }),
    run: async (ctx): Promise<SlashResult> => withHomeNote(deps, ctx, await run(deps, ctx)),
  }
}
