import { lookup } from 'node:dns/promises'

import type { DaemonTask } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { OperationsPolicy } from '@/trading/kernel/config'
import { type MissingEnvError, missingEnvOf } from '@/core/config/resolve'
import { ChannelError, isAbortError, LLMError, RunHalted, StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'
import { sleep } from '@/core/utils/time'

export type OperationTick = (signal: AbortSignal) => Promise<void>
export type Reachability = Pick<
  OperationsPolicy,
  'reachabilityHost' | 'reachabilityTimeoutMs' | 'offlineRetryMs'
>

/** One bounded background loop: what each tick does, when the next one fires, and the host it
 *  waits on while offline. */
interface LoopSpec {
  readonly name: string
  nextDelayMs(now: number): number
  readonly tick: OperationTick
  readonly logger: Logger
  readonly reachability: Reachability
}

/** The one loop. There is no `setInterval` anywhere in trading: an interval that fires while the
 *  previous tick is still running is how a bounded loop becomes concurrent with itself. */
export function createLoopTask(spec: LoopSpec): DaemonTask {
  return {
    name: spec.name,
    async start(signal) {
      await runLoop(spec, signal)
    },
  }
}

export function createDelayedLoopTask(spec: LoopSpec): DaemonTask {
  return {
    name: spec.name,
    async start(signal) {
      if (!(await waitForNextTick(spec.nextDelayMs(Date.now()), signal))) {
        return
      }

      await runLoop(spec, signal)
    },
  }
}

async function runLoop(spec: LoopSpec, signal: AbortSignal): Promise<void> {
  const keyWarning = { warned: false }

  while (!signal.aborted) {
    if (!(await waitUntilReachable(spec, signal))) {
      return
    }

    if (!(await runTick(spec, signal, keyWarning))) {
      return
    }

    if (!(await waitForNextTick(spec.nextDelayMs(Date.now()), signal))) {
      return
    }
  }
}

/** `false` means stop. A tick waits out an offline stretch instead of running into it, so a fetch
 *  trips no source breaker and a send burns no delivery attempt. One warning per stretch. */
async function waitUntilReachable(spec: LoopSpec, signal: AbortSignal): Promise<boolean> {
  const { reachabilityHost, reachabilityTimeoutMs, offlineRetryMs } = spec.reachability
  let warned = false

  for (;;) {
    // The OS resolver, the path every outbound fetch takes: raw DNS or an address policy would gate
    // on a different question than the one the tick is about to ask.
    const resolved = lookup(reachabilityHost).then(
      () => true,
      () => false
    )
    const reachable = (await settleWithin(resolved, reachabilityTimeoutMs)) && (await resolved)

    if (reachable) {
      return true
    }

    if (signal.aborted) {
      return false
    }

    if (!warned) {
      spec.logger.warn('trading.tick_offline', { operation: spec.name, host: reachabilityHost })
      warned = true
    }

    if (!(await waitForNextTick(offlineRetryMs, signal))) {
      return false
    }
  }
}

/** `false` means stop. A boundary failure is logged and retried on the next interval; an invariant
 *  failure escapes to the quarantine around the loop rather than spinning forever getting the same
 *  thing wrong; an abort is shutdown, not a failure. An unset key is said once until the loop logs
 *  anything else: every tick in between would only repeat it. */
async function runTick(
  spec: LoopSpec,
  signal: AbortSignal,
  keyWarning: { warned: boolean }
): Promise<boolean> {
  try {
    await spec.tick(signal)
    keyWarning.warned = false
    return true
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return false
    }

    if (!isBoundaryFailure(err)) {
      throw err
    }

    const missing = missingEnvOf(err)

    if (missing !== undefined) {
      warnKeyMissingOnce(spec, missing, keyWarning)
      return true
    }

    spec.logger.warn('trading.tick_failed', { operation: spec.name, err: formatErrForLog(err) })
    keyWarning.warned = false
    return true
  }
}

function warnKeyMissingOnce(
  spec: LoopSpec,
  err: MissingEnvError,
  keyWarning: { warned: boolean }
): void {
  if (keyWarning.warned) {
    return
  }

  keyWarning.warned = true
  spec.logger.warn('trading.tick_key_missing', { operation: spec.name, env: err.env })
}

/** A storage, channel, or provider failure, or a model key the operator has not set yet, is the
 *  outside world being unavailable, and the next interval is the right response. Everything else
 *  — a validation failure, a lost invariant, a misconfiguration — is this code being wrong, and
 *  retrying it forever would hide that. */
export function isBoundaryFailure(err: unknown): boolean {
  if (err instanceof RunHalted) {
    return err.code === 'budget' || err.code === 'rate'
  }

  return (
    [StorageError, ChannelError, LLMError].some((kind) => err instanceof kind) ||
    missingEnvOf(err) !== undefined
  )
}

/** `sleep` rejects on abort, which here means shutdown rather than a task failure, so the loop
 *  exits normally instead of propagating it to the tracker. */
async function waitForNextTick(delayMs: number, signal: AbortSignal): Promise<boolean> {
  try {
    await sleep(delayMs, signal)
    return true
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return false
    }

    throw err
  }
}
