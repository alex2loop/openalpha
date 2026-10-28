import { lookup } from 'node:dns/promises'

import type { DaemonTask, TaskPassListener } from '@/core/container'
import type { OperatorMessage } from '@/core/errors'
import type { Logger } from '@/core/logging/logger'
import type { OperationsPolicy } from '@/trading/kernel/config'
import { type MissingEnvError, missingEnvOf } from '@/core/config/resolve'
import { notifyPass, TASK_FAILED } from '@/core/container'
import { ChannelError, isAbortError, LLMError, RunHalted, StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'
import { sleep } from '@/core/utils/time'

/** What a tick may say about its own pass without failing it. */
export interface PassNotes {
  /** A step that failed alone while the pass carried on; the pass reports it as its error. */
  fail(): void
}

export type OperationTick = (signal: AbortSignal, notes: PassNotes) => Promise<void>
type Reachability = Pick<
  OperationsPolicy,
  'reachabilityHost' | 'reachabilityTimeoutMs' | 'offlineRetryMs'
>

/** One bounded background loop: what each tick does, when the next one fires, and the host it
 *  waits on while offline. */
interface LoopSpec {
  readonly name: string
  /** The loop's fixed cadence; absent when each wait is worked out from the clock. */
  readonly everyMs?: number
  nextDelayMs(now: number): number
  readonly tick: OperationTick
  readonly onTaskPass: TaskPassListener
  readonly logger: Logger
  readonly reachability: Reachability
}

/** Whether a tick is running, so a self-upgrade waits for it instead of cutting it short. */
interface LoopState {
  ticking: boolean
}

/** The one loop. There is no `setInterval` anywhere in trading: an interval that fires while the
 *  previous tick is still running is how a bounded loop becomes concurrent with itself. */
export function createLoopTask(spec: LoopSpec): DaemonTask {
  return createTask(spec, { delayed: false })
}

export function createDelayedLoopTask(spec: LoopSpec): DaemonTask {
  return createTask(spec, { delayed: true })
}

function createTask(spec: LoopSpec, options: { readonly delayed: boolean }): DaemonTask {
  const state: LoopState = { ticking: false }

  return {
    name: spec.name,
    isWorking: () => state.ticking,
    async start(signal) {
      if (options.delayed && !(await waitForNextTick(spec.nextDelayMs(Date.now()), signal))) {
        return
      }

      await runLoop(spec, { signal, state })
    },
  }
}

async function runLoop(
  spec: LoopSpec,
  run: { readonly signal: AbortSignal; readonly state: LoopState }
): Promise<void> {
  const { signal, state } = run
  const keyWarning = { warned: false }

  while (!signal.aborted) {
    if (!(await waitUntilReachable(spec, signal))) {
      return
    }

    state.ticking = true

    let delayMs: number | undefined

    try {
      delayMs = await runPass(spec, signal, keyWarning)
    } finally {
      state.ticking = false
    }

    if (delayMs === undefined || !(await waitForNextTick(delayMs, signal))) {
      return
    }
  }
}

/** The tick between its two reports. `undefined` means stop; otherwise the wait until the next
 *  pass, which is also what the report says the next one is due. */
async function runPass(
  spec: LoopSpec,
  signal: AbortSignal,
  keyWarning: { warned: boolean }
): Promise<number | undefined> {
  const at = Date.now()
  const report = (phase: 'start' | 'end', extra: PassDetail): void =>
    notifyPass(spec.onTaskPass, {
      name: spec.name,
      phase,
      at,
      ...(spec.everyMs === undefined ? {} : { everyMs: spec.everyMs }),
      ...extra,
    })
  let detail: PassDetail = {}

  report('start', detail)

  try {
    const outcome = await runTick(spec, signal, keyWarning)

    if (outcome.stop) {
      return undefined
    }

    const now = Date.now()
    const delayMs = spec.nextDelayMs(now)

    detail = {
      nextAt: now + delayMs,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    }

    return delayMs
  } catch (err: unknown) {
    detail = { error: TASK_FAILED }

    throw err
  } finally {
    report('end', detail)
  }
}

interface PassDetail {
  readonly error?: OperatorMessage
  readonly nextAt?: number
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

    reportOffline(spec)

    if (!(await waitForNextTick(offlineRetryMs, signal))) {
      return false
    }
  }
}

/** An offline stretch is the pass's error until the loop reaches the network again and runs. */
function reportOffline(spec: LoopSpec): void {
  const { reachabilityHost, offlineRetryMs } = spec.reachability
  const at = Date.now()

  notifyPass(spec.onTaskPass, {
    name: spec.name,
    phase: 'end',
    at,
    ...(spec.everyMs === undefined ? {} : { everyMs: spec.everyMs }),
    error: { key: 'ui.task.offline', params: { host: reachabilityHost } },
    nextAt: at + offlineRetryMs,
  })
}

type TickOutcome =
  | { readonly stop: true }
  | { readonly stop: false; readonly error?: OperatorMessage }

/** `stop` means shutdown. A boundary failure is logged and retried on the next interval; an invariant
 *  failure escapes to the quarantine around the loop rather than spinning forever getting the same
 *  thing wrong; an abort is shutdown only when the loop's own signal fired. An operator stopping the
 *  pass's run ends that pass, and the loop waits for the next interval. An unset key is said once until the loop logs
 *  anything else: every tick in between would only repeat it. */
async function runTick(
  spec: LoopSpec,
  signal: AbortSignal,
  keyWarning: { warned: boolean }
): Promise<TickOutcome> {
  let failed = false

  try {
    await spec.tick(signal, {
      fail: () => {
        failed = true
      },
    })
    keyWarning.warned = false

    return { stop: false, ...(failed ? { error: TASK_FAILED } : {}) }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      if (signal.aborted) {
        return { stop: true }
      }

      spec.logger.info('trading.tick_stopped', { operation: spec.name })
      return { stop: false }
    }

    if (!isBoundaryFailure(err)) {
      throw err
    }

    const missing = missingEnvOf(err)

    if (missing !== undefined) {
      warnKeyMissingOnce(spec, missing, keyWarning)
      return { stop: false, error: { key: 'ui.task.keyMissing', params: { env: missing.env } } }
    }

    spec.logger.warn('trading.tick_failed', { operation: spec.name, err: formatErrForLog(err) })
    keyWarning.warned = false
    return { stop: false, error: TASK_FAILED }
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
