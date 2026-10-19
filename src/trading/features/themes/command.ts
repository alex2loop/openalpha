import type {
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
} from '@/trading/features/themes/types'
import { t } from '@/i18n'
import { firstProposedTheme, renderThemeReportText } from '@/trading/features/themes/render/report'
import { THEME_TRANSITIONS, themeId } from '@/trading/features/themes/types'
import { parseBranded, parseMember, usage } from '@/trading/kernel/surface/surface'

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
}

function render(deps: ThemesCommandDeps, ctx: SlashContext, report: ThemeReport): SlashResult {
  const text = renderThemeReportText(report, { locale: ctx.locale, timezone: deps.timezone })
  const proposed = firstProposedTheme(report)

  if (proposed === undefined) {
    return { kind: 'text', text }
  }

  return {
    kind: 'text',
    text,
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

  return outcome.kind === 'done'
    ? usage(TRANSITION_DONE[request.action], { id: request.id })
    : renderLookupFailure(outcome, { id: request.id, notAllowed: NOT_ALLOWED })
}

function renderLookupFailure(
  failure: ThemeLookupFailure,
  input: { readonly id: string; readonly notAllowed: CommandMessageKey }
): SlashResult {
  return failure.kind === 'not-found'
    ? usage(NOT_FOUND, { id: input.id })
    : usage(input.notAllowed, {
        id: input.id,
        status: { key: `trading.themes.status.${failure.status}` },
      })
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
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}
