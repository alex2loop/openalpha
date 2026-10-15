import { isPlainRecord } from '@/core/utils/collections'

/** The id is pasted into later prompts, so only a plain token is kept: anything else is a network
 *  trying to write instructions through a field nobody approved. */
const ID_TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/

function toId(value: unknown): string | undefined {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined

  return id !== undefined && ID_TOKEN_RE.test(id) ? id : undefined
}

/** The value at a `.`-separated path through plain objects, or `undefined` if a step is not one. */
export function valueAt(json: unknown, dotted: string): unknown {
  let node: unknown = json

  for (const key of dotted.split('.')) {
    if (!isPlainRecord(node)) {
      return undefined
    }

    node = node[key]
  }

  return node
}

/** The id the network gave what was written: a top-level `id`, or the first one-level-nested
 *  `<key>.id`, when it is a string or a number. */
export function returnedIdOf(text: string): string | undefined {
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }

  if (!isPlainRecord(json)) {
    return undefined
  }

  const top = toId(json.id)

  if (top !== undefined) {
    return top
  }

  for (const value of Object.values(json)) {
    const nested = toId(valueAt(value, 'id'))

    if (nested !== undefined) {
      return nested
    }
  }

  return undefined
}
