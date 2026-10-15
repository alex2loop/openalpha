import type { Locale } from '@/core/types/locale'
import type { SuggestionDetail } from '@/trading/features/suggestion/render/debate'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import { t } from '@/i18n'
import { shownProse, stripStance } from '@/trading/features/suggestion/render/debate'
import { SECTION_ICONS } from '@/trading/render/format'
import { INDENT, renderSectionTitle } from '@/trading/render/layout'

/** What the claim list needs of the view: whose locale, and how much of the debate is printed
 *  beside it - a claim already on the page is not restated as unverified. */
interface ClaimsView {
  readonly locale: Locale
  readonly detail: SuggestionDetail
}

export function renderUnsupportedClaims(
  view: ClaimsView,
  suggestion: StoredSuggestion
): readonly string[] {
  const claims = suggestion.action === 'hold' ? suggestion.unsupportedClaims : undefined

  if (claims === undefined || claims.length === 0) {
    return []
  }

  const printed =
    suggestion.debate === undefined ? new Set<string>() : shownProse(suggestion.debate, view.detail)

  // The conclusion block prints the thesis whole, so a claim it carries is already on the page.
  if (suggestion.thesis !== undefined) {
    printed.add(stripStance(suggestion.thesis))
  }

  const listed = claims.map(stripStance).filter((claim) => !printed.has(claim))

  if (listed.length === 0) {
    return []
  }

  return [
    renderSectionTitle(
      SECTION_ICONS.unverified,
      t(view.locale, 'trading.render.suggestion.unsupportedClaims')
    ),
    ...listed.map((claim) => `${INDENT[1]}${claim}`),
  ]
}

/** The same claims as a set, for the thesis renderer to mark the lines it prints. */
export function unsupportedSet(suggestion: StoredSuggestion): ReadonlySet<string> {
  const claims = suggestion.action === 'hold' ? (suggestion.unsupportedClaims ?? []) : []

  return new Set(claims.map(stripStance))
}
