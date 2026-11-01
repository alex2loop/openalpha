import type { CommandMessage } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { EpochRange } from '@/core/utils/time'
import type { BriefDelivery, BriefService, BriefSnapshot } from '@/trading/features/brief/types'
import type { ScreenCard } from '@/trading/features/market-data/render/screen'
import type { MarketDataService, ScreenView } from '@/trading/features/market-data/types'
import type { FocusCall } from '@/trading/features/suggestion/store/suggestion-outcome'
import type {
  SuggestionService,
  TrackRecordReflection,
} from '@/trading/features/suggestion/suggestion'
import type { ModelRecord } from '@/trading/features/suggestion/track-record/model-record'
import type {
  Theme,
  ThemeId,
  ThemeService,
  ThemeTransition,
  ThemeTransitionOutcome,
} from '@/trading/features/themes/types'
import type { InstrumentKind, MarketRef, Region, TradingDay } from '@/trading/kernel/instrument'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { t } from '@/i18n'
import { type BriefText, renderBriefForSurface } from '@/trading/features/brief/surface'
import { renderMacroLean } from '@/trading/features/market-data/render/overview'
import { renderScreenCard } from '@/trading/features/market-data/render/screen'
import {
  type ReflectText,
  renderReflectForSurface,
} from '@/trading/features/suggestion/track-record/surface'
import { toThemeTransitionMessage } from '@/trading/features/themes/command'
import { renderThemeReportText } from '@/trading/features/themes/render/report'
import { CLOSED_THEME_STATUSES } from '@/trading/features/themes/types'
import { NOTICE_SURFACE, renderDeclaredValue, resolveRenderContext } from '@/trading/render/format'

interface AppViewDeps {
  readonly briefs: Pick<BriefService, 'getLatest' | 'reschedule' | 'hasOnDay'>
  readonly marketData: Pick<MarketDataService, 'macroRisk' | 'quoteConvention'>
  readonly suggestions: Pick<SuggestionService, 'reflect' | 'modelRecords' | 'dayDigest'>
  readonly themes: Pick<ThemeService, 'show' | 'transition'>
  readonly timezone: string
}

/** What the host serves an app beside the data: the CLI's own lines for it, written in the operator's
 *  language by the functions the commands print with, so an app and a chat cannot say it differently. */
/** The outcome of moving the brief's send time, with a refusal's reason already in words. */
export type BriefRescheduleView =
  | { readonly kind: 'rescheduled'; readonly delivery: BriefDelivery }
  | { readonly kind: 'rejected'; readonly reason: string; readonly message: string }

/** The themes the operator has not closed, and `/themes show`'s text for them. */
export interface ThemesView {
  readonly themes: readonly Theme[]
  readonly text: string
}

/** A theme move's outcome with `/themes`'s message for it, for the command renderer to word. */
export interface ThemeChangeView {
  readonly kind: ThemeTransitionOutcome['kind']
  readonly message: CommandMessage
}

/** What one operator day added to the book, counted where each thing is stored. */
export interface DayDigestView {
  readonly suggestionCount: number
  readonly hasBrief: boolean
  /** The scored calls that closed that day with the largest move. */
  readonly closed: readonly FocusCall[]
}

export interface AppViews {
  dayDigest(request: {
    readonly day: TradingDay
    readonly range: EpochRange
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<DayDigestView>
  rescheduleBrief(request: {
    readonly sendTime: string
    readonly locale: Locale
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<BriefRescheduleView>
  brief(request: {
    readonly region: Region
    readonly locale: Locale
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<{ readonly snapshot: BriefSnapshot | null; readonly text: BriefText | null }>
  macro(request: {
    readonly region: Region
    readonly locale: Locale
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<{
    readonly result: SourceResult<MacroRiskView>
    readonly lean?: string
    /** Each driver's name in the operator's language, keyed by driver id, missing ones too. */
    readonly labels: Readonly<Record<string, string>>
  }>
  trackRecord(request: {
    readonly limit: number
    readonly locale: Locale
    readonly signal: AbortSignal
  }): Promise<{
    readonly reflection: TrackRecordReflection
    readonly text: ReflectText
    readonly byModel: readonly ModelRecord[]
  }>
  screen(request: {
    readonly market: MarketRef
    readonly instrumentKind?: InstrumentKind
    readonly view: ScreenView
    readonly locale: Locale
  }): ScreenCard
  themes(request: { readonly locale: Locale; readonly signal: AbortSignal }): Promise<ThemesView>
  changeTheme(request: {
    readonly themeId: ThemeId
    readonly transition: ThemeTransition
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<ThemeChangeView>
}

function screenCard(deps: AppViewDeps, request: Parameters<AppViews['screen']>[0]): ScreenCard {
  const display = deps.marketData.quoteConvention(request.market)?.display

  return renderScreenCard(
    request.locale,
    {
      market: request.market,
      context: resolveRenderContext(deps.timezone, NOTICE_SURFACE),
      ...(display === undefined ? {} : { display }),
      ...(request.instrumentKind === undefined ? {} : { instrumentKind: request.instrumentKind }),
    },
    request.view
  )
}

async function macro(
  deps: AppViewDeps,
  request: Parameters<AppViews['macro']>[0]
): ReturnType<AppViews['macro']> {
  const result = await deps.marketData.macroRisk({
    region: request.region,
    now: request.now,
    signal: request.signal,
  })
  const lean = renderMacroLean(request.locale, result)
  const named =
    result.kind === 'available' ? [...result.value.drivers, ...result.value.missing] : []
  const labels = Object.fromEntries(
    named.map((driver) => [
      driver.id,
      renderDeclaredValue(request.locale, `trading.macro.series.${driver.id}`),
    ])
  )

  return lean === undefined ? { result, labels } : { result, lean, labels }
}

async function themes(
  deps: AppViewDeps,
  request: Parameters<AppViews['themes']>[0]
): Promise<ThemesView> {
  const report = await deps.themes.show(request.signal)

  return {
    themes: report.themes.filter((theme) => !CLOSED_THEME_STATUSES.includes(theme.status)),
    text: renderThemeReportText(report, { locale: request.locale, timezone: deps.timezone }),
  }
}

async function changeTheme(
  deps: AppViewDeps,
  request: Parameters<AppViews['changeTheme']>[0]
): Promise<ThemeChangeView> {
  const move = { action: request.transition, id: request.themeId }
  const outcome = await deps.themes.transition({
    ...move,
    now: request.now,
    signal: request.signal,
  })

  return { kind: outcome.kind, message: toThemeTransitionMessage(move, outcome) }
}

async function trackRecord(
  deps: AppViewDeps,
  request: Parameters<AppViews['trackRecord']>[0]
): ReturnType<AppViews['trackRecord']> {
  const [reflection, byModel] = await Promise.all([
    deps.suggestions.reflect({ limit: request.limit, signal: request.signal }),
    deps.suggestions.modelRecords(request.signal),
  ])

  return { reflection, text: renderReflectForSurface(request.locale, reflection), byModel }
}

async function dayDigest(
  deps: AppViewDeps,
  request: Parameters<AppViews['dayDigest']>[0]
): Promise<DayDigestView> {
  const { day, range, limit, signal } = request
  const [calls, hasBrief] = await Promise.all([
    deps.suggestions.dayDigest({ range, limit, signal }),
    deps.briefs.hasOnDay(day, signal),
  ])

  return { suggestionCount: calls.callCount, hasBrief, closed: calls.closed }
}

export function buildAppViews(
  services: Pick<AppViewDeps, 'briefs' | 'marketData' | 'suggestions' | 'themes'>,
  config: { readonly displayTimezone: string }
): AppViews {
  const deps: AppViewDeps = { ...services, timezone: config.displayTimezone }

  return {
    rescheduleBrief: async (request) => {
      const result = await deps.briefs.reschedule(request)

      return result.kind === 'rescheduled'
        ? result
        : {
            kind: 'rejected',
            reason: result.reason,
            message: t(request.locale, `trading.enable.brief.${result.reason}`),
          }
    },
    brief: async (request) => {
      const snapshot = await deps.briefs.getLatest(request)

      return {
        snapshot,
        text:
          snapshot === null ? null : renderBriefForSurface(request.locale, snapshot, deps.timezone),
      }
    },
    macro: (request) => macro(deps, request),
    trackRecord: (request) => trackRecord(deps, request),
    dayDigest: (request) => dayDigest(deps, request),
    screen: (request) => screenCard(deps, request),
    themes: (request) => themes(deps, request),
    changeTheme: (request) => changeTheme(deps, request),
  }
}
