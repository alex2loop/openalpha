import type {
  Affordance,
  CommandMessage,
  CommandMessageValue,
  SlashCommand,
  SlashResult,
} from '@/core/types/command'
import { agentId, isPathId } from '@/core/ids'
import { isPlainRecord } from '@/core/utils/collections'

const COMMAND_PREFIX = '/'

import { renderCommandText } from './render'

// Validates and canonicalizes command output. Accepts `unknown` and guards every union arm before
// reading its fields, so malformed JavaScript output produces a localized error rather than a
// TypeError. Valid `text` is rendered once through the commands-owned sanitizer.
export function toSlashResult(command: SlashCommand, result: unknown): SlashResult {
  if (!isPlainRecord(result) || typeof result.kind !== 'string') {
    return unexpected()
  }

  if (result.kind === 'message') {
    return toMessageResult(command, result)
  }

  if (result.kind === 'text') {
    return toTextResult(result)
  }

  if (result.kind === 'agent') {
    return toAgentResult(result)
  }

  if (result.kind === 'handled') {
    return { kind: 'handled' }
  }

  return unexpected()
}

function toMessageResult(command: SlashCommand, result: Record<string, unknown>): SlashResult {
  if (!Array.isArray(result.messages)) {
    return unexpected()
  }

  const messages: CommandMessage[] = []
  for (const entry of result.messages) {
    const message = toCommandMessage(command, entry)

    if (message === undefined) {
      return unexpected()
    }

    messages.push(message)
  }

  return { kind: 'message', messages }
}

function toCommandMessage(command: SlashCommand, entry: unknown): CommandMessage | undefined {
  if (!isPlainRecord(entry) || typeof entry.key !== 'string') {
    return undefined
  }

  const key = command.messageKeys.find((allowed) => allowed === entry.key)

  if (key === undefined) {
    return undefined
  }

  const values = toMessageValues(entry.values)

  return values === undefined ? { key } : { key, values }
}

// A value the union does not cover is dropped rather than rejected: the renderer leaves the
// placeholder unfilled, which beats failing a whole response over one malformed param.
function toMessageValues(raw: unknown): Readonly<Record<string, CommandMessageValue>> | undefined {
  if (!isPlainRecord(raw)) {
    return undefined
  }

  const values: Record<string, CommandMessageValue> = {}

  for (const [name, value] of Object.entries(raw)) {
    const admitted = toMessageValue(value)

    if (admitted !== undefined) {
      values[name] = admitted
    }
  }

  return Object.keys(values).length === 0 ? undefined : values
}

function toMessageValue(value: unknown): CommandMessageValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  return isPlainRecord(value) && typeof value.key === 'string' ? { key: value.key } : undefined
}

function toTextResult(result: Record<string, unknown>): SlashResult {
  if (typeof result.text !== 'string') {
    return unexpected()
  }

  const rendered = renderCommandText(result.text)

  if (rendered === '') {
    return unexpected()
  }

  const affordances = toAffordances(result.affordances)

  return {
    kind: 'text',
    text: rendered,
    ...(affordances.length === 0 ? {} : { affordances }),
  }
}

/** Offered next, and bounded like every other surface list: a plugin command's output reaches here
 *  as `unknown`, so an entry that is not a label and a slash command is dropped rather than
 *  rendered as a button nothing can run. */
function toAffordances(value: unknown): readonly Affordance[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const affordance = toAffordance(entry)

    return affordance === undefined ? [] : [affordance]
  })
}

function toAffordance(entry: unknown): Affordance | undefined {
  if (!isPlainRecord(entry) || typeof entry.label !== 'string') {
    return undefined
  }

  const label = renderCommandText(entry.label)
  const command = typeof entry.command === 'string' ? entry.command.trim() : ''

  if (label === '' || !command.startsWith(COMMAND_PREFIX)) {
    return undefined
  }

  return {
    label,
    command,
    ...(typeof entry.icon === 'string' && entry.icon !== '' ? { icon: entry.icon } : {}),
  }
}

function toAgentResult(result: Record<string, unknown>): SlashResult {
  if (typeof result.retryMessage !== 'string') {
    return unexpected()
  }

  return {
    kind: 'agent',
    retryMessage: result.retryMessage,
    ...(typeof result.agentId === 'string' && isPathId(result.agentId)
      ? { agentId: agentId(result.agentId) }
      : {}),
  }
}

function unexpected(): SlashResult {
  return { kind: 'message', messages: [{ key: 'slash.commandUnexpected' }] }
}
