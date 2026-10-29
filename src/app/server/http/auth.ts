import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'

import type { ResolvedConfig } from '@/core/config/resolve'
import { BRAND } from '@/core/brand'
import { OperatorConfigError } from '@/core/config/resolve'
import { replacePrivateFileAtomic } from '@/core/security/private-files'

const MIN_TOKEN_LEN = 32
const TOKEN_BYTES = 32
const TOKEN_FILE_MODE = 0o600
const MAX_FAILS = 5
const LOCKOUT_MS = 30_000
/** Exponential-backoff ceiling: 1h. */
const MAX_LOCKOUT_MS = 3_600_000
const MAX_PEERS = 1024
// The lockout key of a request whose peer address or forwarded client is unknown.
const UNKNOWN_PEER = '?'
const PROXIED_PEER_PREFIX = 'proxied:'
const FORWARDED_FOR = 'x-forwarded-for'
const FORWARDED_FOR_SEPARATOR = ','
const SECRET_BYTES = 32

export const LOOPBACK_HOST = '127.0.0.1'
// Headers a reverse proxy adds; without `public_url` the daemon refuses to be fronted by one.
export const PROXY_HEADERS: readonly string[] = [
  'x-forwarded-for',
  'forwarded',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'via',
  'cf-connecting-ip',
  'true-client-ip',
]
const LOOPBACK_ADDRESSES: readonly string[] = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '[::1]']
const PAGE_PROTOCOL = 'http:'
const BEARER_PREFIX = 'Bearer '

interface PeerState {
  fails: number
  until: number
  violations: number
  lastFailAt: number
}

/** The token the operator named cannot serve. The stored one never stands in for it: the API
 *  stays closed. */
export class ApiTokenError extends OperatorConfigError {}

// Process-local by design: one daemon process owns the surface, so the lockout table is
// process-wide security state, not per-run state. Bounded by MAX_PEERS (see prunePeers).
const peers = new Map<string, PeerState>()

export function isLoopback(ip: string | null): boolean {
  return ip !== null && LOOPBACK_ADDRESSES.includes(ip)
}

// Constant-time bearer compare: SHA-256 both sides (full-length coverage, fixed 32-byte digests),
// then timingSafeEqual. Avoids both the length-timing leak and any input-length truncation.
function isTokenEqual(got: string, token: string): boolean {
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(token).digest()

  return timingSafeEqual(a, b)
}

/** What a request offered: a matching token or code, a live browser session, a token or code that
 *  does not match, one left unchecked because the lockout holds, or nothing at all. */
export type Credential = 'valid' | 'session' | 'wrong' | 'locked' | 'absent'

export function resolveBearerCredential(
  header: string | null,
  token: string,
  locked: boolean
): Credential {
  if (header?.startsWith(BEARER_PREFIX) !== true) {
    return 'absent'
  }

  if (locked) {
    return 'locked'
  }

  return isTokenEqual(header.slice(BEARER_PREFIX.length), token) ? 'valid' : 'wrong'
}

export type AuthOutcome = 'ok' | 'locked' | 'unauthorized'

// One lockout accounting for HTTP, WS and the code exchange, per `resolvePeerKey`: while it holds, a
// token or code is refused before it is compared, so no guess is checked. A session is never
// refused by it, only a valid token or code clears it (a session cookie proves nothing about who is
// guessing), and only a wrong token or a wrong or used code counts toward it.
export function resolveAuthOutcome(peer: string, credential: Credential, now: number): AuthOutcome {
  if (credential === 'locked') {
    return 'locked'
  }

  if (credential === 'valid') {
    peers.delete(peer)

    return 'ok'
  }

  if (credential === 'session') {
    return 'ok'
  }

  if (credential === 'absent') {
    return 'unauthorized'
  }

  recordFailure(peer, now)

  return 'unauthorized'
}

/** The origin of the page a request belongs to, from its `Host`: `http://<host>` for a loopback
 *  name on any port (an SSH tunnel serves the daemon on a local port of its own), `publicUrl` for
 *  its own host, else `undefined`. A rebinding page reaches the loopback port under its own name,
 *  so it gets none. */
export function resolvePageOrigin(
  host: string | null,
  publicUrl: string | undefined
): string | undefined {
  if (host === null) {
    return undefined
  }

  const page = toHostUrl(PAGE_PROTOCOL, host)

  if (page !== undefined && LOOPBACK_HOSTNAMES.includes(page.hostname)) {
    return page.origin
  }

  if (publicUrl === undefined) {
    return undefined
  }

  // Parsed under the public scheme, so an explicit default port (`:443`) drops as it does there.
  const published = new URL(publicUrl)

  return toHostUrl(published.protocol, host)?.host === published.host ? publicUrl : undefined
}

/** Native clients send no Origin; a browser must come from the page it was opened on, so another
 *  local web app (a dev server on another port) is refused. */
export function isOriginAllowed(origin: string | null, pageOrigin: string): boolean {
  return origin === null || origin === pageOrigin
}

/** A fresh random secret: a sign-in code or a browser session's cookie value. */
export function buildSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url')
}

/** What is kept of a code or a session secret. Keyed by the API token, so a token change ends
 *  every browser session. */
export function toSecretHash(secret: string, token: string): string {
  return createHmac('sha256', token).update(secret).digest('hex')
}

function toHostUrl(protocol: string, host: string): URL | undefined {
  const url = `${protocol}//${host}`

  return URL.canParse(url) ? new URL(url) : undefined
}

/** Who a request counts as for the lockout. A caller with no proxy header is keyed by its own peer.
 *  Through the `public_url` host it is keyed by the last `X-Forwarded-For` hop, the one our proxy
 *  added, so a remote guesser never locks out a terminal on this machine. Proxy headers on any
 *  other host are not trusted: that caller shares one proxied key. */
export function resolvePeerKey(headers: Headers, ip: string | null, isPublicPage: boolean): string {
  if (!PROXY_HEADERS.some((name) => headers.has(name))) {
    return ip ?? UNKNOWN_PEER
  }

  const hop = isPublicPage
    ? headers.get(FORWARDED_FOR)?.split(FORWARDED_FOR_SEPARATOR).at(-1)?.trim()
    : undefined

  return `${PROXIED_PEER_PREFIX}${hop === undefined || hop === '' ? UNKNOWN_PEER : hop}`
}

/** Asked before a token or code is compared, so a guess sent during the lockout is never checked. */
export function isAuthLocked(peer: string, now: number): boolean {
  const entry = peers.get(peer)

  return entry !== undefined && entry.until > now
}

function recordFailure(peer: string, now: number): void {
  prunePeers(now)

  const entry = peers.get(peer) ?? { fails: 0, until: 0, violations: 0, lastFailAt: now }
  entry.fails += 1
  entry.lastFailAt = now

  if (entry.fails >= MAX_FAILS) {
    entry.until = now + Math.min(LOCKOUT_MS * 2 ** entry.violations, MAX_LOCKOUT_MS)
    entry.fails = 0
    entry.violations += 1
  }

  peers.set(peer, entry)
}

// Bound the map: an entry is forgotten, and its backoff with it, only after a full MAX_LOCKOUT_MS
// with no failure and no lockout; if still over cap, evict the oldest (Map iterates in insertion
// order). Without this, an attacker rotating keys grows `peers` without bound.
function prunePeers(now: number): void {
  for (const [peer, entry] of peers) {
    if (Math.max(entry.until, entry.lastFailAt) + MAX_LOCKOUT_MS <= now) {
      peers.delete(peer)
    }
  }

  while (peers.size > MAX_PEERS) {
    const oldest = peers.keys().next().value

    if (oldest === undefined) {
      break
    }

    peers.delete(oldest)
  }
}

export function apiTokenPath(dataDir: string): string {
  return join(dataDir, 'auth', 'api', 'token.json')
}

/** Whether a configured or stored value can serve as the API token. */
function isApiTokenUsable(token: unknown): token is string {
  return typeof token === 'string' && token.length >= MIN_TOKEN_LEN
}

/** The token the variable `token_env` names holds, or the `ApiTokenError` saying why it cannot
 *  serve. The daemon and the CLI read it here, so both refuse the same values. */
export function resolveTokenEnv(
  tokenEnv: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  const value = env[tokenEnv]

  if (isApiTokenUsable(value)) {
    return value
  }

  throw new ApiTokenError(
    `[api].token_env = "${tokenEnv}" is set but that variable is empty or shorter than ${MIN_TOKEN_LEN} chars`,
    {
      key: 'errors.configApiTokenShort',
      params: { env: tokenEnv, minimum: MIN_TOKEN_LEN, brand: BRAND.name },
    }
  )
}

export async function ensureApiToken(
  config: ResolvedConfig,
  env: Readonly<Record<string, string | undefined>>
): Promise<string> {
  const tokenEnv = config.api.tokenEnv

  if (tokenEnv !== undefined) {
    return resolveTokenEnv(tokenEnv, env)
  }

  const path = apiTokenPath(config.paths.dataDir)
  const file = Bun.file(path)

  if (await file.exists()) {
    // Self-heal the permissions on the read path: a world-readable token is a token to rotate.
    await chmod(path, TOKEN_FILE_MODE)

    const parsed: unknown = await file.json().catch(() => null)
    const existing = parseTokenFile(parsed)

    if (existing !== null) {
      return existing
    }
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex')

  await replacePrivateFileAtomic({ path, content: JSON.stringify({ token }, null, 2) })

  return token
}

/** The token a stored token file holds, or null when its shape or length cannot serve. The daemon
 *  and the CLI read the file through this, so both refuse the same files. */
export function parseTokenFile(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || !('token' in parsed)) {
    return null
  }

  return isApiTokenUsable(parsed.token) ? parsed.token : null
}
