import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type {
  BriefNumericField,
  BriefSectionKind,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'

export const STORY_CODES = Object.freeze([
  'breadth-split-index-down',
  'breadth-split-index-up',
  'foreign-selling',
  'foreign-buying',
  'turnover-thin-rise',
  'turnover-thin-fall',
  'turnover-heavy-rise',
  'turnover-heavy-fall',
  'support-test',
  'resistance-test',
  'breadth-widening',
  'breadth-narrowing',
  'sector-leading',
  'sector-lagging',
  'basis-premium',
  'basis-discount',
] as const)
export type StoryCode = (typeof STORY_CODES)[number]

export const STORY_ROLES = Object.freeze(['supports', 'contradicts'] as const)
export type StoryRole = (typeof STORY_ROLES)[number]

export const WATCH_EFFECTS = Object.freeze(['confirms', 'refutes'] as const)
export type WatchEffect = (typeof WATCH_EFFECTS)[number]

export const THESIS_STATUSES = Object.freeze(['open', 'confirmed', 'refuted', 'expired'] as const)
export type ThesisStatus = (typeof THESIS_STATUSES)[number]

export const WATCH_MARKS = Object.freeze(['met', 'unmet', 'unobserved'] as const)
export type WatchMark = (typeof WATCH_MARKS)[number]

/** The metric and side each watch sentence is written for; one catalog key per shape. */
export const WATCH_SHAPES = Object.freeze([
  'aboveMa50Ratio-above',
  'aboveMa50Ratio-below',
  'indexToMa50Pct-above',
  'indexToMa50Pct-below',
  'net-above',
  'net-below',
  'supportPct-above',
  'supportPct-below',
  'resistancePct-above',
  'resistancePct-below',
  'strength-above',
  'strength-below',
  'basisPct-above',
  'basisPct-below',
] as const)
export type WatchShape = (typeof WATCH_SHAPES)[number]

export interface StoryWatch {
  readonly shape: WatchShape
  readonly row?: { readonly field: 'ticker' | 'sector'; readonly value: string }
  readonly threshold: number // in the metric field's own unit
  readonly horizonSessions: number
  readonly effect: WatchEffect
}

export interface StoryFact {
  readonly row: BriefSectionRow
  readonly role: StoryRole
}

export interface StoryCandidate {
  readonly code: StoryCode
  readonly runKey: string // code, or `${code}:${sector}` for sector codes
  readonly salience: number // 0..1
  readonly facts: readonly StoryFact[]
  readonly watches: readonly StoryWatch[]
}

export type StoryRead =
  | {
      readonly kind: 'read'
      readonly session: TradingDay
      readonly currency: CurrencyCode // the market's money, for flow facts and watch values
      /** The index's distance to its settled support and resistance. The range section measures
       *  from a live level mid-session, so the review reads these instead. */
      readonly levels?: SettledLevels
      readonly candidates: readonly StoryCandidate[]
      readonly provenance: readonly SourceProvenance[]
    }
  | { readonly kind: 'unread' }
  | { readonly kind: 'failed'; readonly err: unknown }

/** A run's length on the session its story was told. */
export const FIRST_RUN_SESSION = 1

const RUN_KEY_SECTOR_SEPARATOR = ':'

export interface SettledLevels {
  readonly supportPct: number
  readonly resistancePct: number
}

export interface MarketBrief {
  readonly sections: readonly BriefSectionResult[]
  readonly stories: StoryRead
}

/** The numeric brief field each watch shape reads, so the review that scores a watch and the line
 *  that prints its threshold name one field. */
export const WATCH_FIELDS = Object.freeze({
  'aboveMa50Ratio-above': 'aboveMa50Ratio',
  'aboveMa50Ratio-below': 'aboveMa50Ratio',
  'indexToMa50Pct-above': 'indexToMa50Pct',
  'indexToMa50Pct-below': 'indexToMa50Pct',
  'net-above': 'net',
  'net-below': 'net',
  'supportPct-above': 'supportPct',
  'supportPct-below': 'supportPct',
  'resistancePct-above': 'resistancePct',
  'resistancePct-below': 'resistancePct',
  'strength-above': 'strength',
  'strength-below': 'strength',
  'basisPct-above': 'basisPct',
  'basisPct-below': 'basisPct',
} as const satisfies Record<WatchShape, BriefNumericField>)

/** The section each shape reads: one table for the story that sets a watch and the review that
 *  scores it from a snapshot row. */
export const WATCH_SECTIONS = Object.freeze({
  'aboveMa50Ratio-above': 'breadth',
  'aboveMa50Ratio-below': 'breadth',
  'indexToMa50Pct-above': 'breadth',
  'indexToMa50Pct-below': 'breadth',
  'net-above': 'foreign-desk-flow',
  'net-below': 'foreign-desk-flow',
  'supportPct-above': 'range',
  'supportPct-below': 'range',
  'resistancePct-above': 'range',
  'resistancePct-below': 'range',
  'strength-above': 'sector-rotation',
  'strength-below': 'sector-rotation',
  'basisPct-above': 'basis',
  'basisPct-below': 'basis',
} as const satisfies Record<WatchShape, BriefSectionKind>)

/** The key a story runs under: its code, plus the sector a sector code is about. */
export function toRunKey(code: StoryCode, sector?: string): string {
  return sector === undefined ? code : `${code}${RUN_KEY_SECTOR_SEPARATOR}${sector}`
}

/** `toRunKey` read back, or undefined for a key this build does not know. */
export function fromRunKey(
  runKey: string
): { readonly code: StoryCode; readonly sector?: string } | undefined {
  const split = runKey.indexOf(RUN_KEY_SECTOR_SEPARATOR)
  const head = split === -1 ? runKey : runKey.slice(0, split)
  const code = STORY_CODES.find((member) => member === head)

  if (code === undefined) {
    return undefined
  }

  return split === -1 ? { code } : { code, sector: runKey.slice(split + 1) }
}
