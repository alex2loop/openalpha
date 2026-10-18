import type { ChannelSettings } from '@/channels/schema'
import type { ChannelDefinition, OperatorNotices } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { App, ServiceProvider } from '@/core/container'
import type { ChannelDefinitionRef, DeclarativeChannelSource } from '@/core/types/plugin'
import { telegramDefinition } from '@/channels/adapters/telegram/definition'
import { zaloDefinition } from '@/channels/adapters/zalo/definition'
import { zaloPersonalDefinition } from '@/channels/adapters/zalo-personal/definition'
import { isChannelDefinitionShape } from '@/channels/define'
import { resolveChannelSettings } from '@/channels/schema'
import { channelId } from '@/core/channels'
import { formatErrForLog } from '@/core/security/credentials'
import { isPlainRecord } from '@/core/utils/collections'

const DEFINITION_SKIPPED = 'channel.definition_skipped'
const DECLARATIVE_CHANNEL_SKIPPED = 'channel.declarative_skipped'
const BUILT_IN_CHANNELS: readonly ChannelDefinition[] = [
  telegramDefinition,
  zaloDefinition,
  zaloPersonalDefinition,
]
const NO_CHANNEL_OVERRIDE: readonly string[] = []

declare module '@/core/container' {
  interface Services {
    channels: readonly ChannelDefinition[]
    operatorNotices: OperatorNotices
  }
}

// Extendable: trusted plugin definitions and safe declarative sources merge into this one registry.
export const channelsProvider: ServiceProvider = {
  name: 'channels',
  register(bind, extend): void {
    bind('channels', () => BUILT_IN_CHANNELS)
    extend('channels', (current, app) => mergeContributions(current, app))
  },
}

export function findChannelDefinition(
  definitions: readonly ChannelDefinition[],
  id: ChannelId
): ChannelDefinition | undefined {
  return definitions.find((definition) => definition.id === id)
}

export function resolveRegisteredChannelSettings(
  definitions: readonly ChannelDefinition[],
  configured: Readonly<Record<string, unknown>>,
  id: ChannelId
): ChannelSettings | null {
  const definition = findChannelDefinition(definitions, id)
  return definition === undefined
    ? null
    : resolveChannelSettings(definition.resolveConfig(configured[definition.id]))
}

function mergeContributions(
  current: readonly ChannelDefinition[],
  app: App
): readonly ChannelDefinition[] {
  const merged = new Map(current.map((definition) => [definition.id, definition]))

  for (const ref of app.resolve('pluginChannelDefinitions')) {
    const definition = createContributedDefinition(ref, app)

    if (definition !== undefined) {
      merged.set(definition.id, definition)
    }
  }

  for (const source of app.resolve('pluginChannelSources')) {
    const definition = createDeclarativeDefinition(source, merged, app)

    if (definition !== undefined) {
      merged.set(definition.id, definition)
    }
  }

  return [...merged.values()]
}

function createDeclarativeDefinition(
  source: DeclarativeChannelSource,
  definitions: ReadonlyMap<ChannelId, ChannelDefinition>,
  app: App
): ChannelDefinition | undefined {
  const base = definitions.get(source.adapter)

  if (base === undefined) {
    app.resolve('logger').warn(DECLARATIVE_CHANNEL_SKIPPED, {
      adapter: source.adapter,
      reason: 'unsupported_adapter',
    })

    return undefined
  }

  const safeFields = base.safeConfigOverrides ?? NO_CHANNEL_OVERRIDE

  if (!hasOnlySafeChannelConfig(source, safeFields)) {
    app.resolve('logger').warn(DECLARATIVE_CHANNEL_SKIPPED, {
      adapter: source.adapter,
      reason: 'unsafe_config',
    })

    return undefined
  }

  const config = mergeChannelConfig(app.config.channels[source.adapter], source, safeFields)

  try {
    base.resolveConfig(config)
  } catch (err: unknown) {
    app.resolve('logger').warn(DECLARATIVE_CHANNEL_SKIPPED, {
      adapter: source.adapter,
      err: formatErrForLog(err),
    })

    return undefined
  }

  return {
    id: base.id,
    ...(base.safeConfigOverrides === undefined
      ? {}
      : { safeConfigOverrides: base.safeConfigOverrides }),
    resolveConfig: () => base.resolveConfig(config),
    isEnabled: (resolved) => base.isEnabled(resolved),
    admission: (resolved) => base.admission(resolved),
    create: (resolved, context) => base.create(resolved, context),
  }
}

function createContributedDefinition(
  ref: ChannelDefinitionRef,
  app: App
): ChannelDefinition | undefined {
  try {
    const expectedId = channelId(ref.id)
    const value = ref.create()

    if (!isChannelDefinitionShape(value)) {
      app
        .resolve('logger')
        .warn(DEFINITION_SKIPPED, { id: expectedId, reason: 'invalid_definition' })
      return undefined
    }

    const id = channelId(value.id)

    if (id !== expectedId) {
      app.resolve('logger').warn(DEFINITION_SKIPPED, {
        id: expectedId,
        declaredId: id,
        reason: 'id_mismatch',
      })
      return undefined
    }

    return { ...value, id }
  } catch (err: unknown) {
    app.resolve('logger').warn(DEFINITION_SKIPPED, {
      id: ref.id,
      err: formatErrForLog(err),
    })
  }

  return undefined
}

function mergeChannelConfig(
  configured: unknown,
  source: DeclarativeChannelSource,
  safeFields: readonly string[]
): Readonly<Record<string, unknown>> {
  const overrides: Record<string, unknown> = {}

  for (const field of safeFields) {
    const value = source.config[field]

    if (value !== undefined) {
      overrides[field] = value
    }
  }

  return { ...(isPlainRecord(configured) ? configured : {}), ...overrides }
}

function hasOnlySafeChannelConfig(
  source: DeclarativeChannelSource,
  safeFields: readonly string[]
): boolean {
  return Object.keys(source.config).every((field) => safeFields.includes(field))
}
