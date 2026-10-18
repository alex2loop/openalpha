import type { ChannelId } from '@/core/channels'
import type { BrandTag, SessionId } from '@/core/ids'
import type { ProgressReporter } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { ThemeScorecard } from '@/trading/features/themes/outcomes/scorecard-types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { FiscalQuarter } from '@/trading/kernel/market/annual-accounts'
import type { ICB_SUPERSECTORS } from '@/trading/kernel/market/market-data'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import { brandFromPattern, marketRef, ticker } from '@/trading/kernel/instrument'

const THEME_ID_RE = /^[a-z][a-z0-9-]{2,47}$/

/** Themes read VN equities only: the one market with a sector cross-section to map them onto. */
export const THEME_MARKET = marketRef('equity-vn')
/** For the reply schema, which states the same rule to the model. */
export const THEME_ID_PATTERN = THEME_ID_RE.source
/** The index every theme return is read against. The market's own constant lives in
 *  `markets/equity-vn/policy.ts`, which a feature may not import. */
export const THEME_BENCHMARK = ticker('VNINDEX')

export const THEME_STATUSES = Object.freeze([
  'proposed',
  'active',
  'weakening',
  'invalidated',
  'rejected',
  'retired',
] as const)
export type ThemeStatus = (typeof THEME_STATUSES)[number]
/** The statuses a run re-reads and may move between. */
export const TRACKED_THEME_STATUSES: readonly ThemeStatus[] = Object.freeze(['active', 'weakening'])
/** The operator closed these, so no report or tool shows them. */
export const CLOSED_THEME_STATUSES: readonly ThemeStatus[] = Object.freeze(['rejected', 'retired'])

export const THEME_MATURITIES = Object.freeze(['emerging', 'scaling', 'mature'] as const)
export type ThemeMaturity = (typeof THEME_MATURITIES)[number]

export const THEME_TRANSITIONS = Object.freeze(['approve', 'reject', 'retire'] as const)
export type ThemeTransition = (typeof THEME_TRANSITIONS)[number]

interface TransitionRule {
  readonly from: readonly ThemeStatus[]
  readonly to: ThemeStatus
}

/** Only the operator makes a theme active, and only the operator ends one. */
export const THEME_TRANSITION_RULES: Readonly<Record<ThemeTransition, TransitionRule>> =
  Object.freeze({
    approve: { from: ['proposed'], to: 'active' },
    reject: { from: ['proposed'], to: 'rejected' },
    retire: { from: ['active', 'weakening', 'invalidated'], to: 'retired' },
  })

export const THEME_STEP_FAILURES = Object.freeze(['budget', 'halted', 'invalid', 'setup'] as const)
export type ThemeStepFailure = (typeof THEME_STEP_FAILURES)[number]

export const THEME_READ_LEVELS = Object.freeze(['theme', 'sector', 'stock'] as const)
export type ThemeReadLevel = (typeof THEME_READ_LEVELS)[number]

export const SECTOR_LINKAGES = Object.freeze(['direct', 'indirect'] as const)
export type SectorLinkage = (typeof SECTOR_LINKAGES)[number]

export const SECTOR_EFFECTS = Object.freeze(['benefits', 'hurt'] as const)
type SectorEffect = (typeof SECTOR_EFFECTS)[number]

/** What a sector is rated on, 1 (weak for the sector) to 5 (strong for it). */
const SECTOR_CRITERIA = Object.freeze([
  'demandGrowth',
  'earningsGrowth',
  'pricingPower',
  'profitability',
  'competition',
  'governmentSupport',
  'supplyDemand',
  'capitalCycle',
  'macroSensitivity',
  'duration',
] as const)
type SectorCriterion = (typeof SECTOR_CRITERIA)[number]

export const EXPOSURE_LABELS = Object.freeze([
  'very-high',
  'high',
  'medium',
  'low',
  'negative',
] as const)
export type ExposureLabel = (typeof EXPOSURE_LABELS)[number]

/** Whether the theme moves the company's earnings or only how the market talks about it. */
export const EARNINGS_VERDICTS = Object.freeze(['earnings', 'sentiment'] as const)
type EarningsVerdict = (typeof EARNINGS_VERDICTS)[number]

export const SCENARIO_CASES = Object.freeze(['bull', 'base', 'bear'] as const)
export type ScenarioCase = (typeof SCENARIO_CASES)[number]

/** Sector keys are the ICB super-sectors the instrument table is filed under. */
export type ThemeSector = (typeof ICB_SUPERSECTORS)[number]

/** What the bundle and the company figures are built from; a kind that could not be read is a
 *  gap the report names. */
export const EVIDENCE_KINDS = Object.freeze([
  'macro',
  'commodity',
  'sector',
  'news',
  'valuation',
  'accounts',
  'price',
  'headlines',
] as const)
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** A news list longer than one run reads, cut to its newest stories: read in part, not missing. */
export const NEWS_CAPPED_GAP = 'news-capped'

/** What a run can report missing or cut: an evidence kind, the screen board, without which no
 *  sector or company is read at all, or a capped news list. */
export const THEME_GAPS = Object.freeze([...EVIDENCE_KINDS, 'screen', NEWS_CAPPED_GAP] as const)
export type ThemeGap = (typeof THEME_GAPS)[number]

/** What a score is built from, across the three levels. */
export const SCORE_PARTS = Object.freeze([
  'probability',
  'opportunity',
  'duration',
  'evidence',
  'linkage',
  'growth',
  'criteria',
  'context',
  'exposure',
  'earnings',
  'quality',
  'valuation',
  'risk',
  'crowding',
] as const)
export type ScorePart = (typeof SCORE_PARTS)[number]

export const SCORE_CONFIDENCES = Object.freeze(['low', 'medium', 'high'] as const)
export type ScoreConfidence = (typeof SCORE_CONFIDENCES)[number]

/** Months after a stock read at which its return is measured against VN-Index. */
export const OUTCOME_HORIZONS_MONTHS: readonly number[] = Object.freeze([3, 6, 12])

export type ThemeId = string & BrandTag<'ThemeId'>

export interface EvidenceDraft {
  readonly kind: EvidenceKind
  /** What makes two items independent: a series, a commodity, the sector board, a news host. */
  readonly origin: string
  readonly text: string
  readonly day: string
}

/** `id` is minted by code (`M1`, `C3`, `N12`), so a model can cite an item but never invent one. */
export interface EvidenceItem extends EvidenceDraft {
  readonly id: string
}

export interface ThemeBundle {
  readonly builtAt: number
  readonly items: readonly EvidenceItem[]
  /** A kind that could not be read, was read only in part, or read stale this run. */
  readonly gaps: readonly ThemeGap[]
}

export interface Theme {
  readonly id: ThemeId
  readonly title: string
  readonly thesis: string
  readonly status: ThemeStatus
  readonly maturity: ThemeMaturity
  /** The conditions that end the thesis, fixed when it was proposed. */
  readonly invalidation: readonly string[]
  readonly createdAt: number
  readonly approvedAt?: number
  readonly updatedAt: number
}

export interface ThemeClaim {
  readonly text: string
  /** Bundle ids, every one checked against the bundle the claim was made on. */
  readonly evidence: readonly string[]
}

interface ThemeWebSource {
  readonly url: string
  readonly title: string
}

export interface ThemeScore {
  /** 0-100. */
  readonly value: number
  readonly confidence: ScoreConfidence
  /** Each part read, 0-1; a part missing here could not be read and carried no weight. */
  readonly parts: Readonly<Partial<Record<ScorePart, number>>>
}

export interface ThemeRead {
  readonly themeId: ThemeId
  readonly status: ThemeStatus
  readonly maturity: ThemeMaturity
  readonly probabilityPct: number
  readonly previousProbabilityPct?: number
  readonly horizonMonths: number
  readonly summary: string
  readonly supporting: readonly ThemeClaim[]
  readonly counter: readonly ThemeClaim[]
  /** What research found. Never counted as evidence: code cannot check it against the bundle. */
  readonly web: readonly ThemeWebSource[]
  /** The invalidation condition this read found met. */
  readonly invalidatedBy?: string
  /** The sectors a proposal says stand to gain; only the read that proposed the theme names them. */
  readonly beneficiaries?: readonly ThemeSector[]
  readonly score?: ThemeScore
  readonly model?: string
}

/** Code's own sector figures, stored with the read so its score can be recomputed from the row. */
export interface SectorFigures {
  /** Net profit over the last four reported quarters against the four before, a fraction. */
  readonly profitGrowth?: number
  /** Median P/E against the median of the members' own five-year average P/E. */
  readonly peToAverage?: number
}

export interface SectorRead {
  readonly themeId: ThemeId
  readonly sector: ThemeSector
  readonly linkage: SectorLinkage
  readonly effect: SectorEffect
  /** Theme -> demand -> industry -> revenue -> profit, in one paragraph. */
  readonly chain: string
  readonly criteria: Readonly<Record<SectorCriterion, number>>
  readonly figures: SectorFigures
  readonly supporting: readonly ThemeClaim[]
  readonly counter: readonly ThemeClaim[]
  readonly web: readonly ThemeWebSource[]
  readonly score?: ThemeScore
  readonly model?: string
}

export interface StockExposure {
  /** The model's estimate with a citation: VN statements carry no segment data. */
  readonly estimatedRevenueSharePct: number
  /** The share the named contracts, capex and projects would bring by the horizon. */
  readonly forwardSharePct: number
  /** The two blended by the theme's maturity, in code. */
  readonly blendedPct: number
  readonly label: ExposureLabel
}

interface StockScenario {
  readonly probabilityPct: number
  /** EPS growth over the read's horizon, in percent. */
  readonly epsGrowthPct: number
  readonly targetPe: number
  readonly summary: string
}

/** What says the market already owns the story. */
export interface Crowding {
  /** Twelve-month return less VN-Index's, a fraction. */
  readonly excessReturn?: number
  /** Where today's P/E sits in the name's own five years, 0-100. */
  readonly pePercentile?: number
  /** Stories on the name in the news source's two-week window; context, not a signal, since no
   *  older count exists to call it a surge against. */
  readonly recentHeadlines?: number
  /** Both the return and the P/E high. A signal that could not be read never makes a name
   *  crowded. */
  readonly crowded: boolean
}

/** The newest quarter's profit against the same quarter a year earlier. */
export interface EarningsSurprise {
  readonly fiscalYear: number
  readonly quarter: FiscalQuarter
  /** When the quarter was filed, which is the day the figure became known. */
  readonly publishedOn: TradingDay
  readonly profit: number
  readonly yearAgoProfit: number
  /** The change less the mean of the name's earlier year-on-year changes, over their spread. */
  readonly standardized?: number
  /** A fraction; absent when the year-ago profit was not positive. */
  readonly growth?: number
}

export interface PricedAt {
  readonly day: TradingDay
  readonly value: number
}

export interface StockRead {
  readonly themeId: ThemeId
  readonly ticker: Ticker
  readonly sector: ThemeSector
  readonly exposure: StockExposure
  readonly exposureBasis: readonly ThemeClaim[]
  readonly verdict: EarningsVerdict
  /** Revenue -> margin -> earnings -> cash flow. */
  readonly chain: readonly ThemeClaim[]
  readonly pricedIn: ThemeClaim
  readonly scenarios: Readonly<Record<ScenarioCase, StockScenario>>
  readonly risks: readonly ThemeClaim[]
  readonly catalysts: readonly ThemeClaim[]
  readonly invalidation: readonly string[]
  readonly horizonMonths: number
  readonly crowding: Crowding
  /** The screen's quality factor for the name, -1 to 1. */
  readonly quality: number
  /** The P/E the scenarios' target P/E is set against; absent for a loss-making name. */
  readonly pe?: number
  readonly surprise?: EarningsSurprise
  /** Stored so a later outcome never depends on run-day bars surviving retention. */
  readonly close?: PricedAt
  readonly benchmark?: PricedAt
  /** Company figures that could not be read for this name. */
  readonly missing: readonly EvidenceKind[]
  readonly web: readonly ThemeWebSource[]
  readonly score?: ThemeScore
  readonly model?: string
}

export interface ThemeRunReads {
  readonly themes: readonly ThemeRead[]
  readonly sectors: readonly SectorRead[]
  readonly stocks: readonly StockRead[]
}

/** A step that failed. A theme-level note with no theme id is the discovery step, which belongs to
 *  no theme; a string label for it could be a theme id the model chose. `subject` is the ticker of
 *  a failed company read. */
export interface ThemeRunNote {
  readonly level: ThemeReadLevel
  readonly themeId?: ThemeId
  readonly subject?: string
  /** The sector a failed company read was shortlisted under. */
  readonly sector?: ThemeSector
  readonly cause: ThemeStepFailure
  /** The unset key variable behind a `setup` failure. */
  readonly env?: string
}

export interface ThemeRun {
  readonly id: string
  /** The one theme a focused run read; absent on a full run. */
  readonly themeId?: ThemeId
  readonly startedAt: number
  readonly finishedAt: number
  readonly promptVersion: string
  readonly scoreVersion: string
  readonly costUsd: number
  readonly gaps: readonly ThemeGap[]
  readonly notes: readonly ThemeRunNote[]
}

export interface ThemeOutcomeBatch {
  readonly resolved: number
  readonly nextCursor?: string
}

export interface ThemeReport {
  readonly themes: readonly Theme[]
  readonly run?: ThemeRun
  /** Each open theme's latest reads, whichever run they came from. */
  readonly reads: ThemeRunReads
  /** The run each open theme was last read on. */
  readonly readRuns: ReadonlyMap<ThemeId, ThemeRun>
  /** Each open theme's reads before those, for each score's change. */
  readonly previous: ThemeRunReads
  readonly scorecard: ThemeScorecard
}

export type ThemeLookupFailure =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-allowed'; readonly status: ThemeStatus }

export type ThemeTransitionOutcome = { readonly kind: 'done' } | ThemeLookupFailure

export interface ThemeRunRequest {
  readonly locale: Locale
  readonly channel: ChannelId
  /** The session the run's model calls bill to, so the command's footer states what it cost. */
  readonly billingSessionId: SessionId | null
  readonly signal: AbortSignal
  readonly progress?: ProgressReporter
  /** Re-reads this tracked theme alone and looks for no new ones; every tracked theme when absent. */
  readonly themeId?: ThemeId
}

type ThemeRunOutcome =
  | { readonly kind: 'busy' }
  | { readonly kind: 'report'; readonly report: ThemeReport }
  | ThemeLookupFailure

export interface ThemeTransitionRequest {
  readonly id: ThemeId
  readonly action: ThemeTransition
  readonly now: number
  readonly signal: AbortSignal
}

export interface ThemeService {
  run(request: ThemeRunRequest): Promise<ThemeRunOutcome>
  /** Each theme's latest stored reads; no model call. */
  show(signal: AbortSignal): Promise<ThemeReport>
  transition(request: ThemeTransitionRequest): Promise<ThemeTransitionOutcome>
  /** Measures stock reads whose horizon has passed against stored bars; no model call. */
  resolveOutcomes(options: OperationTickOptions<string>): Promise<ThemeOutcomeBatch>
}

export function isDiscoveryNote(note: ThemeRunNote): boolean {
  return note.level === 'theme' && note.themeId === undefined
}

export function themeId(raw: string): ThemeId {
  return brandFromPattern<ThemeId>(raw, THEME_ID_RE, {
    label: 'theme id',
    canonicalize: (value) => value.trim().toLowerCase(),
  })
}
