import type { RolePrompt } from '@/trading/features/suggestion/debate/roles'
import type {
  DebateClaim,
  Invalidator,
  PortfolioManagerDecision,
  ResearchCase,
  TradePlan,
} from '@/trading/features/suggestion/debate/types'
import type { EvidenceBundle } from '@/trading/features/suggestion/pipeline/evidence'
import type { DebateInput } from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionDirection } from '@/trading/features/suggestion/types'
import type { DebateRole } from '@/trading/kernel/config'
import type { Market } from '@/trading/markets/types'
import { OUTCOME_WINDOW_DAYS } from '@/trading/features/suggestion/pipeline/outcome-window'
import {
  MAXIMUM_CLAIM_CHARS,
  MAXIMUM_CLAIMS,
  MAXIMUM_INVALIDATORS,
} from '@/trading/features/suggestion/pipeline/schemas'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { orderSessionOf, sessionPhase } from '@/trading/markets/calendar'

const CASE_INSTRUCTIONS = [
  'You are one side of a two-sided research debate about a trade idea.',
  'Argue only from the evidence below. You have no retrieval tools: never assert a fact the',
  'evidence does not contain, and cite the url of every claim that comes from a headline.',
  'The levels are fixed and computed deterministically — never propose different ones.',
  'The opposing side is written separately by another model, and a portfolio manager weighs both.',
  'So do not balance them yourself: no conceding, no closing "however", and never rate how',
  'convincing your own case is. That verdict belongs to the manager, and reaching it on their',
  'behalf discards your side unread. Where the evidence is thin, say what the case rests on',
  'instead of how strong it is.',
].join(' ')

/** Verification answers one question against the evidence, so anything conditional, predictive, or
 *  advisory stays out of the claim list: it cannot come back supported, and a hedge there is what
 *  turns caution into a veto. Such reasoning belongs in the summary, which `CASE_INSTRUCTIONS`
 *  still bars from hedging. Both caps are stated in prose because the strict-subset conversion
 *  drops `maxLength` and `maxItems`, so the schema never carries them to the model. */
const CLAIM_INSTRUCTIONS = [
  'Each entry in claims is ONE assertion about a number, an event, or a state that the evidence',
  'below can confirm or contradict, written to stand alone. No conditionals ("if X then Y"), no',
  `forecasts, no advice, no hedges. Keep each under ${MAXIMUM_CLAIM_CHARS} characters, and give at`,
  `most ${MAXIMUM_CLAIMS} claims, most important first: only the first ${MAXIMUM_CLAIMS} are read.`,
].join(' ')

const INVALIDATOR_INSTRUCTIONS = [
  `In invalidators give at most ${MAXIMUM_INVALIDATORS} conditions that would make this call wrong`,
  'later — each checkable against future evidence the way a claim is checkable against this one:',
  'a number crossing a level, a filing, a rate, a state changing. Not a price move; the stop covers',
  'that. Each is about this instrument, the market it trades in, or a driver the evidence below',
  'names. Each stands alone under the claim length, no conditionals and no hedges. An empty list is',
  'better than a vague one — a condition nobody can check reads as unbroken forever.',
].join(' ')

const CONDITION_INSTRUCTIONS = [
  'The conditions come from an earlier call on this name and are written as things that may',
  'have happened since. Judge each the same way: supported means the evidence shows it has',
  'happened, and nothing about whether it should have.',
]

/** The document already prints every score and level; a role that repeats one rounds it, and the
 *  reader meets the same number twice with two values. A scored factor that reads against the case
 *  is a finding to argue with, not evidence that went missing. */
const EVIDENCE_INSTRUCTIONS = [
  'Every factor below is scored, so it is evidence provided: never say evidence for it is missing',
  'or was not supplied. Do not restate a number the evidence shows; name the factor and let the',
  'number stand where it is printed.',
  'A playbook method that needs data this evidence does not carry - a year of prices, the ledger,',
  'the track record - is out of reach here: skip it. Never report it as unfinished, never wait on',
  'it, and never lower conviction for it.',
].join(' ')

/** What every prompt needs: the run being argued about and the evidence it must argue from. */
interface PromptContext {
  readonly input: DebateInput
  readonly evidence: EvidenceBundle
}

export interface OpposedCases {
  readonly bull: ResearchCase
  readonly bear: ResearchCase
}

type ResearchRole = Extract<DebateRole, 'bull-researcher' | 'bear-researcher'>

/** The sides are named by what the operator would do, not by market direction: on a reduce the bull
 *  argues for keeping the position, or the manager weighs a buy case against a sale. */
const CASE_SIDES = {
  buy: { 'bull-researcher': 'the case for buying', 'bear-researcher': 'the case for waiting' },
  reduce: {
    'bull-researcher': 'the case for keeping the position',
    'bear-researcher': 'the case for selling down',
  },
} as const satisfies Record<SuggestionDirection, Record<ResearchRole, string>>

export function casePrompt(context: PromptContext, role: ResearchRole): RolePrompt {
  const stance = CASE_SIDES[framedDirectionOf(context.input.draft)][role]

  return {
    instructions: [
      CASE_INSTRUCTIONS,
      CLAIM_INSTRUCTIONS,
      EVIDENCE_INSTRUCTIONS,
      '',
      `Build ${stance}.`,
    ].join('\n'),
    message: orderedEvidence(context),
  }
}

export function analystPrompt(context: PromptContext, history: string): RolePrompt {
  return {
    instructions: [
      'You are a market analyst producing one balanced case about a trade idea.',
      'Argue only from the evidence below; you have no retrieval tools.',
      'The levels are fixed and computed deterministically — never propose different ones.',
      CLAIM_INSTRUCTIONS,
      'In materialClaims give the 1-based positions of the claims your summary actually rests on —',
      'the ones that, if contradicted, would change your case. Those are independently verified.',
      'Leave it empty and every claim you made is treated as load-bearing, so answer it.',
      INVALIDATOR_INSTRUCTIONS,
      probabilityInstructions(context),
      EVIDENCE_INSTRUCTIONS,
    ].join('\n'),
    message: [
      orderedEvidence(context),
      '',
      context.evidence.adjudication,
      ...(history === '' ? [] : ['', history]),
    ].join('\n'),
  }
}

interface ManagerPrompt {
  readonly context: PromptContext
  readonly cases: OpposedCases
  readonly claims: readonly DebateClaim[]
  readonly history: string
}

export function managerPrompt(input: ManagerPrompt): RolePrompt {
  const { context, history } = input

  return {
    instructions: [
      'You are the portfolio manager. Weigh the two cases and decide whether the idea proceeds.',
      'proceed means the idea becomes a suggestion the operator reads, carrying the levels below.',
      'hold means it is discarded and the operator is shown nothing at all.',
      'Proceed when the accepted claims support a directional case at these levels, even a weak one:',
      'how weak it is travels as conviction and as position size, and neither of those is yours to',
      'set. Hold when the evidence contradicts the case, or when nothing in it supports one. A case',
      'that is merely thin is a low-conviction proceed, never a hold.',
      EVIDENCE_INSTRUCTIONS,
      'acceptedClaims and rejectedClaims hold claim ids from the list below — ids only, never the',
      'claim text. The accepted ones are independently verified, and one the evidence contradicts',
      'holds the whole suggestion.',
      'Your verdict and the conviction band are both rendered on their own lines above your',
      'rationale, so never name either in it: a rationale that repeats them reads as a second',
      'opinion, and naming them in your own words invents a term the operator has not been shown.',
      INVALIDATOR_INSTRUCTIONS,
    ].join('\n'),
    message: [
      orderedCases(context, input.cases),
      '',
      renderClaims(input.claims),
      '',
      orderedEvidence(context),
      ...bookSection(context),
      '',
      context.evidence.adjudication,
      ...(history === '' ? [] : ['', history]),
    ].join('\n'),
  }
}

/** The session an order placed now would trade in. Timing needs it, and a role left to guess timed
 *  an entry into a session that had already closed. */
function sessionLine(context: { readonly input: DebateInput; readonly market: Market }): string {
  const { calendar } = context.market.manifest
  const { now } = context.input.request

  if (calendar.continuous) {
    return 'SESSION: this market trades around the clock, so an order placed now trades now.'
  }

  const phase = sessionPhase(calendar, now)
  const session = orderSessionOf(calendar, now)

  if (phase === 'open' || phase === 'break') {
    return `SESSION: open today, ${session}; an order placed now trades in today's session.`
  }

  return `SESSION: closed now. The next session an order can trade in is ${session}; time the entry for that session and never call it today's.`
}

/** Upstream reasoning reaches the trader and the risk reviewer; upstream verdicts do not. Handed a
 *  verdict, both restate it, and the operator reads an echo as if it were a second opinion. */
export function traderPrompt(
  context: PromptContext & { readonly market: Market },
  manager: PortfolioManagerDecision
): RolePrompt {
  return {
    instructions: [
      'You are the trader. Express timing and entry conditions around the fixed levels.',
      'Stance avoid means the trade does not go on at all; wait is timing only.',
      'The entry is where the order goes on - the current price, or a limit below it when LEVELS',
      'says so - so reaching it is not something to wait for. A wait names a',
      'condition the evidence shows has not happened yet - a close beyond a level, a reading that',
      'has to turn. If nothing has to happen first, the stance is enter.',
      'entryTiming is never empty: for wait, say what you are waiting for; for avoid, say what would have to change.',
      'You do not choose a size: sizingIntent is an intent, not a quantity. On a wait it is the size',
      'you would take once the conditions are met; none belongs with avoid.',
      'You cannot see the order book, spreads, lots, ticks, or price-band room, and must not mention',
      'them: tradeability is a deterministic stage that runs after you and again before the operator',
      'acts. A condition that says nothing needs to happen is not a condition; leave it out.',
      'A condition that turns on a price sets "above" or "below" to that level, written as the',
      'evidence quotes it, and leaves both null otherwise. "above" is checked against the current',
      'price and "below" against the entry, and one already met is dropped, so compare the numbers',
      'before you wait on one.',
      'Every condition names its kind: price (a close or print beyond a level), reading (a measured',
      'reading that has to turn), event (a dated event), volume (a traded-volume threshold), or timing',
      '(a time of day or session). When to place the order belongs in entryTiming, and a timing',
      'condition never holds a wait.',
      'Reach your own stance from the evidence; the read below is context, not a decision to copy.',
      `Give at most ${MAXIMUM_CLAIMS} entryConditions and at most ${MAXIMUM_CLAIMS} notes.`,
      EVIDENCE_INSTRUCTIONS,
    ].join('\n'),
    // The session line names today's date, so it is this call's own and never an instruction.
    message: [
      sessionLine(context),
      '',
      `PORTFOLIO MANAGER'S READ: ${manager.rationale}`,
      '',
      orderedEvidence(context),
    ].join('\n'),
  }
}

export function riskPrompt(
  context: PromptContext,
  manager: PortfolioManagerDecision,
  trader: TradePlan
): RolePrompt {
  return {
    instructions: [
      'You are the risk reviewer. You may accept, lower conviction, or block.',
      'Block only when acting at these levels would be unsafe on evidence you can see, such as an',
      'accepted claim that contradicts the setup. The levels are set by rule, so how far the stop or',
      'the target sits is never a finding. Missing information is never a block — evidence you do',
      'not have lowers conviction instead.',
      'You cannot see venue microstructure, portfolio weights, position limits, or correlation.',
      'Sizing and portfolio fit are computed deterministically after you, so never block for their',
      'absence, and reach your own verdict rather than restating the reads below.',
      'Timing is not a risk finding either: an idea whose entry has not triggered yet is still',
      'accepted, at whatever conviction the evidence supports.',
      `Every verdict carries notes, at most ${MAXIMUM_CLAIMS}.`,
      'Lowering must name a strictly lower band; you cannot raise conviction or move a level.',
      probabilityInstructions(context),
      EVIDENCE_INSTRUCTIONS,
    ].join('\n'),
    message: [
      `PORTFOLIO MANAGER'S READ: ${manager.rationale}`,
      `TRADER'S TIMING: ${trader.entryTiming}`,
      '',
      orderedEvidence(context),
      '',
      context.evidence.adjudication,
    ].join('\n'),
  }
}

/** A proper score: the role's best answer is its true belief, because a probability stated to
 *  persuade scores worse than one stated to be right. Built per call rather than once, because the
 *  window it names is the one this sleeve's horizon is scored over. */
function probabilityInstructions(context: PromptContext): string {
  return [
    'probability is your own estimate, 0 to 1, that this call closes with a positive return within',
    `${OUTCOME_WINDOW_DAYS[context.input.draft.horizon]} calendar days, however it exits - at a level`,
    'or at expiry. It is scored later against what actually happened, so state what you believe, not what',
    'the case argues. It never changes conviction or size.',
  ].join(' ')
}

export function verifierPrompt(
  context: PromptContext,
  claims: readonly DebateClaim[],
  invalidators: readonly Invalidator[]
): RolePrompt {
  return {
    instructions: [
      'You are the claim verifier. Give every claim and every condition below exactly one verdict,',
      'keyed by its id.',
      'supported: the evidence states it, or it follows from reading the evidence directly —',
      'combining two rows, comparing them, or restating a number in words.',
      'refuted: the evidence states something that contradicts it.',
      'insufficient: the evidence carries nothing on the point, so neither answer is available.',
      'A row marked background is about another company or the market as a whole; it supports nothing',
      'about this instrument, however closely it reads like it does.',
      'A claim you cannot check is insufficient, never refuted. Judge the claim, not its wording,',
      'and attach the citation that carries the support when there is one.',
      ...(invalidators.length === 0 ? [] : CONDITION_INSTRUCTIONS),
    ].join('\n'),
    message: [
      renderClaims(claims),
      ...(invalidators.length === 0 ? [] : ['', renderConditions(invalidators)]),
      '',
      orderedEvidence(context),
    ].join('\n'),
  }
}

function renderClaims(claims: readonly DebateClaim[]): string {
  const lines = claims.map((claim) => `${claim.id} (${claim.stance}): ${claim.text}`)

  return `CLAIMS:\n${lines.join('\n')}`
}

function renderConditions(invalidators: readonly Invalidator[]): string {
  const lines = invalidators.map((entry) => `${entry.id}: ${entry.text}`)

  return `CONDITIONS:\n${lines.join('\n')}`
}

/** The manager alone reads the book: the two researchers argue this name's evidence, and the risk
 *  reviewer is told it cannot see weights because the sizer enforces every cap after it — a block
 *  there would discard an idea the sizer would merely have made smaller. Whether the idea belongs
 *  in this book at all is the manager's own question, and it was answering it blind. */
function bookSection(context: PromptContext): readonly string[] {
  const { portfolio } = context.evidence

  return portfolio === '' ? [] : ['', portfolio]
}

/** Presentation order alternates by a stable hash of market and ticker, so neither case
 *  systematically anchors the synthesis and the same ticker orders the same way every run. */
function orderedCases(context: PromptContext, cases: OpposedCases): string {
  const bull = `BULL CASE (${cases.bull.stance}): ${cases.bull.summary}`
  const bear = `BEAR CASE (${cases.bear.stance}): ${cases.bear.summary}`

  return bullFirst(context) ? `${bull}\n\n${bear}` : `${bear}\n\n${bull}`
}

function orderedEvidence(context: PromptContext): string {
  return `EVIDENCE:\n${context.evidence.text}`
}

function bullFirst(context: PromptContext): boolean {
  const key = `${context.input.draft.instrument.market}:${context.input.draft.instrument.ticker}`
  let hash = 0

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 1_000_003
  }

  return hash % 2 === 0
}
