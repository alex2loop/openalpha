const DEFAULT_ACCEPT = 'application/json'

/** The default `accept`, then each layer in turn; a later layer wins by header name whatever its
 *  case, so a caller's `Accept` replaces the default instead of riding beside it. */
export function buildRequestHeaders(
  ...layers: readonly Readonly<Record<string, string>>[]
): Record<string, string> {
  const merged = new Headers({ accept: DEFAULT_ACCEPT })

  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer)) {
      merged.set(name, value)
    }
  }

  return Object.fromEntries(merged)
}
