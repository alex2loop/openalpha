// OpenRouter's decisions router: one POST answers every question against one state, and the
// answers come back as calibrated distributions rather than prose. It is not a chat model and
// refuses the completions endpoint outright, which is why it is a wire of its own rather than an
// entry under `openai_chat`.
import { z } from 'zod'

import type { ChainEntry, Transport } from '@/ai/types'
import type { DecisionQueries, DecisionQuery, LLMRequest, LLMResponse } from '@/core/llm'
import type { OnStreamEvent, TokenUsage } from '@/core/stream-events'
import { classifyHttpError, classifyNetworkError } from '@/ai/adapters/errors'
import { LLMError } from '@/core/errors'
import { HttpRequestError, httpRequestWithSignal, parseRetryAfterMs } from '@/core/http-client'
import { RETRY_MAX_DELAY_MS } from '@/core/utils/retry'

const DECISIONS_PATH = '/decisions'
/** Nothing is streamed and nothing is sampled, so the usage the router reports is all there is. */
const NO_TOKENS: TokenUsage = Object.freeze({ input: 0, output: 0 })
const USAGE = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative().optional(),
})

export const openrouterDecisionsTransport: Transport = { stream }

async function stream(
  req: LLMRequest,
  entry: ChainEntry,
  onEvent: OnStreamEvent
): Promise<LLMResponse> {
  const asked = req.decisions

  if (asked === undefined) {
    throw new LLMError('fatal', 'a decisions provider was asked without any questions')
  }

  const answer = await post(req, entry, asked)
  const text = JSON.stringify(answer.answers)

  await onEvent({ type: 'text_delta', delta: text })

  return {
    content: [{ type: 'text', text }],
    usage: answer.usage,
    usageSource: 'provider',
    finishReason: 'stop',
  }
}

interface DecisionsReply {
  readonly answers: Readonly<Record<string, unknown>>
  readonly usage: TokenUsage
}

/** The model comes off the chain entry, not the request: `req.model` is what the caller asked the
 *  chain for - a tier name here - while the entry names the provider's own id for what answered. */
async function post(
  req: LLMRequest,
  entry: ChainEntry,
  asked: DecisionQueries
): Promise<DecisionsReply> {
  try {
    const response = await httpRequestWithSignal({
      hosts: [entry.baseUrl],
      path: DECISIONS_PATH,
      method: 'POST',
      headers: { authorization: `Bearer ${entry.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(toBody(entry.model, asked)),
      signal: req.signal,
    })

    return toReply(response.text)
  } catch (err: unknown) {
    throw toChainError(err)
  }
}

// The shared client reports every non-2xx and network failure as an HttpRequestError (a tool
// error), which the provider chain cannot classify; an abort is not one and passes through.
function toChainError(err: unknown): unknown {
  if (!(err instanceof HttpRequestError)) {
    return err
  }

  if (err.status === undefined) {
    return classifyNetworkError(err)
  }

  const retryAfterMs = parseRetryAfterMs(err.retryAfter, Date.now(), RETRY_MAX_DELAY_MS)

  return classifyHttpError(
    err.status,
    err.message,
    retryAfterMs === undefined ? undefined : { retryAfterMs }
  )
}

function toBody(model: string, asked: DecisionQueries): Record<string, unknown> {
  return {
    model,
    state: asked.state,
    questions: Object.fromEntries(
      Object.entries(asked.queries).map(([id, query]) => [id, toQuestion(query)])
    ),
  }
}

/** The router's own words for the two question shapes. `statement` is its `noul`: a single claim
 *  answered with the probability it is true. */
function toQuestion(query: DecisionQuery): Record<string, unknown> {
  return query.kind === 'statement'
    ? { type: 'noul', instructions: query.instructions }
    : { type: 'choice', instructions: query.instructions, criteria: query.criteria }
}

function toReply(text: string): DecisionsReply {
  const parsed = parseReplyJson(text)

  if (typeof parsed !== 'object' || parsed === null || !('answers' in parsed)) {
    throw new LLMError('empty_response', 'decisions reply carried no answers')
  }

  const { answers } = parsed

  if (typeof answers !== 'object' || answers === null) {
    throw new LLMError('empty_response', 'decisions answers were not an object')
  }

  return {
    answers: answers as Readonly<Record<string, unknown>>,
    usage: 'usage' in parsed ? toUsage(parsed.usage) : NO_TOKENS,
  }
}

function parseReplyJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err: unknown) {
    throw new LLMError('empty_response', 'decisions reply was not valid JSON', { cause: err })
  }
}

/** A reply whose usage cannot be read still answers: the tokens then count as none. */
function toUsage(raw: unknown): TokenUsage {
  const usage = USAGE.safeParse(raw)

  if (!usage.success) {
    return NO_TOKENS
  }

  const { input_tokens: input, output_tokens: output, cost } = usage.data

  return cost === undefined ? { input, output } : { input, output, costUsd: cost }
}
