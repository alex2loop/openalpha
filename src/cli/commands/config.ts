import type { Command, Group } from '@/cli/command'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import { buildUnknownProviderMessage, findProviderById } from '@/ai/api'
import { createCommand, createGroup } from '@/cli/command'
import { isEditorSet, openInEditor } from '@/cli/editor'
import { editorFromEnv } from '@/cli/env'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { toMissingKeyErrors } from '@/cli/missing-keys'
import { flagString } from '@/cli/parsing/args'
import { resolveConfigPath } from '@/cli/services'
import { fail, success } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { loadConfig } from '@/core/config/load'
import {
  combineInvalidConfigErrors,
  InvalidConfigError,
  resolveConfig,
} from '@/core/config/resolve'
import { extensionConfigError } from '@/core/config/validate'
import { isSensitiveKey, redact } from '@/core/security/credentials'
import { isPlainRecord } from '@/core/utils/collections'
import { bindLocale, t } from '@/i18n'

const MASKED = '[REDACTED]'
const FALLBACK_EDITOR = 'nano'

const configCmdShow: Command = createCommand({
  name: 'show',
  summary: { key: 'cliHelp.configShowSummary' },
  run: showConfig,
})

const configCmdGet: Command = createCommand({
  name: 'get',
  summary: { key: 'cliHelp.configGetSummary' },
  spec: { positional: ['path'] },
  run: getConfigPath,
})

const configCmdPath: Command = createCommand({
  name: 'path',
  summary: { key: 'cliHelp.configPathSummary' },
  run: printConfigPath,
})

const configCmdValidate: Command = createCommand({
  name: 'validate',
  summary: { key: 'cliHelp.configValidateSummary' },
  // Admitted with a broken file: reporting what is wrong with it is this command's whole job.
  needs: { configFile: 'probe' },
  run: validateConfig,
})

const configCmdEdit: Command = createCommand({
  name: 'edit',
  summary: { key: 'cliHelp.configEditSummary' },
  run: editConfig,
})

export const configCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.config,
  needs: { boot: false, configFile: 'probe' },
  subcommands: [configCmdShow, configCmdGet, configCmdPath, configCmdValidate, configCmdEdit],
})

function showConfig(_args: ParsedArgs, app: CliApp): number {
  app.out(maskedConfigText(app.config))

  return 0
}

function maskedConfigText(config: ResolvedConfig): string {
  return redact(JSON.stringify(config, maskSensitiveValue, 2))
}

function maskSensitiveValue(key: string, value: unknown): unknown {
  return isSensitiveKey(key) ? MASKED : value
}

function getConfigPath(args: ParsedArgs, app: CliApp): number {
  const locale = app.config.locale.language
  const path = flagString(args, 'path')

  if (path === undefined) {
    return usage(app, t(locale, 'cli.configGetRequiresPath'))
  }

  const value = getByPath(app.config, path)

  // Existence first: a path that does not exist is a typo, and reporting it as sensitive sends the
  // operator looking for a permission problem. The value itself is still never printed below.
  if (value === undefined) {
    return usage(app, t(locale, 'cli.configNoSuchPath', { path }))
  }

  // Any segment: a string under a sensitive parent ends in an array index that names nothing.
  if (path.split('.').some(isSensitiveKey)) {
    return usage(app, t(locale, 'cli.configSensitivePath', { path }))
  }

  app.out(redact(formatValue(value)))

  return 0
}

function getByPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => readKey(node, key), root)
}

function readKey(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    const index = Number(key)

    return Number.isInteger(index) ? node[index] : undefined
  }

  return isPlainRecord(node) ? node[key] : undefined
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, maskSensitiveValue, 2)
}

function printConfigPath(_args: ParsedArgs, app: CliApp): number {
  app.out(resolveConfigPath(app))

  return 0
}

function editConfig(_args: ParsedArgs, app: CliApp): Promise<number> {
  const path = app.configProbe?.configPath

  if (path === undefined) {
    return Promise.resolve(
      usage(app, t(app.config.locale.language, 'cli.configNoConfigFile', { brand: BRAND.name }))
    )
  }

  const editor = editorFromEnv() ?? FALLBACK_EDITOR

  if (!isEditorSet(editor)) {
    return Promise.resolve(usage(app, t(app.config.locale.language, 'cli.editorNoEditor')))
  }

  return openInEditor(editor, path, app)
}

async function validateConfig(_args: ParsedArgs, app: CliApp): Promise<number> {
  const problems = await configProblems(app)

  if (problems.length === 0) {
    app.out(success(t(app.config.locale.language, 'cli.configValidationOk')))

    return 0
  }

  for (const problem of problems) {
    app.err(fail(problem))
  }

  return 1
}

// A file that will not load or resolve stops here, as there is no config left to read. Past that,
// every check runs, so the operator fixes what is wrong in one pass.
async function configProblems(app: CliApp): Promise<readonly string[]> {
  const locale = app.config.locale.language

  try {
    const { raw } = await loadConfig({ configPath: app.configPath })
    const config = resolveConfig(raw, { deferMissingKeys: true })

    return [
      ...modelProblems(config, locale),
      ...toMissingKeyErrors(config).map((err) => terminalErrorMessage(err, locale)),
      ...bootProblems(config, app),
    ]
  } catch (err: unknown) {
    return refusalProblems(err, app)
  }
}

// Core refuses its own sections before any module reads its own, so those are checked over
// defaults here and the run still lists both.
function refusalProblems(err: unknown, app: CliApp): readonly string[] {
  const locale = app.config.locale.language
  const probe = app.configProbe

  if (!(err instanceof InvalidConfigError) || err.unchecked === undefined || probe === undefined) {
    return [terminalErrorMessage(err, locale)]
  }

  const extension = extensionConfigError(err.unchecked, probe.assertResolved)

  if (extension === undefined) {
    return [terminalErrorMessage(err, locale)]
  }

  return extension instanceof InvalidConfigError
    ? [terminalErrorMessage(combineInvalidConfigErrors(err, extension), locale)]
    : [terminalErrorMessage(err, locale), terminalErrorMessage(extension, locale)]
}

function modelProblems(config: ResolvedConfig, locale: Locale): readonly string[] {
  const models = [...config.models, ...Object.values(config.modelTiers).flat()]
  // A tier falls back to the main model, and a shared default repeats across entries: name a
  // provider once, on the first entry that uses it.
  const firstPerProvider = models.filter(
    (model, index) => models.findIndex((other) => other.provider === model.provider) === index
  )

  const unknownProviders = firstPerProvider
    .filter((model) => findProviderById(model.provider) === undefined)
    .map((model) => buildUnknownProviderMessage(model))

  return unknownProviders.map((message) =>
    bindLocale(locale).translate(message.key, message.params)
  )
}

function bootProblems(config: ResolvedConfig, app: CliApp): readonly string[] {
  try {
    // Absent only once booted, and a booted process already passed these checks.
    app.configProbe?.assertResolved(config)

    return []
  } catch (err: unknown) {
    return [terminalErrorMessage(err, app.config.locale.language)]
  }
}
