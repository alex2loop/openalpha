import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import {
  foldGlossaryText,
  GLOSSARY_TERMS,
  type GlossaryEntry,
  type GlossaryGroupEntry,
  glossaryGroups,
  matchesGlossaryQuery,
  t,
} from '@/i18n'
import { usage } from '@/trading/kernel/surface/surface'
import {
  answerSurfaceOf,
  type RenderContext,
  resolveRenderContext,
  SECTION_ICONS,
} from '@/trading/render/format'
import {
  INDENT,
  joinSections,
  renderEmptyLine,
  renderSectionTitle,
  toFactLines,
} from '@/trading/render/layout'

const USAGE: 'slash.tradingGlossaryUsage' = 'slash.tradingGlossaryUsage'

interface GlossaryCommandDeps {
  /** The operator's own clock zone, which the render context carries beside the line width. */
  readonly timezone: string
}

/** `/glossary` explains a market term in plain words from the one registry the web pages read,
 *  so every surface gives the same definition. It calls no service: the terms are catalog text. */
export function createGlossaryCommand(deps: GlossaryCommandDeps): SlashCommand {
  return {
    name: 'glossary',
    description: { kind: 'localized', key: 'slash.tradingGlossaryHelp' },
    messageKeys: [USAGE],
    policy: { surfaces: ['channel', 'repl'], role: 'member', action: 'read' },
    usage: () => ({ key: USAGE }),
    completeFor: () => GLOSSARY_TERMS.map((term) => term.id),
    run: (ctx: SlashContext): Promise<SlashResult> =>
      Promise.resolve(run(ctx, resolveRenderContext(deps.timezone, answerSurfaceOf(ctx)))),
  }
}

function run(ctx: SlashContext, context: RenderContext): SlashResult {
  const { locale } = ctx
  const groups = glossaryGroups(locale)
  const query = ctx.args.join(' ')

  if (ctx.args.length === 0) {
    return { kind: 'text', text: renderIndex(locale, { groups, context }) }
  }

  const found = findTerms(groups, query)
  const [only] = found

  if (only !== undefined && found.length === 1) {
    return { kind: 'text', text: renderTerm(locale, only) }
  }

  if (only !== undefined) {
    return { kind: 'text', text: renderMatches(locale, { query, found, context }) }
  }

  if (foldGlossaryText(query) === '') {
    return usage(USAGE)
  }

  return {
    kind: 'text',
    text: renderEmptyLine(
      SECTION_ICONS.glossary,
      t(locale, 'slash.tradingGlossaryNone', { query })
    ),
  }
}

/** A term and the title of the group it is listed under. */
interface FoundTerm {
  readonly entry: GlossaryEntry
  readonly group: string
}

// The terms an exact id or name picks out, else those a name or id starts with, else those that
// merely contain the query: the first tier that finds any decides, so `p/e` is P/E alone.
function findTerms(groups: readonly GlossaryGroupEntry[], query: string): readonly FoundTerm[] {
  const needle = foldGlossaryText(query)
  const terms = groups.flatMap(({ title, terms: entries }) =>
    entries.map((entry) => ({ entry, group: title }))
  )
  const forms = ({ entry }: FoundTerm) => [entry.id, entry.name].map(foldGlossaryText)
  const tiers: readonly ((term: FoundTerm) => boolean)[] = [
    (term) => forms(term).includes(needle),
    (term) => forms(term).some((form) => form.startsWith(needle)),
    ({ entry }) => matchesGlossaryQuery([entry.id, entry.name], needle),
  ]

  if (needle === '') {
    return []
  }

  return tiers.map((tier) => terms.filter(tier)).find((found) => found.length > 0) ?? []
}

interface Index {
  readonly groups: readonly GlossaryGroupEntry[]
  readonly context: RenderContext
}

function renderIndex(locale: Locale, { groups, context }: Index): string {
  const title = renderSectionTitle(SECTION_ICONS.glossary, t(locale, 'slash.tradingGlossaryTitle'))
  const listed = groups.map((group) => [
    `${INDENT[1]}${group.title}`,
    ...toFactLines(
      group.terms.map((term) => term.name),
      context,
      2
    ),
  ])

  return joinSections([
    [title],
    ...listed,
    [`${INDENT[1]}${t(locale, 'slash.tradingGlossaryHint')}`],
  ])
}

function renderTerm(locale: Locale, { entry, group }: FoundTerm): string {
  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.glossary, entry.name),
      `${INDENT[1]}${entry.definition}`,
      `${INDENT[1]}${t(locale, 'slash.tradingGlossaryGroup', { group })}`,
    ],
  ])
}

interface Matches {
  readonly query: string
  readonly found: readonly FoundTerm[]
  readonly context: RenderContext
}

function renderMatches(locale: Locale, { query, found, context }: Matches): string {
  const title = renderSectionTitle(SECTION_ICONS.glossary, t(locale, 'slash.tradingGlossaryTitle'))
  const heading = t(locale, 'slash.tradingGlossaryMatches', { query })

  return joinSections([
    [
      title,
      `${INDENT[1]}${heading}`,
      ...toFactLines(
        found.map(({ entry }) => entry.name),
        context,
        2
      ),
    ],
  ])
}
