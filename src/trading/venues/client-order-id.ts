import { createHash } from 'node:crypto'

const LOWERCASE_HEX_RE = /^[0-9a-f]+$/

/** Deterministic, so a retry re-derives the same id rather than placing a second order, and hex,
 *  so it fits every venue's allowed characters. The length is the venue's own. */
export function hashedClientOrderId(key: string, length: number): string {
  return createHash('sha256').update(key).digest('hex').slice(0, length)
}

/** Whether an id has the shape `hashedClientOrderId` mints at this length. A shape test, not proof:
 *  it tells an id this tree minted from one the exchange's own app generated, which is never
 *  lowercase hex of exactly this length. */
export function isHashedClientOrderId(id: string, length: number): boolean {
  return id.length === length && LOWERCASE_HEX_RE.test(id)
}
