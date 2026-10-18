import type { Locale } from '@/core/types/locale'
import type { SegmentPolicyRequest } from '@/trading/features/profile/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { ProfilePatch } from '@/trading/kernel/operator/profile'
import { LOCALES } from '@/core/types/locale'
import { SEGMENT_POLICY_FIELDS } from '@/trading/features/profile/types'
import {
  INVESTMENT_GOALS,
  INVESTMENT_HORIZONS,
  RISK_LEVELS,
} from '@/trading/kernel/operator/profile'
import { parseFiniteNumber, parseMember } from '@/trading/kernel/surface/surface'

/** Exactly the scalar fields a one-line command can express. Lists, segment targets, and cap
 *  records go through the profile tool instead of a command-line mini-language. */
const FRACTION_FIELDS = Object.freeze([
  'maximum-sector-pct-nav',
  'reserve-pct-nav',
  'regime-scale',
  'risk-per-trade-pct-nav',
  'maximum-open-risk-pct-nav',
  'entry-tranche-pct',
  'take-profit-tranche-pct',
] as const)

const FRACTION_PATCH_KEYS: Readonly<Record<(typeof FRACTION_FIELDS)[number], keyof ProfilePatch>> =
  Object.freeze({
    'maximum-sector-pct-nav': 'maximumSectorPctNav',
    'reserve-pct-nav': 'reservePctNav',
    'regime-scale': 'regimeScale',
    'risk-per-trade-pct-nav': 'riskPerTradePctNav',
    'maximum-open-risk-pct-nav': 'maximumOpenRiskPctNav',
    'entry-tranche-pct': 'entryTranchePct',
    'take-profit-tranche-pct': 'takeProfitTranchePct',
  })

const RISK_FIELDS = Object.freeze(['risk-level', 'risk-capacity', 'risk-willingness'] as const)
const LOCALE_FIELD = 'preferred-locale'
const HORIZON_FIELD = 'horizon'
const GOAL_FIELD = 'goal'
/** The fields that take two words: the segment, then the value it carries. */
const SEGMENT_VALUE_COUNT = 2

/** Every field name `/profile set` accepts, in the order the usage line reads them. */
export const PROFILE_SET_FIELDS: readonly string[] = Object.freeze([
  LOCALE_FIELD,
  ...RISK_FIELDS,
  HORIZON_FIELD,
  GOAL_FIELD,
  ...FRACTION_FIELDS,
  ...SEGMENT_POLICY_FIELDS,
])

interface FieldValueOptions {
  readonly field: string
  /** Zero-based position of the value being completed. Every field but horizon has one. */
  readonly index: number
  readonly segments: readonly PortfolioSegment[]
}

/** The values a field admits at one position, or none when it takes a number no list can
 *  enumerate. */
export function profileFieldValues(options: FieldValueOptions): readonly string[] {
  const { field, index, segments } = options

  if (field === HORIZON_FIELD) {
    if (index === 0) {
      return segments
    }

    return index === 1 ? INVESTMENT_HORIZONS : []
  }

  if (parseMember(field, SEGMENT_POLICY_FIELDS) !== null) {
    return index === 0 ? segments : []
  }

  if (index !== 0) {
    return []
  }

  if (field === LOCALE_FIELD) {
    return LOCALES
  }

  if (RISK_FIELDS.some((name) => name === field)) {
    return RISK_LEVELS
  }

  return field === GOAL_FIELD ? INVESTMENT_GOALS : []
}

interface ParsePatchOptions {
  readonly field: string | undefined
  readonly values: readonly string[]
  readonly segments: readonly PortfolioSegment[]
}

/** The one `field value...` grammar `/profile set` accepts. Returns `null` rather than guessing; the
 *  caller answers with its own usage text. */
export function parseProfilePatch(options: ParsePatchOptions): ProfilePatch | null {
  const { field, values, segments } = options

  if (field === HORIZON_FIELD) {
    return values.length === SEGMENT_VALUE_COUNT ? parseHorizonPatch(values, segments) : null
  }

  const [raw] = values

  if (values.length !== 1) {
    return null
  }

  if (field === LOCALE_FIELD) {
    const locale: Locale | null = parseMember(raw, LOCALES)
    return locale === null ? null : { preferredLocale: locale }
  }

  const riskPatch = parseRiskPatch(field, raw)

  if (riskPatch !== null) {
    return riskPatch
  }

  if (field === GOAL_FIELD) {
    const goal = parseMember(raw, INVESTMENT_GOALS)
    return goal === null ? null : { goal }
  }

  return parseFractionPatch(field, raw)
}

/** These edit one entry of records the patch grammar can only replace whole, so they travel as
 *  their own request rather than as a `ProfilePatch`. */
export function parseSegmentPolicyRequest(options: ParsePatchOptions): SegmentPolicyRequest | null {
  const field = parseMember(options.field, SEGMENT_POLICY_FIELDS)

  if (field === null || options.values.length !== SEGMENT_VALUE_COUNT) {
    return null
  }

  const segment = parseMember(options.values[0], options.segments)
  const pctNav = parseFiniteNumber(options.values[1])

  if (segment === null || pctNav === null) {
    return null
  }

  return { field, segment, pctNav }
}

function parseHorizonPatch(
  values: readonly string[],
  segments: readonly PortfolioSegment[]
): ProfilePatch | null {
  const segment = parseMember(values[0], segments)
  const horizon = parseMember(values[1], INVESTMENT_HORIZONS)

  return segment === null || horizon === null ? null : { horizons: { [segment]: horizon } }
}

function parseRiskPatch(field: string | undefined, raw: string | undefined): ProfilePatch | null {
  const name = parseMember(field, RISK_FIELDS)
  const level = parseMember(raw, RISK_LEVELS)

  if (name === null || level === null) {
    return null
  }

  if (name === 'risk-level') {
    return { riskLevel: level }
  }

  return name === 'risk-capacity' ? { riskCapacity: level } : { riskWillingness: level }
}

function parseFractionPatch(
  field: string | undefined,
  raw: string | undefined
): ProfilePatch | null {
  const name = parseMember(field, FRACTION_FIELDS)
  const value = parseFiniteNumber(raw)

  // Range is the validator's: it names the field and the bounds, which usage cannot.
  if (name === null || value === null) {
    return null
  }

  return { [FRACTION_PATCH_KEYS[name]]: value }
}
