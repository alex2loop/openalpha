import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

/** `/setup` calls no service because it exists to onboard, not to act: it hands the agent one
 *  localized instruction and the agent does the talking.
 *
 *  The instruction is rendered here, not by a surface. An `agent` result re-enters the run as a
 *  user turn, so `retryMessage` is the text the model reads — a key would reach it verbatim. The
 *  key stays in `messageKeys` so the locale gate still requires both translations. */
export function createSetupCommand(): SlashCommand {
  return {
    name: 'setup',
    description: { kind: 'localized', key: 'slash.tradingSetupHelp' },
    messageKeys: ['slash.tradingSetupPrompt'],
    policy: { surfaces: ['channel', 'repl'], role: 'member', action: 'read' },
    run: async (ctx: SlashContext): Promise<SlashResult> => ({
      kind: 'agent',
      retryMessage: t(ctx.locale, 'slash.tradingSetupPrompt', { brand: BRAND.display }),
    }),
  }
}
