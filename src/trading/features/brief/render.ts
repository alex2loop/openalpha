import type { Locale } from '@/core/types/locale'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import { formatDay, t } from '@/i18n'
import { renderVerdictBlock } from '@/trading/features/brief/verdict'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatClock } from '@/trading/render/datetime'
import { toFoldLines } from '@/trading/render/fold'
import { renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import {
  joinSections,
  renderAsOf,
  renderEmptyLine,
  renderSectionTitle,
} from '@/trading/render/layout'
import { formatSpendUsd } from '@/trading/render/money'
import { renderBlockRule, toBriefSectionText } from '@/trading/render/section'

const FOOTER_RULE = '─'.repeat(25)
/** `/rebalance`'s own plan notes, printed twice a day in two commands. What bears on today's
 *  stance - the regime throttle, and a sleeve with nothing to buy - stays; the rest is the plan
 *  talking about itself, and the button beside the brief opens the plan. */
const REBALANCE_OWN_CAVEATS: ReadonlySet<string> = new Set([
  'portfolio.candidates-available',
  'portfolio.candidates-by-name',
  'portfolio.reduction-below-minimum',
])
/** What an uncapped budget prints where a limit would go. */
const UNLIMITED_MARK = '∞'

type BlockName = 'summary' | 'operator' | 'macro' | 'actions'

/** The reader's own state, named rather than left to fall through: a pushed message's first screen
 *  is what their book is doing, before any market. `toBlocks` gathers these wherever compose emits
 *  them, so a kind of another block placed between two of them never splits this one in two. */
const BRIEF_SUMMARY_KINDS = [
  'book-summary',
  'positions-in-loss',
  'position-exits',
  'fired-alerts',
  'unwatched-positions',
  'stale-positions',
] as const satisfies readonly BriefSectionKind[]

/** Reference the reader taps open rather than scrolls past: the composite's working, whose regime
 *  and deployment cap the verdict block above already states, and the headlines, which are context
 *  for a decision rather than one. */
export const FOLDED_SECTION_KINDS = [
  'macro',
  'macro-headlines',
  'economy-headlines',
] as const satisfies readonly BriefSectionKind[]

const MARKET_HEADLINE_KINDS = [
  'market-prices',
  'breadth',
] as const satisfies readonly BriefSectionKind[]

/** The blocks that belong to no market, and the kinds each collects. Macro heads the markets
 *  because its drivers price all of them. Anything else carrying no market describes the operator's
 *  own book. */
const NON_MARKET_BLOCKS = Object.freeze([
  ['summary', BRIEF_SUMMARY_KINDS],
  ['macro', ['regime-shift', 'macro', 'deposit-rate', 'macro-headlines', 'economy-headlines']],
  ['actions', ['suggestions', 'cross-asset-suggestions', 'next-actions', 'discipline']],
] as const satisfies readonly (readonly [BlockName, readonly BriefSectionKind[]])[])

const BLOCK_ICONS = Object.freeze({
  summary: SECTION_ICONS.positions,
  operator: SECTION_ICONS.reflect,
  macro: SECTION_ICONS.macro,
  actions: SECTION_ICONS.actions,
} as const satisfies Record<BlockName, string>)

export function renderBriefText(
  locale: Locale,
  snapshot: BriefSnapshot,
  context: RenderContext
): string {
  // The verdict quotes the market sections the blocks below fold away, so it reads them all.
  const readable = snapshot.sections.filter(isRenderable)
  const renderable = readable.filter(isShown)

  if (renderable.length === 0) {
    return renderEmptyLine(
      SECTION_ICONS.brief,
      t(locale, 'trading.brief.empty', { date: formatDay(locale, snapshot.asOf) })
    )
  }

  const footer = renderCostFooter(locale, snapshot.sections)

  return joinSections([
    [title(locale, snapshot, context.timezone)],
    renderVerdictBlock(locale, readable, context),
    ...toBlocks(renderable).flatMap((block) => renderBlock(locale, block, context)),
    renderCaveatLines(locale, caveatsOf(snapshot, renderable), { collapseInfo: true }),
    footer === null ? [] : footer,
  ])
}

/** The day the numbers describe and the moment they were read. A brief is built once and read
 *  later, so a snapshot with no read time on it passes for current whenever it is opened. */
function title(locale: Locale, snapshot: BriefSnapshot, timezone: string): string {
  return renderSectionTitle(SECTION_ICONS.brief, briefTitle(locale, snapshot, timezone))
}

/** The title's words alone, for a surface that draws its own heading. */
export function briefTitle(locale: Locale, snapshot: BriefSnapshot, timezone: string): string {
  return t(locale, 'trading.brief.title', {
    date: formatDay(locale, snapshot.asOf),
    time: formatClock(locale, snapshot.createdAt, timezone),
  })
}

interface BriefBlock {
  readonly name: BlockName
  readonly market?: MarketRef
  readonly sections: BriefSectionResult[]
}

/** The flat ordered list becomes the reader's blocks, each opened where its first section falls and
 *  keeping compose's order within it. A section joins its block wherever it lands in the stream, so
 *  a block never prints its header twice — and `cost` never becomes a section, it becomes the
 *  footer. */
function toBlocks(sections: readonly BriefSectionResult[]): readonly BriefBlock[] {
  const blocks: BriefBlock[] = []

  for (const section of sections) {
    if (section.kind === 'cost') {
      continue
    }

    const block = blocks.find((candidate) => holds(candidate, section))

    if (block === undefined) {
      blocks.push({ ...blockIdOf(section), sections: [section] })
      continue
    }

    block.sections.push(section)
  }

  return blocks
}

/** A market keeps its headline reading; the rest of its sections are a tap away on
 *  `/overview <market>`, and a pushed message is read on a phone. */
export function isShown(section: BriefSectionResult): boolean {
  return section.market === undefined || MARKET_HEADLINE_KINDS.some((kind) => kind === section.kind)
}

function holds(block: BriefBlock, section: BriefSectionResult): boolean {
  const id = blockIdOf(section)

  return block.market === id.market && block.name === id.name
}

function blockIdOf(section: BriefSectionResult): { name: BlockName; market?: MarketRef } {
  if (section.market !== undefined) {
    return { name: 'operator', market: section.market }
  }

  for (const [name, kinds] of NON_MARKET_BLOCKS) {
    if (kinds.some((kind) => kind === section.kind)) {
      return { name }
    }
  }

  return { name: 'operator' }
}

function renderBlock(
  locale: Locale,
  block: BriefBlock,
  context: RenderContext
): readonly (readonly string[])[] {
  return [
    [blockHeader(locale, block)],
    ...block.sections.map((section) => renderSectionLines(locale, section, context)),
  ]
}

function renderSectionLines(
  locale: Locale,
  section: BriefSectionResult,
  context: RenderContext
): readonly string[] {
  const { heading, lines } = toBriefSectionText(locale, section, context)

  return FOLDED_SECTION_KINDS.some((kind) => kind === section.kind)
    ? toFoldLines(heading, lines)
    : [heading, ...lines]
}

/** The rule, a glyph, what the block is about, and the session its numbers describe — so a reader
 *  scrolling a long brief always knows whose numbers are under their eye and which day closed on
 *  them. A market block reads its name and glyph off its own sections. */
function blockHeader(locale: Locale, block: BriefBlock): string {
  const stamp = block.sections.find((section) => section.asOf !== undefined)?.asOf
  const dated = stamp === undefined ? '' : renderAsOf(locale, stamp)

  if (block.market === undefined) {
    const icon = BLOCK_ICONS[block.name]

    return `${renderBlockRule(icon, t(locale, `trading.brief.block.${block.name}`))}${dated}`
  }

  const name = renderDeclaredValue(locale, `trading.market.${block.market}`)

  return `${renderBlockRule(block.sections[0]?.icon, name)}${dated}`
}

/** Every caveat the brief carries, stated once. A section states its own only when it failed, so a
 *  source four markets share does not repeat its warning in each of their blocks. */
export function caveatsOf(
  snapshot: BriefSnapshot,
  renderable: readonly BriefSectionResult[]
): readonly Caveat[] {
  return dedupeCaveats([
    ...renderable.flatMap((section) => (section.status === 'ready' ? section.caveats : [])),
    ...snapshot.caveats,
  ]).filter((caveat) => !REBALANCE_OWN_CAVEATS.has(caveat.code))
}

/** What the brief itself cost, below a rule: it belongs to the whole read, not to any market. */
function renderCostFooter(
  locale: Locale,
  sections: readonly BriefSectionResult[]
): readonly string[] | null {
  const cost = sections.find((section) => section.kind === 'cost')
  const row = cost?.status === 'ready' ? cost.rows[0] : undefined
  const spent = row?.spentUsd
  const limit = row?.limitUsd

  if (typeof spent !== 'number') {
    return null
  }

  const message = t(locale, 'trading.brief.footer.cost', {
    spent: formatSpendUsd(locale, spent),
    limit: typeof limit === 'number' ? formatSpendUsd(locale, limit) : UNLIMITED_MARK,
  })

  return [FOOTER_RULE, message]
}

/** A section that failed still renders, so its title and caveat say so: dropping it makes an
 *  outage look like a quiet morning. One that reported nothing carries no caveat and stays out. */
export function isRenderable(section: BriefSectionResult): boolean {
  return section.status === 'ready' ? section.rows.length > 0 : section.caveats.length > 0
}
