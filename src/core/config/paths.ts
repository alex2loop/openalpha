import { isAbsolute, join } from 'node:path'

import { BRAND } from '@/core/brand'

const SQLITE_DATABASE_SEGMENTS = ['data', `${BRAND.name}.sqlite`] as const
const IN_MEMORY_PATH = ':memory:'
const ENV_FILE_NAME = 'env'

/** What resolution reads from the host it runs on, handed in by the entry rather than read here,
 *  so the same resolve runs where there is no process or home directory. */
export interface ConfigHost {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homeDir: string
}

export interface DataLocation {
  readonly dataDir: string
  readonly homeDir: string
}

export interface ConfigFileBase {
  readonly cwd: string
  readonly homeDir: string
}

// Expand `~` and `~/…` against `homeDir`; all other forms pass through unchanged.
export function expandHome(p: string, homeDir: string): string {
  if (p === '~') {
    return homeDir
  }

  if (p.startsWith('~/')) {
    return `${homeDir}${p.slice(1)}`
  }

  return p
}

export function resolveDataDir(
  host: ConfigHost,
  raw?: { paths?: { data_dir?: string | undefined } | undefined }
): string {
  const fromEnv = host.env[BRAND.controlEnv.dataDir]

  if (fromEnv !== undefined && fromEnv !== '') {
    return expandHome(fromEnv, host.homeDir)
  }

  const fromConfig = raw?.paths?.data_dir

  if (fromConfig !== undefined && fromConfig !== '') {
    return expandHome(fromConfig, host.homeDir)
  }

  return join(host.homeDir, BRAND.dataDirName)
}

export function resolveEnvFile(dataDir: string): string {
  return join(dataDir, ENV_FILE_NAME)
}

export function resolveConfigFile(
  dataDir: string,
  explicitPath: string | undefined,
  base: ConfigFileBase
): string {
  if (explicitPath === undefined) {
    return join(dataDir, 'config.toml')
  }

  const expanded = expandHome(explicitPath, base.homeDir)

  return isAbsolute(expanded) ? expanded : join(base.cwd, expanded)
}

// One rule for every configured path, writer and reader alike: `~/...` expands HOME, absolute is
// used as-is, relative joins dataDir so the daemon's cwd never decides what it loads. A
// `~`-prefixed-but-not-home path (e.g. `~logs/app.log`) is neither, so it joins dataDir.
export function resolveDataRelative(path: string, location: DataLocation): string {
  if (path === '~' || path.startsWith('~/')) {
    return expandHome(path, location.homeDir)
  }

  if (isAbsolute(path)) {
    return path
  }

  return join(location.dataDir, path)
}

export function resolveSqliteDatabasePath(location: DataLocation, path?: string): string {
  // Sentinel, not a filename: `openDatabase` matches it exactly (persistence/engines/sqlite.ts).
  if (path === IN_MEMORY_PATH) {
    return path
  }

  const candidate =
    path === undefined ? join(...SQLITE_DATABASE_SEGMENTS) : expandHome(path, location.homeDir)

  return isAbsolute(candidate) ? candidate : join(location.dataDir, candidate)
}
