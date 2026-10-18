import type {
  CommandDescription,
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import type { Locale } from '@/core/types/locale'

const MESSAGE_KEYS = ['slash.continueNudge', 'slash.continueNothing'] as const
const DESCRIPTION: CommandDescription = { kind: 'localized', key: 'slash.continueHelp' }
const POLICY = {
  surfaces: ['channel', 'repl'],
  role: 'member',
  action: 'costly',
  execution: { progressKey: 'slash.continueProgress' },
} as const satisfies SlashInvocationPolicy

/** Injected because the nudge re-enters the run as a user turn rather than being rendered by a
 *  surface, and `commands` has no i18n edge. */
export type ContinueNudge = (locale: Locale) => string

/** Whether the chat's session holds a run that ended before finishing; a fresh session or one
 *  whose last run completed has nothing to resume. */
type StoppedRunCheck = (ctx: SlashContext) => Promise<boolean>

export interface ContinueCommandDeps {
  readonly nudge: ContinueNudge
  readonly hasStoppedRun: StoppedRunCheck
}

export function createContinueCommand(deps: ContinueCommandDeps): SlashCommand {
  return {
    name: 'continue',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: POLICY,
    run: async (ctx: SlashContext): Promise<SlashResult> => {
      // Nudging a session with nothing stopped would only send the model a bare "carry on".
      if (!(await deps.hasStoppedRun(ctx))) {
        return { kind: 'message', messages: [{ key: 'slash.continueNothing' }] }
      }

      return { kind: 'agent', retryMessage: deps.nudge(ctx.locale) }
    },
  }
}
