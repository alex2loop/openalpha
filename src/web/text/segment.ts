import { translateDisplayText } from '@/i18n'
import { locale } from '@/web/state/session'

/** A segment (nhóm) in the page's language; a slug the catalog does not know prints as it is. */
export function segmentName(segment: string): string {
  return translateDisplayText(locale.value, {
    key: `trading.segment.${segment}`,
    fallback: segment,
  })
}
