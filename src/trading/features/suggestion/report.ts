import type { ToolAudience } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { SuggestionDetail } from '@/trading/features/suggestion/render/debate'
import type { RenderView } from '@/trading/features/suggestion/render/view'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  ResolvedActionableSuggestion,
  StoredSuggestion,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { FactorAttribution } from '@/trading/kernel/factor'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketCosts } from '@/trading/markets/cost'
import { isAbortError } from '@/core/errors'
import { toReportResult } from '@/trading/features/suggestion/agent-view'
import {
  suggestionScoredRow,
  summarizeFactorAttribution,
} from '@/trading/features/suggestion/pipeline/attribution'
import {
  independentCalls,
  MINIMUM_TRACK_RECORD_SAMPLE,
} from '@/trading/features/suggestion/pipeline/reporting'
import { renderSuggestionText } from '@/trading/features/suggestion/render/suggestion'
import { DEFAULT_FOCUS_KEY } from '@/trading/kernel/operator/focus'
import { marketRoundTripRate, marketTradeCost } from '@/trading/markets/cost'
import { toMarkdownText, withoutFolds } from '@/trading/render/fold'
import { resolveRenderContext, TOOL_SURFACE } from '@/trading/render/format'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const AGENT_REPORT_DETAIL: SuggestionDetail = 'compact'

/** What `/suggest` and the suggestion tools read beside the run itself to write the same report. */
export interface SuggestionReportDeps extends MarketCosts {
  readonly suggestions: Pick<SuggestionService, 'summarize' | 'listResolved' | 'get'>
  readonly marketData: Pick<
    MarketDataService,
    'quoteConvention' | 'minimumRiskReward' | 'boardLot' | 'trailsStop'
  >
  readonly profiles: Pick<ProfileService, 'get'>
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
}

type ReportServices = Pick<SuggestionReportDeps, 'suggestions' | 'marketData' | 'profiles'>

/** The one place the report's inputs are assembled, so the card, `/suggest` and the tools cannot
 *  render from different ones. The services keep their own wider types. */
export function suggestionReportDeps<S extends ReportServices>(
  services: S,
  config: Pick<TradingConfig, 'costs' | 'defaultVenues' | 'displayTimezone'>
): Pick<S, keyof ReportServices> & Omit<SuggestionReportDeps, keyof ReportServices> {
  return {
    suggestions: services.suggestions,
    marketData: services.marketData,
    profiles: services.profiles,
    timezone: config.displayTimezone,
    costs: config.costs,
    defaultVenues: config.defaultVenues,
  }
}

interface ReportRequest {
  readonly result: SuggestionRunResult
  readonly detail: SuggestionDetail
  readonly locale: Locale
  /** The focus label a second opinion opens with, when the caller knows it. */
  readonly focusLabel?: string
  readonly signal: AbortSignal
}

type AgentReportRequest = Omit<ReportRequest, 'detail'> & { readonly audience: ToolAudience }

/** The report a model relays word for word: `/suggest`'s compact text in markdown, without its folds,
 *  with the holding stated as its weight and the order quantity only where the audience may see it.
 *  Short, because the model types every character of it back out; the detail stays in the fields
 *  beside it. */
export async function renderAgentReport(
  deps: SuggestionReportDeps,
  request: AgentReportRequest
): Promise<string> {
  const view = await resolveRenderView(deps, {
    ...request,
    detail: AGENT_REPORT_DETAIL,
    surface: TOOL_SURFACE,
  })

  const text = renderSuggestionText({
    ...view,
    result: toReportResult(request.result, request.audience),
    operatorFigures: 'withheld',
  })

  return toMarkdownText(withoutFolds(text))
}

/** Everything the report reads besides the result. The reads are independent, so they travel
 *  together, and each is best-effort: a line of context never takes the suggestion down with it. */
export async function resolveRenderView(
  deps: SuggestionReportDeps,
  request: ReportRequest & { readonly surface: string }
): Promise<Omit<RenderView, 'operatorFigures'>> {
  const { locale, signal } = request
  const { detail } = request
  const stored = storedOf(request.result)
  // The per-factor record prints only in the full report, and costs a query.
  const [calibration, factorAttribution, previous, entryTranchePct] = await Promise.all([
    stored === undefined ? undefined : resolveCalibration(deps.suggestions, stored, signal),
    detail === 'full' ? resolveFactorRecord(deps, signal) : undefined,
    stored === undefined ? undefined : resolvePrevious(deps.suggestions, stored, signal),
    resolveEntryTranchePct(deps.profiles, locale, signal),
  ])

  return {
    locale,
    context: resolveRenderContext(deps.timezone, request.surface),
    detail,
    ...marketConvention(deps, stored?.instrument.market),
    ...(calibration === undefined ? {} : { calibration }),
    ...(factorAttribution === undefined ? {} : { factorAttribution }),
    ...(previous === undefined ? {} : { previous }),
    ...(entryTranchePct === undefined ? {} : { entryTranchePct }),
    ...(request.focusLabel === undefined ? {} : { focusLabel: request.focusLabel }),
  }
}

/** Only the two arms that carry a stored suggestion have a row to read from. */
export function storedOf(result: SuggestionRunResult): StoredSuggestion | undefined {
  if (result.kind === 'completed') {
    return result.suggestion
  }

  return result.kind === 'cooldown' ? result.previous : undefined
}

/** Everything the render reads off the suggestion's own market, behind one guard. Empty where the
 *  run produced no stored suggestion, which is the same thing as having no market to ask about. */
function marketConvention(
  deps: SuggestionReportDeps,
  market: MarketRef | undefined
): Partial<RenderView> {
  if (market === undefined) {
    return {}
  }

  const quote = deps.marketData.quoteConvention(market)
  const minimumRiskReward = deps.marketData.minimumRiskReward(market)
  const boardLot = deps.marketData.boardLot(market)
  const cost = marketTradeCost(deps, market)

  return {
    trailsStop: deps.marketData.trailsStop(market),
    ...(quote === undefined ? {} : { quote }),
    ...(minimumRiskReward === undefined ? {} : { minimumRiskReward }),
    ...(boardLot === undefined ? {} : { boardLot }),
    ...(cost === undefined ? {} : { cost }),
  }
}

/** Reads the same window `/reflect` does, so the two surfaces cannot quote different hit rates for
 *  one band - scoped to this suggestion's strategy version, which is what makes "calls like this
 *  one" true. The reporting minimum is enforced upstream: a band under it has no `winRate`. */
async function resolveCalibration(
  suggestions: Pick<SuggestionService, 'summarize'>,
  suggestion: StoredSuggestion,
  signal: AbortSignal
): Promise<CalibrationBucket | undefined> {
  if (suggestion.action === 'hold') {
    return undefined
  }

  const report = await bestEffort(() =>
    suggestions.summarize({
      limit: SURFACE_LIMITS.maximumTrackRecordItems,
      strategyVersion: suggestion.strategyVersion,
      signal,
    })
  )

  return report?.summary.calibration.find((entry) => entry.convictionBand === suggestion.conviction)
}

/** The per-factor half of the calibration question, read only for the full report: it costs a
 *  query and prints one row per factor. Unscoped by strategy version - a factor's own reading is
 *  the same measurement across versions, and `/factors` reads the identical window. */
async function resolveFactorRecord(
  deps: SuggestionReportDeps,
  signal: AbortSignal
): Promise<readonly FactorAttribution[] | undefined> {
  const rows = await bestEffort(() =>
    deps.suggestions.listResolved({
      focusKeys: [DEFAULT_FOCUS_KEY],
      limit: SURFACE_LIMITS.maximumTrackRecordItems,
      signal,
    })
  )

  return rows === undefined
    ? undefined
    : summarizeFactorAttribution(
        independentCalls(rows).map((row) =>
          suggestionScoredRow(row, marketRoundTripRate(deps, row.instrument.market))
        ),
        MINIMUM_TRACK_RECORD_SAMPLE
      )
}

/** The latest resolved call on this name, for the line that says what the last one did. */
async function resolvePrevious(
  suggestions: Pick<SuggestionService, 'listResolved'>,
  suggestion: StoredSuggestion,
  signal: AbortSignal
): Promise<ResolvedActionableSuggestion | undefined> {
  const rows = await bestEffort(() =>
    suggestions.listResolved({
      market: suggestion.instrument.market,
      ticker: suggestion.instrument.ticker,
      focusKeys: [suggestion.focusKey],
      limit: 1,
      signal,
    })
  )

  return rows?.[0]
}

/** Absent when the profile cannot be read: the entry ladder drops and the levels stand. */
async function resolveEntryTranchePct(
  profiles: Pick<ProfileService, 'get'>,
  locale: Locale,
  signal: AbortSignal
): Promise<number | undefined> {
  const profile = await bestEffort(() => profiles.get({ defaultLocale: locale, signal }))

  return profile?.entryTranchePct
}

/** A cancel still propagates: swallowing it renders a full report into a turn already stopped. */
async function bestEffort<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return undefined
  }
}
