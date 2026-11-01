type StorageArea = 'session' | 'local'

// Private windows, blocked site data and a full quota all throw here; each reads as absent.
export function readStorage(area: StorageArea, key: string): string | undefined {
  try {
    return resolveStorage(area).getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

export function writeStorage(area: StorageArea, key: string, value: string): void {
  try {
    resolveStorage(area).setItem(key, value)
  } catch {
    // Blocked or full: the value lives only as long as its caller keeps it.
  }
}

export function removeStorage(area: StorageArea, key: string): void {
  try {
    resolveStorage(area).removeItem(key)
  } catch {
    // Blocked: nothing was stored, so nothing is left behind.
  }
}

function resolveStorage(area: StorageArea): Storage {
  return area === 'session' ? sessionStorage : localStorage
}
