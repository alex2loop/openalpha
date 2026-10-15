import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type {
  DecisionQueries,
  DecisionQuery,
  LLMResponse,
  ProviderAttempt,
  ProviderChain,
} from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { AttemptIdentity, AttemptRecorder } from '@/engine/api'
import type { SuggestionRequest } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { AssetClass, InstrumentRef } from '@/trading/kernel/instrument'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import { isAbortError, RunHalted } from '@/core/errors'
import { agentId, runId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { DECISIONS_MODEL_TIER } from '@/trading/kernel/config'
import { groupStories } from '@/trading/markets/news'
import { MINIMUM_RISK_EVENT_STORIES, riskEventCaveats } from '@/trading/markets/news-risk'

/** Below this the model is unsure, and the feed's own split stands. Start conservative; the
 *  track record is what moves it. */
const RELEVANCE_MINIMUM_CONFIDENCE = 0.6
/** Names the read's attempts in the ledger beside the debate roles'. */
const HEADLINE_READER_AGENT = 'headline-reader'
/** A caveat that colours a whole debate needs a firmer read than a headline placement does. */
const RISK_MINIMUM_CONFIDENCE = 0.8
const MAXIMUM_TITLE_CHARS = 200
const ANSWER = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }),
])
const ANSWERS = z.record(z.string(), ANSWER)
type Answer = z.infer<typeof ANSWER>
type Answers = z.infer<typeof ANSWERS>

interface ReadSpend {
  readonly identity: AttemptIdentity
  usd: number
}

interface ReadResult {
  readonly answers: Answers | undefined
  readonly costUsd: number
}
const MAXIMUM_SUMMARY_CHARS = 320

const RELEVANCE_OPTIONS = Object.freeze(['instrument', 'sector', 'market', 'unrelated'] as const)
type Relevance = (typeof RELEVANCE_OPTIONS)[number]
const RELEVANCE_CRITERIA = Object.freeze({
  instrument: 'Names this instrument or is clearly about this company or asset',
  sector: 'About its sector or asset class broadly, not this instrument',
  market: 'About the market, the index, flows, or the economy as a whole',
  unrelated: 'None of the above',
} as const satisfies Record<Relevance, string>)

const RISK_OPTIONS = Object.freeze([
  'kinetic-conflict',
  'sanctions',
  'state-emergency',
  'none',
] as const)
type RiskEvent = (typeof RISK_OPTIONS)[number]
const RISK_CRITERIA = Object.freeze({
  'kinetic-conflict': 'An airstrike, missile strike, invasion, or armed clash between forces',
  sanctions: 'Sanctions imposed on a state, a company, or a person',
  'state-emergency': 'Martial law, a coup, or a declared state of emergency',
  none: 'None of these. A trade dispute or a metaphor is none.',
} as const satisfies Record<RiskEvent, string>)

const ASSET_WORDS = Object.freeze({
  equity: 'listed company',
  gold: 'gold',
  crypto: 'crypto asset',
} as const satisfies Record<AssetClass, string>)

interface HeadlineReadInput {
  /** The `decisions` model tier, bound by composition. Absent means the operator configured none,
   *  and the read abstains. */
  readonly chain?: ProviderChain
  readonly instrument: InstrumentRef
  readonly assetClass: AssetClass
  readonly own: readonly NewsItem[]
  readonly market: readonly NewsItem[]
  readonly signal: AbortSignal
  readonly recordAttempt: AttemptRecorder
  readonly logger: Logger
  /** Who the read is billed under: the suggestion's session and parent run. */
  readonly request: Pick<SuggestionRequest, 'parentRunId' | 'billingSessionId' | 'billingAgentId'>
}

export interface HeadlineReads {
  readonly own: readonly NewsItem[]
  readonly market: readonly NewsItem[]
  readonly caveats: readonly Caveat[]
  readonly costUsd: number
}

/** One request for every headline the bundle will print. No configured model means the operator
 *  turned the read off, so the feed's own split and the keyword warning stand without a caveat.
 *  Unavailable is different: the operator asked for the read and did not get it, so the run says so.
 *  Neither ever blocks and neither deletes a headline. */
export async function readHeadlines(input: HeadlineReadInput): Promise<HeadlineReads> {
  const items = [...input.own, ...input.market]

  if (items.length === 0) {
    return { own: input.own, market: input.market, caveats: [], costUsd: 0 }
  }

  if (input.chain === undefined) {
    return { own: input.own, market: input.market, caveats: riskEventCaveats(items), costUsd: 0 }
  }

  const { answers, costUsd } = await ask(input.chain, input, items)

  if (answers === undefined) {
    return {
      own: input.own,
      market: input.market,
      caveats: [{ code: 'suggestion.headlines-unread' }, ...riskEventCaveats(items)],
      costUsd,
    }
  }

  return { ...apply(input, items, answers), costUsd }
}

/** One call, all questions. The chain owns fallback and cost; a provider that could not answer at
 *  all leaves the read absent, which the caller reports rather than treating as a clean tape. */
async function ask(
  chain: ProviderChain,
  input: HeadlineReadInput,
  items: readonly NewsItem[]
): Promise<ReadResult> {
  const spend: ReadSpend = { identity: readerIdentity(input.request), usd: 0 }

  try {
    const response = await chain.stream(
      {
        model: DECISIONS_MODEL_TIER,
        messages: [],
        maxTokens: 0,
        reasoningMode: 'off',
        signal: input.signal,
        decisions: toQueries(input, items),
      },
      () => Promise.resolve(),
      (attempt) => recordSpend(input, spend, attempt)
    )

    return { answers: toAnswers(response.content), costUsd: spend.usd }
  } catch (err: unknown) {
    if (err instanceof RunHalted || isAbortError(err) || input.signal.aborted) {
      throw err
    }

    input.logger.warn('trading.headline_read_failed', { err: formatErrForLog(err) })

    return { answers: undefined, costUsd: spend.usd }
  }
}

async function recordSpend(
  input: HeadlineReadInput,
  spend: ReadSpend,
  attempt: ProviderAttempt
): Promise<void> {
  spend.usd += await input.recordAttempt(spend.identity, attempt)
}

/** The read is not a run, so its attempts take an id of their own under the suggestion's run. */
function readerIdentity(request: HeadlineReadInput['request']): AttemptIdentity {
  return {
    runId: runId(randomUUID()),
    ...(request.parentRunId === undefined ? {} : { parentRunId: request.parentRunId }),
    agentId: agentId(HEADLINE_READER_AGENT),
    // Attributed to the asking agent, never refused: a read is an attempt inside a run already admitted.
    ...(request.billingAgentId === undefined ? {} : { billingAgentId: request.billingAgentId }),
    sessionId: request.billingSessionId,
  }
}

/** The wire hands back the answers as one JSON object keyed by question id. A reply this build
 *  cannot read leaves the caller with nothing, which it reports rather than reading as a clean
 *  tape. */
function toAnswers(content: LLMResponse['content']): Answers | undefined {
  const text = content.find((block) => block.type === 'text')?.text

  if (text === undefined) {
    return undefined
  }

  const parsed = ANSWERS.safeParse(parseJson(text))

  return parsed.success ? parsed.data : undefined
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function toQueries(input: HeadlineReadInput, items: readonly NewsItem[]): DecisionQueries {
  return {
    state: {
      instrument: {
        ticker: input.instrument.ticker,
        kind: ASSET_WORDS[input.assetClass],
        market: input.instrument.market,
      },
      headlines: items.map(toHeadlineState),
    },
    queries: headlineQuestions(items.length),
  }
}

/** The two questions per headline, against a state shaped `{ instrument, headlines[] }`. Exported so
 *  the research script measures the very questions the pipeline asks. */
function headlineQuestions(count: number): Readonly<Record<string, DecisionQuery>> {
  const questions: Record<string, DecisionQuery> = {}

  for (let index = 0; index < count; index += 1) {
    const ids = headlineAnswerIds(index)

    questions[ids.relevance] = {
      kind: 'choice',
      instructions: `Is \`headlines[${index}]\` about \`instrument\` itself, its sector, the whole market, or unrelated?`,
      criteria: RELEVANCE_CRITERIA,
    }
    questions[ids.risk] = {
      kind: 'choice',
      instructions: `Does \`headlines[${index}]\` report a kinetic military action, sanctions, or a state emergency?`,
      criteria: RISK_CRITERIA,
    }
  }

  return questions
}

function headlineAnswerIds(index: number): {
  readonly relevance: string
  readonly risk: string
} {
  return { relevance: `relevance_${index}`, risk: `risk_${index}` }
}

function toHeadlineState(item: NewsItem): Readonly<Record<string, unknown>> {
  return {
    title: item.title.slice(0, MAXIMUM_TITLE_CHARS),
    ...(item.summary === undefined
      ? {}
      : { summary: item.summary.slice(0, MAXIMUM_SUMMARY_CHARS) }),
  }
}

function apply(
  input: HeadlineReadInput,
  items: readonly NewsItem[],
  answers: Answers
): Omit<HeadlineReads, 'costUsd'> {
  const ownUrls = new Set(input.own.map((item) => item.url))
  const own: NewsItem[] = []
  const market: NewsItem[] = []
  const risky: NewsItem[] = []

  items.forEach((item, index) => {
    const ids = headlineAnswerIds(index)
    const relevance = confidentChoice(answers[ids.relevance], {
      options: RELEVANCE_OPTIONS,
      minimum: RELEVANCE_MINIMUM_CONFIDENCE,
    })
    const risk = confidentChoice(answers[ids.risk], {
      options: RISK_OPTIONS,
      minimum: RISK_MINIMUM_CONFIDENCE,
    })

    if (risk !== undefined && risk !== 'none') {
      risky.push(item)
    }

    const placement = place(relevance, ownUrls.has(item.url))

    if (placement === 'own') {
      own.push(item)
    } else if (placement === 'market') {
      market.push(item)
    }
  })

  const stories = groupStories(risky).length
  const caveats: Caveat[] =
    stories < MINIMUM_RISK_EVENT_STORIES
      ? []
      : [{ code: 'market.risk-event-headlines', detail: { stories } }]

  return { own, market, caveats }
}

/** A confident read decides; an unsure one leaves the headline where its feed put it. */
function place(relevance: Relevance | undefined, fromOwnFeed: boolean): 'own' | 'market' | 'drop' {
  if (relevance === undefined) {
    return fromOwnFeed ? 'own' : 'market'
  }

  if (relevance === 'instrument') {
    return 'own'
  }

  return relevance === 'unrelated' ? 'drop' : 'market'
}

interface ChoiceGate<T extends string> {
  readonly options: readonly T[]
  readonly minimum: number
}

/** An answer outside the options we sent, or below the confidence floor, reads as no answer: the
 *  direction that leaves the feed's own split standing. */
function confidentChoice<T extends string>(
  answer: Answer | undefined,
  gate: ChoiceGate<T>
): T | undefined {
  if (answer === undefined || answer.type !== 'choice' || answer.confidence < gate.minimum) {
    return undefined
  }

  return gate.options.find((option) => option === answer.choice)
}
