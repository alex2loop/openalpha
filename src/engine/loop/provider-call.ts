import type { ChannelId } from '@/core/channels'
import type { SessionId } from '@/core/ids'
import type { LLMErrorCode, LLMMessage, LLMRequest, ProviderChain } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { OnStreamEvent } from '@/core/stream-events'
import type { SettledProviderResponse } from '@/engine/llm-turn'
import type { Hooks, LLMRequestModifier, RunView } from '@/engine/types/run'
import { LLMError, RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { appendSystemBlock } from '@/engine/hooks/system-block'
import { streamSettledTurn } from '@/engine/llm-turn'
import { reserveTurnCost } from '@/engine/loop/limits'
import { runStreamListener } from '@/engine/loop/run-logging'

declare module '@/core/events' {
  interface BusEventMap {
    // channel/chatId route the notice to the human watching the superseded partial answer; a run
    // with no chat (cli, scheduler) carries neither.
    turn_restarted: {
      readonly sessionId: SessionId
      readonly channel: ChannelId
      readonly chatId?: string
      readonly code: LLMErrorCode
    }
  }
}

interface ProviderCallOptions {
  readonly run: RunView
  readonly chain: ProviderChain
  readonly hooks: Hooks
  readonly onChunk: OnStreamEvent | undefined
  /** Returns true and books the restart when the run may retry this turn fresh. */
  readonly consumeTurnRestart: () => boolean
  readonly recoverContextOverflow: () => Promise<void>
}

// `undefined` means the turn was consumed by context-overflow recovery and should be retried.
export async function callProvider(
  options: ProviderCallOptions
): Promise<SettledProviderResponse | undefined> {
  const { run, hooks } = options
  const base = buildLLMRequest(run)
  const request = await applyRequestModifiers(run, base, hooks.llmRequestModifiers)
  const downstream = runStreamListener(options.onChunk, run.services.logger)
  const listener: OnStreamEvent = (event) => {
    if (event.type !== 'tool_call_start') {
      downstream?.(event)
    }
  }

  try {
    return await callChainWithReservation(options, request, listener)
  } catch (err: unknown) {
    if (!(err instanceof LLMError)) {
      throw err
    }

    if (err.code === 'context_overflow') {
      await options.recoverContextOverflow()
      return undefined
    }

    if (err.interruptedVisibleOutput && options.consumeTurnRestart()) {
      run.services.logger.warn('engine.turn_restarted', {
        code: err.code,
        err: formatErrForLog(err),
      })
      run.services.bus.emit('turn_restarted', {
        sessionId: run.identity.sessionId,
        channel: run.identity.channel,
        ...(run.identity.chatId === undefined ? {} : { chatId: run.identity.chatId }),
        code: err.code,
      })
      return undefined
    }

    run.services.logger.error('engine.llm_halted', {
      code: err.code,
      err: formatErrForLog(err),
    })

    throw new RunHalted('llm_error', err.message, err.code)
  }
}

async function callChainWithReservation(
  options: ProviderCallOptions,
  request: LLMRequest,
  listener: OnStreamEvent
): Promise<SettledProviderResponse> {
  const reservation = await reserveTurnCost(options.run, request)

  try {
    return await streamSettledTurn(options.chain, request, {
      onEvent: listener,
      kind: 'turn',
      run: options.run,
      reservation,
    })
  } finally {
    reservation.release()
  }
}

// Instructions join the system prompt before any modifier runs, so the volatile date block still
// appends after them and the cached prefix covers them.
function buildLLMRequest(run: RunView): LLMRequest {
  const { env, state, identity } = run
  const systemMessage: LLMMessage = {
    role: 'system',
    content: env.agent.systemPrompt,
  }
  const request: LLMRequest = {
    model: env.agent.model,
    ...(env.agent.preferredProviderModel === undefined
      ? {}
      : { preferredProviderModel: env.agent.preferredProviderModel }),
    routingKey: env.routingKey ?? identity.sessionId,
    origin: {
      channel: identity.channel,
      sessionId: identity.sessionId,
      ...(identity.chatId === undefined ? {} : { chatId: identity.chatId }),
    },
    messages: [systemMessage, ...state.messages.history],
    tools: state.toolExposure.toSchemas(),
    ...(env.outputContract === undefined ? {} : { outputContract: env.outputContract }),
    ...(env.answerVisibility === undefined ? {} : { answerVisibility: env.answerVisibility }),
    ...(env.reasoningVisibility === undefined
      ? {}
      : { reasoningVisibility: env.reasoningVisibility }),
    maxTokens: env.limits.maxTokens,
    reasoningMode: env.agent.reasoningMode,
    signal: state.abort.signal,
  }

  return env.instructions === undefined ? request : appendSystemBlock(request, env.instructions)
}

async function applyRequestModifiers(
  run: RunView,
  req: LLMRequest,
  modifiers: readonly LLMRequestModifier[]
): Promise<LLMRequest> {
  let current = req

  for (const [index, modifier] of modifiers.entries()) {
    try {
      current = await modifier(run, current)
    } catch (err: unknown) {
      logModifierFailure(run.services.logger, index, err)
    }
  }

  return current
}

function logModifierFailure(logger: Logger, index: number, err: unknown): void {
  logger.warn('engine.llm_request_modifier_failed', {
    modifierIndex: index,
    err: formatErrForLog(err),
  })
}
