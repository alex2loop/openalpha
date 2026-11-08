// The slice of the Workers runtime this Worker calls, so the typecheck needs no extra package.
interface D1Result<T = unknown> {
  readonly meta: { readonly changes: number }
  readonly results: T[]
}

interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement
  run(): Promise<D1Result>
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
}

interface Fetcher {
  fetch(request: Request): Promise<Response>
}

interface CacheStorage {
  readonly default: Cache
}

interface SubtleCrypto {
  timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}
