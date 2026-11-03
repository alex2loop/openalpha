import type { CalendarPolicy } from '@/trading/kernel/config'
import { ConfigError } from '@/core/errors'
import { LOCAL_TIME_RE } from '@/core/utils/time'

export const MINUTES_PER_HOUR = 60

export interface SessionMinutes {
  readonly open: number
  readonly close: number
  readonly earlyClose?: number
  readonly breakStart?: number
  readonly breakEnd?: number
}

// Both bounds are validated at construction rather than at each state read: a malformed local time
// is an operator config error, and the honest place to name it is where the policy enters.
export function resolveSession(policy: CalendarPolicy): SessionMinutes {
  const open = minutesOfDay(policy.sessionOpenLocalTime, policy.timezone)
  const close = minutesOfDay(policy.sessionCloseLocalTime, policy.timezone)

  if (close <= open) {
    throw new ConfigError(`calendar ${policy.timezone} closes before it opens`, undefined, [
      'calendar',
      policy.timezone,
    ])
  }

  const earlyClose = optionalMinutes(policy.earlyCloses?.localTime, policy.timezone)

  if (earlyClose !== undefined && (earlyClose <= open || earlyClose >= close)) {
    throw new ConfigError(
      `calendar ${policy.timezone} has an early close outside its session`,
      undefined,
      ['calendar', policy.timezone]
    )
  }

  const breakStart = optionalMinutes(policy.breakStartLocalTime, policy.timezone)
  const breakEnd = optionalMinutes(policy.breakEndLocalTime, policy.timezone)
  const auctionStart = optionalMinutes(policy.closeAuctionStartLocalTime, policy.timezone)

  if (breakStart !== undefined && breakEnd !== undefined && breakEnd <= breakStart) {
    throw new ConfigError(`calendar ${policy.timezone} has an inverted break`, undefined, [
      'calendar',
      policy.timezone,
    ])
  }

  if (auctionStart !== undefined && (auctionStart <= open || auctionStart >= close)) {
    throw new ConfigError(
      `calendar ${policy.timezone} has an auction outside its session`,
      undefined,
      ['calendar', policy.timezone]
    )
  }

  return {
    open,
    close,
    ...(earlyClose === undefined ? {} : { earlyClose }),
    ...(breakStart === undefined ? {} : { breakStart }),
    ...(breakEnd === undefined ? {} : { breakEnd }),
  }
}

function optionalMinutes(raw: string | undefined, timezone: string): number | undefined {
  return raw === undefined ? undefined : minutesOfDay(raw, timezone)
}

export function minutesOfDay(raw: string, timezone: string): number {
  const match = LOCAL_TIME_RE.exec(raw)

  if (!match) {
    throw new ConfigError(`calendar ${timezone} has an invalid local time: ${raw}`, undefined, [
      'calendar',
      timezone,
    ])
  }

  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2])
}
