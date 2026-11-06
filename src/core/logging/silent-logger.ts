import type { Logger } from '@/core/logging/logger'

export const silentLogger: Logger = {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  info() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  warn() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  error() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  fatal() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  debug() {},
  child(): Logger {
    return this
  },
}
