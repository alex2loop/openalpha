import { getEnv } from '@/cli/env'
import { BRAND } from '@/core/brand'

const BACKGROUND_ENV = BRAND.controlEnv.background
const BACKGROUND_ENV_VALUE = '1'

export function buildBackgroundEnv(): Record<string, string | undefined> {
  return { ...getEnv(), [BACKGROUND_ENV]: BACKGROUND_ENV_VALUE }
}

/** For a process spawned by a background daemon that is not a daemon itself. */
export function buildForegroundEnv(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(getEnv()).filter(([name]) => name !== BACKGROUND_ENV))
}

export function isBackgroundLaunch(): boolean {
  return getEnv()[BACKGROUND_ENV] === BACKGROUND_ENV_VALUE
}
