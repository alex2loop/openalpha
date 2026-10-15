import { AsyncLocalStorage } from 'node:async_hooks'

/** One id per thing the operator asked for, stamped on every record the request produces without
 *  threading a logger through the seams that produce them. The store lives and dies with its async
 *  context, so a scope that ends releases it — there is nothing here to clear. */
const storage = new AsyncLocalStorage<string>()

export function withCorrelation<T>(id: string, fn: () => T): T {
  return storage.run(id, fn)
}

export function currentCorrelation(): string | undefined {
  return storage.getStore()
}
