const FNV_OFFSET = 2_166_136_261
const FNV_PRIME = 16_777_619
const KEY_SEPARATOR = '|'

/** FNV-1a over the joined parts: the same parts always give the same seed. */
export function seedOf(...parts: readonly string[]): number {
  const key = parts.join(KEY_SEPARATOR)
  let hash = FNV_OFFSET

  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), FNV_PRIME)
  }

  return hash >>> 0
}
