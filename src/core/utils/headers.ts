const DEFAULT_ACCEPT = 'application/json'

/** The default `accept`, then each layer in turn; a later layer wins by header name whatever its
 *  case, so a caller's `Accept` replaces the default instead of riding beside it. Plain keys, not
 *  `Headers`, so a malformed value fails inside the request, where its error is classified. */
export function buildRequestHeaders(
  ...layers: readonly Readonly<Record<string, string>>[]
): Record<string, string> {
  const merged: Record<string, string> = { accept: DEFAULT_ACCEPT }

  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer)) {
      merged[name.toLowerCase()] = value
    }
  }

  return merged
}
