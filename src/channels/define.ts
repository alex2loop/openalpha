import type { ChannelDeliveryConfig } from '@/channels/schema'
import type { ChannelDefinition } from '@/channels/types'
import type { Exact } from '@/core/types/exact'
import { channelId } from '@/core/channels'
import { ValidationError } from '@/core/errors'
import { collectUnknownKeys, formatKeys, isPlainRecord } from '@/core/utils/collections'

const CHANNEL_DEFINITION_KEYS: ReadonlySet<string> = new Set<string>([
  'id',
  'safeConfigOverrides',
  'apiHosts',
  'resolveConfig',
  'isEnabled',
  'admission',
  'create',
])

export type ChannelDefinitionInput<T extends ChannelDeliveryConfig = ChannelDeliveryConfig> = Omit<
  ChannelDefinition<T>,
  'id'
> & { readonly id: string }

/**
 * Author-time factory. Brands the plain-string id through `channelId`, validates the unknown keys,
 * and returns a `ChannelDefinition<T>` so `resolveConfig`/`isEnabled`/`admission`/`create` retain
 * the same adapter-specific config type. Authoring is one call instead of import-`channelId`-plus-
 * literal.
 */
export function createChannel<T extends ChannelDeliveryConfig>(
  def: Exact<ChannelDefinitionInput<T>, ChannelDefinitionInput<T>>
): ChannelDefinition<T> {
  if (!isPlainRecord(def)) {
    throw new ValidationError('createChannel requires a definition object')
  }

  const unknown = collectUnknownKeys(def, CHANNEL_DEFINITION_KEYS)

  if (unknown.length > 0) {
    throw new ValidationError(`createChannel: unknown field(s) ${formatKeys(unknown)}`)
  }

  if (typeof def.id !== 'string' || def.id.trim() === '') {
    throw new ValidationError('createChannel: id must be a non-empty string')
  }

  const rawId = def.id

  if (!isChannelDefinitionShape(def)) {
    throw new ValidationError(
      `createChannel: definition '${rawId}' is missing required adapter functions`
    )
  }

  const id = channelId(rawId)

  // why-safe: `isChannelDefinitionShape` proved the adapter functions and override list are present,
  // and `id` is the only field rebranded (string → ChannelId); the spread carries the validated rest.
  return { ...(def as unknown as ChannelDefinition<T>), id }
}

/**
 * The single owner of the channel-definition shape predicate: JavaScript helper validation and
 * trusted contributed definitions created through `ChannelDefinitionRef.create()` both go through
 * here. The id is a plain string at this point (branding happens at the call site).
 */
export function isChannelDefinitionShape(
  value: unknown
): value is Omit<ChannelDefinition, 'id'> & { readonly id: string } {
  if (!isPlainRecord(value) || typeof value.id !== 'string') {
    return false
  }

  return (
    typeof value.resolveConfig === 'function' &&
    typeof value.isEnabled === 'function' &&
    typeof value.admission === 'function' &&
    typeof value.create === 'function' &&
    isSafeConfigOverrideList(value.safeConfigOverrides)
  )
}

function isSafeConfigOverrideList(value: unknown): value is readonly string[] | undefined {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}
