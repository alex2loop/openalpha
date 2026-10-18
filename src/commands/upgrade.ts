import type { CommandSurface, SlashCommand, SlashInvocationPolicy } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { DeliveryTarget } from '@/scheduler/api'

export const UPGRADE_COMMAND_NAME = 'upgrade'

// `/trade` is operator-only too, so a member never saw a suggestion to run it either.
const READ_POLICY = {
  surfaces: ['channel', 'repl'],
  role: 'operator',
  action: 'read',
} as const satisfies SlashInvocationPolicy

export interface UpgradeRequest {
  readonly surface: CommandSurface
  readonly target: DeliveryTarget
  readonly locale: Locale
  readonly signal: AbortSignal
}

export interface UpgradeReply {
  readonly text: string
  /** Set when the reader can install from here; the label of the button that does. */
  readonly confirmLabel?: string
}

/** Consumer-side seam: `app` binds what knows about releases. */
export interface ReleaseUpdates {
  describe(request: UpgradeRequest): Promise<UpgradeReply>
}

export function createUpgradeCommand(releases: ReleaseUpdates): SlashCommand {
  return {
    name: UPGRADE_COMMAND_NAME,
    description: { kind: 'localized', key: 'slash.upgradeHelp' },
    messageKeys: [],
    policy: READ_POLICY,
    run: async (ctx) => {
      const reply = await releases.describe({
        surface: ctx.surface,
        target: { channel: ctx.channel, chatId: ctx.chatId },
        locale: ctx.locale,
        signal: ctx.signal,
      })

      return { kind: 'text', text: reply.text }
    },
  }
}
