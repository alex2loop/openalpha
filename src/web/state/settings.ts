import { type ReadonlySignal, signal } from '@preact/signals'

import type { ConfigValidation } from '@/app/server/wire/config'
import { ApiFailure, getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'

const PENDING_KEY = 'office.pendingRestart'
const ISSUE_SEPARATOR = '; '

export const SETTINGS_SECTIONS = [
  'profile',
  'schedule',
  'agents',
  'channels',
  'data',
  'display',
  'advanced',
] as const

/** The settings the daemon reads once at boot: a saved change waits for a restart. */
const RESTART_ROWS = ['models', 'budget', 'language', 'timeZone', 'raw'] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
export type RestartRow = (typeof RESTART_ROWS)[number]
export type ConfigTree = Readonly<Record<string, unknown>>

type ConfigIssues = NonNullable<ConfigValidation['issues']>

const pending = signal<readonly RestartRow[]>(readPending())

/** The rows saved to `config.toml` since the daemon last restarted, kept for the tab's life. */
export const pendingRestart: ReadonlySignal<readonly RestartRow[]> = pending

/** Reads the config, hands a copy to `change`, and saves what it returns. Throws `ApiFailure`;
 *  a config the daemon refuses carries its own sentences. */
export async function saveConfig(
  change: (tree: ConfigTree) => ConfigTree,
  row: RestartRow
): Promise<void> {
  await saveConfigTree(change(await readConfigTree()), row)
}

/** Validates the whole tree, then writes it; the old file stays beside the new one. */
export async function saveConfigTree(tree: ConfigTree, row: RestartRow): Promise<void> {
  const checked = await sendJson('POST', ROUTES.configValidate, { body: tree })

  if (!checked.ok) {
    throw new ApiFailure(400, 'invalid_body', { message: describeIssues(checked.issues ?? []) })
  }

  await sendJson('POST', ROUTES.configWrite, { body: tree })
  noteRestartRow(row)
}

/** Reads the tree as the daemon holds it; throws `ApiFailure`. */
export async function readConfigTree(abort?: AbortSignal): Promise<ConfigTree> {
  const { config } = await getJson(ROUTES.config, abort === undefined ? {} : { signal: abort })

  if (!isTree(config)) {
    throw new ApiFailure(0, 'bad_response')
  }

  return config
}

/** The daemon restarted: whatever waited for it has been applied. */
export function clearRestartRows(): void {
  pending.value = []
  removeStorage('session', PENDING_KEY)
}

export function isTree(value: unknown): value is ConfigTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function noteRestartRow(row: RestartRow): void {
  if (pending.value.includes(row)) {
    return
  }

  pending.value = [...pending.value, row]
  writeStorage('session', PENDING_KEY, JSON.stringify(pending.value))
}

function describeIssues(issues: ConfigIssues): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join(ISSUE_SEPARATOR)
}

// A stored row this page no longer knows reads as absent.
function readPending(): readonly RestartRow[] {
  try {
    const stored: unknown = JSON.parse(readStorage('session', PENDING_KEY) ?? '[]')

    return Array.isArray(stored) ? RESTART_ROWS.filter((row) => stored.includes(row)) : []
  } catch {
    return []
  }
}
