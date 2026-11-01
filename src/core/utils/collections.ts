import { ValidationError } from '@/core/errors'

/** True for a plain object, excluding `null` and arrays. Domain wording stays with each caller. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every own enumerable key on `record` absent from `allowedKeys`, in object-entry order. Owns no
 * domain wording: the caller composes the failure message from the returned keys.
 */
export function collectUnknownKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): readonly string[] {
  return Object.keys(record).filter((key) => !allowedKeys.has(key))
}

export function formatKeys(keys: readonly string[]): string {
  return keys.map((key) => `'${key}'`).join(', ')
}

/** `T` with every key that may hold `undefined` made optional and narrowed, the rest untouched. */
type DefinedOnly<T> = T extends object
  ? { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
      [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
    }
  : never

/** Drops the keys holding `undefined`. Zod materializes an omitted optional as a present
 *  `undefined`, and under `exactOptionalPropertyTypes` only an absent key fits a domain `foo?: T`. */
export function definedOnly<T extends object>(value: T): DefinedOnly<T> {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)

  // why-safe: filtering entries removes keys, never adds or retypes one, and every removed key
  // held `undefined`, which `DefinedOnly` makes optional.
  return Object.fromEntries(entries) as DefinedOnly<T>
}

export interface LruMap<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V): void
  readonly size: number
  values(): IterableIterator<V>
  clear(): void
}

export interface TtlCache<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V): void
  delete(key: K): void
}

interface TtlEntry<V> {
  readonly value: V
  readonly expiresAt: number
}

// onEvict fires for each value pushed out by capacity — the hook for a value that owns a resource
// (e.g. an open socket) the map itself cannot release.
export function lruMap<K, V>(capacity: number, onEvict?: (value: V) => void): LruMap<K, V> {
  if (capacity < 1) {
    throw new ValidationError('lruMap capacity must be >= 1')
  }

  const map = new Map<K, V>()

  return {
    get(key) {
      const hit = map.get(key)

      if (hit === undefined) {
        return undefined
      }

      // LRU: re-insert so recently-accessed keys become newest (last to evict).
      map.delete(key)
      map.set(key, hit)

      return hit
    },
    set(key, value) {
      if (map.has(key)) {
        map.delete(key)
      }

      map.set(key, value)

      while (map.size > capacity) {
        evictOldest(map, onEvict)
      }
    },
    get size() {
      return map.size
    },
    values() {
      return map.values()
    },
    clear() {
      map.clear()
    },
  }
}

/** Evicts the oldest entries (insertion order) until `map` holds at most `max`. */
export function trimToSize<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    evictOldest(map)
  }
}

export function ttlCache<K, V>(ttlMs: number, max: number): TtlCache<K, V> {
  if (max < 1) {
    throw new ValidationError('ttlCache max must be >= 1')
  }

  const store = new Map<K, TtlEntry<V>>()

  return {
    get(key) {
      const hit = store.get(key)

      if (!hit) {
        return undefined
      }

      if (hit.expiresAt <= Date.now()) {
        store.delete(key)
        return undefined
      }

      return hit.value
    },
    set(key, value) {
      const now = Date.now()

      if (store.size >= max && !store.has(key)) {
        evictForCapacity(store, max, now)
      }

      store.set(key, { value, expiresAt: now + ttlMs })
    },
    delete: (key) => {
      store.delete(key)
    },
  }
}

// Prune expired entries; if still at capacity, evict oldest by insertion order.
function evictForCapacity<K, V>(store: Map<K, TtlEntry<V>>, max: number, now: number): void {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) {
      store.delete(k)
    }
  }

  if (store.size < max) {
    return
  }

  evictOldest(store)
}

function evictOldest<K, V>(map: Map<K, V>, onEvict?: (value: V) => void): void {
  const oldest = map.keys().next().value

  if (oldest === undefined) {
    return
  }

  const value = map.get(oldest)
  map.delete(oldest)

  if (value !== undefined) {
    onEvict?.(value)
  }
}
