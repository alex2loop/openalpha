import type { Locale } from '@/core/types/locale'
import type { DebateInput } from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionDirection } from '@/trading/features/suggestion/types'
import type { FactorScore, TradeLevels } from '@/trading/kernel/factor'
import type { PriceDisplay } from '@/trading/kernel/instrument'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { promptWholePercent } from '@/trading/prompt-text'
import { formatPrice } from '@/trading/render/money'

// What only a debate over a drafted decision reads: the question, the levels and the system's own
// conviction. The analysis never sees any of it, so none of it lives in the shared evidence.

interface DecisionFraming {
  readonly question: string
  readonly entry: string
  readonly stop: string
  readonly target: string
}

/** What the run is deciding, and what each level is for once it has been decided. `buildRoundedLevels`
 *  mirrors the triple on a reduce — stop above entry, target below — so the two sides need different
 *  words for the same three fields. Keyed on `framedDirectionOf`, the same function the research
 *  sides are framed by, so the levels and the cases can never describe opposite trades. */
const FRAMINGS = Object.freeze({
  buy: {
    question: 'whether to buy this name.',
    entry: 'where the buy goes on',
    stop: 'below entry: where the idea is wrong and the position closes',
    target: 'above entry: where the idea has paid off',
  },
  reduce: {
    question:
      'whether to sell down a position the operator already holds. Every level below prices that sale, so "entry" means entering the sale, and the triple is the mirror of a buy: a stop above entry is correct here, not an error.',
    entry: 'where the sale goes on',
    stop: 'above entry: where selling proves to have been the wrong call',
    target: 'below entry: where the sale has paid off',
  },
} as const satisfies Record<SuggestionDirection, DecisionFraming>)

const RUNNER_TARGET =
  'above entry: the far level the reward is measured to, which few entries reach; nothing is sold there'

export function decisionLine(draft: DebateInput['draft']): string {
  return `DECISION: ${FRAMINGS[framedDirectionOf(draft)].question}`
}

export function adjudicationSection(input: DebateInput): string {
  const conviction = `DETERMINISTIC CONVICTION: ${input.draft.conviction}`

  return [conviction, confidenceRow(input.factors)].join('\n')
}

/** Stated against the market's floors, not as numbers: the conviction already drops a band for a
 *  shortfall, and a bare ratio below one invites a role to cut it again. */
function confidenceRow(factors: FactorScore): string {
  return factors.coverageBelowMinimum || factors.agreementBelowMinimum
    ? 'CONFIDENCE: the factors cover too little of the model or disagree too much, and the conviction above is already one band lower for it. Do not lower it again for this.'
    : 'CONFIDENCE: the factors cover enough of the model and agree enough for this market. That is already in the conviction above, so it is no reason to raise or lower it.'
}

interface LevelSectionInput {
  readonly levels: TradeLevels | undefined
  readonly direction: SuggestionDirection
  /** The share sold at the take-profit; below one, the rest rides the trail with no fixed exit. */
  readonly banked: number
  readonly locale: Locale
  readonly display: PriceDisplay | undefined
}

/** The levels are stated as fixed. A persona reasons about timing and conditions around them; it
 *  cannot move them, and its schema has nowhere to return one. Each one says what it is for on the
 *  framed side, because the triple alone is ambiguous: a sale's stop sits above its entry, and a
 *  role reading the bare field names against the buy convention reports the plan as inverted. */
export function levelSection(input: LevelSectionInput): string {
  const { levels, locale, display } = input

  if (levels === undefined) {
    return 'LEVELS: unavailable — no entry, stop, or target has been computed.'
  }

  const { banked } = input
  const framing = FRAMINGS[input.direction]
  const runner = banked < 1

  return [
    'LEVELS (fixed, computed deterministically — quote them as they stand, never alter them):',
    `- entry ${formatPrice(locale, levels.entry, display)} — ${entryPurpose(levels, framing)}`,
    `- stop ${formatPrice(locale, levels.stop, display)} — ${framing.stop}`,
    ...(runner
      ? [
          `- take-profit ${formatPrice(locale, levels.takeProfit, display)} — ${promptWholePercent(banked)} of the position is sold here; the rest has no fixed exit and rides a rising stop`,
        ]
      : []),
    `- target ${formatPrice(locale, levels.target, display)} — ${runner ? RUNNER_TARGET : framing.target}`,
  ].join('\n')
}

/** A resting entry is said to be one, or every role reads the limit as the price trading now. */
function entryPurpose(levels: TradeLevels, framing: DecisionFraming): string {
  const { resting } = levels

  if (resting === undefined) {
    return framing.entry
  }

  return (
    `a buy limit resting below the live price for ${resting.validSessions} sessions, because ` +
    `the name ran ${promptWholePercent(resting.run)} over its last ${resting.runSessions}; ` +
    'it fills only on a dip to it'
  )
}
