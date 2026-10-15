import type { CallAction } from '@/trading/features/suggestion/store/call-actions'
import type { SuggestionAction } from '@/trading/kernel/conviction'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import {
  isWinningReturn,
  MINIMUM_TRACK_RECORD_SAMPLE,
} from '@/trading/features/suggestion/pipeline/reporting'

/** Two focuses that agree this often on the names they both called are almost the same view. */
const OVERLAP_HINT_FRACTION = 0.95

export interface FocusAgreement {
  readonly focusKey: FocusKey
  /** Name-days with a clear majority among the other focuses. */
  readonly comparedCount: number
  readonly matchedCount: number
  /** Disagreements where both sides were scored. */
  readonly contrarianCount: number
  readonly contrarianWins: number
  readonly crowdWins: number
}

export interface FocusOverlap {
  readonly left: FocusKey
  readonly right: FocusKey
  readonly comparedCount: number
  readonly matchedCount: number
}

interface AgreementInput {
  readonly calls: readonly CallAction[]
  /** For each focus, the other focuses some agent has also used. An agent that changed its focus
   *  is never compared with itself. */
  readonly siblings: ReadonlyMap<FocusKey, ReadonlySet<FocusKey>>
}

interface Tally {
  comparedCount: number
  matchedCount: number
  contrarianCount: number
  contrarianWins: number
  crowdWins: number
}

type NameDay = readonly CallAction[]

/** The action more than half of `others` took. A tie, or a 2-1-1 split, has none. */
function majorityOf(others: readonly CallAction[]): SuggestionAction | undefined {
  const counts = new Map<SuggestionAction, number>()

  for (const call of others) {
    counts.set(call.action, (counts.get(call.action) ?? 0) + 1)
  }

  for (const [action, count] of counts) {
    if (count * 2 > others.length) {
      return action
    }
  }

  return undefined
}

function groupNameDays(calls: readonly CallAction[]): readonly NameDay[] {
  const groups = new Map<string, CallAction[]>()

  for (const call of calls) {
    const key = [call.market, call.ticker, call.day].join('\u0000')

    groups.set(key, [...(groups.get(key) ?? []), call])
  }

  return [...groups.values()]
}

function newestWithAction(
  others: readonly CallAction[],
  action: SuggestionAction
): CallAction | undefined {
  return others
    .filter((call) => call.action === action)
    .sort((left, right) => right.createdAt - left.createdAt)[0]
}

function addContrarian(tally: Tally, call: CallAction, crowd: CallAction | undefined): void {
  // A hold majority has no outcome to compare, and an unscored side has nothing to say.
  if (call.returnPct === undefined || crowd?.returnPct === undefined) {
    return
  }

  tally.contrarianCount += 1
  tally.contrarianWins += isWinningReturn(call.returnPct) ? 1 : 0
  tally.crowdWins += isWinningReturn(crowd.returnPct) ? 1 : 0
}

function tallyFocus(tally: Tally, call: CallAction, others: readonly CallAction[]): void {
  const majority = majorityOf(others)

  if (majority === undefined) {
    return
  }

  tally.comparedCount += 1

  if (call.action === majority) {
    tally.matchedCount += 1

    return
  }

  if (majority !== 'hold') {
    addContrarian(tally, call, newestWithAction(others, majority))
  }
}

/** How often each focus takes the action the others take on the same name and day, and how its
 *  disagreements turned out. `hold` is an action: agreeing to wait is agreeing. */
export function summarizeAgreement(input: AgreementInput): readonly FocusAgreement[] {
  const tallies = new Map<FocusKey, Tally>()

  for (const day of groupNameDays(input.calls)) {
    for (const call of day) {
      const own = input.siblings.get(call.focusKey)
      const others = day.filter(
        (other) => other.focusKey !== call.focusKey && !(own?.has(other.focusKey) ?? false)
      )
      const tally = tallies.get(call.focusKey) ?? {
        comparedCount: 0,
        matchedCount: 0,
        contrarianCount: 0,
        contrarianWins: 0,
        crowdWins: 0,
      }

      tallies.set(call.focusKey, tally)
      tallyFocus(tally, call, others)
    }
  }

  return [...tallies].map(([focusKey, tally]) => ({ focusKey, ...tally }))
}

interface PairTally {
  readonly left: FocusKey
  readonly right: FocusKey
  comparedCount: number
  matchedCount: number
}

function pairKey(left: FocusKey, right: FocusKey): string {
  return `${left}\u0000${right}`
}

/** A canonical pair (`left < right`) of different views. Two focuses that both wait on a name are
 *  not copies of each other, so a hold/hold pair is not counted, and neither is a pair one agent
 *  produced by changing its focus. */
function isComparablePair(first: CallAction, second: CallAction, input: AgreementInput): boolean {
  return (
    first.focusKey < second.focusKey &&
    !(input.siblings.get(first.focusKey)?.has(second.focusKey) ?? false) &&
    !(first.action === 'hold' && second.action === 'hold')
  )
}

function addPair(pairs: Map<string, PairTally>, first: CallAction, second: CallAction): void {
  const key = pairKey(first.focusKey, second.focusKey)
  const pair = pairs.get(key) ?? {
    left: first.focusKey,
    right: second.focusKey,
    comparedCount: 0,
    matchedCount: 0,
  }

  pair.comparedCount += 1
  pair.matchedCount += first.action === second.action ? 1 : 0
  pairs.set(key, pair)
}

/** Each canonical pair on the names both called. */
export function summarizeOverlaps(input: AgreementInput): readonly FocusOverlap[] {
  const pairs = new Map<string, PairTally>()

  for (const day of groupNameDays(input.calls)) {
    for (const first of day) {
      for (const second of day.filter((other) => isComparablePair(first, other, input))) {
        addPair(pairs, first, second)
      }
    }
  }

  return [...pairs.values()]
}

/** Whether enough name-days were compared for an agreement rate to say anything. */
export function hasAgreementSample(agreement: FocusAgreement): boolean {
  return agreement.comparedCount >= MINIMUM_TRACK_RECORD_SAMPLE
}

export function isOverlapping(overlap: FocusOverlap): boolean {
  return (
    overlap.comparedCount >= MINIMUM_TRACK_RECORD_SAMPLE &&
    overlap.matchedCount / overlap.comparedCount >= OVERLAP_HINT_FRACTION
  )
}
