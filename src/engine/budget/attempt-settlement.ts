import { randomUUID } from 'node:crypto'

import type { AgentId, LLMAttemptId, RunId, SessionId } from '@/core/ids'
import type { ProviderAttempt, ProviderAttemptObserver } from '@/core/llm'
import type { TokenUsage } from '@/core/stream-events'
import type { ExternalCharge, LLMAttemptInput, LLMAttemptKind } from '@/core/types/usage'
import type { CostCharge, CostReservation } from '@/engine/types/cost'
import type { RunServices, RunState, RunView } from '@/engine/types/run'
import { RunHalted } from '@/core/errors'
import { llmAttemptId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { withRetry } from '@/core/utils/retry'
import { addExternalCost, namedModel } from '@/engine/budget/usage'

const ATTEMPT_RECORD_MAX_TRIES = 3
const ATTEMPT_RECORD_BACKOFF_MS = 100

interface NormalizedUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface SettledCallUsage {
  readonly llmAttemptIds: readonly LLMAttemptId[]
  readonly callUsage: Omit<TokenUsage, 'costUsd'>
  readonly callCostUsd: number
}

interface AttemptSettler {
  readonly observer: ProviderAttemptObserver
  usage(): SettledCallUsage
}

interface SettlerDeps {
  readonly run: RunView
  readonly kind: LLMAttemptKind
  readonly reservation: CostReservation
}

interface CallAccumulator {
  readonly llmAttemptIds: LLMAttemptId[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  costUsd: number
}

/** Who an attempt is billed to: a run's own identity, or a caller outside any run. */
export interface AttemptIdentity {
  readonly runId: RunId
  readonly parentRunId?: RunId
  readonly agentId: AgentId
  /** The agent whose daily cap the spend counts against. Absent bills to `agentId`. */
  readonly billingAgentId?: AgentId
  readonly sessionId: SessionId | null
}

/** Settles one attempt billed to `identity` and returns what it cost. */
export type AttemptRecorder = (
  identity: AttemptIdentity,
  attempt: ProviderAttempt
) => Promise<number>

type LedgerServices = Pick<
  RunServices,
  'costTracker' | 'llmAttemptSink' | 'unrecordedSpend' | 'logger'
>

interface AttemptDraft {
  readonly kind: LLMAttemptKind
  readonly charge: CostCharge
  readonly usage: NormalizedUsage
  readonly id: LLMAttemptId
  readonly settledAt: number
}

// One settler per provider-chain call: the ordered ids and aggregate counts are bounded by the
// chain itself, which caps attempts at entries × (maxRetries + 1).
export function createAttemptSettler(deps: SettlerDeps): AttemptSettler {
  const acc: CallAccumulator = {
    llmAttemptIds: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
  }

  return {
    observer: (attempt) => settleIncurredUsage(deps, acc, attempt),
    usage(): SettledCallUsage {
      return {
        llmAttemptIds: [...acc.llmAttemptIds],
        callUsage: {
          input: acc.inputTokens,
          output: acc.outputTokens,
          cacheRead: acc.cacheReadTokens,
          cacheWrite: acc.cacheWriteTokens,
          reasoning: acc.reasoningTokens,
        },
        callCostUsd: acc.costUsd,
      }
    },
  }
}

// One clock read per attempt: the same `settledAt` drives in-memory day/month attribution and
// the durable row, so the two never disagree about which UTC period a charge belongs to.
async function settleIncurredUsage(
  deps: SettlerDeps,
  acc: CallAccumulator,
  attempt: ProviderAttempt
): Promise<void> {
  const settledAt = Date.now()
  const charge = deps.run.services.costTracker.record(
    attempt.providerModel,
    attempt.usage,
    settledAt
  )
  const usage = normalizeUsage(attempt.usage)

  deps.reservation.consume(charge.costUsd)

  const halt = applyCharge(deps.run.state, { charge, usage, model: attempt.providerModel.model })
  const id = llmAttemptId(randomUUID())

  // Awaited before the chain retries, falls back, or returns: continuing after a failed write
  // would knowingly make durable usage incomplete, so the storage error propagates.
  await recordDurably(
    deps.run.services,
    toAttemptInput(identityOf(deps.run), attempt, { kind: deps.kind, charge, usage, id, settledAt })
  )

  acc.llmAttemptIds.push(id)
  acc.inputTokens += usage.input
  acc.outputTokens += usage.output
  acc.cacheReadTokens += usage.cacheRead
  acc.cacheWriteTokens += usage.cacheWrite
  acc.reasoningTokens += usage.reasoning
  acc.costUsd += charge.costUsd

  // The halt fires only after the attempt is durable: a budget stop must never erase spend.
  if (halt !== undefined) {
    throw halt
  }
}

// A search fee is priced by its vendor, so it reuses the provider-reported branch of the tracker and
// lands in the same ledger as token spend. The caller owns whichever budget the charge belongs to;
// this records the fact and enforces the day/month caps.
export async function settleExternalCharge(
  run: RunView,
  charge: ExternalCharge,
  settledAt: number
): Promise<void> {
  const usage = { input: 0, output: 0, costUsd: charge.costUsd }
  const tracked = run.services.costTracker.record(
    { provider: charge.provider, model: charge.operation },
    usage,
    settledAt
  )

  run.state.totals = addExternalCost(run.state.totals, tracked.costUsd)

  await recordDurably(run.services, {
    id: llmAttemptId(randomUUID()),
    ...identityOf(run),
    billingAgentId: run.identity.billingAgentId,
    kind: 'external',
    provider: charge.provider,
    model: charge.operation,
    outcome: 'success',
    usageSource: 'provider',
    costSource: tracked.costSource,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: tracked.costUsd,
    latencyMs: 0,
    settledAt,
  })

  if (tracked.exceededCap !== undefined) {
    throw new RunHalted('budget', `${tracked.exceededCap} cost cap exceeded by incurred usage`)
  }
}

// The write is idempotent on the attempt id, so a transient fault is retried rather than losing the
// fact. Spend that stays unrecorded is spendable again after a restart, hence the fail-closed mark.
async function recordDurably(services: LedgerServices, input: LLMAttemptInput): Promise<void> {
  try {
    await withRetry(() => services.llmAttemptSink.record(input), {
      maxAttempts: ATTEMPT_RECORD_MAX_TRIES,
      initialMs: ATTEMPT_RECORD_BACKOFF_MS,
    })
  } catch (err: unknown) {
    await latchUnrecorded(services, input, err)

    throw err
  }
}

// Boot folds this log back into the day and month totals, so only a failed append leaves money a
// restart would hand back to the caps.
async function latchUnrecorded(
  services: LedgerServices,
  input: LLMAttemptInput,
  cause: unknown
): Promise<void> {
  services.logger.error('budget.attempt_unrecorded', {
    attemptId: input.id,
    costUsd: input.costUsd,
    err: formatErrForLog(cause),
  })

  try {
    await services.unrecordedSpend.append({
      id: input.id,
      costUsd: input.costUsd,
      settledAt: input.settledAt,
    })
  } catch (err: unknown) {
    services.costTracker.markLedgerUnavailable()
    services.logger.error('budget.unrecorded_spend_unlogged', {
      attemptId: input.id,
      err: formatErrForLog(err),
    })
  }
}

// The same charge lands once in the in-memory totals and once in the run budget; any cap or
// budget halt is captured, not thrown, so the caller can persist the attempt first.
function applyCharge(
  state: RunState,
  settled: { readonly charge: CostCharge; readonly usage: NormalizedUsage; readonly model: string }
): RunHalted | undefined {
  const { charge, usage } = settled

  state.totals = addUsageTotals({
    totals: state.totals,
    usage,
    costUsd: charge.costUsd,
    model: settled.model,
  })

  const budgetHalt = chargeRunBudget(state, charge.costUsd)

  if (charge.exceededCap !== undefined) {
    return new RunHalted('budget', `${charge.exceededCap} cost cap exceeded by incurred usage`)
  }

  return budgetHalt
}

function chargeRunBudget(state: RunState, costUsd: number): RunHalted | undefined {
  try {
    state.budget.charge(costUsd)

    return undefined
  } catch (err: unknown) {
    if (err instanceof RunHalted) {
      return err
    }

    throw err
  }
}

function addUsageTotals(input: {
  readonly totals: RunState['totals']
  readonly usage: NormalizedUsage
  readonly costUsd: number
  readonly model: string
}): RunState['totals'] {
  return {
    costUsd: input.totals.costUsd + input.costUsd,
    inputTokens: input.totals.inputTokens + input.usage.input,
    outputTokens: input.totals.outputTokens + input.usage.output,
    cacheReadTokens: input.totals.cacheReadTokens + input.usage.cacheRead,
    cacheWriteTokens: input.totals.cacheWriteTokens + input.usage.cacheWrite,
    reasoningTokens: input.totals.reasoningTokens + input.usage.reasoning,
    modelCalls: input.totals.modelCalls + 1,
    ...namedModel(input.totals, input.model),
  }
}

function identityOf(run: RunView): AttemptIdentity {
  const { identity } = run

  return {
    runId: identity.runId,
    ...(identity.parentRunId === undefined ? {} : { parentRunId: identity.parentRunId }),
    agentId: identity.agentId,
    billingAgentId: identity.billingAgentId,
    sessionId: identity.billingSessionId,
  }
}

/** One attempt a caller made on a chain outside any run: charged to the day/month caps and written
 *  to the same ledger, before a cap halt is thrown. Returns what it cost; the caller owns any
 *  budget beyond the caps. */
export async function settleCallerAttempt(
  services: LedgerServices,
  identity: AttemptIdentity,
  attempt: ProviderAttempt
): Promise<number> {
  const settledAt = Date.now()
  const charge = services.costTracker.record(attempt.providerModel, attempt.usage, settledAt)
  const draft: AttemptDraft = {
    kind: 'turn',
    charge,
    usage: normalizeUsage(attempt.usage),
    id: llmAttemptId(randomUUID()),
    settledAt,
  }

  await recordDurably(services, toAttemptInput(identity, attempt, draft))

  if (charge.exceededCap !== undefined) {
    throw new RunHalted('budget', `${charge.exceededCap} cost cap exceeded by incurred usage`)
  }

  return charge.costUsd
}

function toAttemptInput(
  identity: AttemptIdentity,
  attempt: ProviderAttempt,
  draft: AttemptDraft
): LLMAttemptInput {
  const { billingAgentId, ...who } = identity
  const base = {
    id: draft.id,
    ...who,
    billingAgentId: billingAgentId ?? identity.agentId,
    kind: draft.kind,
    provider: attempt.providerModel.provider,
    model: attempt.providerModel.model,
    usageSource: attempt.usageSource,
    costSource: draft.charge.costSource,
    inputTokens: draft.usage.input,
    outputTokens: draft.usage.output,
    cacheReadTokens: draft.usage.cacheRead,
    cacheWriteTokens: draft.usage.cacheWrite,
    reasoningTokens: draft.usage.reasoning,
    costUsd: draft.charge.costUsd,
    latencyMs: normalizeCount(attempt.latencyMs),
    settledAt: draft.settledAt,
  }

  return attempt.outcome === 'success'
    ? { ...base, outcome: 'success' }
    : { ...base, outcome: attempt.outcome, errorCode: attempt.errorCode }
}

// Malformed provider counts (undefined/NaN/negative) would poison cumulative totals for the
// rest of the session, and the durable row stores integers — normalize once for both.
export function normalizeUsage(usage: TokenUsage): NormalizedUsage {
  return {
    input: normalizeCount(usage.input),
    output: normalizeCount(usage.output),
    cacheRead: normalizeCount(usage.cacheRead),
    cacheWrite: normalizeCount(usage.cacheWrite),
    reasoning: normalizeCount(usage.reasoning),
  }
}

function normalizeCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}
