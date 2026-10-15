import type { Locale } from '@/core/types/locale'
import type { SuggestionCard } from '@/trading/features/suggestion/render/card'
import type { SuggestionReportDeps } from '@/trading/features/suggestion/report'
import type { AgentFocusStore } from '@/trading/features/suggestion/store/agent-focus'
import type { SuggestionId } from '@/trading/features/suggestion/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import { renderSuggestionCard } from '@/trading/features/suggestion/render/card'
import { resolveRenderView, suggestionReportDeps } from '@/trading/features/suggestion/report'
import { isBookCall } from '@/trading/kernel/operator/focus'
import { renderFocusLabel } from '@/trading/render/focus'
import { NOTICE_SURFACE } from '@/trading/render/format'

export interface SuggestionCards {
  card(request: {
    readonly suggestionId: SuggestionId
    readonly locale: Locale
    readonly signal: AbortSignal
  }): Promise<SuggestionCard | null>
}

function createSuggestionCards(
  deps: SuggestionReportDeps,
  agentFocuses: AgentFocusStore
): SuggestionCards {
  return {
    card: async (request) => {
      const stored = await deps.suggestions.get(request.suggestionId, request.signal)

      if (stored === null) {
        return null
      }

      const focusLabel = isBookCall(stored)
        ? undefined
        : await focusLabelOf(agentFocuses, stored.focusKey, request)
      const view = await resolveRenderView(deps, {
        result: { kind: 'completed', suggestion: stored, reused: true },
        detail: 'compact',
        locale: request.locale,
        signal: request.signal,
        surface: NOTICE_SURFACE,
        ...(focusLabel === undefined ? {} : { focusLabel }),
      })

      return renderSuggestionCard({ ...view, operatorFigures: 'shown' }, stored)
    },
  }
}

/** The words for the focus a second opinion was made under, from the focuses agents have used. A key
 *  no agent has left behind has none, and the card then says "another focus". */
async function focusLabelOf(
  agentFocuses: AgentFocusStore,
  focusKey: FocusKey,
  request: { readonly locale: Locale; readonly signal: AbortSignal }
): Promise<string | undefined> {
  const records = await agentFocuses.listAll(request.signal)
  const record = records.find((entry) => entry.focusKey === focusKey)

  return record === undefined ? undefined : renderFocusLabel(request.locale, record.focus)
}

/** The card service over a built aggregate; the one line registration adds. */
export function buildSuggestionCards(
  services: Pick<SuggestionReportDeps, 'suggestions' | 'marketData' | 'profiles'>,
  config: Pick<TradingConfig, 'costs' | 'defaultVenues' | 'displayTimezone'>,
  stores: Pick<TradingStores, 'agentFocuses'>
): SuggestionCards {
  return createSuggestionCards(suggestionReportDeps(services, config), stores.agentFocuses)
}
