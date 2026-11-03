import type { AsyncLocalStorage } from 'node:async_hooks'

type AsyncStorageClass = typeof AsyncLocalStorage

/** A value visible to everything a function calls, without threading it through the seams between.
 *  `tracksAsync` says how far it follows: true carries it across awaits and timers (Bun, Node);
 *  false holds it for the synchronous part of `fn` only (a browser worker), so a read after the
 *  first await sees `undefined`. A caller whose answer depends on the later reads checks it. */
interface ScopedValue<T> {
  readonly tracksAsync: boolean
  run<R>(value: T, fn: () => R): R
  get(): T | undefined
}

export function createScopedValue<T>(): ScopedValue<T> {
  const Storage = findAsyncStorage()

  return Storage === undefined ? createSynchronousScope<T>() : createTrackedScope(new Storage<T>())
}

// `node:async_hooks` is reached through the process, never imported: the browser build denies the
// specifier, and a browser worker has no `process` at all.
function findAsyncStorage(): AsyncStorageClass | undefined {
  const processRef: typeof process | undefined = globalThis.process
  const asyncHooks = processRef?.getBuiltinModule?.('node:async_hooks')

  return typeof asyncHooks?.AsyncLocalStorage === 'function'
    ? asyncHooks.AsyncLocalStorage
    : undefined
}

function createTrackedScope<T>(storage: AsyncLocalStorage<T>): ScopedValue<T> {
  return {
    tracksAsync: true,
    run: (value, fn) => storage.run(value, fn),
    get: () => storage.getStore(),
  }
}

function createSynchronousScope<T>(): ScopedValue<T> {
  let current: T | undefined

  return {
    tracksAsync: false,
    run(value, fn) {
      const previous = current

      current = value

      try {
        return fn()
      } finally {
        current = previous
      }
    },
    get: () => current,
  }
}
