import type {
  CommandDescription,
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import type { Locale } from '@/core/types/locale'

const MESSAGE_KEYS = ['slash.continueNudge'] as const
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

export function createContinueCommand(nudge: ContinueNudge): SlashCommand {
  return {
    name: 'continue',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: POLICY,
    run: async (ctx: SlashContext): Promise<SlashResult> => ({
      kind: 'agent',
      retryMessage: nudge(ctx.locale),
    }),
  }
}
