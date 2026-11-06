import type { Locale } from '@/core/types/locale'
import type { ProfileSetField } from '@/trading/features/profile/patch'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import { formatFixedFraction, formatFraction } from '@/trading/render/format'
import { toFactLines } from '@/trading/render/layout'

export interface LimitOptions {
  readonly context: RenderContext
  /** The settings printed: a limit or a share of a buy is stated only where it is offered. */
  readonly fields: readonly ProfileSetField[]
}

/** A fact beside the setting it states. */
type FieldFact = readonly [ProfileSetField, string]

/** The first limit opens the line, so it is the first one offered. */
export function renderLimitsLine(
  locale: Locale,
  profile: UserProfile,
  options: LimitOptions
): readonly string[] {
  const [first, ...rest] = offeredFacts(limitFacts(locale, profile), options.fields)

  if (first === undefined) {
    return []
  }

  return toFactLines(
    [t(locale, 'trading.render.profile.limits', { first }), ...rest],
    options.context,
    1
  )
}

/** A full regime scale is the absence of a limit, so it earns no words - the same rule
 *  `/rebalance` already applies to its own deployment line. */
function limitFacts(locale: Locale, profile: UserProfile): readonly FieldFact[] {
  const regime: readonly FieldFact[] =
    profile.regimeScale >= 1
      ? []
      : [
          [
            'regime-scale',
            t(locale, 'trading.render.profile.limitsRegime', {
              regime: formatFraction(locale, profile.regimeScale),
            }),
          ],
        ]

  return [
    [
      'risk-per-trade-pct-nav',
      t(locale, 'trading.render.profile.limitRiskPerTrade', {
        riskPerTrade: formatFraction(locale, profile.riskPerTradePctNav),
      }),
    ],
    [
      'maximum-open-risk-pct-nav',
      t(locale, 'trading.render.profile.limitOpenRisk', {
        openRisk: formatFraction(locale, profile.maximumOpenRiskPctNav),
      }),
    ],
    [
      'maximum-sector-pct-nav',
      t(locale, 'trading.render.profile.limitSector', {
        sector: formatFraction(locale, profile.maximumSectorPctNav),
      }),
    ],
    [
      'reserve-pct-nav',
      t(locale, 'trading.render.profile.limitReserve', {
        reserve: formatFraction(locale, profile.reservePctNav),
      }),
    ],
    ...regime,
  ]
}

export function renderTrancheLine(
  locale: Locale,
  profile: UserProfile,
  options: LimitOptions
): readonly string[] {
  return toFactLines(
    offeredFacts(trancheFacts(locale, profile), options.fields),
    options.context,
    1
  )
}

function trancheFacts(locale: Locale, profile: UserProfile): readonly FieldFact[] {
  return [
    [
      'entry-tranche-pct',
      t(locale, 'trading.render.profile.entryTranche', {
        entry: formatFixedFraction(locale, profile.entryTranchePct),
      }),
    ],
    [
      'take-profit-tranche-pct',
      t(locale, 'trading.render.profile.takeProfitTranche', {
        takeProfit: formatFixedFraction(locale, profile.takeProfitTranchePct),
      }),
    ],
  ]
}

function offeredFacts(
  facts: readonly FieldFact[],
  fields: readonly ProfileSetField[]
): readonly string[] {
  return facts.filter(([field]) => fields.includes(field)).map(([, fact]) => fact)
}
