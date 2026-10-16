import type { Locale } from '@/core/types/locale'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { RenderContext } from '@/trading/render/format'
import { formatDay, t } from '@/i18n'
import { formatClock } from '@/trading/render/datetime'
import { formatCount } from '@/trading/render/format'

const ROW_INDENT = '  '
const SECTION_SEPARATOR = '\n\n'
const SOURCE_SEPARATOR = ', '
const MAX_LISTED_SOURCES = 3

/** A trailing parenthetical still holding a placeholder after `t` has filled what it was given. The
 *  window a heading names is optional by construction — a section that failed measured none — and
 *  `t` leaves an unfilled placeholder visible on purpose, so the two meet here. */
const UNFILLED_WINDOW_RE = /\s*\([^()]*\{[^()]*\}[^()]*\)/g

/** What joins parts of one line, everywhere a renderer builds a row from segments. One owner, so a
 *  board and a metric row cannot separate their pieces differently. */
export const INLINE_SEPARATOR = ' · '

/** The only indents the trading surface has. A row is 1, its detail 2, a detail's detail 3. */
export const INDENT = Object.freeze([
  '',
  ROW_INDENT,
  ROW_INDENT.repeat(2),
  ROW_INDENT.repeat(3),
] as const)

/** As many facts as the destination's line fits, joined in the order they were given and indented
 *  to the depth they belong at. One fact never splits: a fact longer than the budget takes its own
 *  line and the chat client wraps it, because splitting inside one orphans a number from the label
 *  it belongs to. */
export function toFactLines(
  facts: readonly string[],
  context: RenderContext,
  depth: number
): readonly string[] {
  const indent = INDENT[depth] ?? ''
  const lines: string[] = []
  let current = ''

  for (const fact of facts.filter((candidate) => candidate !== '')) {
    const joined = current === '' ? fact : `${current}${INLINE_SEPARATOR}${fact}`

    if (current !== '' && indent.length + joined.length > context.width) {
      lines.push(`${indent}${current}`)
      current = fact
    } else {
      current = joined
    }
  }

  return current === '' ? lines : [...lines, `${indent}${current}`]
}

/** One row's facts where a wrap continues one level deeper: at the row's own depth, a wrapped
 *  continuation reads as the next row. */
export function toRowLines(
  facts: readonly string[],
  context: RenderContext,
  depth: number
): readonly string[] {
  const [head, ...wrapped] = toFactLines(facts, context, depth)

  return head === undefined ? [] : [head, ...wrapped.map((line) => `${ROW_INDENT}${line}`)]
}

/** One blank line between entries of a list, so where one ends and the next begins reads at a
 *  glance. */
export function joinEntries(entries: readonly (readonly string[])[]): readonly string[] {
  return entries.flatMap((entry, index) => (index === 0 ? entry : ['', ...entry]))
}

export function joinSections(sections: readonly (readonly string[])[]): string {
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'))
    .join(SECTION_SEPARATOR)
}

/** The icon sits outside the emphasis, so the glyph still reads on a destination that strips
 *  markdown. The section icon stays the only glyph a title carries - no second device. */
export function renderSectionTitle(icon: string, name: string): string {
  return `${icon} **${name}**`
}

/** A heading whose window could not be filled states the heading alone. The convention every
 *  windowed title follows is that the window is a trailing parenthetical, so dropping it leaves a
 *  title that reads — `Dòng tiền khối ngoại ({sessions} phiên)` is what an unavailable section
 *  printed before this, and a window it never measured would be no better. */
export function withoutUnfilledWindow(heading: string): string {
  return heading.replace(UNFILLED_WINDOW_RE, '')
}

export function renderAsOf(locale: Locale, day: TradingDay): string {
  return ` · ${t(locale, 'trading.render.layout.asOf', { day: formatDay(locale, day) })}`
}

/** Which sources a reading came from and when they were pulled. Named sources are capped because
 *  the question is whose data this is, not an inventory. */
export function renderProvenanceLine(
  locale: Locale,
  provenance: readonly SourceProvenance[],
  timezone: string
): readonly string[] {
  if (provenance.length === 0) {
    return []
  }

  const names = [...new Set(provenance.map((entry) => entry.sourceId))]
  const listed = names.slice(0, MAX_LISTED_SOURCES).join(SOURCE_SEPARATOR)
  const fetchedAt = Math.max(...provenance.map((entry) => entry.fetchedAt))

  return [
    `${INDENT[1]}${t(locale, 'trading.render.layout.provenance', {
      sources: names.length > MAX_LISTED_SOURCES ? `${listed}…` : listed,
      at: formatClock(locale, fetchedAt, timezone),
    })}`,
  ]
}

export function renderOverflowLine(locale: Locale, count: number): string {
  return `${INDENT[1]}${t(locale, 'trading.render.layout.more', {
    count: formatCount(locale, count),
  })}`
}

export function renderEmptyLine(icon: string, message: string): string {
  return `${icon} ${message}`
}
