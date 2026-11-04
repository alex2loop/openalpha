import { type ReadonlySignal, signal } from '@preact/signals'

import type { WorkerReply } from '@/app/server/wire/worker'
import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'

const LOG_KEY = 'oa.edition.errorLog'
const LOG_LIMIT = 200
const LEVELS: ReadonlySet<unknown> = new Set(['warn', 'error', 'fatal'])

export type ErrorLogEntry = Extract<WorkerReply, { readonly kind: 'log' }>['entry']

const kept = signal<readonly ErrorLogEntry[]>(readKept())

/** The worker's warn, error and fatal lines, oldest first. They live in this tab's session storage:
 *  a reload keeps them, closing the tab ends them, and nothing sends them anywhere. */
export const errorLog: ReadonlySignal<readonly ErrorLogEntry[]> = kept

/** Appends one line the worker pushed, dropping the oldest past the limit. A storage the browser
 *  blocks or has no room in leaves the entries in memory for the page's life. */
export function recordLogEntry(entry: ErrorLogEntry): void {
  kept.value = [...kept.value, entry].slice(-LOG_LIMIT)
  writeStorage('session', LOG_KEY, JSON.stringify(kept.value))
}

export function clearErrorLog(): void {
  kept.value = []
  removeStorage('session', LOG_KEY)
}

function readKept(): readonly ErrorLogEntry[] {
  try {
    const stored: unknown = JSON.parse(readStorage('session', LOG_KEY) ?? '[]')

    return Array.isArray(stored) ? stored.filter(isEntry).slice(-LOG_LIMIT) : []
  } catch {
    return []
  }
}

function isEntry(value: unknown): value is ErrorLogEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'time' in value &&
    typeof value.time === 'number' &&
    'level' in value &&
    LEVELS.has(value.level) &&
    'key' in value &&
    typeof value.key === 'string' &&
    'fields' in value &&
    typeof value.fields === 'object' &&
    value.fields !== null
  )
}
