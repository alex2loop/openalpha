import type {
  EvidenceDeps,
  EvidencePart,
  EvidenceRequest,
} from '@/trading/features/themes/evidence/deps'
import type { EvidenceDraft } from '@/trading/features/themes/types'
import { PRESS_SERIES, REPORT_SERIES } from '@/trading/features/market-data/macro-extract/catalogue'
import { formatFigure, toDayBefore, toLookbacks } from '@/trading/features/themes/evidence/series'
import {
  INTERBANK_TENORS,
  interbankSeriesId,
  REDISCOUNT_SERIES_ID,
  REFINANCING_SERIES_ID,
} from '@/trading/kernel/market/policy-rates'
import { utcDayOf } from '@/trading/sources/rows/normalization'

/** A report series is stale once a period and the office's month and a half of lag have passed
 *  since its last figure, which is one report missed by about five weeks. */
const MONTHLY_STALE_DAYS = 75
const QUARTERLY_STALE_DAYS = 137
const YEAR_DAYS = 366
/** The year-ago point is a year before the latest reading, not before today, so the window also
 *  spans the lag of the latest series still fresh. */
export const MACRO_WINDOW_DAYS = YEAR_DAYS + QUARTERLY_STALE_DAYS

/** Only report series go stale: the press and the SBV print when they print. */
interface MacroSeries {
  readonly id: string
  readonly label: string
  readonly staleDays?: number
}

const MACRO_SERIES: readonly MacroSeries[] = Object.freeze([
  ...REPORT_SERIES.map((spec) => ({
    id: spec.id,
    label: spec.description,
    staleDays: spec.quarterly ? QUARTERLY_STALE_DAYS : MONTHLY_STALE_DAYS,
  })),
  ...PRESS_SERIES.map((spec) => ({ id: spec.id, label: spec.description })),
  { id: REFINANCING_SERIES_ID, label: 'SBV refinancing rate, percent' },
  { id: REDISCOUNT_SERIES_ID, label: 'SBV rediscount rate, percent' },
  ...INTERBANK_TENORS.map((tenor) => ({
    id: interbankSeriesId(tenor),
    label: `Interbank rate, ${tenor}, percent`,
  })),
])

interface Reading {
  readonly day: string
  readonly value: number
}

interface MacroRead {
  readonly draft?: EvidenceDraft
  readonly stale: boolean
}

/** Dated, so a gap between two readings shows rather than reading as one period. */
function renderEarlier(reading: Reading | undefined, label: string): readonly string[] {
  return reading === undefined ? [] : [`${formatFigure(reading.value)} ${label} (${reading.day})`]
}

/** The reading before can be the one three months or a year back; it is stated once. */
function isPrevious(reading: Reading | undefined, previous: Reading | undefined): boolean {
  return reading !== undefined && reading.day === previous?.day
}

async function readMacroSeries(
  deps: EvidenceDeps,
  series: MacroSeries,
  request: EvidenceRequest
): Promise<MacroRead> {
  const today = utcDayOf(request.now)
  const points = await deps.readSeries({
    seriesId: series.id,
    fromDay: toDayBefore(today, MACRO_WINDOW_DAYS),
    toDay: today,
    signal: request.signal,
  })
  const lookbacks = toLookbacks(points)

  if (lookbacks === undefined) {
    return { stale: series.staleDays !== undefined }
  }

  const { latest, quarterAgo, yearAgo } = lookbacks
  const previous = points.at(-2)
  const text = [
    `${series.label}: ${formatFigure(latest.value)} (${latest.day})`,
    ...renderEarlier(previous, 'the reading before'),
    ...(isPrevious(quarterAgo, previous) ? [] : renderEarlier(quarterAgo, 'three months earlier')),
    ...(isPrevious(yearAgo, previous) ? [] : renderEarlier(yearAgo, 'a year earlier')),
  ].join('; ')

  return {
    draft: { kind: 'macro', origin: series.id, text, day: latest.day },
    stale: series.staleDays !== undefined && latest.day < toDayBefore(today, series.staleDays),
  }
}

export async function readMacro(
  deps: EvidenceDeps,
  request: EvidenceRequest
): Promise<EvidencePart> {
  const reads = await Promise.all(
    MACRO_SERIES.map((series) => readMacroSeries(deps, series, request))
  )

  return {
    kind: 'macro',
    drafts: reads.flatMap((read) => (read.draft === undefined ? [] : [read.draft])),
    missing: reads.some((read) => read.stale),
  }
}
