import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { BRAND } from '@/core/brand'

const HOME_DIR = homedir()
const SQLITE_DATABASE_SEGMENTS = ['data', `${BRAND.name}.sqlite`] as const
const IN_MEMORY_PATH = ':memory:'
const ENV_FILE_NAME = 'env'

// Expand `~` and `~/…` against `home`; all other forms pass through unchanged.
export function expandHome(p: string, home: string = HOME_DIR): string {
  if (p === '~') {
    return home
  }

  if (p.startsWith('~/')) {
    return `${home}${p.slice(1)}`
  }

  return p
}

export function resolveDataDir(raw?: {
  paths?: { data_dir?: string | undefined } | undefined
}): string {
  const envKey = `${BRAND.envPrefix}DATA_DIR`
  const fromEnv = process.env[envKey]

  if (fromEnv !== undefined && fromEnv !== '') {
    return expandHome(fromEnv)
  }

  const fromConfig = raw?.paths?.data_dir

  if (fromConfig !== undefined && fromConfig !== '') {
    return expandHome(fromConfig)
  }

  return join(HOME_DIR, BRAND.dataDirName)
}

export function resolveEnvFile(dataDir: string): string {
  return join(dataDir, ENV_FILE_NAME)
}

export function resolveConfigFile(dataDir: string, cwd: string, explicitPath?: string): string {
  if (explicitPath === undefined) {
    return join(dataDir, 'config.toml')
  }

  const expanded = expandHome(explicitPath)

  return isAbsolute(expanded) ? expanded : join(cwd, expanded)
}

// One rule for every configured path, writer and reader alike: `~/...` expands HOME, absolute is
// used as-is, relative joins dataDir so the daemon's cwd never decides what it loads. A
// `~`-prefixed-but-not-home path (e.g. `~logs/app.log`) is neither, so it joins dataDir.
export function resolveDataRelative(path: string, dataDir: string): string {
  if (path === '~' || path.startsWith('~/')) {
    return expandHome(path)
  }

  if (isAbsolute(path)) {
    return path
  }

  return join(dataDir, path)
}

export function resolveSqliteDatabasePath(dataDir: string, path?: string): string {
  // Sentinel, not a filename: `openDatabase` matches it exactly (persistence/engines/sqlite.ts).
  if (path === IN_MEMORY_PATH) {
    return path
  }

  const candidate = path === undefined ? join(...SQLITE_DATABASE_SEGMENTS) : expandHome(path)

  return isAbsolute(candidate) ? candidate : join(dataDir, candidate)
}
