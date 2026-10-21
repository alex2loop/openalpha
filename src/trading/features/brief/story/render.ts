import type { Locale } from '@/core/types/locale'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { StoryRole } from '@/trading/kernel/operator/brief-story'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import {
  FIRST_RUN_SESSION,
  fromRunKey,
  STORY_CODES,
  STORY_ROLES,
  THESIS_STATUSES,
  toRunKey,
  WATCH_EFFECTS,
  WATCH_FIELDS,
  WATCH_MARKS,
  WATCH_SHAPES,
} from '@/trading/kernel/operator/brief-story'
import {
  EFFECT_ARROW,
  formatCount,
  SECTION_ICONS,
  WATCH_MARK_GLYPHS,
} from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  renderAsOf,
  renderEmptyLine,
  renderProvenanceLine,
} from '@/trading/render/layout'
import { renderBlockRule, renderLabelledRow } from '@/trading/render/section'
import { renderValue } from '@/trading/render/section-values'

type ReadySection = Extract<BriefSectionResult, { readonly status: 'ready' }>

interface StoryView {
  readonly locale: Locale
  readonly section: ReadySection
  readonly context: RenderContext
}

/** The review of earlier stories, one block each, then today's story or the quiet line. Every
 *  sentence is a catalog key chosen by a stored code; every number reaches it through a formatter. */
export function renderStoryBlocks(
  locale: Locale,
  sections: readonly BriefSectionResult[],
  context: RenderContext
): readonly (readonly string[])[] {
  const story = readyOf(sections, 'story')
  const reviews = sections.flatMap((section) =>
    section.kind === 'thesis-review' && section.status === 'ready' ? [section] : []
  )
  const reviewed = new Set(reviews.flatMap(reviewedRunKey))

  return [
    ...reviews.map((section) => renderThesis({ locale, section, context })),
    ...(story === undefined ? [] : [renderStory({ locale, section: story, context }, reviewed)]),
  ]
}

function reviewedRunKey(section: ReadySection): readonly string[] {
  const [head] = section.rows
  const code = memberOf(STORY_CODES, head?.story)

  if (code === undefined) {
    return []
  }

  return [toRunKey(code, typeof head?.sector === 'string' ? head.sector : undefined)]
}

function readyOf(sections: readonly BriefSectionResult[], kind: 'story'): ReadySection | undefined {
  for (const section of sections) {
    if (section.kind === kind && section.status === 'ready') {
      return section
    }
  }

  return undefined
}

/** One tracked story: its head row, then one row per watch. */
function renderThesis(view: StoryView): readonly string[] {
  const { locale } = view
  const [head, ...watches] = view.section.rows
  const code = memberOf(STORY_CODES, head?.story)
  const status = memberOf(THESIS_STATUSES, head?.thesisStatus)

  if (head === undefined || code === undefined || status === undefined) {
    return []
  }

  const met = watches.filter((row) => row.mark === 'met').length
  const summary = [
    t(locale, `trading.brief.story.title.${code}`, { sector: sectorOf(locale, [head]) }),
    t(locale, `trading.brief.thesis.status.${status}`),
    t(locale, 'trading.brief.thesis.progress', {
      met: formatCount(locale, met),
      total: formatCount(locale, watches.length),
    }),
  ]

  return [
    renderBlockRule(SECTION_ICONS.thesisReview, t(locale, 'trading.brief.section.thesis-review')),
    `${INDENT[1]}${summary.join(INLINE_SEPARATOR)}`,
    ...(typeof head.sessions === 'number'
      ? [
          `${INDENT[1]}${t(locale, 'trading.brief.thesis.run', {
            count: formatCount(locale, head.sessions),
          })}`,
        ]
      : []),
    ...watches.flatMap((row) => renderReviewWatch(view, row)),
  ]
}

function renderReviewWatch(view: StoryView, row: BriefSectionRow): readonly string[] {
  const mark = memberOf(WATCH_MARKS, row.mark)
  const sentence = renderWatch(view, row)

  return mark === undefined || sentence === undefined
    ? []
    : [`${INDENT[2]}${WATCH_MARK_GLYPHS[mark]} ${sentence}`]
}

function renderStory(view: StoryView, reviewed: ReadonlySet<string>): readonly string[] {
  const { locale, section } = view
  const [head] = section.rows
  const code = memberOf(STORY_CODES, head?.story)

  if (code === undefined) {
    const line = noNewStoryLine(locale, section.rows, reviewed)

    return line === undefined ? [] : [renderEmptyLine(SECTION_ICONS.story, line)]
  }

  const facts = section.rows.flatMap((row) => factOf(row))
  const params = {
    sector: sectorOf(
      locale,
      facts.map((fact) => fact.row)
    ),
    sessions: countOf(
      locale,
      facts.map((fact) => fact.row.sessions).find((value) => value !== undefined)
    ),
  }

  return [
    renderBlockRule(SECTION_ICONS.story, t(locale, 'trading.brief.section.story')),
    `${INDENT[1]}${t(locale, `trading.brief.story.hook.${code}`, params)}`,
    ...labelled(view, 'facts', factLines(view, facts, 'supports')),
    ...renderSession(view),
    ...labelled(view, 'insight', [
      `${INDENT[2]}${t(locale, `trading.brief.story.insight.${code}`, params)}`,
    ]),
    ...labelled(view, 'counterpoint', [
      `${INDENT[2]}${t(locale, `trading.brief.story.counterpoint.${code}`, params)}`,
      ...factLines(view, facts, 'contradicts'),
    ]),
    ...labelled(
      view,
      'watch',
      section.rows.flatMap((row) => renderStoryWatch(view, row))
    ),
  ]
}

/** No new story. Quiet only when nothing fired at all. A told run still going on is named, with its
 *  length once it has outlived the session it was told, unless the review above already carries it,
 *  in which case nothing more is said. */
function noNewStoryLine(
  locale: Locale,
  rows: readonly BriefSectionRow[],
  reviewed: ReadonlySet<string>
): string | undefined {
  const runs = rows.filter((row) => typeof row.runKey === 'string')

  if (runs.length === 0) {
    return t(locale, 'trading.brief.story.quiet')
  }

  const ongoing = runs
    .filter((row) => typeof row.runKey === 'string' && !reviewed.has(row.runKey))
    .flatMap((row) => ongoingTitle(locale, row))

  return ongoing.length === 0
    ? undefined
    : t(locale, 'trading.brief.story.continuing', { stories: ongoing.join(INLINE_SEPARATOR) })
}

function ongoingTitle(locale: Locale, row: BriefSectionRow): readonly string[] {
  const { runKey, sessions } = row
  const run = typeof runKey === 'string' ? fromRunKey(runKey) : undefined

  if (run === undefined) {
    return []
  }

  const title = t(locale, `trading.brief.story.title.${run.code}`, {
    sector: sectorOf(locale, run.sector === undefined ? [] : [{ sector: run.sector }]),
  })

  return typeof sessions === 'number' && sessions > FIRST_RUN_SESSION
    ? [t(locale, 'trading.brief.story.ongoing', { title, count: formatCount(locale, sessions) })]
    : [title]
}

function labelled(
  view: StoryView,
  label: 'facts' | 'insight' | 'counterpoint' | 'watch',
  lines: readonly string[]
): readonly string[] {
  return lines.length === 0
    ? []
    : [`${INDENT[1]}${t(view.locale, `trading.brief.story.label.${label}`)}`, ...lines]
}

interface FactRow {
  readonly row: BriefSectionRow
  readonly role: StoryRole
}

function factOf(row: BriefSectionRow): readonly FactRow[] {
  const role = memberOf(STORY_ROLES, row.storyRole)

  return role === undefined ? [] : [{ row, role }]
}

function factLines(view: StoryView, facts: readonly FactRow[], role: StoryRole): readonly string[] {
  const unit = view.section.currency === undefined ? {} : { currency: view.section.currency }

  // A figure under the counterpoint argues against the reading, so it says so before the number.
  const lead =
    role === 'contradicts' ? `${t(view.locale, 'trading.brief.story.label.contradicting')} ` : ''

  return facts
    .filter((fact) => fact.role === role)
    .map((fact) => `${INDENT[2]}${lead}${renderLabelledRow(view.locale, fact.row, unit)}`)
}

/** Where the numbers come from and which session they describe, once for the whole story. */
function renderSession(view: StoryView): readonly string[] {
  const { locale, section, context } = view
  const [line] = renderProvenanceLine(locale, section.provenance, context.timezone)

  return line === undefined || section.asOf === undefined
    ? []
    : [`${line}${renderAsOf(locale, section.asOf)}`]
}

function renderStoryWatch(view: StoryView, row: BriefSectionRow): readonly string[] {
  const sentence = renderWatch(view, row)

  return sentence === undefined ? [] : [`${INDENT[2]}${sentence}`]
}

/** The watch's sentence and what reaching it would mean. The threshold prints in its metric's own
 *  unit, taken from the field the shape reads. */
function renderWatch(view: StoryView, row: BriefSectionRow): string | undefined {
  const { locale, section } = view
  const shape = memberOf(WATCH_SHAPES, row.watch)
  const effect = memberOf(WATCH_EFFECTS, row.effect)

  if (shape === undefined || effect === undefined || typeof row.threshold !== 'number') {
    return undefined
  }

  const unit = section.currency === undefined ? {} : { currency: section.currency }
  const sentence = t(locale, `trading.brief.story.watch.${shape}`, {
    value: renderValue(locale, [WATCH_FIELDS[shape], row.threshold], unit),
    sessions: countOf(locale, row.sessions),
    sector: sectorOf(locale, [row]),
  })

  return `${sentence} ${EFFECT_ARROW} ${t(locale, `trading.brief.story.effect.${effect}`)}`
}

/** A sector reads the way every other section prints it. Empty for a story that is not about one. */
function sectorOf(locale: Locale, rows: readonly BriefSectionRow[]): string {
  const sector = rows.map((row) => row.sector).find((value) => typeof value === 'string')

  return sector === undefined ? '' : renderValue(locale, ['sector', sector])
}

function countOf(locale: Locale, value: unknown): string {
  return typeof value === 'number' ? formatCount(locale, value) : ''
}

/** Narrows a stored string to its closed tuple without an assertion. */
function memberOf<T extends string>(members: readonly T[], value: unknown): T | undefined {
  return members.find((member) => member === value)
}
