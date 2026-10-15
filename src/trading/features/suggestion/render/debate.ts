import type { Locale } from '@/core/types/locale'
import type {
  ManagerVerdict,
  ResearchStance,
  RiskVerdict,
  StoredDebate,
  StoredDebateFull,
  TradeStance,
} from '@/trading/features/suggestion/debate/types'
import type { SuggestionDirection } from '@/trading/features/suggestion/types'
import type { LeanDebateReason } from '@/trading/kernel/config'
import type { SuggestionAction } from '@/trading/kernel/conviction'
import { t } from '@/i18n'
import { isTraderRefusal } from '@/trading/features/suggestion/debate/types'
import { DEBATE_MODE_ROLES } from '@/trading/kernel/config'
import { toFoldLines } from '@/trading/render/fold'
import {
  DIRECTION_MARKS,
  formatCount,
  renderDeclaredValue,
  renderProvidedValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, renderSectionTitle } from '@/trading/render/layout'

/** The trailing space is load-bearing: a Vietnamese thousands separator is a dot without one, so
 *  `50.700` would otherwise end a sentence. */
const SENTENCE_END_RE = /[.!?]\s/
/** Roles restate their own stance ("Bearish: ...") ahead of a label that already carries it. */
const STANCE_PREFIX_RE = /^(?:bullish|bearish|neutral)\s*[:-]\s*/i

/** Verdict glyphs, distinct from the ▲/▼ factor marks: a declined idea is not a bearish forecast,
 *  and sharing the arrow made the manager's refusal read as a downside call. `caution` is hollow
 *  rather than filled because the filled diamond is the flat-direction mark. */
const VERDICT_MARKS = Object.freeze({ pass: '✓', caution: '◇', stop: '✗' })

/** Who is speaking, beside the verdict marks they share a column with, rather than inside a catalog
 *  value a translator can drop or change. */
const SPEAKER_MARKS = Object.freeze({ bull: '🐂', bear: '🐻' })
/** The step whose verdict is the debate's own, not a role's. */
const OUTCOME_MARK = '➡️'

/** Only a value that could have gone the other way is marked. Bull and bear carry none: their
 *  direction is fixed by the role, so it would restate the label — unless the verifier rejected
 *  what they said. `satisfies` makes a new verdict a compile error rather than an unmarked row. */
const MANAGER_MARKS = {
  proceed: VERDICT_MARKS.pass,
  hold: VERDICT_MARKS.stop,
} as const satisfies Record<ManagerVerdict, string>

const RISK_MARKS = {
  accept: VERDICT_MARKS.pass,
  lower: VERDICT_MARKS.caution,
  block: VERDICT_MARKS.stop,
} as const satisfies Record<RiskVerdict, string>

const TRADE_MARKS = {
  enter: VERDICT_MARKS.pass,
  wait: VERDICT_MARKS.caution,
  avoid: VERDICT_MARKS.stop,
} as const satisfies Record<TradeStance, string>

const STANCE_MARKS = {
  bullish: DIRECTION_MARKS.up,
  bearish: DIRECTION_MARKS.down,
  neutral: DIRECTION_MARKS.flat,
} as const satisfies Record<ResearchStance, string>

/** How many entry conditions a compact read prints. The role orders them by weight, and past the
 *  first few it reaches execution mechanics the deterministic stages already enforce — so the tail
 *  is where the noise collects, and the compact detail is what collapses it. */
const COMPACT_CONDITION_ROWS = 3

/** How much of each debate voice to print: `compact` trims each to its opening sentence. */
export type SuggestionDetail = 'compact' | 'full'

/** What the debate block needs beyond the debate itself: the claims the verifier rejected, to mark
 *  the voice that said them, and the thesis, because a full debate publishes the manager's
 *  rationale as both and printing it twice reads as two findings. */
interface DebateView {
  readonly locale: Locale
  readonly detail: SuggestionDetail
  /** What the run decided, which the debate rows may not contradict: a held run prints no size and
   *  no "the suggestion stands". */
  readonly action: SuggestionAction
  /** The side the debate argued over, so the bull and bear labels name the decision on the table. */
  readonly direction: SuggestionDirection
  readonly unsupported: ReadonlySet<string>
  readonly thesis?: string
}

export function renderDebateLines(view: DebateView, debate: StoredDebate): readonly string[] {
  if (debate.mode === 'lean') {
    const analyst = voice(view, debate.analystSummary, STANCE_MARKS[debate.analystStance])
    const stance = renderDeclaredValue(view.locale, `trading.debate.stance.${debate.analystStance}`)
    const row = statesThesis(view, debate.analystSummary)
      ? t(view.locale, 'trading.render.suggestion.debateAnalystStance', { stance })
      : t(view.locale, 'trading.render.suggestion.debateAnalyst', {
          stance,
          summary: analyst.text,
        })

    return [
      renderSectionTitle(SECTION_ICONS.debate, t(view.locale, 'trading.render.suggestion.debate')),
      leanReasonRow(view.locale, debate.reason),
      ...trimNotice(view, debate),
      ...skillsRow(view, debate),
      ...proseFold(view, [debateRow(analyst.mark, row)]),
    ]
  }

  const staged = renderFullDebate(view, debate)

  return [
    renderSectionTitle(
      SECTION_ICONS.debate,
      t(view.locale, 'trading.render.suggestion.debateStaged')
    ),
    ...staged.verdicts,
    ...trimNotice(view, debate),
    ...skillsRow(view, debate),
    ...proseFold(view, staged.prose),
  ]
}

/** The case each side made, behind one tap. The verdicts above it are what the reader acts on; the
 *  argument is what they check it against, and it is four paragraphs long. */
function proseFold(view: DebateView, body: readonly string[]): readonly string[] {
  return toFoldLines(t(view.locale, 'trading.render.suggestion.debateFold'), body)
}

/** Why this run argued once instead of six times. A reader who counted the steps is owed the rule
 *  that picked them, and only the pipeline knows which of the three fired. */
function leanReasonRow(locale: Locale, reason: LeanDebateReason): string {
  return `${INDENT[1]}${t(locale, 'trading.render.suggestion.debateLean', {
    steps: formatCount(locale, DEBATE_MODE_ROLES.lean.length),
    reason: renderDeclaredValue(locale, `trading.debate.lean.${reason}`),
  })}`
}

/** What each role decided, and what each side argued. The two travel apart because only the first
 *  is a decision: the verdicts stay on the page and the case for and against folds away.
 *
 *  The gates are numbered as the pipeline runs, with the first refusing one named after the rows:
 *  the reader should see which verdict ended the idea. The case for and against is what the gates
 *  weighed, not a gate, so it carries no number. */
interface StagedDebate {
  readonly verdicts: readonly string[]
  readonly prose: readonly string[]
}

function renderFullDebate(view: DebateView, debate: StoredDebateFull): StagedDebate {
  const { locale } = view
  const bull = voice(view, debate.bullSummary)
  const bear = voice(view, debate.bearSummary)
  const [bullKey, bearKey] =
    view.direction === 'reduce'
      ? (['debateBullReduce', 'debateBearReduce'] as const)
      : (['debateBull', 'debateBear'] as const)

  return {
    verdicts: [
      managerRow(view, debate),
      ...traderRows(view, debate),
      riskRow(locale, debate),
      ...outcomeLine(view, debate),
    ],
    prose: [
      debateRow(
        bull.mark ?? SPEAKER_MARKS.bull,
        t(locale, `trading.render.suggestion.${bullKey}`, { summary: bull.text })
      ),
      debateRow(
        bear.mark ?? SPEAKER_MARKS.bear,
        t(locale, `trading.render.suggestion.${bearKey}`, { summary: bear.text })
      ),
    ],
  }
}

/** Whether this voice is the paragraph the conclusion block already carries whole. A run publishes
 *  one role's reasoning as the suggestion's thesis — the manager's when six roles argued, the
 *  analyst's when one did — and printing it here as well made the same text appear twice, trimmed
 *  then whole. The verdict stays; the reasoning is left to the block that carries all of it. */
function statesThesis(view: DebateView, summary: string): boolean {
  return view.thesis !== undefined && stripStance(view.thesis) === stripStance(summary)
}

function managerRow(view: DebateView, debate: StoredDebateFull): string {
  const { locale } = view
  const manager = voice(view, debate.managerRationale, MANAGER_MARKS[debate.managerVerdict])
  const verdict = renderDeclaredValue(locale, `trading.debate.manager.${debate.managerVerdict}`)

  if (statesThesis(view, debate.managerRationale)) {
    return debateRow(
      manager.mark,
      t(locale, 'trading.render.suggestion.debateManagerVerdict', { verdict }),
      stepLead(1)
    )
  }

  return debateRow(
    manager.mark,
    t(locale, 'trading.render.suggestion.debateManager', { verdict, rationale: manager.text }),
    stepLead(1)
  )
}

type RiskRowKey =
  | 'debateRisk'
  | 'debateRiskConviction'
  | 'debateRiskNote'
  | 'debateRiskConvictionNote'

/** The risk role reports a conviction only when it lowered one and a note only when it wrote one,
 *  so the line it fills differs. The note matters most on a block: a bare "block" decides the run
 *  without saying why. */
function riskRow(locale: Locale, debate: StoredDebateFull): string {
  const mark = RISK_MARKS[debate.riskVerdict]
  const params: Record<string, string> = {
    verdict: renderDeclaredValue(locale, `trading.debate.risk.${debate.riskVerdict}`),
  }
  let key: RiskRowKey = 'debateRisk'

  if (debate.riskConviction !== undefined) {
    params.conviction = renderDeclaredValue(locale, `trading.conviction.${debate.riskConviction}`)
    key = 'debateRiskConviction'
  }

  if (debate.riskNote !== undefined) {
    params.note = debate.riskNote
    key = debate.riskConviction === undefined ? 'debateRiskNote' : 'debateRiskConvictionNote'
  }

  return debateRow(mark, t(locale, `trading.render.suggestion.${key}`, params), stepLead(3))
}

/** The stance alone is not actionable: `wait` only reads as a decision next to what it waits for. */
function traderRows(view: DebateView, debate: StoredDebateFull): readonly string[] {
  return [traderRow(view, debate), ...traderDetailRows(view, debate)]
}

function traderRow(view: DebateView, debate: StoredDebateFull): string {
  const { locale } = view
  const stance = renderDeclaredValue(locale, `trading.debate.trader.${debate.traderStance}`)
  const mark = isTraderRefusal(debate.traderStance, debate.traderSizingIntent)
    ? VERDICT_MARKS.stop
    : TRADE_MARKS[debate.traderStance]
  const timing = voice(view, debate.traderTiming, mark)

  return debateRow(
    timing.mark,
    t(locale, 'trading.render.suggestion.debateTraderTiming', { stance, timing: timing.text }),
    stepLead(2)
  )
}

/** The conditions a `wait` is waiting on, labelled once with the rest indented under the label, and
 *  a size the trader asked to cut. Full policy size is the default the deterministic sizer already
 *  applies, so naming it would add a line that says nothing; on a held run only a refusal names its
 *  size, because any other reads as an order the verdict just declined. */
function traderDetailRows(view: DebateView, debate: StoredDebateFull): readonly string[] {
  const { locale } = view
  const [first, ...rest] = shownConditions(view, debate)
  const intent = debate.traderSizingIntent
  const refused = isTraderRefusal(debate.traderStance, intent)

  return [
    ...(first === undefined
      ? []
      : [
          debateRow(
            undefined,
            t(locale, 'trading.render.suggestion.debateTraderCondition', { condition: first }),
            INDENT[2]
          ),
        ]),
    ...rest.map((condition) => debateRow(undefined, condition, INDENT[3])),
    ...((view.action === 'hold' && !refused) || intent === 'full-policy-size'
      ? []
      : [
          debateRow(
            undefined,
            t(locale, 'trading.render.suggestion.debateTraderSizing', {
              intent: renderDeclaredValue(locale, `trading.debate.sizing.${intent}`),
            }),
            INDENT[2]
          ),
        ]),
  ]
}

/** The earliest role that refused, in the order they ran. Every role still answers after a refusal
 *  — the manager's no does not halt the debate — so this names the gate the idea failed at rather
 *  than claiming the run stopped there. Refusal means what `declineReasonOf` holds on: a lowered
 *  conviction is not one, and neither is a trader waiting, which is timing around a live idea and
 *  says so. Reaching the end means no step refused, so a hold there was decided outside the debate;
 *  otherwise a cautioned pass says so, or the header's call would read as contradicting the rows
 *  above it. */
function outcomeLine(view: DebateView, debate: StoredDebateFull): readonly string[] {
  const { locale } = view

  if (debate.managerVerdict === 'hold') {
    return [`${INDENT[1]}${t(locale, 'trading.render.suggestion.debateRefusedManager')}`]
  }
  if (isTraderRefusal(debate.traderStance, debate.traderSizingIntent)) {
    return [`${INDENT[1]}${t(locale, 'trading.render.suggestion.debateRefusedTrader')}`]
  }
  if (debate.riskVerdict === 'block') {
    return [`${INDENT[1]}${t(locale, 'trading.render.suggestion.debateRefusedRisk')}`]
  }
  if (debate.traderStance === 'wait' && view.action === 'hold') {
    return [
      `${INDENT[1]}${OUTCOME_MARK} ${t(locale, 'trading.render.suggestion.debateTraderWaiting')}`,
    ]
  }
  if (view.action === 'hold') {
    return [
      `${INDENT[1]}${OUTCOME_MARK} ${t(locale, 'trading.render.suggestion.debateHeldElsewhere')}`,
    ]
  }
  if (debate.riskVerdict === 'lower' || debate.traderStance === 'wait') {
    return [
      `${INDENT[1]}${OUTCOME_MARK} ${t(locale, 'trading.render.suggestion.debatePassedCaution')}`,
    ]
  }
  return []
}

/** A trailing ellipsis is the only sign a voice was cut, and it does not say the rest is reachable.
 *  Worded without a ticker so a channel and the CLI can print the same line. */
function trimNotice(view: DebateView, debate: StoredDebate): readonly string[] {
  if (view.detail === 'full' || !wasTrimmed(view.detail, debate)) {
    return []
  }

  return [`${INDENT[1]}${t(view.locale, 'trading.render.suggestion.debateTrimmed')}`]
}

function wasTrimmed(detail: SuggestionDetail, debate: StoredDebate): boolean {
  const prose =
    debate.mode === 'full' ? [...debateProse(debate), debate.traderTiming] : debateProse(debate)
  const conditions =
    debate.mode === 'full' && debate.traderStance !== 'enter' ? debate.traderConditions : []

  return (
    conditions.length > shownConditionCount(detail, conditions.length) ||
    prose.some((text) => shownText(detail, text) !== stripStance(text))
  )
}

/** The methods the roles applied. A debate whose roles read none has no line. */
function skillsRow(view: DebateView, debate: StoredDebate): readonly string[] {
  const skills = debate.playbook

  if (skills === undefined || skills.length === 0) {
    return []
  }

  // A stored playbook is read back as plain strings, so an id the catalog has outgrown degrades to
  // the id rather than printing a missing key. Composition gates every skill this binary carries.
  const names = skills.map((skill) =>
    renderProvidedValue(view.locale, `trading.skill.${skill}`, skill)
  )

  return [
    `${INDENT[1]}${t(view.locale, 'trading.render.suggestion.debatePlaybook', {
      count: formatCount(view.locale, names.length),
      names: names.join(INLINE_SEPARATOR),
    })}`,
  ]
}

/** The conditions a wait is waiting on, in the order the role ranked them. An `enter` waits for
 *  nothing, so whatever it listed there restates evidence printed above. */
function shownConditions(view: DebateView, debate: StoredDebateFull): readonly string[] {
  if (debate.traderStance === 'enter') {
    return []
  }

  const { traderConditions } = debate

  return traderConditions.slice(0, shownConditionCount(view.detail, traderConditions.length))
}

function shownConditionCount(detail: SuggestionDetail, total: number): number {
  return detail === 'full' ? total : Math.min(total, COMPACT_CONDITION_ROWS)
}

interface Voice {
  readonly text: string
  readonly mark?: string
}

/** A role's prose and the mark that introduces it. A claim the verifier rejected is marked where it
 *  is read, which is what lets the failed-claim block stop repeating the paragraph. */
function voice(view: DebateView, prose: string, mark?: string): Voice {
  const text = shownText(view.detail, prose)

  if (view.unsupported.has(stripStance(prose))) {
    return { text, mark: SECTION_ICONS.unverified }
  }

  return mark === undefined ? { text } : { text, mark }
}

function debateRow(mark: string | undefined, text: string, lead: string = INDENT[1]): string {
  return mark === undefined ? `${lead}${text}` : `${lead}${mark} ${text}`
}

/** A numbered step keeps its label at row depth so the numbers line up down the block; a
 *  continuation row under one drops to the next indent instead. */
function stepLead(step: number): string {
  return `${INDENT[1]}${step}. `
}

/** What the debate block actually put on the page — trimmed prose included, so a claim only counts
 *  as printed when a line carries the whole of it. */
export function shownProse(debate: StoredDebate, detail: SuggestionDetail): Set<string> {
  return new Set(debateProse(debate).map((text) => shownText(detail, text)))
}

/** The voices whose prose reaches the page as a paragraph. The trader's timing is a clause on its
 *  own row, not a case, so it is not one of them. */
function debateProse(debate: StoredDebate): readonly string[] {
  return debate.mode === 'lean'
    ? [debate.analystSummary]
    : [debate.bullSummary, debate.bearSummary, debate.managerRationale]
}

/** The opening sentence stands in for a voice unless the reader asked for all of it. */
function shownText(detail: SuggestionDetail, prose: string): string {
  const text = stripStance(prose)

  return detail === 'full' ? text : firstSentence(text)
}

/** The ellipsis replaces the sentence's own full stop, so the trim reads as one mark, not two. */
function firstSentence(text: string): string {
  const end = text.search(SENTENCE_END_RE)

  return end < 0 ? text : `${text.slice(0, end)}…`
}

export function stripStance(text: string): string {
  return text.replace(STANCE_PREFIX_RE, '').trim()
}
