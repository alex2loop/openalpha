import { BRAND } from '../../../src/core/brand'

const VAPID_SUBJECT = `https://${BRAND.publicDomain}`
const VAPID_JWT_SECONDS = 3_600
export const VAPID_CURVE = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const
const JWT_HEADER = { typ: 'JWT', alg: 'ES256' }
const UNCOMPRESSED_POINT = 0x04
const MS_PER_SECOND = 1_000
const PLUS_RE = /\+/g
const SLASH_RE = /\//g
const DASH_RE = /-/g
const UNDERSCORE_RE = /_/g
const PADDING_RE = /=+$/

export interface VapidKey {
  readonly privateKey: CryptoKey
  /** The uncompressed P-256 point, base64url: what the app subscribes with. */
  readonly publicKey: string
}

interface VapidJwk {
  readonly kty?: string
  readonly crv?: string
  readonly d?: string
  readonly x: string
  readonly y: string
}

/** Reads the private key as the JWK JSON `scripts/vapid-keys.ts` prints and derives the public key
 *  from its `x` and `y`. A secret that is not such a key throws. */
export async function importVapidKey(secret: string): Promise<VapidKey> {
  const jwk: unknown = JSON.parse(secret)

  if (!isVapidJwk(jwk)) {
    throw new TypeError('the VAPID secret is not an EC private key')
  }

  const privateKey = await crypto.subtle.importKey('jwk', jwk, VAPID_CURVE, false, ['sign'])
  const point = new Uint8Array([
    UNCOMPRESSED_POINT,
    ...fromBase64Url(jwk.x),
    ...fromBase64Url(jwk.y),
  ])

  return { privateKey, publicKey: toBase64Url(point) }
}

function isVapidJwk(value: unknown): value is VapidJwk {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof value.x === 'string' &&
    'y' in value &&
    typeof value.y === 'string'
  )
}

/** The `Authorization` value for a push service: a short-lived ES256 token naming that service's
 *  origin, and the public key it verifies against. */
export async function buildVapidAuthorization(input: {
  audience: string
  key: VapidKey
  now: number
}): Promise<string> {
  const claims = {
    aud: input.audience,
    exp: Math.floor(input.now / MS_PER_SECOND) + VAPID_JWT_SECONDS,
    sub: VAPID_SUBJECT,
  }
  const unsigned = `${toBase64Url(encode(JWT_HEADER))}.${toBase64Url(encode(claims))}`
  const signature = await crypto.subtle.sign(
    SIGNATURE,
    input.key.privateKey,
    new TextEncoder().encode(unsigned)
  )

  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${input.key.publicKey}`
}

function encode(value: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(PLUS_RE, '-')
    .replace(SLASH_RE, '_')
    .replace(PADDING_RE, '')
}

function fromBase64Url(text: string): Uint8Array {
  const standard = text.replace(DASH_RE, '+').replace(UNDERSCORE_RE, '/')

  return Uint8Array.from(atob(standard), (char) => char.charCodeAt(0))
}
