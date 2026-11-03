import type { EvidenceContext } from '@/trading/features/suggestion/debate/debate-prompts'
import type { RolePrompt } from '@/trading/features/suggestion/debate/roles'
import type { DebateRole } from '@/trading/kernel/config'
import {
  CLAIM_INSTRUCTIONS,
  EVIDENCE_INSTRUCTIONS,
  evidenceBlock,
} from '@/trading/features/suggestion/debate/debate-prompts'
import { MAXIMUM_INVALIDATORS } from '@/trading/features/suggestion/pipeline/schemas'

type AnalysisSide = Extract<DebateRole, 'bull-researcher' | 'bear-researcher'>

/** The factor rows say which way each reading leans for the price. The debate's wording is about
 *  buying, which an analysis never asks, and it promises a distance from a current price that an
 *  analysis does not state. */
export const ANALYSIS_FACTORS_HEADING =
  'FACTORS (each band says which way that factor leans for the price, not the level of the thing named - a bearish band on a factor whose name is a quantity means that quantity argues against the price holding up; an abstained factor is not a zero). A window in sessions is a span, never a price:'

const CASE_INSTRUCTIONS = [
  'You are one side of a two-sided analysis of an instrument.',
  'Argue only from the evidence below. You have no retrieval tools: never assert a fact the',
  'evidence does not contain, and cite the url of every claim that comes from a headline.',
  'Nobody is deciding whether to trade, so assume no position, entry, price level or size and',
  'never recommend one. The reader wants the strongest honest case for your side on this evidence.',
  'The opposing side is written separately by another model, so do not balance them yourself:',
  'no conceding, no closing "however", and never rate how convincing your own case is. Where the',
  'evidence is thin, say what the case rests on instead of how strong it is.',
].join(' ')

const WRONG_INSTRUCTIONS = [
  `In invalidators give at most ${MAXIMUM_INVALIDATORS} conditions that would show your case to be`,
  'wrong - each checkable against later evidence the way a claim is checkable against this one:',
  'a number crossing a level, a filing, a rate, a state changing. Not a price move, which',
  'nobody can check against anything. Each is about this instrument, the market it trades in, or a',
  'driver the evidence below names. Each stands alone under the claim length, no conditionals and',
  'no hedges. An empty list is better than a vague one.',
].join(' ')

const SIDE_BRIEFS = {
  'bull-researcher': 'Build the case for why this instrument could do well from here.',
  'bear-researcher': 'Build the case for why this instrument could do badly from here.',
} as const satisfies Record<AnalysisSide, string>

/** Both sides read the same evidence and differ only in the question they are asked: neither
 *  assumes a trade, and neither is told what the other will say. */
export function analysisCasePrompt(context: EvidenceContext, side: AnalysisSide): RolePrompt {
  return {
    instructions: [
      CASE_INSTRUCTIONS,
      CLAIM_INSTRUCTIONS,
      WRONG_INSTRUCTIONS,
      EVIDENCE_INSTRUCTIONS,
      '',
      SIDE_BRIEFS[side],
    ].join('\n'),
    message: evidenceBlock(context),
  }
}
