import type { Locale } from '@/core/types/locale'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import { toPlainText } from '@/core/utils/surface-text'
import {
  briefTitle,
  caveatsOf,
  FOLDED_SECTION_KINDS,
  readSections,
} from '@/trading/features/brief/render'
import { renderStoryLines, type StoryLine } from '@/trading/features/brief/story/render'
import { renderBriefStrip } from '@/trading/features/brief/strip'
import { renderQuotedReading, renderVerdictBlock } from '@/trading/features/brief/verdict'
import { renderCaveatLines } from '@/trading/render/caveat'
import { NOTICE_SURFACE, renderDeclaredValue, resolveRenderContext } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { toBriefSectionText } from '@/trading/render/section'

export interface BriefText {
  readonly title: string
  /** The headline figures, one cell each: the indices, gold, the coin and the dollar. */
  readonly strip: readonly string[]
  /** True when a section carries a call a model argued, so the page opens with the AI label. */
  readonly aiGenerated: boolean
  /** The verdict block's heading, as the CLI prints it. */
  readonly verdictTitle: string
  /** The answer: the session sentence and the figures it rests on. */
  readonly verdict: readonly string[]
  /** The verdict's opening lines that are the session sentence, not figures. */
  readonly readingLines: number
  /** What to do first, right under the verdict with no heading of its own, as the CLI prints it. */
  readonly nextActions: readonly string[]
  /** The review of earlier stories and today's story, each line with its role: empty when the
   *  brief tells none. */
  readonly story: readonly StoryLine[]
  /** Ready and unavailable sections, block by block in the CLI's order. */
  readonly sections: readonly {
    /** Unique in the brief: a market's kind repeats once per market. */
    readonly id: string
    readonly kind: string
    /** The heading of the block the section sits in, as the CLI prints it without its glyph. */
    readonly block: string
    /** The market's name, on a section that belongs to one. */
    readonly market?: string
    readonly status: 'ready' | 'unavailable'
    /** Reference the CLI folds away: a page shows its heading and opens it on request. */
    readonly folded?: true
    readonly heading: string
    readonly lines: readonly string[]
    /** Each line's depth, level with `lines`: 0 for a row, 1 for the detail under it. */
    readonly depths: readonly number[]
  }[]
  /** Every caveat the brief carries, stated once, as the CLI words them. */
  readonly caveats: readonly string[]
}

/** A section heading is drawn as `<icon> **name**`; the app draws its own, so both go. */
const HEADING_ICON_RE = /^(?:\p{Extended_Pictographic}|\uFE0F|\s)+/u

/** The brief's own lines for an app to lay out: what `renderBriefText` prints, in its blocks and
 *  order, with every indent trimmed and the cost footer left to the app's own budget screen. */
export function renderBriefForSurface(
  locale: Locale,
  snapshot: BriefSnapshot,
  options: {
    readonly timezone: string
    /** The caveats in their plain form, for an edition that makes no call. */
    readonly plain?: true
  }
): BriefText {
  const { timezone } = options
  const context = resolveRenderContext(timezone, NOTICE_SURFACE)
  const { readable, renderable, hasAiCalls, stories, nextActions, blocks } = readSections(
    locale,
    snapshot
  )
  const [verdictHead = '', ...verdict] = renderVerdictBlock(locale, readable, context)

  return {
    title: briefTitle(locale, snapshot, timezone),
    strip: renderBriefStrip(locale, readable, context),
    aiGenerated: hasAiCalls,
    verdictTitle: toHeading(verdictHead),
    verdict: verdict.map(trim),
    readingLines: renderQuotedReading(locale, readable, context).length,
    nextActions: nextActions.flatMap((section) =>
      toBriefSectionText(locale, section, context).lines.map(trim)
    ),
    story: renderStoryLines(locale, stories, context)
      .flat()
      .map(({ role, text }) => ({
        role,
        text: toPlainText(trim(text).replace(HEADING_ICON_RE, '')),
      })),
    sections: blocks.flatMap((block) =>
      block.sections
        .filter((section) => section.status !== 'omitted-by-policy')
        .map((section) =>
          toSurfaceSection(locale, section, {
            context,
            block: block.title,
          })
        )
    ),
    caveats: renderCaveatLines(locale, caveatsOf(snapshot, renderable), {
      collapseInfo: true,
      plain: options.plain === true,
    }).map((line) => toPlainText(trim(line))),
  }
}

function toSurfaceSection(
  locale: Locale,
  section: BriefSectionResult,
  place: { readonly context: RenderContext; readonly block: string }
): BriefText['sections'][number] {
  const text = toBriefSectionText(locale, section, place.context)

  return {
    id: section.market === undefined ? section.kind : `${section.kind}:${section.market}`,
    kind: section.kind,
    block: place.block,
    ...(section.market === undefined
      ? {}
      : { market: renderDeclaredValue(locale, `trading.market.${section.market}`) }),
    status: section.status === 'ready' ? 'ready' : 'unavailable',
    ...(FOLDED_SECTION_KINDS.some((kind) => kind === section.kind)
      ? { folded: true as const }
      : {}),
    heading: toHeading(text.heading),
    lines: text.lines.map(trim),
    depths: text.lines.map(depthOf),
  }
}

function toHeading(line: string): string {
  return line.replace(HEADING_ICON_RE, '').replaceAll('**', '')
}

/** How deep a rendered line sits, as `INDENT` places it: 0 for a row, 1 for its detail. */
function depthOf(line: string): number {
  return Math.max(0, (line.length - line.trimStart().length) / INDENT[1].length - 1)
}

function trim(line: string): string {
  return line.trimStart()
}
