import type { ChainEntry } from '@/ai/types'
import type { ResolvedLlm } from '@/core/config/resolve'
import type { LLMRequest, ProviderModelId } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { CooldownTracker } from '@/core/utils/concurrency'
import { LLMError } from '@/core/errors'
import { sleep } from '@/core/utils/time'

interface CooldownWaitInput {
  readonly entries: readonly ChainEntry[]
  readonly tracker: CooldownTracker
  readonly req: LLMRequest
  readonly tuning: ResolvedLlm
  readonly logger: Logger
}

/** A chain entry is one model at one provider. Cooling the provider instead would disable every
 *  other model configured behind it, which is how a routing provider's chain lost its own
 *  fallbacks to a single upstream 429. */
export function buildEntryKey(entry: ChainEntry): string {
  return `${entry.provider.id}/${entry.model}`
}

export function isEntryOnCooldown(entry: ChainEntry, tracker: CooldownTracker): boolean {
  return entryReadyInMs(entry, tracker) > 0
}

// Every entry cooling down used to fail the call instantly, so one transient 429 sank the rest of
// a run — including its mandatory final synthesis. Wait out the shortest transient cooldown once,
// capped at the configured cooldown; permanent cooldowns never wait, and an abort during the wait
// propagates from sleep like any transport abort.
export async function orderAfterCooldownWait(
  input: CooldownWaitInput
): Promise<readonly ChainEntry[]> {
  const ordered = orderEntries(input.entries, input.tracker, input.req)
  if (ordered.length > 0) {
    return ordered
  }

  const waitMs = Math.min(...input.entries.map((entry) => entryReadyInMs(entry, input.tracker)))

  if (!Number.isFinite(waitMs)) {
    throw new LLMError('fatal', 'every entry in the chain is disabled until restart')
  }

  if (waitMs <= 0 || waitMs > input.tuning.transientCooldownMs) {
    throw buildCooldownError()
  }

  input.logger.warn('llm.cooldown_wait', { waitMs })
  await sleep(waitMs, input.req.signal)

  const retried = orderEntries(input.entries, input.tracker, input.req)
  if (retried.length === 0) {
    throw buildCooldownError()
  }
  return retried
}

/** Whatever refused them, a caller facing only cooling entries is being asked to wait — the one
 *  thing `rate` says and `transient` does not. */
function buildCooldownError(): LLMError {
  return new LLMError('rate', 'every entry in the chain is on cooldown')
}

function orderEntries(
  entries: readonly ChainEntry[],
  tracker: CooldownTracker,
  req: LLMRequest
): readonly ChainEntry[] {
  const available = entries.filter((entry) => !isEntryOnCooldown(entry, tracker))
  const preferred = req.preferredProviderModel

  if (preferred === undefined) {
    return preferredFirst(available, req.model)
  }

  if (preferred.model !== req.model) {
    throw new LLMError('not_found', 'preferred provider/model does not match the requested model')
  }

  const configured = entries.find((entry) => isProviderModel(entry, preferred))

  if (configured === undefined) {
    throw new LLMError('not_found', 'preferred provider/model is not configured')
  }

  if (isEntryOnCooldown(configured, tracker)) {
    return preferredFirst(available, req.model)
  }

  return [configured, ...available.filter((entry) => entry !== configured)]
}

// The agent's model leads; the rest stay as infra fallback.
function preferredFirst(entries: readonly ChainEntry[], model: string): readonly ChainEntry[] {
  const index = entries.findIndex((entry) => entry.model === model)

  return index <= 0 ? entries : [...entries.slice(index), ...entries.slice(0, index)]
}

function isProviderModel(entry: ChainEntry, id: ProviderModelId): boolean {
  return entry.provider.id === id.provider && entry.model === id.model
}

/** Cooling is recorded against the entry, or against its provider for a failure that spans every
 *  model behind it (bad key, unpaid bill). An entry waits out whichever runs longer. */
function entryReadyInMs(entry: ChainEntry, tracker: CooldownTracker): number {
  return Math.max(tracker.readyInMs(entry.provider.id), tracker.readyInMs(buildEntryKey(entry)))
}
