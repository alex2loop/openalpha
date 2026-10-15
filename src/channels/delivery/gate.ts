import { randomUUID } from 'node:crypto'

import type { OperatorContext } from '@/channels/operator'
import type {
  AdmissionMode,
  ChannelCallbackQuery,
  InboundMessage,
  OutboundButton,
} from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { EventBus } from '@/core/events'
import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { PairingStore, SessionKey, SessionRouter } from '@/core/types/session'
import { operatorContextOf } from '@/channels/operator'
import { BRAND } from '@/core/brand'
import { sessionId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

const APPROVE_VERB = '/approve'
const DENY_VERB = '/deny'
const PAIR_VERB = '/pair'
const WHITESPACE_RE = /\s+/
// Caps how many rows an unauthenticated stranger can mint through offerPairingCode.
const MAX_OUTSTANDING_PAIRING_REQUESTS = 200

type AdmitDecision = 'admit' | 'reject'

export interface Gate {
  /** Open (true) when operator_user_ids is unconfigured; otherwise requires membership. */
  isOperatorUser(userId: string | undefined, context: OperatorContext): boolean
  /** 'reject' replies with a pairing code the first time, and is inert on repeats. */
  admit(msg: InboundMessage): Promise<AdmitDecision>
  /** False only when no later check could admit this chat or user, so a stranger's update need not
   *  be stored: pairing mode keeps everything (an unknown chat is offered a code), allowlist does not. */
  canAdmit(chatId: string, userId: string): boolean
  /** A button tap: the same allowlist `admit` applies, plus the operator check a tap carries. */
  admitCallback(query: ChannelCallbackQuery): Promise<boolean>
  /** Operator pairing commands, honoured only from a config-seeded chat. True = fully handled. */
  operatorCommand(msg: InboundMessage): Promise<boolean>
  activeSessionId(chatId: string, userId: string): Promise<SessionId>
}

interface GateDeps {
  readonly store: PairingStore
  readonly router: SessionRouter
  readonly channel: ChannelId
  readonly configIds: readonly string[]
  readonly operatorUserIds: readonly string[]
  readonly mode: AdmissionMode
  readonly sendText: (
    chatId: string,
    text: string,
    buttons?: readonly OutboundButton[]
  ) => Promise<void>
  readonly bus: EventBus
  readonly logger: Logger
  readonly locale: Locale
}

interface OperatorCommand {
  readonly chatId: string
  readonly verb: string
  readonly arg: string | undefined
}

export function createGate(deps: GateDeps): Gate {
  const seeded = new Set(deps.configIds)

  // When configured, operator commands require a listed operator user — not just any group member.
  const isOperatorUser = createOperatorCheck(deps.operatorUserIds)

  async function isAllowed(id: string): Promise<boolean> {
    return isAllowedId(deps, seeded, id)
  }

  // A group chat's id is unknowable in advance, so the operator's user id admits them in one.
  // There is no open mode: every admitted chat speaks for the one local operator, so admitting a
  // stranger would hand them the operator's ledger, profile, and memory.
  async function isAdmitted(chatId: string, userId: string): Promise<boolean> {
    return (await isAllowed(chatId)) || (await isAllowed(userId))
  }

  async function sessionFor(chatId: string, userId: string): Promise<SessionId> {
    const key: SessionKey = { channel: deps.channel, chatId, userId }
    return deps.router.getOrCreate(key, sessionId(randomUUID()))
  }

  return {
    isOperatorUser,

    canAdmit: (chatId, userId) =>
      deps.mode === 'pairing' || seeded.has(chatId) || seeded.has(userId),

    async admit(msg): Promise<AdmitDecision> {
      if (await isAdmitted(msg.chatId, msg.userId)) {
        // A direct chat's only member is its owner; a group's membership says nothing about who
        // the operator is, so group access additionally requires the listed operator check —
        // the same conjunction admitCallback already applies to button taps.
        const context = operatorContextOf(msg.isGroup, msg.chatId)

        return context.kind === 'direct' || isOperatorUser(msg.userId, context) ? 'admit' : 'reject'
      }

      if (deps.mode === 'allowlist') {
        return 'reject'
      }

      await offerPairingCode(deps, msg.chatId)

      return 'reject'
    },

    async admitCallback(query): Promise<boolean> {
      if (query.chatId === undefined) {
        return false
      }

      return (
        (await isAdmitted(query.chatId, query.from)) &&
        isOperatorUser(query.from, operatorContextOf(query.isGroup, query.chatId))
      )
    },

    async operatorCommand(msg): Promise<boolean> {
      // Seeded chat + (when configured) operator user. A paired chat cannot pair more chats.
      const context: OperatorContext = operatorContextOf(msg.isGroup, msg.chatId)

      if (!(seeded.has(msg.chatId) && isOperatorUser(msg.userId, context))) {
        return false
      }

      const [verb, ...rest] = msg.text.trim().split(WHITESPACE_RE)

      if (verb !== APPROVE_VERB && verb !== DENY_VERB && verb !== PAIR_VERB) {
        return false
      }

      await replyToOperatorCommand(deps, { chatId: msg.chatId, verb, arg: rest[0] })

      return true
    },

    activeSessionId: sessionFor,
  }
}

// A command that throws still sends a notice: the gate is never silent on a chat that issued one.
async function replyToOperatorCommand(deps: GateDeps, command: OperatorCommand): Promise<void> {
  try {
    await deps.sendText(command.chatId, await runOperatorCommand(deps, command.verb, command.arg))
  } catch (err: unknown) {
    deps.logger.warn('gate.operator_command_failed', {
      channel: deps.channel,
      verb: command.verb,
      err: formatErrForLog(err),
    })
    await deps.sendText(command.chatId, t(deps.locale, 'pairing.cmdFail'))
  }
}

// Fail closed on storage faults. Seeded ids admit directly; otherwise the pairing store decides.
async function isAllowedId(
  deps: GateDeps,
  seeded: ReadonlySet<string>,
  id: string
): Promise<boolean> {
  if (seeded.has(id)) {
    return true
  }

  if (deps.mode !== 'pairing') {
    return false
  }

  try {
    return await deps.store.isPaired(deps.channel, id)
  } catch (err: unknown) {
    deps.logger.warn('gate.is_paired_failed', { channel: deps.channel, err: formatErrForLog(err) })

    return false
  }
}

// Fail closed: a group with no listed operators admits no one; a direct chat admits only its owner.
function createOperatorCheck(
  operatorUserIds: readonly string[]
): (userId: string | undefined, context: OperatorContext) => boolean {
  const operatorUsers = new Set(operatorUserIds)

  return (userId, context) => {
    if (userId === undefined) {
      return false
    }

    if (operatorUsers.size === 0) {
      return context.kind === 'direct' && userId === context.chatId
    }

    return operatorUsers.has(userId)
  }
}

// A chat already holding a pending code is exempt: the store hands back its existing row, so
// re-checking it cannot grow the backlog.
async function pairingCapacityExceeded(deps: GateDeps, chatId: string): Promise<boolean> {
  const pending = await deps.store.listPending(deps.channel, Date.now())

  if (pending.length < MAX_OUTSTANDING_PAIRING_REQUESTS) {
    return false
  }

  return !pending.some((request) => request.chatId === chatId)
}

// Idempotent by construction: the store hands back the chat's existing pending code, so a chat that keeps messaging gets silence instead of spam.
async function offerPairingCode(deps: GateDeps, chatId: string): Promise<void> {
  try {
    if (await pairingCapacityExceeded(deps, chatId)) {
      // Saturation closes the bootstrap path to every new chat, and silence here looks identical to
      // an ordinary unadmitted message.
      deps.logger.warn('gate.pairing_capacity_exhausted', {
        channel: deps.channel,
        limit: MAX_OUTSTANDING_PAIRING_REQUESTS,
      })

      return
    }

    const result = await deps.store.requestCode({
      channel: deps.channel,
      chatId,
      now: Date.now(),
    })

    if (result.status === 'pending') {
      return
    }

    const lines = [
      t(deps.locale, 'pairing.needsAccess'),
      t(deps.locale, 'pairing.yourCode', { code: result.code }),
      t(deps.locale, 'pairing.askOperator', { brand: BRAND.name, code: result.code }),
    ]

    try {
      await deps.sendText(chatId, lines.join('\n'))
    } catch (err: unknown) {
      // The code is stored before it is sent, and a stored code silences every later offer until
      // it expires — drop it so the next message mints one the chat can actually receive.
      await releasePendingCode(deps, result.code)
      throw err
    }

    deps.bus.emit('pairing_requested', {
      channel: deps.channel,
      chatId,
      code: result.code,
      expiresAt: result.expiresAt,
    })
  } catch (err: unknown) {
    // An unreachable store must not crash the poll loop; the chat simply stays unadmitted.
    deps.logger.warn('gate.request_code_failed', {
      channel: deps.channel,
      err: formatErrForLog(err),
    })
  }
}

async function releasePendingCode(deps: GateDeps, code: string): Promise<void> {
  try {
    await deps.store.deny({ channel: deps.channel, code })
  } catch (err: unknown) {
    deps.logger.warn('gate.pending_code_release_failed', {
      channel: deps.channel,
      err: formatErrForLog(err),
    })
  }
}

async function runOperatorCommand(
  deps: GateDeps,
  verb: string,
  arg: string | undefined
): Promise<string> {
  if (verb === PAIR_VERB) {
    return listPendingText(deps)
  }

  if (!arg) {
    return t(deps.locale, 'pairing.usage', { verb })
  }

  if (verb === DENY_VERB) {
    const denied = await deps.store.deny({ channel: deps.channel, code: arg })

    return denied
      ? t(deps.locale, 'pairing.denied', { arg })
      : t(deps.locale, 'pairing.noPendingCode', { arg })
  }

  const result = await deps.store.approve({ channel: deps.channel, code: arg, now: Date.now() })

  if (result.ok) {
    return t(deps.locale, 'pairing.paired', { id: result.chatId })
  }

  return result.reason === 'expired'
    ? t(deps.locale, 'pairing.expired')
    : t(deps.locale, 'pairing.noPendingCode', { arg })
}

async function listPendingText(deps: GateDeps): Promise<string> {
  const pending = await deps.store.listPending(deps.channel, Date.now())

  if (pending.length === 0) {
    return t(deps.locale, 'pairing.noPending')
  }

  const rows = pending.map((p) =>
    t(deps.locale, 'pairing.pendingRow', { code: p.code, chatId: p.chatId })
  )

  return [t(deps.locale, 'pairing.pendingHeader'), ...rows].join('\n')
}
