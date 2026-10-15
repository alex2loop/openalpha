import type { Locale } from '@/core/types/locale'
import type { BriefDelivery, BriefService, BriefSnapshot } from '@/trading/features/brief/types'
import type { ScreenCard } from '@/trading/features/market-data/render/screen'
import type { MarketDataService, ScreenView } from '@/trading/features/market-data/types'
import type {
  SuggestionService,
  TrackRecordReflection,
} from '@/trading/features/suggestion/suggestion'
import type { InstrumentKind, MarketRef, Region } from '@/trading/kernel/instrument'
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
import { NOTICE_SURFACE, renderDeclaredValue, resolveRenderContext } from '@/trading/render/format'

interface AppViewDeps {
  readonly briefs: Pick<BriefService, 'getLatest' | 'reschedule'>
  readonly marketData: Pick<MarketDataService, 'macroRisk' | 'quoteConvention'>
  readonly suggestions: Pick<SuggestionService, 'reflect'>
  readonly timezone: string
}

/** What the host serves an app beside the data: the CLI's own lines for it, written in the operator's
 *  language by the functions the commands print with, so an app and a chat cannot say it differently. */
/** The outcome of moving the brief's send time, with a refusal's reason already in words. */
export type BriefRescheduleView =
  | { readonly kind: 'rescheduled'; readonly delivery: BriefDelivery }
  | { readonly kind: 'rejected'; readonly reason: string; readonly message: string }

export interface AppViews {
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
    /** Each driver's name in the operator's language, keyed by driver id. */
    readonly labels: Readonly<Record<string, string>>
  }>
  trackRecord(request: {
    readonly limit: number
    readonly locale: Locale
    readonly signal: AbortSignal
  }): Promise<{ readonly reflection: TrackRecordReflection; readonly text: ReflectText }>
  screen(request: {
    readonly market: MarketRef
    readonly instrumentKind?: InstrumentKind
    readonly view: ScreenView
    readonly locale: Locale
  }): ScreenCard
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

export function buildAppViews(
  services: Pick<AppViewDeps, 'briefs' | 'marketData' | 'suggestions'>,
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
    macro: async (request) => {
      const result = await deps.marketData.macroRisk({
        region: request.region,
        now: request.now,
        signal: request.signal,
      })
      const lean = renderMacroLean(request.locale, result)
      const labels = Object.fromEntries(
        (result.kind === 'available' ? result.value.drivers : []).map((driver) => [
          driver.id,
          renderDeclaredValue(request.locale, `trading.macro.series.${driver.id}`),
        ])
      )

      return lean === undefined ? { result, labels } : { result, lean, labels }
    },
    trackRecord: async (request) => {
      const reflection = await deps.suggestions.reflect({
        limit: request.limit,
        signal: request.signal,
      })

      return { reflection, text: renderReflectForSurface(request.locale, reflection) }
    },
    screen: (request) => screenCard(deps, request),
  }
}
