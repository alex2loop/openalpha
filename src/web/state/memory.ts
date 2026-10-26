import { type ReadonlySignal, signal } from '@preact/signals'

import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import type { MemoryResponse, MemoryWriteBody } from '@/app/server/wire/memory'
import type { MessageKey } from '@/i18n'
import { getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { COMMAND_PREFIX, sessionId, type Turn } from '@/web/state/chat'
import { tr } from '@/web/text/tr'

const KEY_SEPARATOR = '_'
const COMBINING_MARKS = /\p{M}/gu
const D_STROKE = /đ/g
const NON_KEY_RUN = /[^a-z0-9]+/g
const EDGE_SEPARATORS = /^_+|_+$/g
const USER_ROLE = 'user'
const ATTRIBUTE_NAMES: ReadonlyMap<string, MessageKey> = new Map([
  ['style', 'ui.office.memory.attr.style'],
  ['constraints', 'ui.office.memory.attr.constraints'],
  ['interests', 'ui.office.memory.attr.interests'],
  ['context', 'ui.office.memory.attr.context'],
  ['communication', 'ui.office.memory.attr.communication'],
])

export type MemoryScope = MemoryResponse['scopes'][number]

/** What a note may hold, as the daemon last said. */
export interface MemoryLimits {
  readonly ttlDays: number
  readonly keyMaxLen: number
}

// The rows forgotten on this page whose bar has not ended, or whose delete a read has not yet shown.
const hidden = signal<ReadonlySet<string>>(new Set())
let lastLimits: MemoryLimits | undefined

export const hiddenRows: ReadonlySignal<ReadonlySet<string>> = hidden

/** Throws `ApiFailure`. Rows this page already sent a delete for leave the hidden set once a read
 *  no longer holds them. */
export async function readMemory(abort: AbortSignal): Promise<MemoryResponse> {
  const read = await getJson(ROUTES.memory, { signal: abort })
  const present = new Set(
    read.scopes.flatMap((scope) =>
      [...scope.told, ...scope.notes].map((row) => toRowId(scope.scope, row.key))
    )
  )

  lastLimits = { ttlDays: read.ttlDays, keyMaxLen: read.keyMaxLen }
  hidden.value = new Set([...hidden.peek()].filter((id) => present.has(id)))

  return read
}

/** The limits of the last read, or a read for them. Throws `ApiFailure`. */
export async function readMemoryLimits(abort: AbortSignal): Promise<MemoryLimits> {
  return lastLimits ?? (await readMemory(abort))
}

/** Saves a note for the scope the open chat uses. Throws `ApiFailure`, with `fields` on `key` or
 *  `value` for what the daemon refused. */
export async function rememberNote(key: string, value: string): Promise<void> {
  const session = sessionId.value

  await sendJson('POST', ROUTES.memoryWrite, {
    body: {
      key,
      value,
      ...(session === undefined ? {} : { sessionId: session }),
    } satisfies MemoryWriteBody,
  })
}

/** Forgets one key in one scope. A key already gone answers quietly. Throws `ApiFailure`. */
export async function forgetNote(scope: string, key: string): Promise<void> {
  await sendJson('DELETE', ROUTES.memoryForget(scope, key))
}

export function toRowId(scope: string, key: string): string {
  return JSON.stringify([scope, key])
}

export function hideRow(id: string): void {
  hidden.value = new Set([...hidden.peek(), id])
}

export function showRow(id: string): void {
  hidden.value = new Set([...hidden.peek()].filter((held) => held !== id))
}

/** A key suggested from what to remember: unaccented lowercase letters and digits, `_` between
 *  words, at most `maxLen` characters. Empty when nothing usable is left. */
export function toMemoryKey(text: string, maxLen: number): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(D_STROKE, 'd')
    .replace(NON_KEY_RUN, KEY_SEPARATOR)
    .replace(EDGE_SEPARATORS, '')
    .slice(0, maxLen)
    .replace(EDGE_SEPARATORS, '')
}

/** Only what the operator asked in plain words: a command and its answer carry quantities, prices
 *  and amounts, which never go into what the model reads. */
export function canRemember(source: Turn | ChatHistoryMessage): boolean {
  if ('kind' in source) {
    return source.kind === 'ask' && source.isSystem === undefined
  }

  return source.role === USER_ROLE && !source.content.trimStart().startsWith(COMMAND_PREFIX)
}

/** A told preference's name, as Bộ nhớ lists it; an attribute this page does not know reads as is. */
export function toAttributeName(attribute: string): string {
  const key = ATTRIBUTE_NAMES.get(attribute)

  return key === undefined ? attribute : tr(key)
}
