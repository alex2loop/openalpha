import type { FeedDeps } from '@/app/server/feed/relay'
import type { WireEvent } from '@/app/server/wire/events'
import type { BusEventMap } from '@/core/events'
import type { Locale } from '@/core/types/locale'
import '@/app/events'
import { APP_SOURCE } from '@/app/server/channel'
import { scrubCredentials } from '@/core/security/credentials'
import { renderRoleStance } from '@/trading/api'

/** Tells the page what each debate role said. The page only: a role's words can carry a size or a
 *  level, so nothing here reaches a chat, and the quiet weight keeps it out of the bell. */
export function followRoles({ bus, broadcast, locale }: FeedDeps): (() => void)[] {
  return [
    bus.on('role_output', (e) => {
      broadcast(toRoleEvent(e, locale))
    }),
  ]
}

function toRoleEvent(e: BusEventMap['role_output'], locale: Locale): WireEvent {
  const stance = renderRoleStance(locale, e)

  return {
    v: 1,
    kind: 'role_output',
    weight: 'quiet',
    source: APP_SOURCE,
    role: {
      ticker: e.ticker,
      market: e.market,
      role: e.role,
      ...(stance === undefined ? {} : { stance }),
      // Model prose: scrubbed before it leaves the daemon, like every other thing a model wrote.
      ...(e.summary === undefined ? {} : { summary: scrubCredentials(e.summary) }),
      citations: e.citations,
      unsupported: e.unsupported,
    },
  }
}
