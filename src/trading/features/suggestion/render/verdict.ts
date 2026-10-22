import type { HaltCode, HaltDetail } from '@/core/errors'
import type { Locale } from '@/core/types/locale'
import type { RunResultReason } from '@/core/types/run'
import type { MessageKey } from '@/i18n'
import type {
  BatchOvercommit,
  SuggestionBatchResult,
} from '@/trading/features/suggestion/batch-types'
import type { StoredSuggestion, SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { Caveat, HoldReasonCode, ReduceReasonCode } from '@/trading/kernel/caveat'
import type { FactorResult } from '@/trading/kernel/factor'
import type { RunFocus } from '@/trading/kernel/operator/focus'
import type { ProfileStamp } from '@/trading/kernel/operator/profile'
import { BRAND } from '@/core/brand'
import { setEnvCommand } from '@/core/config/resolve'
import { t } from '@/i18n'
import { renderProfileStamp } from '@/trading/features/profile/render'
import { shownCall } from '@/trading/features/suggestion/render/second-opinion'
import { isInconclusive } from '@/trading/features/suggestion/types'
import { MILD_SCORE_AT } from '@/trading/kernel/conviction'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { renderCaveatLines } from '@/trading/render/caveat'
import { renderCapBreachLines } from '@/trading/render/exposure'
import { renderFocusLabel } from '@/trading/render/focus'
import { formatFraction, renderDeclaredValue } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'

/** One verdict per line, because a hold carries the reason that held it and those are sentences.
 *  The leading newline marks a block, which a surface renders under the tool line, not inline. */
export function renderBatchVerdicts(
  locale: Locale,
  batch: SuggestionBatchResult
): string | undefined {
  const { breaches, overcommit, results } = batch

  if (results.length === 0) {
    return undefined
  }

  const lines = [
    ...batchStampLine(locale, results),
    ...results.map((result) => renderVerdict(locale, result)),
  ]
  const verdicts = lines.map((line) => `${INDENT[1]}${line}`).join('\n')

  return `\n${verdicts}${renderCombinedBlock(locale, { breaches, overcommit })}`
}

/** Under the verdicts, not among them: a ceiling crossed is a fact about the set, and a line inside
 *  the one-per-name list would read as a verdict on whichever name it followed. */
function renderCombinedBlock(
  locale: Locale,
  combined: Pick<SuggestionBatchResult, 'breaches' | 'overcommit'>
): string {
  const lines = [
    ...renderCapBreachLines(locale, combined.breaches),
    ...renderOvercommitLines(locale, combined.overcommit),
  ]

  if (lines.length === 0) {
    return ''
  }

  return `\n${[`${INDENT[1]}${t(locale, 'trading.render.suggestion.combinedLead')}`, ...lines].join('\n')}`
}

/** One sentence per budget the set spends past, written under the breaches' lead. */
function renderOvercommitLines(
  locale: Locale,
  overcommit: readonly BatchOvercommit[]
): readonly string[] {
  return overcommit.map((item) => `${INDENT[1]}${renderOvercommit(locale, item)}`)
}

function renderOvercommit(locale: Locale, item: BatchOvercommit): string {
  const params = {
    need: formatFraction(locale, item.needPctNav),
    available: formatFraction(locale, item.availablePctNav),
  }

  if (item.kind === 'open-risk') {
    return t(locale, 'trading.render.suggestion.overcommitOpenRisk', params)
  }

  if (item.market === undefined) {
    return t(locale, 'trading.render.suggestion.overcommitCash', params)
  }

  return t(locale, 'trading.render.suggestion.overcommitMarketCash', {
    ...params,
    market: renderDeclaredValue(locale, `trading.market.${item.market}`),
  })
}

/** One read shapes every name in a batch, so the policy is stated once above them. Absent when no
 *  item reached a stored row - an unsupported ticker and a failed run were gated by nothing. */
function batchStampLine(
  locale: Locale,
  results: readonly SuggestionRunResult[]
): readonly string[] {
  const stamp = results.map(storedProfile).find((entry) => entry !== undefined)

  return stamp === undefined ? [] : [renderProfileStamp(locale, stamp)]
}

function storedProfile(result: SuggestionRunResult): ProfileStamp | undefined {
  if (result.kind === 'completed') {
    return result.suggestion.profile
  }

  if (result.kind === 'cooldown') {
    return result.previous.profile
  }

  return undefined
}

/** The horizon prints beside the stamp because it is the suggestion's own fact, not the profile's:
 *  a segment horizon is overridden per segment, and the run recorded the one it sized against. */
export function renderStampLine(locale: Locale, suggestion: StoredSuggestion): readonly string[] {
  const stamp = renderProfileStamp(locale, suggestion.profile)
  const horizon = t(locale, 'trading.render.suggestion.horizon', {
    horizon: renderDeclaredValue(locale, `trading.horizon.${suggestion.horizon}`),
  })

  return [`${INDENT[1]}${stamp}${INLINE_SEPARATOR}${horizon}`]
}

/** One line naming what the run decided. Total over the union: an item that failed reads as a
 *  failure, never as one the market does not support. */
export function renderVerdict(locale: Locale, result: SuggestionRunResult): string {
  switch (result.kind) {
    case 'completed':
      return renderStoredVerdict(locale, result.suggestion)
    // A cooldown still has a verdict to show — the one the operator is being held to.
    case 'cooldown':
      return renderStoredVerdict(locale, result.previous)
    case 'unsupported':
      return renderUnsupportedReason(locale, result)
    case 'error':
      return t(locale, 'trading.render.suggestion.error', { ticker: result.ticker })
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

/** Conviction grades an action, so a hold reports the reason it held instead: the band beside "no
 *  action" reads as confidence in a trade the run declined to propose. */
function renderStoredVerdict(locale: Locale, call: StoredSuggestion): string {
  const suggestion = shownCall(call)
  const params = {
    ticker: suggestion.instrument.ticker,
    action: renderDeclaredValue(locale, `trading.action.${suggestion.action}`),
  }

  if (suggestion.action !== 'hold') {
    return t(locale, 'toolSummaries.suggestionVerdict', {
      ...params,
      conviction: renderDeclaredValue(locale, `trading.conviction.${suggestion.conviction}`),
    })
  }

  const reasons = renderHoldReasons(locale, suggestion).join(' ')

  return reasons === ''
    ? t(locale, 'toolSummaries.suggestionVerdictAction', params)
    : t(locale, 'toolSummaries.suggestionVerdictHold', { ...params, reasons })
}

/** `market-not-tradeable` covers a band edge, a full foreign room, a halt and a delisting alike; the
 *  caveat stored beside it names which one, so the operator reads the cause, not the category. */
function notTradeableKey(caveats: readonly Caveat[]): `trading.${string}` {
  for (const caveat of caveats) {
    if (caveat.code === 'market.band-edge-blocked') {
      return caveat.detail?.edge === 'floor'
        ? 'trading.holdBlocked.floor'
        : 'trading.holdBlocked.ceiling'
    }

    if (caveat.code === 'market.foreign-room-exhausted' && caveat.detail?.blocks === 1) {
      return 'trading.holdBlocked.foreign-room'
    }
  }

  return 'trading.hold.market-not-tradeable'
}

interface HeldCall {
  readonly holdReasonCodes: readonly HoldReasonCode[]
  readonly caveats: readonly Caveat[]
  readonly reduceReasonCode?: ReduceReasonCode
  /** The rows the composite folded, which say how hard a contested read actually pulls apart. */
  readonly factorScores: readonly FactorResult[]
}

function renderHoldReason(locale: Locale, code: HoldReasonCode, call: HeldCall): string {
  if (code === 'market-not-tradeable') {
    return renderDeclaredValue(locale, notTradeableKey(call.caveats))
  }

  return code === 'factors-contested' && !isPulledApart(call.factorScores)
    ? renderDeclaredValue(locale, 'trading.holdContested.faint')
    : renderDeclaredValue(locale, `trading.hold.${code}`)
}

/** Contested says the factors pull hard both ways only when each side has a factor past the lean
 *  the scale calls clear; a disagreement against a reading near zero is a read that does not lean. */
function isPulledApart(factors: readonly FactorResult[]): boolean {
  return (
    factors.some((factor) => factor.score >= MILD_SCORE_AT) &&
    factors.some((factor) => factor.score <= -MILD_SCORE_AT)
  )
}

/** A hold on a name a sale was called for leads with that sale's reason. */
export function renderHoldReasons(locale: Locale, suggestion: HeldCall): readonly string[] {
  const reasons = suggestion.holdReasonCodes.map((code) =>
    renderHoldReason(locale, code, suggestion)
  )
  const sale = suggestion.reduceReasonCode

  return sale === undefined
    ? reasons
    : [
        renderDeclaredValue(locale, 'trading.render.suggestion.saleReason', {
          reason: renderDeclaredValue(locale, `trading.brief.reduce-reason.${sale}`),
        }),
        ...reasons,
      ]
}

/** The reason on its own line. The candidate-market hint that follows it in the full text is the
 *  caller's, because a batch verdict is one line per item. */
export function renderUnsupportedReason(
  locale: Locale,
  result: Extract<SuggestionRunResult, { readonly kind: 'unsupported' }>
): string {
  return renderDeclaredValue(locale, `trading.suggestion.unsupported.${result.reason}`, {
    ticker: result.ticker,
    ...(result.market === undefined ? {} : { market: result.market }),
    ...(result.focusLabel === undefined ? {} : { focus: result.focusLabel }),
  })
}

/** A refusal for being outside the caller's focus names that focus, which only the surface knows
 *  how to say in the reader's language. Every other result passes through. */
export function labelOutsideFocus(
  locale: Locale,
  focus: RunFocus,
  result: SuggestionRunResult
): SuggestionRunResult {
  if (result.kind !== 'unsupported' || result.reason !== 'outside-focus') {
    return result
  }

  return { ...result, focusLabel: renderFocusLabel(locale, focus.focus) }
}

/** What the operator should do next, keyed by what stopped the debate. `haltCause` flattens three
 *  vocabularies into one string — the provider's own classification, the halt code, then the run's
 *  reason — so every member of all three is answered here and a new one is a compile error. That
 *  exhaustiveness is the point: a bad model id and an overloaded provider both used to fall through
 *  to "retry in a few minutes", and only one of them ever clears. */
const INCONCLUSIVE_HINT_KEYS = {
  setup: 'trading.render.suggestion.inconclusiveHintSetup',
  auth: 'trading.render.suggestion.inconclusiveHintProvider',
  billing: 'trading.render.suggestion.inconclusiveHintProvider',
  run_budget: 'trading.render.suggestion.inconclusiveHintCostCap',
  daily_cap: 'trading.render.suggestion.inconclusiveHintCostCap',
  monthly_cap: 'trading.render.suggestion.inconclusiveHintCostCap',
  agent_daily_cap: 'trading.render.suggestion.inconclusiveHintAgentCap',
  ledger_unavailable: 'trading.render.suggestion.inconclusiveHintCostCap',
  budget: 'trading.render.suggestion.inconclusiveHintCostCap',
  aborted: 'trading.render.suggestion.inconclusiveHintCancelled',
  abort: 'trading.render.suggestion.inconclusiveHintCancelled',
  shutdown: 'trading.render.suggestion.inconclusiveHintCancelled',
  transient: 'trading.render.suggestion.inconclusiveHintProviderSilent',
  timeout: 'trading.render.suggestion.inconclusiveHintProviderSilent',
  empty_response: 'trading.render.suggestion.inconclusiveHintProviderSilent',
  fatal: 'trading.render.suggestion.inconclusiveHintProviderSilent',
  llm_error: 'trading.render.suggestion.inconclusiveHintProviderSilent',
  error: 'trading.render.suggestion.inconclusiveHintProviderSilent',
  rate: 'trading.render.suggestion.inconclusiveHintRateLimited',
  not_found: 'trading.render.suggestion.inconclusiveHintModelMissing',
  context_overflow: 'trading.render.suggestion.inconclusiveHintTooLarge',
  output_budget_exhausted: 'trading.render.suggestion.inconclusiveHintTooLarge',
  response_too_large: 'trading.render.suggestion.inconclusiveHintTooLarge',
  length_limit: 'trading.render.suggestion.inconclusiveHintTooLarge',
  content_filter: 'trading.render.suggestion.inconclusiveHintContentFiltered',
  turn_limit: 'trading.render.suggestion.inconclusiveHintTurnLimit',
  loop: 'trading.render.suggestion.inconclusiveHintTurnLimit',
  'invalid-output': 'trading.render.suggestion.inconclusiveHintInvalidOutput',
  'no-budget-slice': 'trading.render.suggestion.inconclusiveHintNoBudget',
  queue_full: 'trading.render.suggestion.inconclusiveHintInternal',
  session_busy: 'trading.render.suggestion.inconclusiveHintInternal',
  no_agents: 'trading.render.suggestion.inconclusiveHintInternal',
  hook_failed: 'trading.render.suggestion.inconclusiveHintInternal',
  agent_paused: 'trading.render.suggestion.inconclusiveHintPaused',
} as const satisfies Record<InconclusiveCause, MessageKey>

/** Everything `haltCause` can report, plus the two failures the debate mints itself. */
type InconclusiveCause =
  | HaltDetail
  | HaltCode
  | Exclude<RunResultReason, 'completed'>
  | 'invalid-output'
  | 'no-budget-slice'
  | 'setup'

const DEFAULT_INCONCLUSIVE_HINT_KEY: MessageKey = 'trading.render.suggestion.inconclusiveHintRetry'
export function filteredCaveats(suggestion: StoredSuggestion): readonly Caveat[] {
  return isInconclusive(suggestion)
    ? suggestion.caveats.filter((caveat) => caveat.code !== 'suggestion.debate-degraded')
    : suggestion.caveats
}

/** The degraded-debate caveat, hoisted under the price where a top-down reader meets it, plus one
 *  actionable way forward — never the bare "run it again" that ignores that they just did, and
 *  never a retry the cause has already ruled out. */
export function inconclusiveBanner(
  locale: Locale,
  suggestion: StoredSuggestion
): readonly string[] {
  const degraded = suggestion.caveats.filter(
    (caveat) => caveat.code === 'suggestion.debate-degraded'
  )
  const params = { instrument: buildInstrumentKey(suggestion.instrument), brand: BRAND.name }
  const env = envOf(degraded)
  const hint =
    env === undefined
      ? t(locale, hintKeyFor(causeOf(degraded)), params)
      : t(locale, 'trading.render.suggestion.inconclusiveHintKeyMissing', {
          ...params,
          env,
          command: setEnvCommand(env),
        })

  return [...renderCaveatLines(locale, degraded), `${INDENT[1]}${hint}`]
}

/** Widened to a plain lookup so an unrecognised cause — a stored row from an older build — reads as
 *  the generic retry rather than failing to type. */
function hintKeyFor(cause: string): MessageKey {
  const keys: Readonly<Record<string, MessageKey | undefined>> = INCONCLUSIVE_HINT_KEYS

  return keys[cause] ?? DEFAULT_INCONCLUSIVE_HINT_KEY
}

/** The first failure is the one that stopped the debate: a later role never ran, and `failFast`
 *  makes its sibling's abort a consequence rather than a cause. */
function causeOf(degraded: readonly Caveat[]): string {
  const cause = degraded[0]?.detail?.cause

  return typeof cause === 'string' ? cause : ''
}

/** The unset key variable the stopped debate names, so the hint says which one to set rather than
 *  pointing at `doctor`. A row stored before a failure carried it has none. */
function envOf(degraded: readonly Caveat[]): string | undefined {
  const env = degraded[0]?.detail?.env

  return typeof env === 'string' ? env : undefined
}

/** The band's own record, not the book's: a reader deciding how much to trust this call is asking
 *  what calls like it have done, and no other line answers that. */
