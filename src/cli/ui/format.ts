import type { ChannelDefinition } from '@/channels/api'
import type { Locale } from '@/core/types/locale'
import type { RunResultReason } from '@/core/types/run'
import type { MessageKey } from '@/i18n'
import type { SessionStatus, SessionSummary } from '@/persistence/api'
import { formatUsd } from '@/core/utils/cost'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/api'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const BYTES_PER_UNIT = 1024
const DECIMALS = 1
const DISPLAY_SEGMENTS = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const SESSION_ID_PREVIEW_LEN = 8
const SESSION_STATUS_KEYS = Object.freeze({
  active: 'cli.sessionStatusActive',
  done: 'cli.sessionStatusDone',
  stale: 'cli.sessionStatusStale',
} as const satisfies Record<SessionStatus, MessageKey>)
// Every run end a session row stores, plus the sweep's mark for a run a restart cut off.
const SESSION_END_KEYS = Object.freeze({
  completed: 'cli.sessionEndCompleted',
  aborted: 'cli.sessionEndAborted',
  budget: 'cli.sessionEndBudget',
  error: 'cli.sessionEndError',
  turn_limit: 'cli.sessionEndTurnLimit',
  loop: 'cli.sessionEndLoop',
  timeout: 'cli.sessionEndTimeout',
  daemon_restarted: 'cli.sessionEndRestarted',
} as const satisfies Record<RunResultReason | 'daemon_restarted', MessageKey>)
const END_KEY_BY_REASON: ReadonlyMap<string, MessageKey> = new Map(Object.entries(SESSION_END_KEYS))

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  let value = bytes
  let unit = 0

  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT
    unit += 1
  }

  // Whole bytes read better without a decimal point: "512 B", not "512.0 B".
  const shown = unit === 0 ? String(Math.round(value)) : value.toFixed(DECIMALS)

  return `${shown} ${BYTE_UNITS[unit]}`
}

export function truncateDisplay(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return ''
  }

  let result = ''
  let width = 0

  for (const { segment } of DISPLAY_SEGMENTS.segment(value)) {
    const segmentWidth = Bun.stringWidth(segment)

    if (width + segmentWidth > maxWidth) {
      break
    }

    result += segment
    width += segmentWidth
  }

  return result
}

export function availableChannelIds(definitions: readonly ChannelDefinition[]): string {
  return definitions.map((definition) => definition.id).join(', ') || '(none)'
}

export function formatSessionStatus(locale: Locale, status: SessionStatus): string {
  return t(locale, SESSION_STATUS_KEYS[status])
}

/** A stored end reason in the reader's language; one written by an older build prints as stored. */
export function formatSessionEnd(locale: Locale, reason: string): string {
  const key = END_KEY_BY_REASON.get(reason)

  return key === undefined ? reason : t(locale, key)
}

/** One row per session, on the operator's own clock, for every command that lists them. */
export function formatSessionRow(
  locale: Locale,
  session: SessionSummary,
  timezone: string
): string {
  return [
    session.id.slice(0, SESSION_ID_PREVIEW_LEN),
    `[${session.agentId}]`,
    formatInstant(locale, session.lastActivityAt, timezone),
    formatUsd(session.costUsd),
    formatSessionStatus(locale, session.status),
  ].join('  ')
}
