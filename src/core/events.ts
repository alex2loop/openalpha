import type { Logger } from '@/core/logging/logger'
import { abortError, RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging target for module-contributed events
export interface BusEventMap {}

export interface EventBus {
  emit<T extends keyof BusEventMap>(topic: T, payload: BusEventMap[T]): void
  on<T extends keyof BusEventMap>(topic: T, fn: (p: BusEventMap[T]) => void): () => void
  once<T extends keyof BusEventMap>(
    topic: T,
    options: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<BusEventMap[T]>
}

type Handler = (payload: unknown) => void

export function observe<T extends keyof BusEventMap>(
  bus: EventBus,
  topic: T,
  options: { readonly signal: AbortSignal; readonly fn: (p: BusEventMap[T]) => void }
): void {
  if (options.signal.aborted) {
    return
  }

  const off = bus.on(topic, options.fn)
  options.signal.addEventListener('abort', off, { once: true })
}

export function createEventBus(logger: Logger): EventBus {
  const handlers = new Map<keyof BusEventMap, Set<Handler>>()
  const on: EventBus['on'] = (topic, fn) => subscribe(handlers, topic, fn)

  return {
    on,
    emit(topic, payload) {
      const set = handlers.get(topic)

      if (!set) {
        return
      }

      for (const fn of set) {
        try {
          fn(payload)
        } catch (err: unknown) {
          // Listener throws must never propagate to emitters — isolate + log.
          logger.warn('bus.handler_threw', { topic: String(topic), err: formatErrForLog(err) })
        }
      }
    },
    once(topic, options) {
      return onceWithTimeout(on, topic, options)
    },
  }
}

function subscribe<T extends keyof BusEventMap>(
  handlers: Map<keyof BusEventMap, Set<Handler>>,
  topic: T,
  fn: (p: BusEventMap[T]) => void
): () => void {
  let set = handlers.get(topic)

  if (!set) {
    set = new Set()
    handlers.set(topic, set)
  }

  // why-safe: `emit` only dispatches a `BusEventMap[T]` to the set filed under that same topic.
  const handler = fn as Handler
  set.add(handler)

  return () => {
    set?.delete(handler)
  }
}

function onceWithTimeout<T extends keyof BusEventMap>(
  on: EventBus['on'],
  topic: T,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<BusEventMap[T]> {
  if (options.signal?.aborted) {
    return Promise.reject(abortError(options.signal))
  }

  return new Promise<BusEventMap[T]>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    let off: (() => void) | undefined

    const cleanup = (): void => {
      if (off !== undefined) {
        off()
        off = undefined
      }
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const onEvent = (p: BusEventMap[T]): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(p)
    }

    const onAbort = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(abortError(options.signal))
    }

    off = on(topic, onEvent)
    timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(
        new RunHalted('abort', `event '${String(topic)}' timed out after ${options.timeoutMs}ms`)
      )
    }, options.timeoutMs)

    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
