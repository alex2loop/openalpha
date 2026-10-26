import { translateDisplayText } from '@/i18n'
import { locale } from '@/web/state/session'

/** A venue's name; one only the operator's config names has no catalog entry and prints its id in
 *  capitals, as the CLI does. */
export function toVenueName(venue: string): string {
  return translateDisplayText(locale.value, {
    key: `trading.venue.${venue}`,
    fallback: venue.toUpperCase(),
  })
}
