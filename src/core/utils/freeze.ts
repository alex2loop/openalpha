import { isPlainRecord } from '@/core/utils/collections'

export function freezeDeep<T>(value: T): T {
  return freeze(value, new WeakSet())
}

// `seen` guards a cyclic structure from an infinite recursion that would blow the stack; a value
// already frozen is also already visited (freezeDeep never freezes without recursing first), so
// the `Object.isFrozen` check below doubles as the cycle break without needing a second lookup.
function freeze<T>(value: T, seen: WeakSet<object>): T {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Object.isFrozen(value) || seen.has(value)) {
    return value
  }

  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      freeze(item, seen)
    }
    return Object.freeze(value)
  }

  if (!isPlainRecord(value)) {
    return Object.freeze(value)
  }

  for (const child of Object.values(value)) {
    freeze(child, seen)
  }

  return Object.freeze(value)
}
