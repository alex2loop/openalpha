/** Sets `key` as the newest entry; past `max` entries the oldest leaves (insertion order is age). */
export function setCapped<K, V>(map: Map<K, V>, entry: readonly [K, V], max: number): void {
  const [key, value] = entry

  map.delete(key)
  map.set(key, value)

  for (const old of map.keys()) {
    if (map.size <= max) {
      break
    }

    map.delete(old)
  }
}
