import type { ChainEntry, Transport } from '@/ai/types'
import type { LLMRequest, LLMResponse } from '@/core/llm'
import type { OnStreamEvent, StreamEvent } from '@/core/stream-events'
import { attemptUsageOf, LLMError } from '@/core/errors'
import { CHARS_PER_TOKEN, estimateTextTokens, weightedCharCount } from '@/core/stream-events'

const DEFAULT_TTFT_TIMEOUT_MS = 180_000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 180_000

interface StreamTarget {
  readonly entry: ChainEntry
  readonly emit: OnStreamEvent
}

interface IdleTimeoutTarget {
  readonly entry: ChainEntry
  readonly req: LLMRequest
  readonly timeoutMs: number
  readonly hasOutput: boolean
  readonly outputChars: number
}

export async function streamWithIdleTimeout(
  transport: Transport,
  req: LLMRequest,
  target: StreamTarget
): Promise<LLMResponse> {
  const { entry, emit } = target
  const ttftMs = entry.ttftTimeoutMs ?? DEFAULT_TTFT_TIMEOUT_MS
  const idleMs = entry.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  const idle = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let hasOutput = false
  let outputChars = 0
  let lastEventAt = performance.now()

  // One self-rescheduling watchdog rather than a timer per delta: a long completion emits thousands
  // of events, and re-arming on each is churn on the hottest path in the loop.
  const watch = (): void => {
    const budgetMs = hasOutput ? idleMs : ttftMs
    const idleForMs = performance.now() - lastEventAt

    if (idleForMs >= budgetMs) {
      idle.abort()
      return
    }

    timer = setTimeout(watch, budgetMs - idleForMs)
  }
  const guarded: OnStreamEvent = (event) => {
    if (isOutputDelta(event)) {
      hasOutput = true
    }

    outputChars += generatedChars(event)
    lastEventAt = performance.now()
    emit(event)
  }

  timer = setTimeout(watch, ttftMs)

  try {
    return await transport.stream(
      { ...req, signal: AbortSignal.any([req.signal, idle.signal]) },
      entry,
      guarded
    )
  } catch (err: unknown) {
    if (idle.signal.aborted && !req.signal.aborted) {
      throw toIdleTimeout(err, {
        entry,
        req,
        timeoutMs: hasOutput ? idleMs : ttftMs,
        hasOutput,
        outputChars,
      })
    }

    throw err
  } finally {
    clearTimeout(timer)
  }
}

type OutputDeltaEvent = Extract<
  StreamEvent,
  { type: 'text_delta' | 'reasoning_delta' | 'tool_call_args_delta' }
>

// Genuine model output — as opposed to bookkeeping frames like `usage` or `finish_reason`, which
// arrive on every stream (including one that never answers) and must not count as first output.
function isOutputDelta(event: StreamEvent): event is OutputDeltaEvent {
  return (
    event.type === 'text_delta' ||
    event.type === 'reasoning_delta' ||
    event.type === 'tool_call_args_delta'
  )
}

// Deltas the model generated. Reasoning and tool arguments are billed as output too, so a stall
// mid-tool-call is not free.
function generatedChars(event: StreamEvent): number {
  return isOutputDelta(event) ? weightedCharCount(event.delta) : 0
}

function toIdleTimeout(err: unknown, target: IdleTimeoutTarget): LLMError {
  const failure = attemptUsageOf(err)
  const label = `${target.entry.provider.id}/${target.entry.model}`
  const message = target.hasOutput
    ? `stream idle for ${target.timeoutMs}ms from ${label}`
    : `no first output within ${target.timeoutMs}ms from ${label}`

  if (failure !== undefined) {
    return new LLMError('timeout', message, {
      cause: failure.error,
      usage: failure.usage,
      usageSource: failure.usageSource,
    })
  }

  // A stalled transport rarely reports usage, and the fallback estimator downstream only sees the
  // request. Billing the deltas already observed here is what keeps the stall from costing zero.
  return new LLMError('timeout', message, {
    cause: err,
    usage: {
      input: estimateTextTokens(JSON.stringify(target.req.messages)),
      output: tokensFromChars(target.outputChars),
    },
    usageSource: 'estimated',
  })
}

function tokensFromChars(chars: number): number {
  return chars === 0 ? 0 : Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN))
}
