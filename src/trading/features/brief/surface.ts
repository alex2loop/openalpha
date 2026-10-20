import type { Locale } from '@/core/types/locale'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { BriefSectionKind } from '@/trading/kernel/operator/brief-section'
import {
  briefTitle,
  caveatsOf,
  FOLDED_SECTION_KINDS,
  isRenderable,
  isShown,
} from '@/trading/features/brief/render'
import { renderStoryBlocks } from '@/trading/features/brief/story/render'
import { renderVerdictBlock } from '@/trading/features/brief/verdict'
import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { renderCaveatLines } from '@/trading/render/caveat'
import { toPlainText } from '@/trading/render/fold'
import { NOTICE_SURFACE, renderDeclaredValue, resolveRenderContext } from '@/trading/render/format'
import { toBriefSectionText } from '@/trading/render/section'

export interface BriefText {
  readonly title: string
  /** The answer: the session sentence and the figures it rests on. */
  readonly verdict: readonly string[]
  /** The review of earlier stories and today's story, as plain lines: empty when the brief tells none. */
  readonly story: readonly string[]
  /** Ready and unavailable sections in the brief's order. */
  readonly sections: readonly {
    /** Unique in the brief: a market's kind repeats once per market. */
    readonly id: string
    readonly kind: string
    /** The market's name, on a section that belongs to one. */
    readonly market?: string
    readonly status: 'ready' | 'unavailable'
    readonly heading: string
    readonly lines: readonly string[]
  }[]
  /** Every caveat the brief carries, stated once, as the CLI words them. */
  readonly caveats: readonly string[]
}

/** The cost is the app's own budget screen. The folded kinds are reference the CLI tucks away: the
 *  verdict already states the regime and cap, and a card that listed them would repeat it. */
const HIDDEN_KINDS: ReadonlySet<string> = new Set([
  'cost',
  'thesis-review',
  'story',
  ...FOLDED_SECTION_KINDS,
])

/** A section heading is drawn as `<icon> **name**`; the app draws its own, so both go. */
const HEADING_ICON_RE = /^(?:\p{Extended_Pictographic}|\uFE0F|\s)+/u

/** The brief's own lines for an app to lay out: the sections `renderBriefText` prints, in its
 *  order, with every indent trimmed and the cost footer left to the app's own budget screen. */
export function renderBriefForSurface(
  locale: Locale,
  snapshot: BriefSnapshot,
  timezone: string
): BriefText {
  const context = resolveRenderContext(timezone, NOTICE_SURFACE)
  const readable = snapshot.sections.filter(isRenderable)
  const renderable = readable.filter(isShown)
  const order = (kind: BriefSectionKind): number => BRIEF_SECTION_ORDER.indexOf(kind)

  return {
    title: briefTitle(locale, snapshot, timezone),
    // The first line is the block's own rule, which the app replaces with its card.
    verdict: renderVerdictBlock(locale, readable, context).slice(1).map(trim),
    story: renderStoryBlocks(locale, readable, context)
      .flat()
      .map((line) => toPlainText(trim(line).replace(HEADING_ICON_RE, ''))),
    sections: renderable
      .filter(
        (section) => !HIDDEN_KINDS.has(section.kind) && section.status !== 'omitted-by-policy'
      )
      .sort((left, right) => order(left.kind) - order(right.kind))
      .map((section) => {
        const text = toBriefSectionText(locale, section, context)

        return {
          id: section.market === undefined ? section.kind : `${section.kind}:${section.market}`,
          kind: section.kind,
          ...(section.market === undefined
            ? {}
            : { market: renderDeclaredValue(locale, `trading.market.${section.market}`) }),
          status: section.status === 'ready' ? 'ready' : 'unavailable',
          heading: text.heading.replace(HEADING_ICON_RE, '').replaceAll('**', ''),
          lines: text.lines.map(trim),
        }
      }),
    caveats: renderCaveatLines(locale, caveatsOf(snapshot, renderable), { collapseInfo: true }).map(
      (line) => toPlainText(trim(line))
    ),
  }
}

function trim(line: string): string {
  return line.trimStart()
}
