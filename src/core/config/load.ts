import { parse as parseToml, TomlError } from 'smol-toml'

import { BRAND } from '@/core/brand'
import { MissingEnvError, OperatorConfigError } from '@/core/config/operator-errors'
import { expandHome, resolveConfigFile, resolveDataDir } from '@/core/config/paths'
import {
  type ConfigResolveOptions,
  type ResolvedConfig,
  resolveConfig,
} from '@/core/config/resolve'
import { parseRawConfig, type RawConfig } from '@/core/config/schema'
import { ConfigError } from '@/core/errors'
import { isPlainRecord } from '@/core/utils/collections'

interface ConfigLoadOptions {
  /** Only an absent implicit file may resolve defaults; an explicit missing path always fails. */
  readonly configFile?: 'required' | 'optional' | 'probe'
  /** An explicit file always wins over the implicit `<dataDir>/config.toml` location. */
  readonly configPath?: string
  /** Highest-precedence workspace path. It is expanded before the implicit file path is chosen. */
  readonly dataDir?: string
}

class MissingConfigError extends OperatorConfigError {
  constructor(configPath: string, explicit: boolean) {
    super(
      explicit ? `--config file not found: ${configPath}` : `no config.toml found at ${configPath}`,
      explicit
        ? { key: 'errors.configPathMissing', params: { path: configPath } }
        : { key: 'errors.configFileMissing', params: { path: configPath, brand: BRAND.name } }
    )
  }
}

type ConfigProbeOptions = ConfigLoadOptions & ConfigResolveOptions

interface LoadedConfig {
  readonly raw: RawConfig
  readonly configPath: string
}

interface ProbedConfig {
  readonly config: ResolvedConfig
  readonly configPath: string
  /** null when the config both loaded and resolved. Kept whole, so a surface can word it. */
  readonly error: Error | null
  readonly missing: boolean
  /** The file is sound and only a key variable is unset, so `config` still carries its paths. */
  readonly keyMissing: boolean
}

export async function probeConfig(options?: ConfigProbeOptions): Promise<ProbedConfig> {
  const configPath = resolveConfigPath(options)

  let raw: RawConfig | undefined

  try {
    raw = (await loadConfig(options)).raw

    return {
      config: resolveConfig(raw, options),
      configPath,
      error: null,
      missing: false,
      keyMissing: false,
    }
  } catch (err: unknown) {
    const keyless =
      raw !== undefined && err instanceof MissingEnvError ? keylessConfig(raw, options) : undefined

    return {
      config: keyless ?? fallbackConfig(raw?.locale ?? (await readLocale(configPath)), options),
      configPath,
      error: err instanceof Error ? err : new ConfigError(String(err)),
      missing: err instanceof MissingConfigError,
      keyMissing: keyless !== undefined,
    }
  }
}

/** The config with its unset keys deferred; undefined when another unset variable (storage) fails it. */
function keylessConfig(raw: RawConfig, options?: ConfigProbeOptions): ResolvedConfig | undefined {
  try {
    return resolveConfig(raw, { ...options, deferMissingKeys: true })
  } catch {
    return undefined
  }
}

/** The defaults, keeping the operator's own `[locale]` where it is valid, so a config that failed
 *  elsewhere still reports that failure in their language. */
function fallbackConfig(locale: unknown, options?: ConfigProbeOptions): ResolvedConfig {
  try {
    return resolveConfig(parseRawConfig({ locale }), options)
  } catch {
    return resolveConfig(parseRawConfig(undefined), options)
  }
}

/** The `[locale]` table of a config that failed schema validation, read straight from the file. */
async function readLocale(path: string): Promise<unknown> {
  try {
    const toml = await readToml(path)

    return isPlainRecord(toml) ? toml.locale : undefined
  } catch {
    return undefined
  }
}

export async function loadConfig(options?: ConfigLoadOptions): Promise<LoadedConfig> {
  const dataDir = resolveLoadDataDir(options)
  const configPath = resolveConfigFile(dataDir, process.cwd(), options?.configPath)

  const toml = await readToml(configPath)

  if (toml === undefined) {
    if (
      (options?.configFile === 'optional' || options?.configFile === 'probe') &&
      options.configPath === undefined
    ) {
      return { raw: parseRawConfig(undefined), configPath }
    }

    throw new MissingConfigError(configPath, options?.configPath !== undefined)
  }

  const overlaid = withDataDir(toml, rawDataDirOverride(options, dataDir))

  return { raw: parseRawConfig(overlaid), configPath }
}

export function parseConfigToml(text: string): RawConfig {
  return parseRawConfig(parseTomlText(text))
}

function resolveConfigPath(options?: ConfigLoadOptions): string {
  return resolveConfigFile(resolveLoadDataDir(options), process.cwd(), options?.configPath)
}

/** The data dir before any config loads: `--data-dir`, the brand's data-dir variable, then the default. */
export function resolveLoadDataDir(options?: ConfigLoadOptions): string {
  if (options?.dataDir !== undefined) {
    return expandHome(options.dataDir)
  }

  return resolveDataDir()
}

async function readToml(path: string): Promise<unknown> {
  const file = Bun.file(path)

  if (!(await file.exists())) {
    return undefined
  }

  try {
    return parseTomlText(await file.text())
  } catch (err: unknown) {
    throw err instanceof TomlError
      ? new OperatorConfigError(
          `config file is not valid TOML: ${path}`,
          { key: 'errors.configNotToml', params: { path, line: err.line, column: err.column } },
          { cause: err }
        )
      : new ConfigError(`config file is not valid TOML: ${path}`, err)
  }
}

function parseTomlText(text: string): unknown {
  return parseToml(text)
}

function readEnvDataDir(): string | undefined {
  const envValue = process.env[BRAND.controlEnv.dataDir]

  return envValue !== undefined && envValue !== '' ? envValue : undefined
}

function rawDataDirOverride(
  options: ConfigLoadOptions | undefined,
  bootstrapDataDir: string
): string | undefined {
  if (options?.dataDir !== undefined) {
    return bootstrapDataDir
  }

  return readEnvDataDir()
}

// Preserve malformed known sections for parseRawConfig; only a valid path table can be overlaid.
function withDataDir(toml: unknown, dataDir: string | undefined): unknown {
  if (dataDir === undefined) {
    return toml
  }

  if (!isPlainRecord(toml)) {
    return toml
  }

  const paths = toml.paths

  if (paths === undefined) {
    return { ...toml, paths: { data_dir: dataDir } }
  }

  if (!isPlainRecord(paths)) {
    return toml
  }

  return { ...toml, paths: { ...paths, data_dir: dataDir } }
}
