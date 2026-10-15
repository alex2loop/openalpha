export const MEMORY_KEY_MAX_LEN = 256
const MEMORY_KEY_PATTERN = /^[A-Za-z0-9_:.@/-]+$/

export function isMemoryKey(value: string): boolean {
  return value.length > 0 && value.length <= MEMORY_KEY_MAX_LEN && MEMORY_KEY_PATTERN.test(value)
}
