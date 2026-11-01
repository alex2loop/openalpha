import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { VenueKeyAudit } from '@/trading/api'
import { t } from '@/i18n'
import { auditVenueKeys, resolveTradingConfig } from '@/trading/api'

import type { DoctorEnvironment, DoctorProbe, DoctorSurface } from './types'
import { checkLabel, offlineKey, subjectLabel } from './labels'
import { ONLINE_TIMEOUT_MS } from './online-probes'

/** What a venue answers when it refuses the key itself: a wrong key, a demo key, or an IP outside
 *  the key's allow list. */
const AUTH_REFUSED_CODE = 'order.auth'

export async function probeVenueKeys(options: {
  readonly config: ResolvedConfig
  readonly online: boolean
  readonly surface: DoctorSurface
  readonly env: DoctorEnvironment
  readonly locale: Locale
}): Promise<readonly DoctorProbe[]> {
  const { config, locale } = options
  const name = checkLabel(locale, 'venues')

  if (!options.online) {
    return [{ name, status: 'ok', detail: t(locale, offlineKey(options.surface, 'notProbed')) }]
  }

  const trading = resolveTradingConfig({ extensions: config.extensions, locale: config.locale })
  const audits = await auditVenueKeys({
    venues: trading.venues,
    env: options.env,
    signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS),
  })

  if (audits.length === 0) {
    return [{ name, status: 'ok', detail: t(locale, 'cli.doctorVenueKeysNone') }]
  }

  return audits.flatMap((audit) => auditProbes(audit, locale))
}

function auditProbes(audit: VenueKeyAudit, locale: Locale): readonly DoctorProbe[] {
  const name = subjectLabel(locale, 'venue', audit.venue)
  const values = { venue: audit.venue }

  if (audit.kind === 'failed') {
    const detail =
      audit.code === AUTH_REFUSED_CODE
        ? t(locale, 'cli.doctorVenueKeyRefused', values)
        : t(locale, 'cli.doctorProbeFailedCode', { code: audit.code })

    return [{ name, status: 'fail', detail }]
  }

  const warnings = [
    ...(audit.withdrawals ? [t(locale, 'cli.doctorVenueWithdrawalsOn', values)] : []),
    ...(audit.ipRestricted ? [] : [t(locale, 'cli.doctorVenueIpOpen', values)]),
    ...(audit.trading ? [] : [t(locale, 'cli.doctorVenueTradingOff', values)]),
  ]

  return warnings.length === 0
    ? [{ name, status: 'ok', detail: t(locale, 'cli.doctorVenueKeyClean', values) }]
    : warnings.map((detail) => ({ name, status: 'warn' as const, detail }))
}
