import type { Locale } from '@/core/types/locale'
import type {
  ThemeClaim,
  ThemeId,
  ThemeReadLevel,
  ThemeReport,
  ThemeRun,
  ThemeRunNote,
  ThemeRunReads,
  ThemeScore,
  ThemeSector,
} from '@/trading/features/themes/types'
import { t } from '@/i18n'
import { SCORE_SCALE, toMainDriver } from '@/trading/features/themes/score/compose'
import { renderProvidedValue } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'

const SHOWN_CLAIMS = 2
/** Sorts an unscored read below every scored one, never level with a zero. */
const UNSCORED_RANK = -1

export interface ReportContext {
  readonly report: ThemeReport
  readonly run: ThemeRun
  readonly locale: Locale
  readonly timezone: string
  /** Each read's score on its theme's read before, by `toReadKey`. */
  readonly previous: ReadonlyMap<string, ThemeScore>
  readonly titles: ReadonlyMap<ThemeId, string>
}

/** A read as the score line needs it: which read it is, and its score if it has one. */
interface ScoredRead {
  readonly level: ThemeReadLevel
  readonly themeId: ThemeId
  readonly subject: string
  readonly score?: ThemeScore
}

export function toPreviousScores(previous: ThemeRunReads): ReadonlyMap<string, ThemeScore> {
  const reads: readonly ScoredRead[] = [
    ...previous.themes.map((read) => ({ ...read, level: 'theme' as const, subject: read.themeId })),
    ...previous.sectors.map((read) => ({
      ...read,
      level: 'sector' as const,
      subject: read.sector,
    })),
    ...previous.stocks.map((read) => ({ ...read, level: 'stock' as const, subject: read.ticker })),
  ]

  return new Map(
    reads.flatMap((read) =>
      read.score === undefined ? [] : [[toReadKey(read), read.score] as const]
    )
  )
}

export interface ScoreGroup<T> {
  readonly best: T
  /** The same name or sector read under other themes, lower scored. */
  readonly others: readonly T[]
}

/** Highest score first, one entry per key: a name two themes reach is one opportunity, shown at its
 *  best score with the other themes named. */
export function groupByScore<T extends { readonly score?: ThemeScore }>(
  reads: readonly T[],
  keyOf: (read: T) => string
): readonly ScoreGroup<T>[] {
  const groups = Map.groupBy(
    sortByScore(reads, (read) => read.score),
    keyOf
  )

  return [...groups.values()].flatMap(([best, ...others]) =>
    best === undefined ? [] : [{ best, others }]
  )
}

/** Highest score first. */
export function sortByScore<T>(
  items: readonly T[],
  scoreOf: (item: T) => ThemeScore | undefined
): readonly T[] {
  return items.toSorted(
    (left, right) =>
      (scoreOf(right)?.value ?? UNSCORED_RANK) - (scoreOf(left)?.value ?? UNSCORED_RANK)
  )
}

/** "Theme score 71/100 (was 84), mostly on valuation · high confidence"; nothing for an unscored
 *  read, which the run's gaps line already explains. */
export function renderScoreFacts(context: ReportContext, read: ScoredRead): readonly string[] {
  const { score } = read

  if (score === undefined) {
    return []
  }

  return [
    renderScoreMove(context, { ...read, score }),
    t(context.locale, `trading.themes.confidence.${score.confidence}`),
  ]
}

function renderScoreMove(
  context: ReportContext,
  read: ScoredRead & { readonly score: ThemeScore }
): string {
  const { locale } = context
  const previous = context.previous.get(toReadKey(read))

  const current = { score: read.score.value, scale: SCORE_SCALE }

  // A score read on other parts (a sector step that failed one run) moved for that reason alone.
  if (
    previous === undefined ||
    previous.value === read.score.value ||
    !isSamePartSet(previous, read.score)
  ) {
    return t(locale, 'trading.render.themes.score', current)
  }

  const driver = toMainDriver({ level: read.level, current: read.score, previous })
  const values = { ...current, previous: previous.value }

  return driver === undefined
    ? t(locale, 'trading.render.themes.scoreMoved', values)
    : t(locale, 'trading.render.themes.scoreMovedBy', {
        ...values,
        part: t(locale, `trading.themes.part.${driver}`),
      })
}

function isSamePartSet(left: ThemeScore, right: ThemeScore): boolean {
  const parts = Object.keys(left.parts)

  return (
    parts.length === Object.keys(right.parts).length && parts.every((part) => part in right.parts)
  )
}

function toReadKey(read: ScoredRead): string {
  return `${read.level}:${read.themeId}:${read.subject}`
}

/** The label on a row, then each of its first claims on a line of its own beneath it. A plain
 *  text, such as a condition that would end the read, is a claim with no citation. */
export function renderClaims(
  label: string,
  claims: readonly (ThemeClaim | string)[]
): readonly string[] {
  return claims.length === 0
    ? []
    : [
        `${INDENT[1]}${label}`,
        ...claims
          .slice(0, SHOWN_CLAIMS)
          .map((claim) => `${INDENT[2]}${typeof claim === 'string' ? claim : claim.text}`),
      ]
}

export function renderSectorName(locale: Locale, sector: ThemeSector): string {
  return renderProvidedValue(locale, `trading.sector.${sector}`, sector)
}

export function titleOf(context: ReportContext, themeId: ThemeId): string {
  return context.titles.get(themeId) ?? themeId
}

/** The run a theme's shown reads came from, when that was before the latest run. */
export function olderReadRunOf(context: ReportContext, themeId: ThemeId): ThemeRun | undefined {
  const readRun = context.report.readRuns.get(themeId)

  return readRun === undefined || readRun.id === context.run.id ? undefined : readRun
}

/** A theme's failed steps on the latest run, and on the earlier run its shown reads came from. */
export function notesOf(context: ReportContext, themeId: ThemeId): readonly ThemeRunNote[] {
  const older = olderReadRunOf(context, themeId)
  const runs = older === undefined ? [context.run] : [context.run, older]

  return runs.flatMap((run) => run.notes.filter((note) => note.themeId === themeId))
}
