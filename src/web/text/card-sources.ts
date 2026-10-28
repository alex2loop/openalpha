import type { SuggestionCardWire } from '@/app/server/wire/trading'
import { isSourcesTitle } from '@/web/text/sources-title'

/** The citations a card names: the lines under its sources title, none when it has no such block. */
export function citationsOf(card: SuggestionCardWire): readonly string[] {
  const block = card.details.find(([title = '']) => isSourcesTitle(title))

  return block?.slice(1) ?? []
}
