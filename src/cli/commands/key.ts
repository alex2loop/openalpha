import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { createCommand, createGroup, type Group, hasLoadedConfig, type Needs } from '@/cli/command'
import { liveDaemon } from '@/cli/daemon-guard'
import { getEnv } from '@/cli/env'
import {
  isRuntimeEnvName,
  readEnvFile,
  removeEnvFileValue,
  writeEnvFileValue,
} from '@/cli/env-file'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { keyEnvNames } from '@/cli/missing-keys'
import { flagString } from '@/cli/parsing/args'
import { hint, success } from '@/cli/ui/colors'
import { declined, promptSecret } from '@/cli/ui/prompt'
import { BRAND, isControlEnvName } from '@/core/brand'
import { isEnvName } from '@/core/config/resolve'
import { isAbortError } from '@/core/errors'
import { closestName } from '@/core/utils/text'
import { t } from '@/i18n'

const KEY_TAIL_CHARS = 4
const KEY_TAIL_MIN_LENGTH = 16
const TAIL_MARK = '…'
const COLUMN_GAP = '  '
// A key command reads only the data dir and the locale, so it runs before a config file exists
// and beside a live daemon.
const KEY_NEEDS: Needs = { boot: false, configFile: 'optional', daemon: 'any' }
const NAME_SPEC = { positional: ['name'] } as const

const keySetCommand = createCommand({
  name: 'set',
  summary: { key: 'cliHelp.keySetSummary' },
  needs: KEY_NEEDS,
  spec: NAME_SPEC,
  run: setKey,
})

const keyListCommand = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.keyListSummary' },
  needs: KEY_NEEDS,
  run: listKeys,
})

const keyUnsetCommand = createCommand({
  name: 'unset',
  summary: { key: 'cliHelp.keyUnsetSummary' },
  needs: KEY_NEEDS,
  spec: NAME_SPEC,
  run: unsetKey,
})

export const keyCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.key,
  subcommands: [keySetCommand, keyListCommand, keyUnsetCommand],
  default: 'list',
})

async function setKey(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const name = flagString(args, 'name') ?? ''

  if (!isEnvName(name)) {
    return usage(app, t(locale, 'cli.keyNameInvalid', { brand: BRAND.name }))
  }

  if (isControlEnvName(name)) {
    return usage(app, t(locale, 'cli.keyNameReserved', { name, brand: BRAND.display }))
  }

  if (isRuntimeEnvName(name)) {
    return usage(app, t(locale, 'cli.keyNameRuntime', { name }))
  }

  const value = await readSecret(app, name)

  if (value === undefined) {
    return declined(app, locale)
  }

  if (value === '') {
    app.out(hint(t(locale, 'cli.keyEmpty', { name })))

    return 1
  }

  const { path } = app.keyFile

  await writeEnvFileValue({ path, name, value })
  app.out(success(t(locale, 'cli.keySaved', { name, path })))
  await printSaveHints(app, name)

  return 0
}

async function printSaveHints(app: CliApp, name: string): Promise<void> {
  const locale = app.config.locale.language
  const known = hasLoadedConfig(app) ? keyEnvNames(app.config) : undefined

  if (isSetInShell(app, name)) {
    app.out(hint(t(locale, 'cli.keyShellWins', { name })))
  }

  // A hint, never a refusal: a key saved before the config names it is legitimate.
  if (known !== undefined && !known.includes(name)) {
    app.out(hint(renderUnreadName(locale, name, known)))
  }

  if ((await liveDaemon(app)) !== null) {
    app.out(hint(t(locale, 'cli.keyRestart', { brand: BRAND.name })))
  }
}

function renderUnreadName(locale: Locale, name: string, names: readonly string[]): string {
  const near = closestName(name, names)

  if (near !== undefined) {
    return t(locale, 'cli.keyNameUnreadNear', { name, near })
  }

  return t(locale, 'cli.keyNameUnread', { name, names: names.join(', ') })
}

/** undefined: the prompt was cancelled. */
async function readSecret(app: CliApp, name: string): Promise<string | undefined> {
  try {
    return await promptSecret(t(app.config.locale.language, 'cli.keyPrompt', { name }))
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return undefined
    }

    throw err
  }
}

async function listKeys(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const env = getEnv()
  const inFile = await readEnvFile(app.keyFile.path)
  const fromConfig = hasLoadedConfig(app) ? keyEnvNames(app.config) : []
  const names = [...new Set([...inFile.keys(), ...fromConfig])].sort()
  const width = Math.max(0, ...names.map((name) => name.length))

  for (const name of names) {
    const source = t(locale, sourceKeyOf(app, { name, inFile: inFile.has(name) }))
    const value = env[name] ?? ''
    const tail =
      value.length >= KEY_TAIL_MIN_LENGTH ? ` ${TAIL_MARK}${value.slice(-KEY_TAIL_CHARS)}` : ''

    app.out(`${name.padEnd(width)}${COLUMN_GAP}${source}${tail}`)
  }

  return 0
}

function sourceKeyOf(
  app: CliApp,
  key: { readonly name: string; readonly inFile: boolean }
): 'cli.keySourceFile' | 'cli.keySourceShell' | 'cli.keySourceFileUnused' | 'cli.keySourceNone' {
  if (app.keyFile.loaded.has(key.name)) {
    return 'cli.keySourceFile'
  }

  if (!isSetInShell(app, key.name)) {
    return 'cli.keySourceNone'
  }

  return key.inFile ? 'cli.keySourceFileUnused' : 'cli.keySourceShell'
}

async function unsetKey(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const name = flagString(args, 'name') ?? ''

  if (!isEnvName(name)) {
    return usage(app, t(locale, 'cli.keyNameInvalid', { brand: BRAND.name }))
  }

  const { path } = app.keyFile
  const removed = await removeEnvFileValue(path, name)

  app.out(t(locale, removed ? 'cli.keyRemoved' : 'cli.keyNotInFile', { name, path }))

  return 0
}

/** Set by the shell rather than by the key file: the file never overrides it. */
function isSetInShell(app: CliApp, name: string): boolean {
  return (getEnv()[name] ?? '') !== '' && !app.keyFile.loaded.has(name)
}
