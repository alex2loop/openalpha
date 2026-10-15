import { z } from 'zod'

import type {
  ScoreConfidence,
  SectorRead,
  StockRead,
  ThemeId,
  ThemeRead,
  ThemeReadLevel,
  ThemeRunReads,
  ThemeScore,
} from '@/trading/features/themes/types'
import {
  EARNINGS_VERDICTS,
  EVIDENCE_KINDS,
  EXPOSURE_LABELS,
  SCORE_CONFIDENCES,
  SCORE_PARTS,
  SECTOR_EFFECTS,
  SECTOR_LINKAGES,
  THEME_MATURITIES,
  THEME_READ_LEVELS,
  THEME_STATUSES,
  themeId,
} from '@/trading/features/themes/types'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { ICB_SUPERSECTORS } from '@/trading/kernel/market/market-data'
import { parseJson } from '@/trading/kernel/store/store-row'

const LEVEL = z.enum(THEME_READ_LEVELS)
const SECTOR = z.enum(ICB_SUPERSECTORS)
const CONFIDENCE = z.enum(SCORE_CONFIDENCES)
const SCORE_PART_VALUES = z.partialRecord(z.enum(SCORE_PARTS), z.number())
const CLAIM = z.object({ text: z.string(), evidence: z.array(z.string()) })
const CLAIMS = z.array(CLAIM)
const WEB = z.array(z.object({ url: z.string(), title: z.string() }))
const RATING = z.number()
const SCENARIO = z.object({
  probabilityPct: z.number(),
  epsGrowthPct: z.number(),
  targetPe: z.number(),
  summary: z.string(),
})
const DAY = z.string().transform((raw) => tradingDay(raw))
const PRICED_AT = z.object({
  day: DAY,
  value: z.number(),
})
const QUARTER = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
const STORED_THEME = z.object({
  status: z.enum(THEME_STATUSES),
  maturity: z.enum(THEME_MATURITIES),
  probabilityPct: z.number(),
  previousProbabilityPct: z.number().exactOptional(),
  horizonMonths: z.number(),
  summary: z.string(),
  supporting: CLAIMS,
  counter: CLAIMS,
  web: WEB,
  invalidatedBy: z.string().exactOptional(),
  beneficiaries: z.array(SECTOR).exactOptional(),
  model: z.string().exactOptional(),
  scoreParts: SCORE_PART_VALUES.exactOptional(),
})
const STORED_SECTOR = z.object({
  linkage: z.enum(SECTOR_LINKAGES),
  effect: z.enum(SECTOR_EFFECTS),
  chain: z.string(),
  criteria: z.object({
    demandGrowth: RATING,
    earningsGrowth: RATING,
    pricingPower: RATING,
    profitability: RATING,
    competition: RATING,
    governmentSupport: RATING,
    supplyDemand: RATING,
    capitalCycle: RATING,
    macroSensitivity: RATING,
    duration: RATING,
  }),
  figures: z.object({
    profitGrowth: z.number().exactOptional(),
    peToAverage: z.number().exactOptional(),
  }),
  supporting: CLAIMS,
  counter: CLAIMS,
  web: WEB,
  model: z.string().exactOptional(),
  scoreParts: SCORE_PART_VALUES.exactOptional(),
})
const STORED_STOCK = z.object({
  sector: SECTOR,
  exposure: z.object({
    estimatedRevenueSharePct: z.number(),
    forwardSharePct: z.number(),
    blendedPct: z.number(),
    label: z.enum(EXPOSURE_LABELS),
  }),
  exposureBasis: CLAIMS,
  verdict: z.enum(EARNINGS_VERDICTS),
  chain: CLAIMS,
  pricedIn: CLAIM,
  scenarios: z.object({ bull: SCENARIO, base: SCENARIO, bear: SCENARIO }),
  risks: CLAIMS,
  catalysts: CLAIMS,
  invalidation: z.array(z.string()),
  horizonMonths: z.number(),
  crowding: z.object({
    excessReturn: z.number().exactOptional(),
    pePercentile: z.number().exactOptional(),
    recentHeadlines: z.number().exactOptional(),
    crowded: z.boolean(),
  }),
  quality: z.number(),
  pe: z.number().exactOptional(),
  surprise: z
    .object({
      fiscalYear: z.number(),
      quarter: QUARTER,
      publishedOn: DAY,
      profit: z.number(),
      yearAgoProfit: z.number(),
      standardized: z.number().exactOptional(),
      growth: z.number().exactOptional(),
    })
    .exactOptional(),
  close: PRICED_AT.exactOptional(),
  benchmark: PRICED_AT.exactOptional(),
  missing: z.array(z.enum(EVIDENCE_KINDS)),
  web: WEB,
  model: z.string().exactOptional(),
  scoreParts: SCORE_PART_VALUES.exactOptional(),
})

/** `subject` is the theme id, the sector key or the ticker, so the payload never repeats it. */
export interface StoredReadRow {
  readonly theme_id: string
  readonly level: string
  readonly subject: string
  readonly score: number | null
  readonly confidence: string | null
  readonly payload: string
}

interface ReadRow {
  readonly themeId: ThemeId
  readonly level: ThemeReadLevel
  readonly subject: string
  readonly score: number | null
  readonly confidence: ScoreConfidence | null
  readonly payload: string
}

type ReadKey = Pick<ReadRow, 'themeId' | 'level' | 'subject'>

export function toReadRows(reads: ThemeRunReads): readonly ReadRow[] {
  return [
    ...reads.themes.map(({ themeId: id, score, ...payload }) =>
      toReadRow({ themeId: id, level: 'theme', subject: id }, payload, score)
    ),
    ...reads.sectors.map(({ themeId: id, sector, score, ...payload }) =>
      toReadRow({ themeId: id, level: 'sector', subject: sector }, payload, score)
    ),
    ...reads.stocks.map(({ themeId: id, ticker: subject, score, ...payload }) =>
      toReadRow({ themeId: id, level: 'stock', subject }, payload, score)
    ),
  ]
}

/** The score's value and confidence go to columns, so outcomes can join on them; its parts ride in
 *  the payload, so the score can be recomputed from the row. */
function toReadRow(key: ReadKey, payload: object, score: ThemeScore | undefined): ReadRow {
  return {
    ...key,
    score: score?.value ?? null,
    confidence: score?.confidence ?? null,
    payload: JSON.stringify(
      score === undefined ? payload : { ...payload, scoreParts: score.parts }
    ),
  }
}

export function toRunReads(rows: readonly StoredReadRow[]): ThemeRunReads {
  const parsed = rows.map((row) => ({ ...row, level: LEVEL.parse(row.level) }))

  return {
    themes: parsed.filter((row) => row.level === 'theme').map(toThemeRead),
    sectors: parsed.filter((row) => row.level === 'sector').map(toSectorRead),
    stocks: parsed.filter((row) => row.level === 'stock').map(toStockRead),
  }
}

function toThemeRead(row: StoredReadRow): ThemeRead {
  const { scoreParts, ...read } = parseJson(row.payload, 'theme read', (value) =>
    STORED_THEME.parse(value)
  )

  return { ...read, themeId: themeId(row.theme_id), ...toScore(row, scoreParts) }
}

function toSectorRead(row: StoredReadRow): SectorRead {
  const { scoreParts, ...read } = parseJson(row.payload, 'theme sector read', (value) =>
    STORED_SECTOR.parse(value)
  )

  return {
    ...read,
    themeId: themeId(row.theme_id),
    sector: SECTOR.parse(row.subject),
    ...toScore(row, scoreParts),
  }
}

function toStockRead(row: StoredReadRow): StockRead {
  const { scoreParts, ...read } = parseJson(row.payload, 'theme stock read', (value) =>
    STORED_STOCK.parse(value)
  )

  return {
    ...read,
    themeId: themeId(row.theme_id),
    ticker: ticker(row.subject),
    ...toScore(row, scoreParts),
  }
}

function toScore(
  row: StoredReadRow,
  parts: ThemeScore['parts'] | undefined
): { readonly score?: ThemeScore } {
  return row.score === null || row.confidence === null
    ? {}
    : {
        score: {
          value: Number(row.score),
          confidence: CONFIDENCE.parse(row.confidence),
          parts: parts ?? {},
        },
      }
}
