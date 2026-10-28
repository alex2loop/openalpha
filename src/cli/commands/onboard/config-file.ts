import { lstat, readdir, readFile, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { parse, stringify } from 'smol-toml'

import type { Locale } from '@/core/types/locale'
import { BRAND } from '@/core/brand'
import { parseConfigToml } from '@/core/config/load'
import { OperatorConfigError } from '@/core/config/resolve'
import { isErrno } from '@/core/errors'
import { createPrivateFileAtomic, replacePrivateFileAtomic } from '@/core/security/private-files'
import { isPlainRecord } from '@/core/utils/collections'

/** A first-run daily cap, so a new key cannot run up a bill before the user picks a budget. */
export const STARTER_DAILY_BUDGET_USD = 2
const BACKUP_STAMP_RE = /[:.]/g
/** Newest backups of one config file kept; every save writes one. */
const MAXIMUM_CONFIG_BACKUPS = 5

type Table = Readonly<Record<string, unknown>>

export interface StarterModel {
  readonly provider: string
  readonly model: string
  /** Absent for a subscription login, a cloud account or a server on this machine. */
  readonly apiKeyEnv?: string
  /** Set only for a provider whose endpoint is account-specific. */
  readonly baseUrl?: string
}

interface StarterAnswers {
  readonly model: StarterModel
  readonly language?: Locale
  /** ISO 4217 code of the book, written beside the language so the choice is visible. */
  readonly currency?: string
  readonly dailyBudgetUsd?: number
  readonly telegramTokenEnv?: string
}

export type ConfigEdit =
  | { readonly kind: 'model'; readonly model: StarterModel }
  | { readonly kind: 'telegram'; readonly tokenEnv: string }
  | { readonly kind: 'budget'; readonly dailyUsd: number }
  | { readonly kind: 'language'; readonly language: Locale }

export interface ExistingConfig {
  readonly text: string
  readonly table: Table
}

/** The one first-run config: `onboard` writes it for the CLI, `setup write` for the app. */
export function starterConfigToml(answers: StarterAnswers): string {
  return stringify({
    ...(answers.language === undefined && answers.currency === undefined
      ? {}
      : {
          locale: {
            ...(answers.language === undefined ? {} : { language: answers.language }),
            ...(answers.currency === undefined ? {} : { currency: answers.currency }),
          },
        }),
    models: [toModelTable(answers.model)],
    budget: { max_daily_usd: answers.dailyBudgetUsd ?? STARTER_DAILY_BUDGET_USD },
    ...(answers.telegramTokenEnv === undefined
      ? {}
      : { channels: { telegram: { token_env: answers.telegramTokenEnv } } }),
  })
}

/** Only "no such file" means absent: a config that cannot be inspected must not be overwritten. */
export async function isConfigPresent(path: string): Promise<boolean> {
  try {
    await lstat(path)

    return true
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return false
    }

    throw new OperatorConfigError(
      `cannot inspect config path: ${path}`,
      { key: 'errors.setupPathUnusable', params: { path } },
      { cause: err }
    )
  }
}

export async function writeStarterConfig(path: string, content: string): Promise<void> {
  await createPrivateFileAtomic({ path, content, validate: validateConfig })
}

export async function readExistingConfig(path: string): Promise<ExistingConfig> {
  const text = await readFile(path, 'utf8')

  try {
    return { text, table: parse(text) }
  } catch (err: unknown) {
    throw new OperatorConfigError(
      `cannot parse config: ${path}`,
      { key: 'errors.onboardConfigUnreadable', params: { path, brand: BRAND.name } },
      { cause: err }
    )
  }
}

/** The edited table as TOML, one change applied and every other setting kept. */
export function editedConfigToml(table: Table, edit: ConfigEdit): string {
  return stringify(applyEdit(table, edit))
}

/** Keeps the file as it was beside it, then swaps in the edit. Returns the backup's path. */
export async function saveEditedConfig(
  path: string,
  change: { readonly before: string; readonly after: string }
): Promise<string> {
  const backupPath = `${path}.${new Date().toISOString().replace(BACKUP_STAMP_RE, '-')}.bak`

  await createPrivateFileAtomic({ path: backupPath, content: change.before })
  await replacePrivateFileAtomic({ path, content: change.after, validate: validateConfig })
  await pruneBackups(path)

  return backupPath
}

// The stamp is ISO-derived, so name order is age order. A failed prune never fails the save.
async function pruneBackups(path: string): Promise<void> {
  const prefix = `${basename(path)}.`

  try {
    const names = await readdir(dirname(path))
    const backups = names.filter((name) => name.startsWith(prefix) && name.endsWith('.bak')).sort()
    const stale = backups.slice(0, Math.max(0, backups.length - MAXIMUM_CONFIG_BACKUPS))

    await Promise.all(stale.map((name) => unlink(join(dirname(path), name))))
  } catch {
    // Leftover backups cost disk only; the next save retries.
  }
}

function applyEdit(table: Table, edit: ConfigEdit): Table {
  switch (edit.kind) {
    case 'model':
      return { ...table, models: withFirstModel(table.models, toModelTable(edit.model)) }
    case 'telegram':
      return withSubTable(table, ['channels', 'telegram'], { token_env: edit.tokenEnv })
    case 'budget':
      return withSubTable(table, ['budget'], { max_daily_usd: edit.dailyUsd })
    case 'language':
      return withSubTable(table, ['locale'], { language: edit.language })
  }
}

/** Replaces the first entry, the one a run reaches for first, and keeps any fallbacks after it. */
function withFirstModel(models: unknown, entry: Table): readonly unknown[] {
  return Array.isArray(models) ? [entry, ...models.slice(1)] : [entry]
}

function withSubTable(table: Table, path: readonly string[], fields: Table): Table {
  const [head, ...rest] = path

  if (head === undefined) {
    return { ...table, ...fields }
  }

  const child = isPlainRecord(table[head]) ? table[head] : {}

  return { ...table, [head]: withSubTable(child, rest, fields) }
}

function toModelTable(model: StarterModel): Table {
  return {
    provider: model.provider,
    model: model.model,
    ...(model.apiKeyEnv === undefined ? {} : { api_key_env: model.apiKeyEnv }),
    ...(model.baseUrl === undefined ? {} : { base_url: model.baseUrl }),
  }
}

function validateConfig(content: string): void {
  parseConfigToml(content)
}
