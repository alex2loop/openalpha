import type { ModelPrice } from '@/ai/types'

// A vendor-qualified price row also answers for its bare tail, the form the catalog ships for a
// direct provider (`google/gemini-2.5-flash` for `gemini-2.5-flash`). A tail two vendors both claim
// is left out instead of picking one's price, and an exact row is never overwritten.
export function withBareTails(
  exact: ReadonlyMap<string, ModelPrice>
): ReadonlyMap<string, ModelPrice> {
  const claims = new Map<string, number>()

  for (const id of exact.keys()) {
    const tail = bareTail(id)
    claims.set(tail, (claims.get(tail) ?? 0) + 1)
  }

  const map = new Map(exact)
  for (const [id, price] of exact) {
    const tail = bareTail(id)

    if (claims.get(tail) === 1 && !map.has(tail)) {
      map.set(tail, price)
    }
  }

  return map
}

function bareTail(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1)
}
