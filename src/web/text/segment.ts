import { translateDisplayText } from '@/i18n'
import { locale } from '@/web/state/session'

/** A segment (nhóm) in the page's language; a slug the catalog does not know prints as it is. */
export function segmentName(segment: string): string {
  return translateDisplayText(locale.value, {
    key: `trading.segment.${segment}`,
    fallback: segment,
  })
}

/** A sector by its slug, in the page's language; one the catalog does not know prints as it is. */
export function sectorName(sector: string): string {
  return translateDisplayText(locale.value, { key: `trading.sector.${sector}`, fallback: sector })
}
