import type { Locale } from '@/core/types/locale'
import type { ReportContext } from '@/trading/features/themes/render/shared'
import type {
  Theme,
  ThemeGap,
  ThemeId,
  ThemeRead,
  ThemeReport,
  ThemeRunNote,
  ThemeStepFailure,
} from '@/trading/features/themes/types'
import { BRAND } from '@/core/brand'
import { setEnvCommand } from '@/core/config/resolve'
import { t } from '@/i18n'
import { MAXIMUM_NEWS_ITEMS } from '@/trading/features/themes/evidence/news'
import { renderTopSectors, renderTopStocks } from '@/trading/features/themes/render/opportunities'
import { renderScorecard } from '@/trading/features/themes/render/scorecard'
import {
  notesOf,
  olderReadRunOf,
  renderClaims,
  renderScoreFacts,
  renderSectorName,
  sortByScore,
  titleOf,
  toPreviousScores,
} from '@/trading/features/themes/render/shared'
import { SCORE_SCALE, STOCK_SCORE_PARTS } from '@/trading/features/themes/score/compose'
import {
  isDiscoveryNote,
  NEWS_CAPPED_GAP,
  TRACKED_THEME_STATUSES,
} from '@/trading/features/themes/types'
import { formatInstant } from '@/trading/render/datetime'
import { formatPercent, SECTION_ICONS } from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinEntries,
  joinSections,
  renderEmptyLine,
  renderSectionTitle,
} from '@/trading/render/layout'

const SHOWN_SOURCES = 2
const LIST_SEPARATOR = ', '

interface ThemeRenderOptions {
  readonly locale: Locale
  readonly timezone: string
}

interface ThemeLine {
  readonly theme: Theme
  readonly read?: ThemeRead
}

/** Top themes, then the sectors and names they lead to ranked across every theme, then the
 *  proposals and the scorecard. The theme row carries the lifecycle: a run writes its reads'
 *  statuses into it and the operator's approvals land there too, so a read is never asked what
 *  state its theme is in now. An invalidated theme stays listed until the operator retires it. */
export function renderThemeReportText(report: ThemeReport, options: ThemeRenderOptions): string {
  const { run } = report

  if (run === undefined) {
    return renderEmptyLine(SECTION_ICONS.themes, t(options.locale, 'trading.render.themes.empty'))
  }

  const context: ReportContext = {
    report,
    run,
    ...options,
    previous: toPreviousScores(report.previous),
    titles: new Map(report.themes.map((theme) => [theme.id, theme.title])),
  }
  const lines = toThemeLines(report)

  return joinSections([
    renderHeader(context),
    renderTopThemes(
      lines.filter((line) => isListed(line.theme)),
      context
    ),
    renderTopSectors(context),
    renderTopStocks(context),
    renderProposed(
      lines.filter((line) => line.theme.status === 'proposed'),
      context
    ),
    renderScorecard(report.scorecard, options.locale),
  ])
}

/** The proposal `renderProposed` ranks first, the one the approve button offers. */
export function firstProposedTheme(report: ThemeReport): ThemeId | undefined {
  const proposed = toThemeLines(report).filter((line) => line.theme.status === 'proposed')
  const [first] = sortByScore(proposed, (line) => line.read?.score)

  return first?.theme.id
}

function toThemeLines(report: ThemeReport): readonly ThemeLine[] {
  const reads = new Map(report.reads.themes.map((read) => [read.themeId, read]))

  return report.themes.map((theme): ThemeLine => {
    const read = reads.get(theme.id)

    return read === undefined ? { theme } : { theme, read }
  })
}

function isListed(theme: Theme): boolean {
  return TRACKED_THEME_STATUSES.includes(theme.status) || theme.status === 'invalidated'
}

function renderHeader(context: ReportContext): readonly string[] {
  const { locale, run } = context
  const gaps = renderGapKinds(run.gaps, locale)
  const at = formatInstant(locale, run.finishedAt, context.timezone)

  return [
    renderSectionTitle(SECTION_ICONS.themes, t(locale, 'trading.render.themes.title')),
    run.themeId === undefined
      ? t(locale, 'trading.render.themes.run', { at })
      : t(locale, 'trading.render.themes.runFocused', { at, theme: titleOf(context, run.themeId) }),
    ...(gaps === '' ? [] : [t(locale, 'trading.render.themes.gaps', { kinds: gaps })]),
    ...(run.gaps.includes(NEWS_CAPPED_GAP)
      ? [t(locale, `trading.themes.gap.${NEWS_CAPPED_GAP}`, { count: MAXIMUM_NEWS_ITEMS })]
      : []),
    renderScoreLegend(locale),
  ]
}

/** Theme scores and the board's composite sit on different scales, so the report says which one it
 *  prints before the first number. */
function renderScoreLegend(locale: Locale): string {
  return t(locale, 'trading.render.themes.scoreLegend', {
    scale: SCORE_SCALE,
    parts: STOCK_SCORE_PARTS.map((part) => t(locale, `trading.themes.part.${part}`)).join(
      LIST_SEPARATOR
    ),
  })
}

function renderGapKinds(gaps: readonly ThemeGap[], locale: Locale): string {
  return gaps
    .filter((gap) => gap !== NEWS_CAPPED_GAP)
    .map((gap) => t(locale, `trading.themes.gap.${gap}`))
    .join(LIST_SEPARATOR)
}

function renderTopThemes(lines: readonly ThemeLine[], context: ReportContext): readonly string[] {
  if (lines.length === 0) {
    return []
  }

  return [
    t(context.locale, 'trading.render.themes.topThemes'),
    ...joinEntries(
      sortByScore(lines, (line) => line.read?.score).map((line, index) =>
        renderTheme(line, { context, rank: index + 1 })
      )
    ),
  ]
}

function renderTheme(
  line: ThemeLine,
  input: { readonly context: ReportContext; readonly rank: number }
): readonly string[] {
  const { context } = input
  const { theme, read } = line
  const head = [
    `${input.rank}. **${theme.title}** (${theme.id})`,
    ...(read === undefined
      ? []
      : renderScoreFacts(context, { ...read, level: 'theme', subject: theme.id })),
  ]

  return [
    head.join(INLINE_SEPARATOR),
    renderStatus(line, context.locale),
    ...renderReadAt(theme.id, context),
    ...(read === undefined ? [`${INDENT[1]}${theme.thesis}`] : renderRead(read, context.locale)),
    ...renderHurt(theme.id, context),
    ...renderNotes(theme.id, context),
    ...renderChainSkipped(read, context.locale),
  ]
}

/** A proposal's status is the heading it sits under, so its row starts at the maturity. */
function renderStatus(line: ThemeLine, locale: Locale): string {
  const { status } = line.theme
  const facts = [
    ...(status === 'proposed' ? [] : [t(locale, `trading.themes.status.${status}`)]),
    t(locale, `trading.themes.maturity.${line.theme.maturity}`),
    ...(line.read === undefined ? [] : [renderOdds(line.read, locale)]),
  ]

  return `${INDENT[1]}${facts.join(INLINE_SEPARATOR)}`
}

/** Only for a read older than the latest run: a focused run, or a failed refresh, left it as is.
 *  The header names the latest run's gaps, so an older read names its own. */
function renderReadAt(themeId: ThemeId, context: ReportContext): readonly string[] {
  const { locale } = context
  const older = olderReadRunOf(context, themeId)

  if (older === undefined) {
    return []
  }

  const at = formatInstant(locale, older.finishedAt, context.timezone)
  const kinds = renderGapKinds(older.gaps, locale)
  const line =
    kinds === ''
      ? t(locale, 'trading.render.themes.readAt', { at })
      : t(locale, 'trading.render.themes.readAtGaps', { at, kinds })

  return [`${INDENT[1]}${line}`]
}

function renderOdds(read: ThemeRead, locale: Locale): string {
  const odds = t(locale, 'trading.render.themes.odds', {
    probability: formatPercent(locale, read.probabilityPct),
    months: read.horizonMonths,
  })
  const previous = read.previousProbabilityPct

  return previous === undefined
    ? odds
    : `${odds} ${t(locale, 'trading.render.themes.was', { probability: formatPercent(locale, previous) })}`
}

function renderRead(read: ThemeRead, locale: Locale): readonly string[] {
  return [
    `${INDENT[1]}${read.summary}`,
    ...(read.beneficiaries === undefined
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.themes.gains', {
            sectors: read.beneficiaries
              .map((sector) => renderSectorName(locale, sector))
              .join(LIST_SEPARATOR),
          })}`,
        ]),
    ...renderClaims(t(locale, 'trading.render.themes.why'), read.supporting),
    ...renderClaims(t(locale, 'trading.render.themes.risk'), read.counter),
    ...(read.invalidatedBy === undefined
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.themes.invalidated', { condition: read.invalidatedBy })}`,
        ]),
    ...(read.web.length === 0
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.themes.sources', {
            links: read.web
              .slice(0, SHOWN_SOURCES)
              .map((source) => source.url)
              .join(LIST_SEPARATOR),
          })}`,
        ]),
  ]
}

/** A sector the theme hurts is no opportunity, so it is named here rather than ranked. */
function renderHurt(themeId: ThemeId, context: ReportContext): readonly string[] {
  const { locale } = context
  const hurt = context.report.reads.sectors.filter(
    (read) => read.themeId === themeId && read.effect === 'hurt'
  )

  return hurt.length === 0
    ? []
    : [
        `${INDENT[1]}${t(locale, 'trading.render.themes.hurts', {
          sectors: hurt.map((read) => renderSectorName(locale, read.sector)).join(LIST_SEPARATOR),
        })}`,
      ]
}

/** Every step of this theme that failed, under the theme it belongs to. */
function renderNotes(themeId: ThemeId, context: ReportContext): readonly string[] {
  return notesOf(context, themeId).map((note) => `${INDENT[1]}${renderNote(note, context.locale)}`)
}

function renderNote(note: ThemeRunNote, locale: Locale): string {
  const cause = renderFailure(locale, note)

  if (note.level === 'theme') {
    return t(locale, 'trading.render.themes.stale', { cause })
  }

  return note.level === 'sector'
    ? t(locale, 'trading.render.themes.sectorFailed', { cause })
    : t(locale, 'trading.render.themes.stockFailed', { ticker: note.subject ?? '', cause })
}

/** Sectors and companies are read only while a read keeps the theme active, so a weakening one
 *  says why it has none rather than looking like a failed step. */
function renderChainSkipped(read: ThemeRead | undefined, locale: Locale): readonly string[] {
  return read?.status === 'weakening'
    ? [`${INDENT[1]}${t(locale, 'trading.render.themes.chainSkipped')}`]
    : []
}

function renderProposed(lines: readonly ThemeLine[], context: ReportContext): readonly string[] {
  const { locale } = context
  const discovery = context.run.notes.find(isDiscoveryNote)
  const status =
    discovery === undefined
      ? []
      : [
          t(locale, 'trading.render.themes.discoveryFailed', {
            cause: renderFailure(locale, discovery),
          }),
        ]
  const ranked = sortByScore(lines, (line) => line.read?.score)
  const [first] = ranked

  if (first === undefined) {
    return status.length > 0 || context.run.themeId !== undefined
      ? status
      : [t(locale, 'trading.render.themes.noProposals')]
  }

  return [
    t(locale, 'trading.render.themes.proposed'),
    t(locale, 'trading.render.themes.act'),
    '',
    ...joinEntries(ranked.map((line, index) => renderTheme(line, { context, rank: index + 1 }))),
    ...status,
  ]
}

function renderFailure(
  locale: Locale,
  failure: { readonly cause: ThemeStepFailure; readonly env?: string }
): string {
  if (failure.env !== undefined) {
    return t(locale, 'trading.themes.keyMissing', {
      env: failure.env,
      command: setEnvCommand(failure.env),
      brand: BRAND.name,
    })
  }

  return t(locale, `trading.themes.failure.${failure.cause}`, { brand: BRAND.name })
}
