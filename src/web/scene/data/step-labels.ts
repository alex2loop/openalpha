import type { ProgressWire } from '@/app/server/wire/live'
import type { MessageKey } from '@/i18n'
import { toParamText } from '@/web/scene/data/room-status'
import { TRUNCATION_MARK } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

const STAGE_DETAIL_KEY = 'progress.researchStageDetail'
// A step no label names is cut to this many characters.
const SHORT_MAX = 14
const PART_SEPARATOR = ' · '
// Parameters that name what the whole run is about; the command line already says it.
const SUBJECT_PARAMS = ['ticker', 'market', 'title'] as const
const LEADING_MARKS = /^[^\p{L}\p{N}]+/u
const TRAILING_MARKS = /[\s.…]+$/u

/** A step's label: the catalog line, then the progress parameters it reads. */
type StepLabel = readonly [key: MessageKey, ...params: string[]]

/** The short terminal label of every step the office knows, by the progress key a run reports. */
const STEP_LABELS: Readonly<Record<string, StepLabel>> = Object.freeze({
  'trading.progress.suggestion.resolve': ['ui.office.step.resolve'],
  'trading.progress.suggestion.cooldown': ['ui.office.step.cooldown'],
  'trading.progress.suggestion.portfolio': ['ui.office.step.portfolio'],
  'trading.progress.suggestion.factors': ['ui.office.step.factors'],
  'trading.progress.suggestion.levels': ['ui.office.step.levels'],
  'trading.progress.suggestion.gate': ['ui.office.step.gates'],
  'trading.progress.suggestion.debate': ['ui.office.step.debate'],
  'trading.progress.suggestion.shared': ['ui.office.step.shared'],
  'trading.progress.suggestion.stages': ['ui.office.step.stages'],
  'trading.progress.suggestion.persist': ['ui.office.step.saving'],
  'trading.progress.debate.cases': ['ui.office.step.cases', 'step', 'total'],
  'trading.progress.debate.synthesis': ['ui.office.step.verdict', 'step', 'total'],
  'trading.progress.debate.plan': ['ui.office.step.draft', 'step', 'total'],
  'trading.progress.debate.analysis': ['ui.office.step.evidence', 'step', 'total'],
  'trading.progress.debate.verification': ['ui.office.step.verify', 'step', 'total'],
  'trading.progress.brief.data': ['ui.office.step.data'],
  'trading.progress.brief.sections': ['ui.office.step.sections'],
  'trading.progress.brief.persist': ['ui.office.step.saving'],
  'trading.progress.refresh.instruments': ['ui.office.step.tickers'],
  'trading.progress.refresh.bars': ['ui.office.step.bars', 'done', 'total'],
  'trading.progress.refresh.fundamentals': ['ui.office.step.ratios', 'done', 'total'],
  'trading.progress.refresh.accounts': ['ui.office.step.filings', 'done', 'total'],
  'trading.progress.refresh.flows': ['ui.office.step.flows', 'done', 'total'],
  'trading.progress.refresh.macro': ['ui.office.step.macro'],
  'trading.progress.refresh.premium': ['ui.office.step.premium'],
  'trading.progress.refreshJoined': ['ui.office.step.waiting'],
  'trading.progress.themes.evidence': ['ui.office.step.data'],
  'trading.progress.themes.update': ['ui.office.step.recheck'],
  'trading.progress.themes.discover': ['ui.office.step.discover'],
  'trading.progress.themes.sectors': ['ui.office.step.sectors'],
  'trading.progress.themes.companies': ['ui.office.step.companies'],
  'trading.progress.themes.company': ['ui.office.step.earnings'],
  'progress.researchStartLight': ['ui.office.step.depthLight'],
  'progress.researchStartMedium': ['ui.office.step.depthMedium'],
  'progress.researchStartDeep': ['ui.office.step.depthDeep'],
  'progress.researchStagePlan': ['ui.office.step.plan'],
  'progress.researchStagePlanComplete': ['ui.office.step.planReady'],
  'progress.researchStageCrawl': ['ui.office.step.sources'],
  'progress.researchStageCrawlProgress': ['ui.office.step.questionsDone', 'done', 'total'],
  'progress.researchStageCrawlComplete': ['ui.office.step.sourcesChecked'],
  'progress.researchStageSynthesize': ['ui.office.step.report'],
  'progress.researchStageSynthesizeComplete': ['ui.office.step.reportReady'],
  'progress.researchStageReview': ['ui.office.step.review'],
  'progress.researchStageReviewComplete': ['ui.office.step.reviewDone'],
  'progress.researchSupportedClaims': ['ui.office.step.sourcesUsed', 'sources'],
  'progress.researchQuestionRunning': ['ui.office.step.question', 'index', 'total'],
  'progress.researchQuestionActivity': ['ui.office.step.question', 'index', 'total'],
  'progress.researchQuestionComplete': ['ui.office.step.question', 'index', 'total'],
  'progress.researchQuestionRetry': ['ui.office.step.questionRetry', 'index', 'total'],
  'progress.researchFallbackRunning': ['ui.office.step.retry'],
  'progress.researchReviewFollowupRunning': ['ui.office.step.followUp', 'index', 'total'],
  'progress.researchReviewFollowupComplete': ['ui.office.step.followUp', 'index', 'total'],
})

interface StepKey {
  readonly key: string
  readonly params?: Readonly<Record<string, unknown>> | undefined
}

/** The step a progress line stands for: a research stage's line wraps the stage's own key. */
export function stepOf(progress: ProgressWire): StepKey {
  const stage = progress.params?.stage

  if (progress.key !== STAGE_DETAIL_KEY || typeof stage !== 'object' || stage === null) {
    return progress
  }

  return 'key' in stage && typeof stage.key === 'string'
    ? { key: stage.key, params: 'params' in stage ? paramsOf(stage.params) : undefined }
    : progress
}

/** A step's terminal form: its catalog label (with the figures the run carries) when the progress
 *  key is known, else the run's own text cut short. */
export function stepLabelOf(progress: ProgressWire): string {
  const step = stepOf(progress)
  const label = Object.hasOwn(STEP_LABELS, step.key) ? STEP_LABELS[step.key] : undefined

  return (label === undefined ? undefined : labelText(label, step)) ?? shortTextOf(progress)
}

// The label with its parameters filled in; absent when the run did not carry one of them.
function labelText(label: StepLabel, step: StepKey): string | undefined {
  const [key, ...names] = label
  const values: Record<string, string> = {}

  for (const name of names) {
    const value = toParamText(step.params?.[name])

    if (value === undefined) {
      return undefined
    }

    values[name] = value
  }

  return tr(key, values)
}

// The run's text without the subject its command line names and without marks at either end.
function shortTextOf(progress: ProgressWire): string {
  const subjects = SUBJECT_PARAMS.map((name) => toParamText(progress.params?.[name]))
  const parts = progress.text.split(PART_SEPARATOR)
  const text = (subjects.includes(parts[0]) ? parts.slice(1) : parts)
    .join(PART_SEPARATOR)
    .replace(LEADING_MARKS, '')
    .replace(TRAILING_MARKS, '')

  return text.length <= SHORT_MAX
    ? text
    : `${text.slice(0, SHORT_MAX - TRUNCATION_MARK.length).trimEnd()}${TRUNCATION_MARK}`
}

function paramsOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : undefined
}
