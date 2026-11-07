// The slice of the Workers runtime this Worker calls, so the typecheck needs no extra package.
interface D1Result {
  readonly meta: { readonly changes: number }
}

interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement
  run(): Promise<D1Result>
  first<T>(): Promise<T | null>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
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
