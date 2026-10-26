import type { UpdateState } from '@/cli/update/state'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import { formatUpdateMessage } from '@/cli/update/notice'
import { isCompiledBinary } from '@/cli/update/release'
import { newerVersionOf, readUpdateState, refreshUpdateState } from '@/cli/update/state'
import { BRAND } from '@/core/brand'
import { type MessageKey, t } from '@/i18n'

import type { DoctorProbe, DoctorSurface } from './types'
import { checkLabel, offlineKey } from './labels'

function statusKey(state: UpdateState, surface: DoctorSurface): MessageKey {
  if (state.checkedAt === 0) {
    return offlineKey(surface, 'neverChecked')
  }

  return state.failed ? 'cli.updateUnchecked' : 'cli.updateUpToDate'
}

/** Never fails: being behind is a warning, and not knowing is fine. */
export async function probeVersion(options: {
  readonly config: ResolvedConfig
  readonly online: boolean
  readonly surface: DoctorSurface
  readonly locale: Locale
}): Promise<DoctorProbe> {
  const { config, online, locale } = options
  const name = checkLabel(locale, 'version')

  if (!config.update.check) {
    return { name, status: 'ok', detail: t(locale, 'cli.updateCheckOff') }
  }

  if (!isCompiledBinary()) {
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

  return {
    name,
    status: 'ok',
    detail: t(locale, statusKey(state, options.surface), { brand: BRAND.name }),
  }
}
