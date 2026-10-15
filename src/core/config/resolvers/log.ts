import type { RawConfig } from '@/core/config/schema'
import { resolveDataRelative } from '@/core/config/paths'

const DEFAULT_LOG_LEVEL = 'info' as const
const DEFAULT_LOG_FILE = 'logs/daemon.log'
const DEFAULT_LOG_MAX_FILE_MB = 50
const DEFAULT_LOG_MAX_FILES = 7

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface ResolvedLog {
  readonly level: LogLevel
  readonly file: string
  readonly maxFileMb: number
  readonly maxFiles: number
}

export function resolveLog(
  raw: RawConfig['log'],
  dataDir: string,
  logLevel?: LogLevel
): ResolvedLog {
  const log: { level: LogLevel; file: string; maxFileMb: number; maxFiles: number } = {
    level: logLevel ?? raw?.level ?? DEFAULT_LOG_LEVEL,
    file: resolveDataRelative(raw?.file ?? DEFAULT_LOG_FILE, dataDir),
    maxFileMb: raw?.max_file_mb ?? DEFAULT_LOG_MAX_FILE_MB,
    maxFiles: raw?.max_files ?? DEFAULT_LOG_MAX_FILES,
  }

  return log
}
