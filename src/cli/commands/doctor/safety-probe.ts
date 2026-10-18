import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { TradingConfig } from '@/trading/api'
import { BRAND } from '@/core/brand'
import { type MessageKey, t } from '@/i18n'

import type { DoctorProbe } from './types'
import { checkLabel } from './labels'

interface SafetySwitch {
  readonly on: boolean
  readonly key: MessageKey
}

/** Switches that let {brand} act without asking, or run what a plugin ships. `allow_code` only
 *  counts beside `allow_untrusted`: the loader reads it after that gate, so alone it does nothing. */
export function probeSafety(
  config: ResolvedConfig,
  trading: TradingConfig | undefined,
  locale: Locale
): readonly DoctorProbe[] {
  const name = checkLabel(locale, 'safety')
  const { allowUntrusted, allowCode } = config.plugins
  const switches: readonly SafetySwitch[] = [
    { on: trading?.orders.allowUnattended === true, key: 'cli.doctorSafetyUnattended' },
    { on: allowUntrusted, key: 'cli.doctorSafetyUntrustedPlugins' },
    { on: allowUntrusted && allowCode, key: 'cli.doctorSafetyPluginCode' },
  ]
  const findings = switches.filter((entry) => entry.on)
  const values = { brand: BRAND.display }
  // A `[trading]` section that does not parse leaves allow_unattended unread, so the row never
  // reads clean on it; the plugin switches come from the core config and are still reported.
  const unread: readonly DoctorProbe[] =
    trading === undefined
      ? [{ name, status: 'warn', detail: t(locale, 'cli.doctorConfigNotLoaded') }]
      : []
  const rows = [
    ...unread,
    ...findings.map(
      (entry): DoctorProbe => ({ name, status: 'warn', detail: t(locale, entry.key, values) })
    ),
  ]

  return rows.length === 0
    ? [{ name, status: 'ok', detail: t(locale, 'cli.doctorSafetyClean', values) }]
    : rows
}
