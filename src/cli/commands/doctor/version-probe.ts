import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import { formatUpdateMessage } from '@/cli/update/notice'
import { isSourceCheckout } from '@/cli/update/release'
import { newerVersionOf, readUpdateState, refreshUpdateState } from '@/cli/update/state'
import { t } from '@/i18n'

import type { DoctorProbe } from './types'
import { checkLabel } from './labels'

/** Never fails: being behind is a warning, and not knowing is fine. */
export async function probeVersion(
  config: ResolvedConfig,
  online: boolean,
  locale: Locale
): Promise<DoctorProbe> {
  const name = checkLabel(locale, 'version')

  if (!config.update.check) {
    return { name, status: 'ok', detail: t(locale, 'cli.updateCheckOff') }
  }

  if (await isSourceCheckout()) {
    return { name, status: 'ok', detail: t(locale, 'cli.upgradeSourceCheckout') }
  }

  const dataDir = config.paths.dataDir
  const state = online
    ? await refreshUpdateState({ dataDir, now: Date.now() })
    : await readUpdateState(dataDir)
  const latest = newerVersionOf(state)

  if (latest !== null) {
    return { name, status: 'warn', detail: formatUpdateMessage(locale, latest) }
  }

  const known = state.checkedAt > 0 && !state.failed

  return {
    name,
    status: 'ok',
    detail: t(locale, known ? 'cli.updateUpToDate' : 'cli.updateUnchecked'),
  }
}
