import type { Locale } from '@/core/types/locale'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import { formatDay, t } from '@/i18n'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatInstant, isTradingDayText } from '@/trading/render/datetime'
import { withoutUnfilledWindow } from '@/trading/render/layout'

/** The one section whose heading changes when it fails, and the caveat that would then claim a kept
 *  number the section does not show. */
const QUOTES_KIND = 'market-quotes'
const STALE_CACHE_CODE = 'source.stale-cache'

/** A section's heading apart from its rows, for a surface that folds the rows away. */
export interface BriefSectionText {
  readonly heading: string
  readonly lines: readonly string[]
}

/** A market whose prices did not come back says so in its heading, so no reader mistakes the
 *  missing block for a quiet one; its lines drop the sentence about a number held from before,
 *  because the section shows none. */
export function toUnavailableText(
  locale: Locale,
  section: Exclude<BriefSectionResult, { readonly status: 'ready' }>,
  timezone: string
): BriefSectionText {
  const isQuotes = section.kind === QUOTES_KIND
  const caveats = isQuotes
    ? section.caveats.filter((caveat) => caveat.code !== STALE_CACHE_CODE)
    : section.caveats

  return {
    heading: isQuotes
      ? t(locale, 'trading.brief.quotesUnavailable')
      : renderSectionHeading(locale, section, timezone),
    lines: renderCaveatLines(locale, caveats),
  }
}

/** One owner for what a section is called, so a surface that renders a section's rows its own way
 *  still names it the way every other surface does. */
export function renderSectionHeading(
  locale: Locale,
  section: BriefSectionResult,
  timezone: string
): string {
  return withoutUnfilledWindow(
    t(
      locale,
      `trading.brief.section.${section.kind}` as const,
      titleParamsOf(section, locale, timezone)
    )
  )
}

/** The title params a builder cannot resolve: an instant reads in the operator's locale and clock,
 *  and a trading day reads day-first in both — only this renderer holds either. Every day-valued
 *  param is converted, not a named few, or the next title to carry one prints its ISO form. */
function titleParamsOf(
  section: BriefSectionResult,
  locale: Locale,
  timezone: string
): Readonly<Record<string, string | number>> | undefined {
  const params = section.status === 'ready' ? section.titleParams : undefined

  if (params === undefined) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(params).map((entry) => [entry[0], titleParam(locale, entry, timezone)])
  )
}

function titleParam(
  locale: Locale,
  [name, value]: readonly [string, string | number],
  timezone: string
): string | number {
  if (name === 'observedAt' && typeof value === 'number') {
    return formatInstant(locale, value, timezone)
  }

  return typeof value === 'string' && isTradingDayText(value) ? formatDay(locale, value) : value
}
