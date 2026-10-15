import type { ModelReasoningCapability } from '@/ai/reasoning/effort'
import type { ReasoningResolution } from '@/ai/reasoning/resolve'
import type { ChainEntry, Transport } from '@/ai/types'
import type {
  LLMRequest,
  LLMResponse,
  ProviderAttempt,
  ProviderAttemptOutcome,
  ProviderModelId,
  ReasoningMode,
} from '@/core/llm'
import type { OnStreamEvent, TokenUsage } from '@/core/stream-events'
import { streamWithIdleTimeout } from '@/ai/chain/stream-watchdog'
import { loadOpenRouterCapabilities, loadOpenRouterStructuredOutputs } from '@/ai/openrouter-feed'
import { resolveReasoning, widenedMaxTokens } from '@/ai/reasoning/resolve'
import { attemptUsageOf, LLMError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { estimateTextTokens } from '@/core/stream-events'
import { withRetry } from '@/core/utils/retry'

const OUTPUT_CONTRACT_REJECTION_RE = /schema|response_format|json_schema|structured output/i

interface AttemptLedger {
  nextId(): number
  append(attempt: ProviderAttempt): void
  snapshot(): readonly ProviderAttempt[]
}

export interface AttemptResult {
  readonly response: LLMResponse
  readonly attempt: ProviderAttempt
}

interface RunProviderAttemptInput {
  readonly entry: ChainEntry
  readonly req: LLMRequest
  readonly transport: Transport
  readonly emit: OnStreamEvent
  readonly nextAttemptId: () => number
  readonly onRetry: (attempt: ProviderAttempt) => Promise<void>
  readonly onTerminal: (attempt: ProviderAttempt) => Promise<void>
  readonly maxRetries: number
  readonly retryBackoffMs: number
  readonly isRetryable: (err: LLMError) => boolean
}

interface RejectedFieldRetry {
  readonly input: RunProviderAttemptInput
  readonly req: LLMRequest
  readonly entry: ChainEntry
  readonly err: unknown
}

interface RunAttemptOnceInput {
  readonly input: RunProviderAttemptInput
  readonly entryReq: LLMRequest
  readonly entry: ChainEntry
  readonly attemptNumber: number
  readonly maxAttempts: number
}

export function createAttemptLedger(maxRecords: number): AttemptLedger {
  const limit = normalizeLimit(maxRecords)
  const attempts: ProviderAttempt[] = []
  const ids = new Set<number>()
  let nextAttemptId = 1

  return {
    nextId(): number {
      if (nextAttemptId > limit) {
        throw new LLMError('fatal', 'provider attempt limit exceeded')
      }

      return nextAttemptId++
    },
    append(attempt): void {
      if (attempts.length >= limit || ids.has(attempt.attemptId)) {
        throw new LLMError('fatal', 'provider attempt ledger rejected an invalid record')
      }

      ids.add(attempt.attemptId)
      attempts.push(attempt)
    },
    snapshot(): readonly ProviderAttempt[] {
      return [...attempts]
    },
  }
}

export async function runProviderAttempt(input: RunProviderAttemptInput): Promise<AttemptResult> {
  const reasoningMode =
    input.req.reasoningMode === 'default' ? input.entry.reasoningMode : input.req.reasoningMode
  const entryReq: LLMRequest = {
    ...input.req,
    ...(input.entry.maxTokens === undefined
      ? {}
      : { maxTokens: Math.min(input.req.maxTokens, input.entry.maxTokens) }),
  }
  const [capabilities, structuredOutputModels] = await routedCapabilities(input.entry)
  const capability = capabilities?.get(input.entry.model)
  const structuredOutputs = structuredOutputModels?.has(input.entry.model)
  const reasoningResolution = resolveReasoning({
    model: input.entry.model,
    requested: reasoningMode,
    maxTokens: entryReq.maxTokens,
    ...(input.entry.provider.reasoning === undefined
      ? {}
      : { family: input.entry.provider.reasoning }),
    ...(input.entry.reasoningRequired === undefined
      ? {}
      : { reasoningRequired: input.entry.reasoningRequired }),
    ...(capability === undefined ? {} : { capability }),
  })
  const entry: ChainEntry = {
    ...input.entry,
    reasoningMode,
    reasoningResolution,
    ...(structuredOutputs === undefined ? {} : { structuredOutputs }),
  }
  const attemptReq = widenReasoningRequest(entryReq, reasoningMode, reasoningResolution)

  logReasoningDowngrade(entry, reasoningMode, attemptReq.maxTokens)

  try {
    return await attemptLadder(input, attemptReq, entry)
  } catch (err: unknown) {
    return await retryWithoutRejectedField({ input, req: attemptReq, entry, err })
  }
}

// Reasoning fields and an output contract are both optimizations the caller can do without, so an
// endpoint refusing one costs a retry without it rather than the whole run. The rejected attempt is
// paid for and reaches no other settlement path: the ladder does not retry a fatal error, and the
// chain never sees this one.
async function retryWithoutRejectedField(options: RejectedFieldRetry): Promise<AttemptResult> {
  const { input, req, entry, err } = options

  if (isReasoningRejection(err, entry)) {
    entry.logger.warn('ai.reasoning_rejected', {
      provider: entry.provider.id,
      model: entry.model,
      fields: Object.keys(entry.reasoningResolution.request),
    })
    await input.onRetry(toFailedAttempt(err, 'retry'))

    return await attemptLadder(input, req, withoutReasoning(entry))
  }

  if (!isOutputContractRejection(err, req)) {
    throw err
  }

  entry.logger.warn('ai.output_contract_rejected', {
    provider: entry.provider.id,
    model: entry.model,
    contract: req.outputContract?.name,
  })
  await input.onRetry(toFailedAttempt(err, 'retry'))

  return await attemptLadder(input, withoutOutputContract(req), entry)
}

function attemptLadder(
  input: RunProviderAttemptInput,
  entryReq: LLMRequest,
  entry: ChainEntry
): Promise<AttemptResult> {
  const maxAttempts = input.maxRetries + 1
  let attemptNumber = 0

  return withRetry(
    () => runAttemptOnce({ input, entryReq, entry, attemptNumber: ++attemptNumber, maxAttempts }),
    {
      maxAttempts,
      initialMs: input.retryBackoffMs,
      signal: input.req.signal,
      isRetryable: (err) => err instanceof LLMError && input.isRetryable(err),
      delayFor: (err) => (err instanceof LLMError ? (err.retryAfterMs ?? 0) : 0),
    }
  )
}

// A refusal names the field it would not take, which is how one aimed at reasoning is told apart.
function isReasoningRejection(err: unknown, entry: ChainEntry): err is LLMError {
  return (
    err instanceof LLMError &&
    err.code === 'fatal' &&
    Object.keys(entry.reasoningResolution.request).some((field) => err.message.includes(field))
  )
}

function isOutputContractRejection(err: unknown, req: LLMRequest): err is LLMError {
  return (
    req.outputContract !== undefined &&
    err instanceof LLMError &&
    err.code === 'fatal' &&
    OUTPUT_CONTRACT_REJECTION_RE.test(err.message)
  )
}

function withoutReasoning(entry: ChainEntry): ChainEntry {
  return {
    ...entry,
    reasoningResolution: { ...entry.reasoningResolution, effectiveMode: 'default', request: {} },
  }
}

function withoutOutputContract(req: LLMRequest): LLMRequest {
  const { outputContract, ...rest } = req
  return rest
}

// Both derive from one cached fetch, so a direct provider costs nothing by skipping them.
function routedCapabilities(
  entry: ChainEntry
): Promise<
  [ReadonlyMap<string, ModelReasoningCapability> | undefined, ReadonlySet<string> | undefined]
> {
  if (entry.provider.id !== 'openrouter') {
    return Promise.resolve([undefined, undefined])
  }

  return Promise.all([
    loadOpenRouterCapabilities(entry.logger),
    loadOpenRouterStructuredOutputs(entry.logger),
  ])
}

function widenReasoningRequest(
  req: LLMRequest,
  requested: ReasoningMode,
  resolution: ReasoningResolution
): LLMRequest {
  const maxTokens = widenedMaxTokens(req.maxTokens, requested, resolution.effectiveMode)
  return maxTokens === req.maxTokens ? req : { ...req, maxTokens }
}

function logReasoningDowngrade(
  entry: ChainEntry,
  requested: ReasoningMode,
  maxTokens: number
): void {
  const reason = entry.reasoningResolution.downgradeReason

  if (reason === undefined) {
    return
  }

  entry.logger.warn('ai.reasoning_downgraded', {
    requested,
    effective: entry.reasoningResolution.effectiveMode,
    provider: entry.provider.id,
    model: entry.model,
    reason,
    // Key must not contain "token": isSensitiveKey would redact it from the log line.
    outputCap: maxTokens,
  })
}

async function runAttemptOnce(options: RunAttemptOnceInput): Promise<AttemptResult> {
  const { input, entryReq, entry, attemptNumber, maxAttempts } = options
  const attemptId = input.nextAttemptId()
  const providerModel = { provider: entry.provider.id, model: entry.model }
  const startedAt = performance.now()

  try {
    const response = await streamWithIdleTimeout(input.transport, entryReq, {
      entry,
      emit: input.emit,
    })

    return {
      response,
      attempt: toSuccessfulAttempt({
        attemptId,
        providerModel,
        response,
        latencyMs: performance.now() - startedAt,
      }),
    }
  } catch (err: unknown) {
    const latencyMs = performance.now() - startedAt

    if (err instanceof LLMError) {
      const attributed = attributeProviderError(err, {
        providerModel,
        req: entryReq,
        attemptId,
        latencyMs,
      })

      if (attemptNumber < maxAttempts && input.isRetryable(attributed)) {
        // The one place a retried failure is named: it is rethrown to be tried again, so it never
        // reaches the fallback path where every other provider error is logged.
        entry.logger.warn('llm.provider_retry', {
          provider: entry.provider.id,
          model: entry.model,
          code: attributed.code,
          attempt: attemptNumber,
          latencyMs: Math.round(latencyMs),
          err: formatErrForLog(attributed),
        })
        await input.onRetry(toFailedAttempt(attributed, 'retry'))
      }

      throw attributed
    }

    const failure = attemptUsageOf(err)

    if (failure === undefined) {
      throw err
    }

    await input.onTerminal({
      attemptId,
      providerModel,
      usage: failure.usage,
      usageSource: failure.usageSource,
      latencyMs,
      outcome: 'terminal_failure',
      // The error escaped provider classification (no LLMError), so no finer code exists.
      errorCode: 'fatal',
    })

    throw failure.error
  }
}

// An error that carries usage (a refusal's zero, or the runner's tally) is believed as it is; the
// estimate is the fallback for one that never reached the runner.
function attributedUsage(err: LLMError, req: LLMRequest): TokenUsage {
  return err.usage ?? { input: estimateTextTokens(JSON.stringify(req.messages)), output: 0 }
}

function attributeProviderError(
  err: LLMError,
  input: {
    readonly providerModel: ProviderModelId
    readonly req: LLMRequest
    readonly attemptId: number
    readonly latencyMs: number
  }
): LLMError {
  const usage = attributedUsage(err, input.req)

  return new LLMError(err.code, err.message, {
    cause: err,
    providerModel: input.providerModel,
    attemptId: input.attemptId,
    usage,
    usageSource: err.usageSource ?? 'estimated',
    latencyMs: input.latencyMs,
    ...(err.retryAfterMs === undefined ? {} : { retryAfterMs: err.retryAfterMs }),
    ...(err.fallbackAllowed ? { fallbackAllowed: true } : {}),
  })
}

export function toFailedAttempt(
  err: LLMError,
  outcome: Exclude<ProviderAttemptOutcome, 'success'>
): ProviderAttempt {
  if (
    err.attemptId === undefined ||
    err.providerModel === undefined ||
    err.usage === undefined ||
    err.usageSource === undefined ||
    err.latencyMs === undefined
  ) {
    throw new LLMError('fatal', 'provider attempt completed without usage metadata', {
      cause: err,
    })
  }

  return {
    attemptId: err.attemptId,
    providerModel: err.providerModel,
    usage: err.usage,
    usageSource: err.usageSource,
    latencyMs: err.latencyMs,
    outcome,
    errorCode: err.code,
  }
}

function toSuccessfulAttempt(input: {
  readonly attemptId: number
  readonly providerModel: ProviderModelId
  readonly response: LLMResponse
  readonly latencyMs: number
}): ProviderAttempt {
  return {
    attemptId: input.attemptId,
    providerModel: input.providerModel,
    usage: input.response.usage,
    usageSource: input.response.usageSource,
    latencyMs: input.latencyMs,
    outcome: 'success',
  }
}

function normalizeLimit(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}
