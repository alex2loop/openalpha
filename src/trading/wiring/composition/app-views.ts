import type { CommandMessage } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { EpochRange } from '@/core/utils/time'
import type { BriefDelivery, BriefService, BriefSnapshot } from '@/trading/features/brief/types'
import type {
  MarketDataService,
  ScreenForm,
  ScreenView,
} from '@/trading/features/market-data/types'
import type { LeanCall } from '@/trading/features/suggestion/store/suggestion-lean'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { ModelRecord } from '@/trading/features/suggestion/track-record/model-record'
import type { TrackRecordReflection } from '@/trading/features/suggestion/track-record/reflect'
import type {
  Theme,
  ThemeId,
  ThemeService,
  ThemeTransition,
  ThemeTransitionOutcome,
} from '@/trading/features/themes/types'
import type {
  InstrumentKind,
  MarketRef,
  PriceDisplay,
  Region,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { TradingEdition } from '@/trading/wiring/composition/edition'
import type { ScreenAnswer } from '@/trading/wiring/host/view-types'
import { t } from '@/i18n'
import { type BriefText, renderBriefForSurface } from '@/trading/features/brief/surface'
import { FIRST_LOAD_PENDING } from '@/trading/features/market-data/ops/ensure'
import { renderMacroLean } from '@/trading/features/market-data/render/overview'
import { renderScreenCard } from '@/trading/features/market-data/render/screen'
import { BOARD_READING } from '@/trading/features/market-data/render/screen-evidence'
import { boardFacts, missingFactorLabels } from '@/trading/features/market-data/render/screen-facts'
import {
  type ReflectText,
  renderReflectForSurface,
} from '@/trading/features/suggestion/track-record/surface'
import { toThemeTransitionMessage } from '@/trading/features/themes/command'
import { renderThemeReportText } from '@/trading/features/themes/render/report'
import { CLOSED_THEME_STATUSES } from '@/trading/features/themes/types'
import { NOTICE_SURFACE, renderDeclaredValue, resolveRenderContext } from '@/trading/render/format'
import { renderMetricLine } from '@/trading/render/metric'

/** A kind filter needs at least two kinds to choose between. */
const MINIMUM_CHOICES = 2

interface AppViewDeps {
  readonly briefs: Pick<BriefService, 'getLatest' | 'reschedule' | 'hasOnDay'>
  readonly marketData: Pick<
    MarketDataService,
    'macroRisk' | 'quoteConvention' | 'screen' | 'screenableKinds'
  >
  readonly suggestions: Pick<SuggestionService, 'reflect' | 'modelRecords' | 'dayDigest'>
  readonly themes: Pick<ThemeService, 'show' | 'transition'>
  readonly timezone: string
  /** How a screen answers on this edition; absent is the ranked board. */
  readonly screenForm?: ScreenForm
  /** The brief's caveats in their plain form, for an edition that makes no call. */
  readonly plainCaveats?: true
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
  readonly closed: readonly LeanCall[]
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
  /** The board read and the lines the CLI prints for it, in the form this edition answers. */
  screen(request: {
    readonly market: MarketRef
    readonly instrumentKind?: InstrumentKind
    readonly limit: number
    readonly now: number
    readonly signal: AbortSignal
    readonly locale: Locale
  }): Promise<ScreenAnswer>
  themes(request: { readonly locale: Locale; readonly signal: AbortSignal }): Promise<ThemesView>
  changeTheme(request: {
    readonly themeId: ThemeId
    readonly transition: ThemeTransition
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<ThemeChangeView>
}

async function screen(
  deps: AppViewDeps,
  request: Parameters<AppViews['screen']>[0]
): Promise<ScreenAnswer> {
  const { market, instrumentKind, limit, now, signal, locale } = request
  const kindOption = instrumentKind === undefined ? {} : { instrumentKind }
  const view = await deps.marketData.screen({
    market,
    limit,
    now,
    signal,
    ...kindOption,
    ...(deps.screenForm === undefined ? {} : { form: deps.screenForm }),
  })
  const display = deps.marketData.quoteConvention(market)?.display
  const card = renderScreenCard(
    locale,
    {
      market,
      context: resolveRenderContext(deps.timezone, NOTICE_SURFACE),
      ...(display === undefined ? {} : { display }),
      ...kindOption,
    },
    view
  )

  const kinds = screenKindsOf(deps, { market, locale })

  const named = {
    view,
    card,
    ...kinds,
    nameFacts: nameFacts(view, locale, display),
    ...(view.caveats.some(({ code }) => code === FIRST_LOAD_PENDING.code)
      ? { isLoading: true as const }
      : {}),
  }

  return view.form === 'board'
    ? {
        ...named,
        factorLabels: factorLabels(view, locale),
        factorReadings: factorReadings(view, locale, display),
        nameReadings: nameReadings(view, locale, display),
      }
    : named
}

/** The kinds a market's screen can be narrowed to, where it holds more than one: a market with a
 *  single kind has nothing to choose. */
function screenKindsOf(
  deps: AppViewDeps,
  request: Pick<Parameters<AppViews['screen']>[0], 'market' | 'locale'>
): Pick<ScreenAnswer, 'kinds'> {
  const kinds = deps.marketData.screenableKinds().get(request.market) ?? []

  return kinds.length < MINIMUM_CHOICES
    ? {}
    : {
        kinds: kinds.map((kind) => ({
          kind,
          label: renderDeclaredValue(request.locale, `trading.instrument-kind.${kind}`),
        })),
      }
}

/** What each name reads on the board and what it lacks, as the CLI's board lists them: the one
 *  source of the page's grid and of the text. */
function nameFacts(
  view: ScreenView,
  locale: Locale,
  display: PriceDisplay | undefined
): NonNullable<ScreenAnswer['nameFacts']> {
  return Object.fromEntries(
    view.candidates.map((candidate) => [
      candidate.instrument.ticker,
      {
        facts: boardFacts(locale, candidate, { display }),
        missing: missingFactorLabels(locale, candidate),
      },
    ])
  )
}

/** What each name's market states beside its factors, as the CLI's own board rows word them. */
function nameReadings(
  view: ScreenView,
  locale: Locale,
  display: PriceDisplay | undefined
): NonNullable<ScreenAnswer['nameReadings']> {
  const quote = display === undefined ? {} : { quote: { display } }

  return Object.fromEntries(
    view.candidates.flatMap(({ instrument, readings }) =>
      readings === undefined
        ? []
        : [
            [
              instrument.ticker,
              readings.map((reading) => ({
                id: reading.id,
                ...(reading.sessions === undefined ? {} : { sessions: reading.sessions }),
                value: reading.value,
                text: renderMetricLine(locale, [reading], { ...BOARD_READING, ...quote }) ?? '',
              })),
            ] as const,
          ]
    )
  )
}

/** What each name's factors read in the quantities they were scored on, as the CLI's board rows
 *  write them; a factor that states none is left out. */
function factorReadings(
  view: ScreenView,
  locale: Locale,
  display: PriceDisplay | undefined
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  return Object.fromEntries(
    view.candidates.map((candidate) => [
      candidate.instrument.ticker,
      Object.fromEntries(
        candidate.factors.flatMap((factor) => {
          const reading = renderMetricLine(locale, factor.metrics, {
            ...BOARD_READING,
            ...(display === undefined ? {} : { quote: { display } }),
          })

          return reading === undefined ? [] : [[factor.id, reading] as const]
        })
      ),
    ])
  )
}

/** Each factor a board's names read, named for the operator, so the app never owns a catalog key. */
function factorLabels(view: ScreenView, locale: Locale): Readonly<Record<string, string>> {
  const ids = new Set(view.candidates.flatMap((candidate) => candidate.factors.map(({ id }) => id)))

  return Object.fromEntries(
    [...ids].map((id) => [id, renderDeclaredValue(locale, `trading.factor.${id}`)])
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
  config: { readonly displayTimezone: string },
  edition?: Pick<TradingEdition, 'screen' | 'readingsOnly'>
): AppViews {
  const deps: AppViewDeps = {
    ...services,
    timezone: config.displayTimezone,
    ...(edition?.screen === undefined ? {} : { screenForm: edition.screen }),
    ...(edition?.readingsOnly === true ? { plainCaveats: true as const } : {}),
  }

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
          snapshot === null
            ? null
            : renderBriefForSurface(request.locale, snapshot, {
                timezone: deps.timezone,
                ...(deps.plainCaveats === true ? { plain: true as const } : {}),
              }),
      }
    },
    macro: (request) => macro(deps, request),
    trackRecord: (request) => trackRecord(deps, request),
    dayDigest: (request) => dayDigest(deps, request),
    screen: (request) => screen(deps, request),
    themes: (request) => themes(deps, request),
    changeTheme: (request) => changeTheme(deps, request),
  }
}
