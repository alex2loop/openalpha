import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { TradingConfig } from '@/trading/api'
import { BRAND } from '@/core/brand'
import { type MessageKey, t } from '@/i18n'

import type { DoctorProbe } from './types'
import { checkLabel } from './labels'

/** Switches that let {brand} act without asking, or run what a plugin ships. `allow_code` only
 *  counts beside `allow_untrusted`: the loader reads it after that gate, so alone it does nothing. */
export function probeSafety(
  config: ResolvedConfig,
  trading: TradingConfig | undefined,
  locale: Locale
): readonly DoctorProbe[] {
  const name = checkLabel(locale, 'safety')
  const { allowUntrusted, allowCode } = config.plugins
  const findings: readonly MessageKey[] = [
    ...(trading?.orders.allowUnattended === true ? ['cli.doctorSafetyUnattended' as const] : []),
    ...(allowUntrusted ? ['cli.doctorSafetyUntrustedPlugins' as const] : []),
    ...(allowUntrusted && allowCode ? ['cli.doctorSafetyPluginCode' as const] : []),
  ]
  const values = { brand: BRAND.display }

  return findings.length === 0
    ? [{ name, status: 'ok', detail: t(locale, 'cli.doctorSafetyClean', values) }]
    : findings.map((key) => ({ name, status: 'warn' as const, detail: t(locale, key, values) }))
}
