import type { ChannelAdmission, ChannelDefinition } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { Logger } from '@/core/logging/logger'
import type { PairingStore } from '@/core/types/session'
import { resolveChannelSettings } from '@/channels/schema'
import { formatErrForLog } from '@/core/security/credentials'

interface ChannelRecipientOptions {
  readonly channel: ChannelId
  readonly configured?: string
  /** Absent when the channel admits by allowlist only, where a pairing row admits no one. */
  readonly store?: PairingStore
  readonly logger: Logger
}

/** Where an unaddressed notice lands on one running channel. */
export interface ChannelRecipient {
  current(): string | undefined
  refresh(): Promise<void>
  /** A paired chat was admitted: re-reads the pairing unless it is already the recipient. */
  admitted(chatId: string): Promise<void>
  /** False for a chat whose pairing was revoked, wherever the send came from: an alert or brief
   *  armed in it, or the default recipient. A chat that never paired stays deliverable. Throws when
   *  the pairing cannot be read: a send retries it, an arming pass refuses. */
  isDeliverable(chatId: string): Promise<boolean>
}

/** Where a notice nobody addressed lands on a channel: the configured fallback chat, else the one
 *  chat the allowlist names. Two or more ids and there is no answer - legacy guessed the first
 *  numeric-looking id (every Telegram id is) and quietly relocated the morning brief whenever the
 *  allowlist was reordered. `doctor` warns about the ambiguous case instead. */
export function resolveFallbackChat(
  definition: ChannelDefinition,
  config: unknown
): string | undefined {
  const resolved = definition.resolveConfig(config)
  const settings = resolveChannelSettings(resolved)

  return settings.fallbackChatId ?? loneAllowedId(definition.admission(resolved).allowedIds)
}

/** The configured chat, else the one chat paired on the channel. `pair approve` and `pair revoke`
 *  write from another process: a chat paired while the daemon runs is read on its first admitted
 *  message, and a revoked one is refused at its next send, which then re-reads the pairing. */
export function createChannelRecipient(options: ChannelRecipientOptions): ChannelRecipient {
  const { channel, configured, store, logger } = options
  let paired: string | undefined
  // One read at a time: a slow read finishing late cannot overwrite a newer answer.
  let tail = Promise.resolve()

  const read = async (): Promise<void> => {
    try {
      paired = await store?.lonePairedChat(channel)
    } catch (err: unknown) {
      logger.warn('channel.paired_chat_failed', { channel, err: formatErrForLog(err) })
    }
  }

  const refresh = (): Promise<void> => {
    if (configured === undefined && store !== undefined) {
      tail = tail.then(read)
    }

    return tail
  }

  const isDeliverable = async (chatId: string): Promise<boolean> =>
    store === undefined || chatId === configured || !(await store.isRevoked(channel, chatId))

  return {
    current: () => configured ?? paired,
    refresh,
    admitted: (chatId) => (chatId === paired ? tail : refresh()),
    isDeliverable,
  }
}

/** The channel the daemon would pick as its default recipient, read without running a channel: the
 *  first enabled definition, in registry order, with a configured or paired chat. A terminal cannot
 *  know whether that channel then started, which the daemon's own answer adds. */
export async function resolveDefaultRecipient(
  definitions: readonly ChannelDefinition[],
  channels: Readonly<Record<string, unknown>>,
  store: PairingStore
): Promise<{ readonly channel: ChannelId; readonly chatId: string } | undefined> {
  for (const definition of definitions) {
    const chatId = await enabledRecipient(definition, channels[definition.id], store)

    if (chatId !== undefined) {
      return { channel: definition.id, chatId }
    }
  }

  return undefined
}

async function enabledRecipient(
  definition: ChannelDefinition,
  raw: unknown,
  store: PairingStore
): Promise<string | undefined> {
  const admission = enabledAdmission(definition, raw)

  if (admission === undefined) {
    return undefined
  }

  const configured = resolveFallbackChat(definition, raw)

  if (configured !== undefined || admission.mode !== 'pairing') {
    return configured
  }

  return await store.lonePairedChat(definition.id)
}

function enabledAdmission(
  definition: ChannelDefinition,
  raw: unknown
): ChannelAdmission | undefined {
  try {
    const resolved = definition.resolveConfig(raw)

    return definition.isEnabled(resolved) ? definition.admission(resolved) : undefined
  } catch {
    // A channel whose config will not resolve (a plugin's, say) is simply not a candidate here.
    return undefined
  }
}

function loneAllowedId(allowedIds: readonly string[]): string | undefined {
  return allowedIds.length === 1 ? allowedIds[0] : undefined
}
