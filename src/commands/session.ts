import type { SessionId } from '@/core/ids'
import type {
  CommandDescription,
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'

const MESSAGE_KEYS = ['slash.newSession'] as const
const DESCRIPTION: CommandDescription = { kind: 'localized', key: 'slash.helpNew' }
// Operator, like /agent: the underlying route swap collapses every member's route for the chat.
const POLICY = {
  surfaces: ['channel', 'repl'],
  role: 'operator',
  action: 'mutate',
  idempotencyKey: (ctx: SlashContext) => ctx.requestId,
} as const satisfies SlashInvocationPolicy

/** Routes the caller's chat to a fresh session. The old transcript stays on disk. */
export type SessionReset = (ctx: SlashContext) => Promise<SessionId>

export function createNewSessionCommand(reset: SessionReset): SlashCommand {
  return {
    name: 'new',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: POLICY,
    async run(ctx): Promise<SlashResult> {
      await reset(ctx)

      return { kind: 'message', messages: [{ key: 'slash.newSession' }] }
    },
  }
}
