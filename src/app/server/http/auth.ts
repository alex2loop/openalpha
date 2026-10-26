import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
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

const LOOPBACK_ADDRESSES: readonly string[] = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '[::1]']
const PAGE_SCHEME = 'http://'

interface PeerState {
  fails: number
  until: number
  violations: number
}

/** The token the operator named cannot serve. The stored one never stands in for it: the API
 *  stays closed. */
export class ApiTokenError extends OperatorConfigError {}

// Process-local by design: one daemon process owns the surface, so the lockout table is
// process-wide security state, not per-run state. Bounded by MAX_PEERS (see prunePeers).
const peers = new Map<string, PeerState>()

type AuthBackoffState = 'ok' | 'locked'

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

/** What a request offered: a matching token, a token that does not match, or nothing at all. */
type Credential = 'valid' | 'wrong' | 'absent'

function toCredential(presented: readonly string[], token: string): Credential {
  if (presented.length === 0) {
    return 'absent'
  }

  return presented.some((got) => isTokenEqual(got, token)) ? 'valid' : 'wrong'
}

function bearerOf(header: string | null): string[] {
  return header?.startsWith('Bearer ') === true ? [header.slice('Bearer '.length)] : []
}

export function resolveBearerCredential(header: string | null, token: string): Credential {
  return toCredential(bearerOf(header), token)
}

/** The socket can carry the token in the header or in `?token=` — a browser WebSocket sets no headers. */
export function resolveWebSocketCredential(req: Request, token: string): Credential {
  const query = new URL(req.url).searchParams.get('token')

  return toCredential(
    [...bearerOf(req.headers.get('authorization')), ...(query === null ? [] : [query])],
    token
  )
}

export type AuthOutcome = 'ok' | 'locked' | 'unauthorized'

// One lockout accounting for HTTP and WS auth. Every peer is loopback, so the lockout is one shared
// key: a valid token is never refused because of it (and clears it), and only a request that
// presents a wrong token counts toward it.
export function resolveAuthOutcome(
  ip: string | null,
  credential: Credential,
  now: number
): AuthOutcome {
  const addr = ip ?? '?'

  if (credential === 'valid') {
    peers.delete(addr)

    return 'ok'
  }

  if (credential === 'absent') {
    return 'unauthorized'
  }

  if (authBackoff(addr, now) === 'locked') {
    return 'locked'
  }

  recordFailure(addr, now)

  return 'unauthorized'
}

/** A rebinding page reaches the loopback port under its own name, so only a loopback name passes.
 *  Any port does: an SSH tunnel serves the daemon on a local port of its own. */
export function isHostAllowed(host: string | null): boolean {
  return host !== null && LOOPBACK_HOSTNAMES.includes(toPageUrl(host)?.hostname ?? '')
}

/** Native clients send no Origin; a browser's WebSocket must come from the page it was opened on,
 *  so another local web app (a dev server on another port) is refused. */
export function isOriginAllowed(origin: string | null, host: string | null): boolean {
  if (origin === null) {
    return true
  }

  return host !== null && origin === toPageUrl(host)?.origin
}

function toPageUrl(host: string): URL | undefined {
  const url = `${PAGE_SCHEME}${host}`

  return URL.canParse(url) ? new URL(url) : undefined
}

function authBackoff(ip: string, now: number): AuthBackoffState {
  const entry = peers.get(ip)

  return entry !== undefined && entry.until > now ? 'locked' : 'ok'
}

function recordFailure(ip: string, now: number): void {
  prunePeers(now)

  const entry = peers.get(ip) ?? { fails: 0, until: 0, violations: 0 }
  entry.fails += 1

  if (entry.fails >= MAX_FAILS) {
    entry.until = now + Math.min(LOCKOUT_MS * 2 ** entry.violations, MAX_LOCKOUT_MS)
    entry.fails = 0
    entry.violations += 1
  }

  peers.set(ip, entry)
}

// Bound the map: drop entries no longer locked out with no pending fails; if still over cap, evict
// the oldest (Map iterates in insertion order). Without this, an attacker rotating source IPs grows
// `peers` without bound.
function prunePeers(now: number): void {
  for (const [ip, entry] of peers) {
    if (entry.until <= now && entry.fails === 0) {
      peers.delete(ip)
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

export async function ensureApiToken(
  config: ResolvedConfig,
  env: Readonly<Record<string, string | undefined>>
): Promise<string> {
  const tokenEnv = config.api.tokenEnv

  if (tokenEnv !== undefined && tokenEnv !== '') {
    const value = env[tokenEnv]

    if (value !== undefined && value.length >= MIN_TOKEN_LEN) {
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

  const path = apiTokenPath(config.paths.dataDir)
  const file = Bun.file(path)

  if (await file.exists()) {
    // Self-heal the permissions on the read path: a world-readable token is a token to rotate.
    await chmod(path, TOKEN_FILE_MODE)

    const parsed: unknown = await file.json().catch(() => null)
    const existing = readToken(parsed)

    if (existing !== null) {
      return existing
    }
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex')

  await replacePrivateFileAtomic({ path, content: JSON.stringify({ token }, null, 2) })

  return token
}

function readToken(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || !('token' in parsed)) {
    return null
  }

  const token = parsed.token

  return typeof token === 'string' && token.length >= MIN_TOKEN_LEN ? token : null
}
