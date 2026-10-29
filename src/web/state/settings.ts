import { type ReadonlySignal, signal } from '@preact/signals'

import type { ConfigValidation } from '@/app/server/wire/config'
import type { MessageKey } from '@/i18n'
import { ApiFailure, getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'

const PENDING_KEY = 'office.pendingRestart'
const ISSUE_SEPARATOR = '; '
const IF_MATCH_HEADER = 'If-Match'

export const SETTINGS_SECTIONS = [
  'profile',
  'memory',
  'schedule',
  'agents',
  'channels',
  'providers',
  'exchanges',
  'tools',
  'data',
  'display',
  'advanced',
] as const

/** Each section's name in the nav, its heading, and wherever a line points to it. */
export const SECTION_TITLES = Object.freeze({
  profile: 'ui.office.common.profile',
  memory: 'ui.office.settings.memory',
  schedule: 'ui.office.settings.schedule',
  agents: 'ui.office.settings.agents',
  channels: 'ui.office.settings.channels',
  providers: 'ui.office.settings.providers',
  exchanges: 'ui.office.settings.exchanges',
  tools: 'ui.office.settings.tools',
  data: 'ui.office.settings.data',
  display: 'ui.office.settings.display',
  advanced: 'ui.office.settings.advanced',
} as const satisfies Record<SettingsSection, MessageKey>)

/** The settings the daemon reads once at boot: a saved change waits for a restart. */
const RESTART_ROWS = [
  'models',
  'budget',
  'language',
  'timeZone',
  'raw',
  'credentials',
  'webSearch',
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
export type RestartRow = (typeof RESTART_ROWS)[number]
export type ConfigTree = Readonly<Record<string, unknown>>

type ConfigIssues = NonNullable<ConfigValidation['issues']>

/** The tree as GET /v1/config holds it, and what each hidden secret reads as in it. */
export interface ConfigRead {
  readonly tree: ConfigTree
  readonly redacted: string
  /** The file as read; a save that carries it is refused once another edit has landed. */
  readonly version: string
}

const pending = signal<readonly RestartRow[]>(readPending())

/** The rows saved to `config.toml` since the daemon last restarted, kept for the tab's life. */
export const pendingRestart: ReadonlySignal<readonly RestartRow[]> = pending

/** Reads the config, hands a copy to `change`, and saves what it returns. Throws `ApiFailure`;
 *  a config the daemon refuses carries its own sentences. */
export async function saveConfig(
  change: (tree: ConfigTree) => ConfigTree,
  row: RestartRow
): Promise<void> {
  const read = await readConfig()

  await saveConfigTree({ tree: change(read.tree), version: read.version }, row)
}

/** Validates the whole tree, then writes it over the file `version` names; the old file stays
 *  beside the new one. Answers the version written, for the next save. */
export async function saveConfigTree(
  save: { readonly tree: ConfigTree; readonly version: string },
  row: RestartRow
): Promise<string> {
  const checked = await sendJson('POST', ROUTES.configValidate, { body: save.tree })

  if (!checked.ok) {
    throw new ApiFailure(400, 'invalid_body', { message: describeIssues(checked.issues ?? []) })
  }

  const written = await sendJson('POST', ROUTES.configWrite, {
    body: save.tree,
    headers: { [IF_MATCH_HEADER]: save.version },
  })

  noteRestartRow(row)

  return written.version
}

/** Reads the tree as the daemon holds it; throws `ApiFailure`. */
export async function readConfigTree(abort?: AbortSignal): Promise<ConfigTree> {
  return (await readConfig(abort)).tree
}

/** As `readConfigTree`, with the placeholder the daemon shows its secrets as. */
export async function readConfig(abort?: AbortSignal): Promise<ConfigRead> {
  const { config, redacted, version } = await getJson(
    ROUTES.config,
    abort === undefined ? {} : { signal: abort }
  )

  if (!isTree(config)) {
    throw new ApiFailure(0, 'bad_response')
  }

  return { tree: config, redacted, version }
}

/** The daemon restarted: whatever waited for it has been applied. */
export function clearRestartRows(): void {
  pending.value = []
  removeStorage('session', PENDING_KEY)
}

export function isTree(value: unknown): value is ConfigTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A change saved outside `config.toml` (a key) that also waits for a restart. */
export function noteRestartRow(row: RestartRow): void {
  if (pending.value.includes(row)) {
    return
  }

  pending.value = [...pending.value, row]
  writeStorage('session', PENDING_KEY, JSON.stringify(pending.value))
}

function describeIssues(issues: ConfigIssues): string {
  return issues.map(toIssueLine).join(ISSUE_SEPARATOR)
}

/** One issue as the operator reads it: a refused field's sentence names it already, so it stands
 *  alone; any other issue leads with its path. */
export function toIssueLine(issue: ConfigIssues[number]): string {
  return issue.refused === true ? issue.message : `${issue.path}: ${issue.message}`
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
