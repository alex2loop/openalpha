import type { TradingConfig } from '@/trading/kernel/config'
import { OperatorConfigError } from '@/core/config/resolve'
import { marketRef } from '@/trading/kernel/instrument'
import { isWeekendDay } from '@/trading/markets/calendar'
import { cryptoManifest } from '@/trading/markets/crypto/market'
import { vnManifest } from '@/trading/markets/equity-vn/market'
import { goldManifest } from '@/trading/markets/gold/market'
import { goldVnManifest } from '@/trading/markets/gold-vn/market'
import { MARKETS_CONFIG_KEY } from '@/trading/wiring/config-schema'

/** The two ways a `holidays` / `open_days` date can be wrong on its own, refused where the config
 *  resolves so `config validate` and boot agree. A market this build does not ship has no weekend
 *  to test against; composition refuses the unknown market itself. */
export function assertConfiguredDays(config: TradingConfig, section: string): void {
  const label = `[${section}.${MARKETS_CONFIG_KEY}]`

  assertDaysAgree(config, label)
  assertDaysAreWeekdays(config, label)
}

/** A date both closed and reopened under one market says two things; neither can be guessed. */
function assertDaysAgree(config: TradingConfig, label: string): void {
  const contradicted = Object.entries(config.markets).flatMap(([ref, settings]) => {
    const reopened = new Set(settings?.openDays ?? [])

    return (settings?.holidays ?? [])
      .filter((day) => reopened.has(day))
      .map((day) => `${ref} ${day}`)
  })

  if (contradicted.length > 0) {
    throw new OperatorConfigError(
      `${label} dates in both holidays and open_days: ${contradicted.join(', ')}`,
      { key: 'errors.configMarketDayContradicted', params: { days: contradicted.join(', ') } }
    )
  }
}

/** A configured date on the market's own weekend is a mistyped date: that day never traded, so the
 *  change it was meant to make is not there. Every offender in one throw. */
function assertDaysAreWeekdays(config: TradingConfig, label: string): void {
  const policies = new Map(
    [cryptoManifest, goldManifest, goldVnManifest, vnManifest]
      .map((build) => build(config))
      .map((manifest) => [manifest.id, manifest.defaultCalendar])
  )
  const misplaced = Object.entries(config.markets).flatMap(([ref, settings]) => {
    const policy = policies.get(marketRef(ref))

    return policy === undefined
      ? []
      : [...(settings?.holidays ?? []), ...(settings?.openDays ?? [])]
          .filter((day) => isWeekendDay(policy, day))
          .map((day) => `${ref} ${day}`)
  })

  if (misplaced.length > 0) {
    throw new OperatorConfigError(
      `${label} holidays or open_days fall on a weekend: ${misplaced.join(', ')}`,
      { key: 'errors.configMarketDayOnWeekend', params: { days: misplaced.join(', ') } }
    )
  }
}
