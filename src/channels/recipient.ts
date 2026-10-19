import type { ChannelDefinition } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import { resolveChannelSettings } from '@/channels/schema'

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

/** The channel the daemon would pick as its default recipient, read from config alone: the first
 *  enabled definition, in registry order, that has a fallback chat. A terminal cannot know whether
 *  that channel then started, which the daemon's own answer adds. */
export function resolveConfiguredRecipient(
  definitions: readonly ChannelDefinition[],
  channels: Readonly<Record<string, unknown>>
): { readonly channel: ChannelId; readonly chatId: string } | undefined {
  for (const definition of definitions) {
    const chatId = enabledFallbackChat(definition, channels[definition.id])

    if (chatId !== undefined) {
      return { channel: definition.id, chatId }
    }
  }

  return undefined
}

function enabledFallbackChat(definition: ChannelDefinition, raw: unknown): string | undefined {
  try {
    return definition.isEnabled(definition.resolveConfig(raw))
      ? resolveFallbackChat(definition, raw)
      : undefined
  } catch {
    // A channel whose config will not resolve (a plugin's, say) is simply not a candidate here.
    return undefined
  }
}

function loneAllowedId(allowedIds: readonly string[]): string | undefined {
  return allowedIds.length === 1 ? allowedIds[0] : undefined
}
