import { type ReadonlySignal, signal } from '@preact/signals'

import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import type { MemoryResponse, MemoryWriteBody } from '@/app/server/wire/memory'
import type { MessageKey } from '@/i18n'
import { getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { COMMAND_PREFIX, sessionId, type Turn, USER_ROLE } from '@/web/state/chat'
import { tr } from '@/web/text/tr'

const KEY_SEPARATOR = '_'
const COMBINING_MARKS = /\p{M}/gu
const D_STROKE = /đ/g
const NON_KEY_RUN = /[^a-z0-9]+/g
const EDGE_SEPARATORS = /^_+|_+$/g
const LIMITS_READ_ROWS = 1
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

interface HeldForget {
  cancelled: boolean
}

/** One forget held by the undo bar: `commit` sends it, `restore` takes it back. */
interface HeldForgetAction {
  readonly commit: () => Promise<undefined>
  readonly restore: () => void
}

// The rows a forget hides while its bar runs or its delete is unanswered.
const hidden = signal<ReadonlySet<string>>(new Set())
// Rows whose delete was answered; the next read shows them as the daemon now holds them.
const settled = new Set<string>()
// Each forget the bar still holds, so a save of the same note can call it off.
const heldForgets = new Map<string, HeldForget>()
const changes = signal(0)
let savesInFlight: Promise<unknown> = Promise.resolve()
let lastLimits: MemoryLimits | undefined

export const hiddenRows: ReadonlySignal<ReadonlySet<string>> = hidden
/** Moves each time a forget or a save was answered, so an open list reads again. */
export const memoryChanges: ReadonlySignal<number> = changes

/** Throws `ApiFailure`. A forget already answered stops hiding its row here. */
export async function readMemory(abort: AbortSignal): Promise<MemoryResponse> {
  const read = await getJson(ROUTES.memory, { signal: abort })

  lastLimits = { ttlDays: read.ttlDays, keyMaxLen: read.keyMaxLen }
  hidden.value = new Set([...hidden.peek()].filter((id) => !settled.has(id)))
  settled.clear()

  return read
}

/** The limits of the last read, or a one-row read for them. Throws `ApiFailure`. */
export async function readMemoryLimits(abort: AbortSignal): Promise<MemoryLimits> {
  if (lastLimits !== undefined) {
    return lastLimits
  }

  const read = await getJson(ROUTES.memory, { query: { limit: LIMITS_READ_ROWS }, signal: abort })

  lastLimits = { ttlDays: read.ttlDays, keyMaxLen: read.keyMaxLen }

  return lastLimits
}

/** Saves a note for the scope the open chat uses, and calls off a held forget of that same note,
 *  which never sends. Throws `ApiFailure`, with `fields` on `key` or `value` for what the daemon
 *  refused. */
export async function rememberNote(key: string, value: string): Promise<void> {
  const session = sessionId.value
  const saving = sendJson('POST', ROUTES.memoryWrite, {
    body: {
      key,
      value,
      ...(session === undefined ? {} : { sessionId: session }),
    } satisfies MemoryWriteBody,
  })

  savesInFlight = Promise.allSettled([savesInFlight, saving])

  const saved = await saving
  const id = toRowId(saved.scope, key)
  const held = heldForgets.get(id)

  if (held !== undefined) {
    held.cancelled = true
    showRow(id)
  }

  changes.value++
}

/** Hides the row now; its delete waits for the bar and for any save under way, so a note saved
 *  again meanwhile is not deleted. Either answer lets the next read show the row as it stands. */
export function holdForget(scope: string, key: string): HeldForgetAction {
  const id = toRowId(scope, key)
  const held: HeldForget = { cancelled: false }
  const release = (): void => {
    if (heldForgets.get(id) === held) {
      heldForgets.delete(id)
    }
  }

  heldForgets.set(id, held)
  hidden.value = new Set([...hidden.peek(), id])

  return {
    commit: async () => {
      await waitForSaves()
      release()

      if (!held.cancelled) {
        try {
          await sendJson('DELETE', ROUTES.memoryForget(scope, key))
        } finally {
          settled.add(id)
          changes.value++
        }
      }

      return undefined
    },
    restore: () => {
      release()
      showRow(id)
    },
  }
}

export function toRowId(scope: string, key: string): string {
  return JSON.stringify([scope, key])
}

// A save started while this one was awaited is waited for too.
async function waitForSaves(): Promise<void> {
  let tail: Promise<unknown>

  do {
    tail = savesInFlight
    await tail
  } while (tail !== savesInFlight)
}

function showRow(id: string): void {
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
