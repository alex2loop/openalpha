import type { ResolvedConfig } from '@/core/config/resolve'
import { BRAND } from '@/core/brand'

import { buildReleaseUrl } from './release'
import { isUpdateCheckEnabled, readFreshUpdateState } from './state'

/** What an app shows about updates: the running version and the newest release with its page. An
 *  app compares both with its own version, which may differ from the daemon's on another machine. */
export interface ReleaseStatus {
  readonly current: string
  /** The newest published release, whether or not it is newer; null before the feed answers. */
  readonly latest: string | null
  readonly url: string | null
  /** When the release feed last answered or failed; 0 before the first check. */
  readonly checkedAt: number
}

/** The cache while it is fresh, the release feed otherwise, so asking often costs two requests a day.
 *  Null when update checks are off (config, or a source checkout that updates with git). */
export async function readReleaseStatus(
  config: ResolvedConfig,
  options: { readonly now: number; readonly signal: AbortSignal }
): Promise<ReleaseStatus | null> {
  if (!isUpdateCheckEnabled(config)) {
    return null
  }

  const state = await readFreshUpdateState(config.paths.dataDir, options)
  const { latest } = state

  return {
    current: BRAND.version,
    latest,
    url: latest === null ? null : buildReleaseUrl(latest),
    checkedAt: state.checkedAt,
  }
}
