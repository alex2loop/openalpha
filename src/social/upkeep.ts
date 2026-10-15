import type { Logger } from '@/core/logging/logger'
import type { SocialStore } from '@/core/types/social'
import type { InstallDeps } from '@/social/install'
import type { SocialNotifier } from '@/social/notices'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY } from '@/core/utils/time'
import { notifySafely } from '@/social/notices'
import { stageUpdate } from '@/social/update'

interface UpkeepDeps {
  readonly install: InstallDeps
  readonly store: SocialStore
  readonly notifier: SocialNotifier
  readonly logger: Logger
  now(): number
}

/** Skills are checked once a day, which is how often Moltbook itself tells agents to look. */
export const SOCIAL_UPKEEP_INTERVAL_MS = MS_PER_DAY
/** Thirty days of writes: the daily caps read one day and the duplicate guard one more. */
const WRITES_RETENTION_MS = 30 * MS_PER_DAY

/** Once per `SOCIAL_UPKEEP_INTERVAL_MS`: look for changed skills, then drop old writes and expired
 *  drafts. A network that cannot be checked is logged and the rest go on. */
export async function runSocialUpkeep(deps: UpkeepDeps, signal: AbortSignal): Promise<void> {
  for (const network of await deps.store.listNetworks()) {
    if (signal.aborted) {
      return
    }

    await stageChange(deps, network.name, signal)
  }

  const now = deps.now()

  await deps.store.pruneWrites(now - WRITES_RETENTION_MS)
  await deps.store.pruneDrafts(now)
}

async function stageChange(deps: UpkeepDeps, network: string, signal: AbortSignal): Promise<void> {
  try {
    const staged = await stageUpdate(deps.install, network, signal)

    if (staged === undefined || !staged.isNew) {
      return
    }

    const { changes } = staged

    await notifySafely(deps.notifier, deps.logger, {
      kind: 'skill-changed',
      network,
      files: changes.changedFiles.length + changes.removedFiles.length,
      endpoints: changes.newEndpoints.length + changes.removedEndpoints.length,
    })
  } catch (err: unknown) {
    if (isAbortError(err) && signal.aborted) {
      throw err
    }

    deps.logger.warn('social.update_check_failed', { network, err: formatErrForLog(err) })
  }
}
