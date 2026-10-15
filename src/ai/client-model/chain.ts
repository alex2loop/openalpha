import type {
  ClientModelBroker,
  ClientModelMessage,
  ClientModelRequestDraft,
} from '@/ai/client-model/types'
import type {
  LLMMessage,
  LLMRequest,
  ProviderAttempt,
  ProviderAttemptObserver,
  ProviderChain,
  ProviderModelId,
  ProviderResponse,
} from '@/core/llm'
import type { OnStreamEvent, TokenUsage } from '@/core/stream-events'
import { currentClientModelJob } from '@/ai/client-model/job-context'
import { CLIENT_MODEL_PROVIDER } from '@/core/config/resolve'
import { LLMError } from '@/core/errors'
import { estimateTextTokens } from '@/core/stream-events'
import { contentBlocks, textOf } from '@/core/utils/message'

/** Keeps a client-written debate apart in the track record from the same model reached through a
 *  configured provider. */
const CLIENT_MODEL_NAME_PREFIX = `${CLIENT_MODEL_PROVIDER}:`
const DEFAULT_REQUEST_ROLE = 'model'
const PROMPT_PART_SEPARATOR = '\n\n'
const ONLY_ATTEMPT_ID = 1

interface ClientStreamInput {
  readonly broker: ClientModelBroker
  readonly req: LLMRequest
  readonly onEvent: OnStreamEvent
  readonly observer?: ProviderAttemptObserver
}

export function createClientModelChain(broker: ClientModelBroker): ProviderChain {
  const chain: ProviderChain = {
    stream: (req, onEvent, observer) =>
      streamFromClient({ broker, req, onEvent, ...(observer === undefined ? {} : { observer }) }),
    estimateMaxCost: () => 0,
  }

  return Object.freeze(chain)
}

/** Reports one settled attempt, as a provider would: the debate model a suggestion records is read
 *  from it. */
async function streamFromClient(input: ClientStreamInput): Promise<ProviderResponse> {
  const jobId = currentClientModelJob()

  if (jobId === undefined) {
    throw new LLMError('fatal', 'client model call made outside an mcp job')
  }

  const draft = toClientModelRequest(input.req)
  const startedAt = performance.now()
  const answer = await input.broker.post(jobId, draft, input.req.signal)
  const providerModel: ProviderModelId = {
    provider: CLIENT_MODEL_PROVIDER,
    model: `${CLIENT_MODEL_NAME_PREFIX}${answer.model}`,
  }
  const usage: TokenUsage = {
    input: estimateTextTokens(promptTextOf(draft)),
    output: estimateTextTokens(answer.text),
  }
  const attempt: ProviderAttempt = {
    attemptId: ONLY_ATTEMPT_ID,
    providerModel,
    usage,
    usageSource: 'estimated',
    latencyMs: performance.now() - startedAt,
    outcome: 'success',
  }

  await input.observer?.(attempt)

  if (input.req.answerVisibility !== 'hidden') {
    input.onEvent({ type: 'text_delta', delta: answer.text })
  }

  return {
    content: [{ type: 'text', text: answer.text }],
    usage,
    usageSource: 'estimated',
    finishReason: 'stop',
    model: providerModel.model,
    providerModel,
    attempts: [attempt],
  }
}

function toClientModelRequest(req: LLMRequest): ClientModelRequestDraft {
  if ((req.tools?.length ?? 0) > 0 || req.decisions !== undefined) {
    throw unanswerable('tools or decision queries')
  }

  const system: string[] = []
  const messages: ClientModelMessage[] = []

  for (const message of req.messages) {
    const text = textOnlyOf(message)

    if (message.role === 'system') {
      system.push(text)
      continue
    }

    if (message.role === 'tool') {
      throw unanswerable('a tool result')
    }

    messages.push({ role: message.role, text })
  }

  return {
    role: req.outputContract?.name ?? DEFAULT_REQUEST_ROLE,
    system: system.join(PROMPT_PART_SEPARATOR),
    messages,
    ...(req.outputContract === undefined
      ? {}
      : { output: { name: req.outputContract.name, schema: req.outputContract.schema } }),
    maxTokens: req.maxTokens,
  }
}

function textOnlyOf(message: LLMMessage): string {
  if (contentBlocks(message.content).some((block) => block.type !== 'text')) {
    throw unanswerable('non-text content')
  }

  return textOf(message.content)
}

function promptTextOf(draft: ClientModelRequestDraft): string {
  return [draft.system, ...draft.messages.map((message) => message.text)].join(
    PROMPT_PART_SEPARATOR
  )
}

function unanswerable(what: string): LLMError {
  return new LLMError('fatal', `the client model cannot answer a request carrying ${what}`)
}
