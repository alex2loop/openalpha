import { createHash, randomUUID } from 'node:crypto'

const ALPHANUMERIC_RE = /^[A-Za-z0-9]+$/

/** For a host that streams a tool call without an id: the result must name the call it answers. */
export function buildToolCallId(): string {
  return `call_${randomUUID()}`
}

/** Rewrites an id another host minted into the shape this one accepts. The same id always maps to
 *  the same value, so a call and its result still pair up. */
export function toWireToolCallId(id: string, length: number | undefined): string {
  if (length === undefined || (id.length === length && ALPHANUMERIC_RE.test(id))) {
    return id
  }

  return createHash('sha256').update(id).digest('hex').slice(0, length)
}
