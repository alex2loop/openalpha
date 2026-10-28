import type { ServerWebSocket } from 'bun'

import type { ExecSocketData } from '@/app/server/ws/socket'
import type { ApiRouteContext } from '@/app/types'
import {
  isAuthLocked,
  isLoopback,
  LOOPBACK_HOST,
  PROXY_HEADERS,
  resolveAuthOutcome,
  resolveBearerCredential,
} from '@/app/server/http/auth'
import { apiError, toAuthRefusal } from '@/app/server/http/dispatch'

// Separate from the page's socket cap: a terminal never takes a browser's seat.
const MAX_EXEC_CONNECTIONS = 8

// Process-local: this process's open exec sockets, capped at MAX_EXEC_CONNECTIONS.
const seated = new Set<ServerWebSocket<ExecSocketData>>()

// Set once the daemon starts down: no new handshake, and an open socket starts no command.
let admissionClosed = false

/**
 * Who may run a command in the daemon, decided before the upgrade: the operator's own terminal on
 * this machine with the token, never a browser or anything behind a proxy. A reverse proxy or
 * `tailscale serve` on this machine presents a loopback peer, so the proxy and Host checks are what
 * keep a remote caller out. Undefined admits.
 */
export function admitExec(
  req: Request,
  ctx: Pick<ApiRouteContext, 'app' | 'token' | 'ip'>
): Response | undefined {
  const { headers } = req

  if (admissionClosed) {
    return apiError('unavailable')
  }

  if (PROXY_HEADERS.some((name) => headers.has(name))) {
    return apiError('forbidden')
  }

  // A browser always sends one; the terminal never does.
  if (headers.has('origin')) {
    return apiError('forbidden')
  }

  if (!isLoopback(ctx.ip)) {
    return apiError('forbidden')
  }

  if (headers.get('host') !== `${LOOPBACK_HOST}:${ctx.app.config.api.port}`) {
    return apiError('forbidden')
  }

  // The bearer header only, never the page's cookie; a wrong token counts toward the shared lockout.
  const now = Date.now()
  const credential = resolveBearerCredential(
    headers.get('authorization'),
    ctx.token,
    isAuthLocked(ctx.ip, now)
  )
  const refusal = toAuthRefusal(resolveAuthOutcome(ctx.ip, credential, now))

  if (refusal !== null) {
    return refusal
  }

  // After auth, so a peer without the token cannot learn whether the daemon is full.
  return hasExecRoom() ? undefined : apiError('too_many_streams')
}

export function closeExecAdmission(): void {
  admissionClosed = true
}

export function isExecAdmissionOpen(): boolean {
  return !admissionClosed
}

/** The open handler takes a seat; two handshakes racing to the last one both pass `admitExec`. */
export function takeExecSeat(ws: ServerWebSocket<ExecSocketData>): boolean {
  if (!hasExecRoom()) {
    return false
  }

  seated.add(ws)

  return true
}

export function releaseExecSeat(ws: ServerWebSocket<ExecSocketData>): void {
  seated.delete(ws)
}

export function seatedExecs(): readonly ServerWebSocket<ExecSocketData>[] {
  return [...seated]
}

function hasExecRoom(): boolean {
  return seated.size < MAX_EXEC_CONNECTIONS
}
