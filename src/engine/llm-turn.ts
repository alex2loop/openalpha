import type { LLMAttemptId } from '@/core/ids'
import type {
  LLMRequest,
  ProviderAttemptObserver,
  ProviderChain,
  ProviderResponse,
} from '@/core/llm'
import type { OnStreamEvent, TokenUsage } from '@/core/stream-events'
import type { LLMAttemptKind } from '@/core/types/usage'
import type { SettledCallUsage } from '@/engine/budget/attempt-settlement'
import type { CostReservation } from '@/engine/types/cost'
import type { RunView } from '@/engine/types/run'
import { RunHalted } from '@/core/errors'
import { createAttemptSettler } from '@/engine/budget/attempt-settlement'

export interface SettledProviderResponse {
  readonly response: ProviderResponse
  readonly llmAttemptIds: readonly [LLMAttemptId, ...LLMAttemptId[]]
  readonly callUsage: Omit<TokenUsage, 'costUsd'>
  readonly callCostUsd: number
}

// Every settled network attempt is observed into durable storage by the chain before it
// continues; the caller owns the reservation the attempts consume and releases it in `finally`.
export async function streamSettledTurn(
  chain: ProviderChain,
  req: LLMRequest,
  input: {
    readonly onEvent: OnStreamEvent
    readonly kind: LLMAttemptKind
    readonly run: RunView
    readonly reservation: CostReservation
  }
): Promise<SettledProviderResponse> {
  const settler = createAttemptSettler({
    run: input.run,
    kind: input.kind,
    reservation: input.reservation,
  })
  const response = await streamTurn(chain, req, {
    onEvent: input.onEvent,
    observer: settler.observer,
  })

  return toSettledResponse(response, settler.usage())
}

// Deliberately thin: the context_overflow retry lives in loop/run.ts, and the no-re-emit
// invariant stays owned by ai/chain/provider-chain.ts.
async function streamTurn(
  chain: ProviderChain,
  req: LLMRequest,
  input: {
    readonly onEvent: OnStreamEvent
    readonly observer: ProviderAttemptObserver
  }
): Promise<ProviderResponse> {
  return chain.stream(req, input.onEvent, input.observer)
}

function toSettledResponse(
  response: ProviderResponse,
  usage: SettledCallUsage
): SettledProviderResponse {
  const [first, ...rest] = usage.llmAttemptIds

  if (first === undefined) {
    throw new RunHalted('llm_error', 'provider chain returned success without a settled attempt')
  }

  return {
    response,
    llmAttemptIds: [first, ...rest],
    callUsage: usage.callUsage,
    callCostUsd: usage.callCostUsd,
  }
}
