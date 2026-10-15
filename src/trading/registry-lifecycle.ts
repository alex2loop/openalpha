import { ConfigError } from '@/core/errors'

interface RegistrationPhase<T> {
  add(id: string, value: T): void
  close(): void
  entries(): readonly T[]
  find(id: string): T | null
}

// Shared open/close/duplicate lifecycle: the three registries differ in what they register, never
// in how registration works.
export function createRegistrationPhase<T>(boundary: string): RegistrationPhase<T> {
  const byId = new Map<string, T>()
  let closed = false

  return {
    add(id, value) {
      if (closed) {
        throw new ConfigError(`${boundary} registration is closed`, undefined, [boundary, id])
      }

      if (byId.has(id)) {
        throw new ConfigError(`duplicate ${boundary} id: ${id}`, undefined, [boundary, id])
      }

      byId.set(id, value)
    },

    // Idempotent: a failed start must not leave a half-open registry a later call can mutate.
    close() {
      closed = true
    },

    entries() {
      assertClosed(closed, boundary)

      return [...byId.values()]
    },

    find(id) {
      assertClosed(closed, boundary)

      return byId.get(id) ?? null
    },
  }
}

// Throwing beats an empty list, which is what a mis-ordered provider would silently produce and
// would surface much later as "no market owns this ticker".
function assertClosed(closed: boolean, boundary: string): void {
  if (!closed) {
    throw new ConfigError(`${boundary} read before registration closed`, undefined, [boundary])
  }
}
