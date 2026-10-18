import type {
  Affordance,
  CommandSurface,
  SlashCommand,
  SlashInvocationPolicy,
} from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { DeliveryTarget } from '@/scheduler/api'

export const UPGRADE_COMMAND_NAME = 'upgrade'
export const UPGRADE_CONFIRM_ARG = 'confirm'

// `/trade` is operator-only too, so a member never saw a suggestion to run it either.
const READ_POLICY = {
  surfaces: ['channel', 'repl'],
  role: 'operator',
  action: 'read',
} as const satisfies SlashInvocationPolicy

// A tapped button or a re-delivered message carries the same request id, so it installs once.
const CONFIRM_POLICY = {
  ...READ_POLICY,
  action: 'mutate',
  idempotencyKey: (ctx) => ctx.requestId,
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
  install(request: UpgradeRequest): Promise<UpgradeReply>
}

export function createUpgradeCommand(releases: ReleaseUpdates): SlashCommand {
  return {
    name: UPGRADE_COMMAND_NAME,
    description: { kind: 'localized', key: 'slash.upgradeHelp' },
    messageKeys: [],
    policy: READ_POLICY,
    policyFor: (args) => (args[0] === UPGRADE_CONFIRM_ARG ? CONFIRM_POLICY : READ_POLICY),
    run: async (ctx) => {
      const request: UpgradeRequest = {
        surface: ctx.surface,
        target: { channel: ctx.channel, chatId: ctx.chatId },
        locale: ctx.locale,
        signal: ctx.signal,
      }
      const reply =
        ctx.args[0] === UPGRADE_CONFIRM_ARG
          ? await releases.install(request)
          : await releases.describe(request)

      return { kind: 'text', text: reply.text, ...toAffordances(reply) }
    },
  }
}

function toAffordances(reply: UpgradeReply): { readonly affordances?: readonly Affordance[] } {
  if (reply.confirmLabel === undefined) {
    return {}
  }

  return {
    affordances: [
      { label: reply.confirmLabel, command: `/${UPGRADE_COMMAND_NAME} ${UPGRADE_CONFIRM_ARG}` },
    ],
  }
}
