import type { Locale } from '@/core/types/locale'
import type { CaveatDetail } from '@/trading/kernel/caveat'
import { renderTradingDays } from '@/trading/render/datetime'
import {
  CAVEAT_SUBJECT_SEPARATOR,
  formatAmount,
  formatFraction,
  formatMultiple,
  renderProvidedValue,
} from '@/trading/render/format'

const SUBJECT_PREFIXES: Readonly<Record<string, `trading.${string}`>> = Object.freeze({
  segment: 'trading.segment',
  sector: 'trading.sector',
  status: 'trading.instrument.status',
  horizon: 'trading.horizon',
  risk: 'trading.risk',
  sourceKind: 'trading.source.kind',
  factor: 'trading.factor',
  region: 'trading.region',
  regime: 'trading.regime',
  review: 'trading.index-review',
  limit: 'trading.cap',
  kind: 'trading.refresh.kind',
})

/** Subject fields whose number is a fraction rather than a magnitude. Membership is what declares
 *  the unit, so a caveat carries the raw fraction and the catalog sentence writes no `%` of its
 *  own. Without this a drift of 0.0489 prints as `0,05` in a sentence that reads as a percentage,
 *  which is wrong by a factor of a hundred and plausible either way. */
const SUBJECT_FRACTIONS: ReadonlySet<string> = new Set([
  'badDebtGrowth',
  'cap',
  'deployment',
  'drift',
  'fall',
  'gap',
  'imbalance',
  'inventoryGrowth',
  'leverage',
  'loanGrowth',
  'minimum',
  'premium',
  'proximity',
  'raisedShare',
  'rate',
  'realizedLoss',
  'run',
  'salesGrowth',
  'scale',
  'share',
  'target',
  'underwater',
  'weight',
])

/** Subject fields whose number is a multiple of a baseline, printed with the `×` a multiple carries
 *  everywhere else so "1,6" cannot be read as a share. */
const SUBJECT_MULTIPLES: ReadonlySet<string> = new Set([
  'capexToDepreciation',
  'conversion',
  'cover',
  'volume',
])

/** Subject fields whose value is a declared code rather than free text. Without this a finding
 *  prints the raw id — `vn-financials`, `equity-vn` — in place of a translated name. A value that
 *  is a trading day is shown in the reader's date order instead of the stored ISO form, and a
 *  number is rendered by `Intl` rather than interpolated raw — a stored float would otherwise
 *  print its own artifacts into the sentence. */
export function renderSubject(locale: Locale, subject: CaveatDetail): CaveatDetail {
  const rendered: Record<string, string | number> = {}

  for (const [field, value] of Object.entries(subject)) {
    const prefix = SUBJECT_PREFIXES[field]

    if (typeof value === 'number') {
      rendered[field] = formatSubjectNumber(locale, field, value)
      continue
    }

    const days = renderTradingDays(locale, value, CAVEAT_SUBJECT_SEPARATOR)

    if (days !== undefined) {
      rendered[field] = days
      continue
    }

    rendered[field] =
      prefix === undefined ? value : renderProvidedValue(locale, `${prefix}.${value}`, value)
  }

  return rendered
}

function formatSubjectNumber(locale: Locale, field: string, value: number): string {
  if (SUBJECT_FRACTIONS.has(field)) {
    return formatFraction(locale, value)
  }

  return SUBJECT_MULTIPLES.has(field) ? formatMultiple(locale, value) : formatAmount(locale, value)
}
