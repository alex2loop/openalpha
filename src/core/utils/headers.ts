/** Later layers win by header name, whatever its case, so a caller's `Accept` replaces a default
 *  `accept` instead of riding beside it. The result is a plain record keyed by lowercase name. */
export function mergeHeaders(
  ...layers: readonly Readonly<Record<string, string>>[]
): Record<string, string> {
  const merged = new Headers()

  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer)) {
      merged.set(name, value)
    }
  }

  return Object.fromEntries(merged)
}
