import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { InstrumentRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type {
  InvestmentHorizon,
  ProfilePatch,
  ProfileStamp,
  RiskCapSet,
  UserProfile,
} from '@/trading/kernel/operator/profile'
import type { RenderContext } from '@/trading/render/format'
import type { SleeveBlock, SleeveColumn, SleeveRow } from '@/trading/render/sleeve-block'
import { pluralKey, t } from '@/i18n'
import { CASH_SEGMENT } from '@/trading/kernel/instrument'
import { disabledSegments, isSegmentDisabled } from '@/trading/kernel/operator/profile'
import {
  formatCount,
  formatFixedFraction,
  formatFraction,
  renderDeclaredValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderSectionTitle,
  toFactLines,
} from '@/trading/render/layout'
import { ABSENT_CELL, apportion, FRACTION_QUANTUM } from '@/trading/render/number'
import { renderSleeveBlock } from '@/trading/render/sleeve-block'

/** What the operator's own settings allow, sleeve by sleeve. The per-name cap sits beside the
 *  sleeve cap because a position cap read apart from the sleeve it sits in says nothing about how
 *  much of that sleeve one name may take. */
const PROFILE_COLUMNS: readonly SleeveColumn[] = Object.freeze([
  { labelKey: 'trading.render.sleeve.columnHorizon', align: 'left' },
  { labelKey: 'trading.render.sleeve.columnTarget', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnPositionCap', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnCap', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnEtfCap', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnEtfCore', align: 'right' },
])

/** The allocation policy and the caps are what `/rebalance` measures every gap against, so a profile
 *  that names only the labels leaves the reader unable to check the report. */
export function renderProfileText(
  locale: Locale,
  profile: UserProfile,
  context: RenderContext
): string {
  const disabled = disabledSegments(profile.caps)

  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.profile, t(locale, 'trading.render.profile.title')),
      ...toFactLines(
        [
          t(locale, 'trading.render.profile.risk', {
            risk: renderDeclaredValue(locale, `trading.risk.${profile.riskLevel}`),
          }),
          t(locale, 'trading.render.profile.goal', {
            goal: renderDeclaredValue(locale, `trading.goal.${profile.goal}`),
          }),
          t(
            locale,
            pluralKey(
              profile.watchlist.length,
              'trading.render.profile.watchedOne',
              'trading.render.profile.watched'
            ),
            { watchlist: formatCount(locale, profile.watchlist.length) }
          ),
        ],
        context,
        1
      ),
      ...renderLimitsLine(locale, profile, context),
      ...toFactLines(
        [
          t(locale, 'trading.render.profile.entryTranche', {
            entry: formatFixedFraction(locale, profile.entryTranchePct),
          }),
          t(locale, 'trading.render.profile.takeProfitTranche', {
            takeProfit: formatFixedFraction(locale, profile.takeProfitTranchePct),
          }),
        ],
        context,
        1
      ),
    ],
    renderSleeveBlock(locale, sleeveBlockOf(locale, profile, disabled), context),
    [
      `${INDENT[1]}${t(locale, 'trading.render.profile.locale', {
        locale: profile.preferredLocale,
      })}`,
      `${INDENT[1]}${t(locale, 'trading.render.profile.next')}`,
    ],
  ])
}

/** A full regime scale is the absence of a limit, so it earns no words - the same rule
 *  `/rebalance` already applies to its own deployment line. */
function renderLimitsLine(
  locale: Locale,
  profile: UserProfile,
  context: RenderContext
): readonly string[] {
  const first = t(locale, 'trading.render.profile.limits', {
    first: t(locale, 'trading.render.profile.limitRiskPerTrade', {
      riskPerTrade: formatFraction(locale, profile.riskPerTradePctNav),
    }),
  })
  const regime =
    profile.regimeScale >= 1
      ? []
      : [
          t(locale, 'trading.render.profile.limitsRegime', {
            regime: formatFraction(locale, profile.regimeScale),
          }),
        ]

  return toFactLines(
    [
      first,
      t(locale, 'trading.render.profile.limitOpenRisk', {
        openRisk: formatFraction(locale, profile.maximumOpenRiskPctNav),
      }),
      t(locale, 'trading.render.profile.limitSector', {
        sector: formatFraction(locale, profile.maximumSectorPctNav),
      }),
      t(locale, 'trading.render.profile.limitReserve', {
        reserve: formatFraction(locale, profile.reservePctNav),
      }),
      ...regime,
    ],
    context,
    1
  )
}

/** Targets are the superset: `seedTargets` seeds every sleeve there, cash included, while caps seed
 *  only the ones a ceiling can bind. A switched-off sleeve leaves the rows and is named once under
 *  them. */
function sleeveBlockOf(
  locale: Locale,
  profile: UserProfile,
  disabled: ReadonlySet<string>
): SleeveBlock {
  const rows = enabledTargets(profile.segmentTargets, disabled).map(([segment, target]) =>
    toSleeveRow(locale, sleeveInputOf(profile, segment, target))
  )

  return {
    columns: PROFILE_COLUMNS,
    rows,
    disabled: [...disabled].map((segment) =>
      renderDeclaredValue(locale, `trading.segment.${segment}`)
    ),
    pinned: Object.keys(profile.pinnedTargets).map((segment) =>
      renderDeclaredValue(locale, `trading.segment.${segment}`)
    ),
  }
}

interface SleeveInput {
  readonly segment: string
  readonly target: number
  readonly cap?: RiskCapSet
  readonly horizon?: InvestmentHorizon
}

/** Keyed by a plain string because `Object.entries` hands one back, and a plain string cannot index
 *  a record keyed by the branded segment type. A sleeve with no cap set carries the field absent
 *  rather than present-and-undefined: under `exactOptionalPropertyTypes` only the first assigns. */
function sleeveInputOf(profile: UserProfile, segment: string, target: number): SleeveInput {
  const cap = new Map(Object.entries(profile.caps)).get(segment)
  const horizon = new Map(Object.entries(profile.horizons)).get(segment)

  return {
    segment,
    target,
    ...(cap === undefined ? {} : { cap }),
    ...(horizon === undefined ? {} : { horizon }),
  }
}

function toSleeveRow(locale: Locale, input: SleeveInput): SleeveRow {
  const { cap, horizon } = input

  return {
    name: renderDeclaredValue(locale, `trading.segment.${input.segment}`),
    cash: input.segment === CASH_SEGMENT,
    cells: [
      horizon === undefined ? undefined : renderDeclaredValue(locale, `trading.horizon.${horizon}`),
      formatFixedFraction(locale, input.target),
      cap === undefined ? undefined : formatFixedFraction(locale, cap.maximumPositionPctNav),
      cap === undefined ? undefined : formatFixedFraction(locale, cap.maximumSegmentPctNav),
      cap?.maximumEtfPctNav === undefined
        ? undefined
        : formatFixedFraction(locale, cap.maximumEtfPctNav),
      cap?.minimumEtfPctNav === undefined
        ? undefined
        : formatFixedFraction(locale, cap.minimumEtfPctNav),
    ],
  }
}

/** One line naming the policy a surface's numbers came out of. No icon and no indent: the caller
 *  places it, and an icon in this tree means a block starts here. */
export function renderProfileStamp(locale: Locale, stamp: ProfileStamp): string {
  return t(locale, `trading.render.profile.${stamp.saved ? 'stamp' : 'stampDefault'}`, {
    risk: renderDeclaredValue(locale, `trading.risk.${stamp.riskLevel}`),
    goal: renderDeclaredValue(locale, `trading.goal.${stamp.goal}`),
  })
}

function renderTargets(
  locale: Locale,
  targets: Readonly<Record<PortfolioSegment, number>>,
  disabled: ReadonlySet<string>
): string {
  return enabledTargets(targets, disabled)
    .map(
      ([segment, target]) =>
        `${renderDeclaredValue(locale, `trading.segment.${segment}`)} ${formatFraction(locale, target)}`
    )
    .join(INLINE_SEPARATOR)
}

/** The sleeves a surface actually prints, their shares rounded together: `seedTargets` renormalizes
 *  the enabled sleeves to one, and five rounded on their own print a column summing to 100,01%. A
 *  switched-off sleeve is dropped first, so the shares add to whatever the printed rows cover. */
function enabledTargets(
  targets: Readonly<Record<PortfolioSegment, number>>,
  disabled: ReadonlySet<string>
): readonly (readonly [string, number])[] {
  const enabled = Object.entries(targets).filter(([segment]) => !disabled.has(segment))
  const shares = apportion(
    enabled.map(([, target]) => target),
    FRACTION_QUANTUM
  )

  return enabled.map(([segment, target], index) => [segment, shares[index] ?? target] as const)
}

/** One entry per sleeve, both ceilings together: a position cap read apart from its segment cap says
 *  nothing about how much of the sleeve one name may take. */
function renderCaps(locale: Locale, caps: Readonly<Record<PortfolioSegment, RiskCapSet>>): string {
  return Object.entries(caps)
    .filter(([, cap]) => !isSegmentDisabled(cap))
    .map(
      ([segment, cap]) =>
        `${renderDeclaredValue(locale, `trading.segment.${segment}`)} ${renderCapSet(locale, cap)}`
    )
    .join(INLINE_SEPARATOR)
}

/** A switched-off sleeve never reaches this renderer: the targets and caps lines filter it, and one
 *  `segmentsOff` line names every closed sleeve. */
function renderCapSet(locale: Locale, cap: RiskCapSet): string {
  const pair = `${formatFraction(locale, cap.maximumPositionPctNav)} / ${formatFraction(locale, cap.maximumSegmentPctNav)}`

  return `${pair}${renderEtfBand(locale, cap)}`
}

/** The sleeve's ETF band, where it declares one: a core, a ceiling, or both, in that order because
 *  the floor is read before the room above it. */
function renderEtfBand(locale: Locale, cap: RiskCapSet): string {
  const core =
    cap.minimumEtfPctNav === undefined
      ? ''
      : t(locale, 'trading.render.profile.coreEtf', {
          core: formatFraction(locale, cap.minimumEtfPctNav),
        })
  const ceiling =
    cap.maximumEtfPctNav === undefined
      ? ''
      : t(locale, 'trading.render.profile.capEtf', {
          cap: formatFraction(locale, cap.maximumEtfPctNav),
        })

  return `${core}${ceiling}`
}

/** Only the fields the patch carries: an approval prompt states the change, not the profile it
 *  lands in. */
export function renderPatchText(locale: Locale, patch: ProfilePatch): string {
  const risk = 'trading.risk'
  const fields: readonly (readonly [MessageKey, string | undefined])[] = [
    ['trading.render.profile.field.riskLevel', declaredValue(locale, risk, patch.riskLevel)],
    ['trading.render.profile.field.riskCapacity', declaredValue(locale, risk, patch.riskCapacity)],
    [
      'trading.render.profile.field.riskWillingness',
      declaredValue(locale, risk, patch.riskWillingness),
    ],
    ['trading.render.profile.field.horizon', horizonsOf(locale, patch.horizons)],
    ['trading.render.profile.field.goal', declaredValue(locale, 'trading.goal', patch.goal)],
    ['trading.render.profile.field.locale', patch.preferredLocale],
    ['trading.render.profile.field.riskPerTrade', fractionValue(locale, patch.riskPerTradePctNav)],
    ['trading.render.profile.field.openRisk', fractionValue(locale, patch.maximumOpenRiskPctNav)],
    ['trading.render.profile.field.reserve', fractionValue(locale, patch.reservePctNav)],
    ['trading.render.profile.field.sector', fractionValue(locale, patch.maximumSectorPctNav)],
    ['trading.render.profile.field.regime', fractionValue(locale, patch.regimeScale)],
    ['trading.render.profile.field.entryTranche', fractionValue(locale, patch.entryTranchePct)],
    [
      'trading.render.profile.field.takeProfitTranche',
      fractionValue(locale, patch.takeProfitTranchePct),
    ],
    ['trading.render.profile.field.exclusions', tickerList(patch.exclusions)],
    ['trading.render.profile.field.targets', targetsOf(locale, patch.segmentTargets, patch.caps)],
    ['trading.render.profile.field.caps', capsOf(locale, patch.caps)],
  ]

  return fields
    .flatMap(([key, value]) => (value === undefined ? [] : [`${t(locale, key)} ${value}`]))
    .join(INLINE_SEPARATOR)
}

function declaredValue(
  locale: Locale,
  prefix: `trading.${string}`,
  value: string | undefined
): string | undefined {
  return value === undefined ? undefined : renderDeclaredValue(locale, `${prefix}.${value}`)
}

function fractionValue(locale: Locale, value: number | undefined): string | undefined {
  return value === undefined ? undefined : formatFraction(locale, value)
}

/** An empty list is a real change - the operator cleared their exclusions - so it prints as absent
 *  rather than vanishing from the prompt. */
function tickerList(instruments: readonly InstrumentRef[] | undefined): string | undefined {
  if (instruments === undefined) {
    return undefined
  }

  return instruments.length === 0
    ? ABSENT_CELL
    : instruments.map((instrument) => instrument.ticker).join(' ')
}

function targetsOf(
  locale: Locale,
  targets: Readonly<Record<PortfolioSegment, number>> | undefined,
  caps: Readonly<Record<PortfolioSegment, RiskCapSet>> | undefined
): string | undefined {
  return targets === undefined ? undefined : renderTargets(locale, targets, disabledSegments(caps))
}

function capsOf(
  locale: Locale,
  caps: Readonly<Record<PortfolioSegment, RiskCapSet>> | undefined
): string | undefined {
  return caps === undefined ? undefined : renderCaps(locale, caps)
}

function horizonsOf(
  locale: Locale,
  horizons: Readonly<Partial<Record<PortfolioSegment, InvestmentHorizon>>> | undefined
): string | undefined {
  if (horizons === undefined) {
    return undefined
  }

  return Object.entries(horizons)
    .map(
      ([segment, horizon]) =>
        `${renderDeclaredValue(locale, `trading.segment.${segment}`)} ${renderDeclaredValue(locale, `trading.horizon.${horizon}`)}`
    )
    .join(INLINE_SEPARATOR)
}
