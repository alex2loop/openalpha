import type { ProviderGate } from '@/tools/web/search/types'
import { abortError } from '@/core/errors'
import { sleep } from '@/core/utils/time'

const DUCKDUCKGO_CONCURRENCY = 2
const DUCKDUCKGO_MIN_GAP_MS = 1_500

interface ThrottledInput<T> {
  readonly gates: Map<string, ProviderGate>
  readonly provider: string
  readonly signal: AbortSignal
  readonly task: () => Promise<T>
}

export async function runThrottled<T>(input: ThrottledInput<T>): Promise<T> {
  const { gates, provider, signal, task } = input
  const gate = gates.get(provider) ?? { active: 0, starting: false, waiters: [] }

  gates.set(provider, gate)
  await acquire(gate, provider, signal)

  try {
    return await task()
  } finally {
    gate.active -= 1
    wakeNextWaiter(gate)
  }
}

async function acquire(gate: ProviderGate, provider: string, signal: AbortSignal): Promise<void> {
  const concurrency = provider === 'duckduckgo' ? DUCKDUCKGO_CONCURRENCY : 8
  const minGapMs = provider === 'duckduckgo' ? DUCKDUCKGO_MIN_GAP_MS : 0

  await waitForTurn(gate, concurrency, signal)

  try {
    const now = performance.now()
    const elapsed = gate.lastStartedAt === undefined ? minGapMs : now - gate.lastStartedAt

    await sleep(Math.max(0, minGapMs - elapsed), signal)
    gate.active += 1
    gate.lastStartedAt = performance.now()
  } finally {
    gate.starting = false
    wakeNextWaiter(gate)
  }
}

// FIFO, no busy poll: a caller that cannot proceed yet queues a wake callback instead of sleeping
// and re-checking on a fixed interval, so releases wake waiters in arrival order.
async function waitForTurn(
  gate: ProviderGate,
  concurrency: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    throw abortError(signal)
  }

  for (;;) {
    if (!gate.starting && gate.active < concurrency) {
      gate.starting = true
      return
    }

    await nextTurn(gate, signal)

    // A wake already took this waiter off the queue and its abort listener off the signal; if the
    // abort landed before it resumed, nothing else would wake the next waiter.
    if (signal.aborted) {
      wakeNextWaiter(gate)
      throw abortError(signal)
    }
  }
}

function nextTurn(gate: ProviderGate, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const wake = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = (): void => {
      removeWaiter(gate, wake)
      reject(abortError(signal))
    }

    gate.waiters.push(wake)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function removeWaiter(gate: ProviderGate, wake: () => void): void {
  const index = gate.waiters.indexOf(wake)

  if (index !== -1) {
    gate.waiters.splice(index, 1)
  }
}

function wakeNextWaiter(gate: ProviderGate): void {
  gate.waiters.shift()?.()
}
