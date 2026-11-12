import type { ChannelDefinition } from '@/channels/api'
import type { HaltCode } from '@/core/errors'
import type { Locale } from '@/core/types/locale'
import type { RunResultReason } from '@/core/types/run'
import type { MessageKey } from '@/i18n'
import type { SessionStatus, SessionSummary } from '@/persistence/api'
import { BRAND } from '@/core/brand'
import { HALT_SPEC } from '@/core/errors'
import { formatSpendUsd } from '@/core/utils/cost'
import { HALT_CODE_SEPARATOR, NO_REASON_MESSAGE } from '@/engine/api'
import { t } from '@/i18n'
import { STALE_SESSION_MESSAGE } from '@/persistence/api'
import { formatInstant } from '@/trading/api'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const BYTES_PER_UNIT = 1024
const DECIMALS = 1
const PERCENT = 100
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
// A halted run stores `<halt code><separator><detail>`; the code is worded, the detail trails it.
const HALT_DETAIL_MAX_WIDTH = 80

/** Spend, and how much of the cap it is when one is set (a cap of 0 or less means none). */
export function formatSpendOfCap(locale: Locale, spentUsd: number, capUsd: number): string {
  const spent = formatSpendUsd(locale, spentUsd)

  if (capUsd <= 0) {
    return spent
  }

  return t(locale, 'cli.spendOfCap', {
    spent,
    max: formatSpendUsd(locale, capUsd),
    pct: Math.round((spentUsd / capUsd) * PERCENT),
  })
}

export function formatBytes(locale: Locale, bytes: number): string {
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
  const shown =
    unit === 0
      ? String(Math.round(value))
      : value.toLocaleString(locale, {
          minimumFractionDigits: DECIMALS,
          maximumFractionDigits: DECIMALS,
        })

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

/** A stored run error in the reader's language: a halt code's own wording, the restart note or the
 *  no-reason note. Any other message prints as stored. */
export function formatSessionError(locale: Locale, message: string): string {
  if (message === STALE_SESSION_MESSAGE) {
    return t(locale, 'cli.historyErrorRestarted')
  }

  if (message === NO_REASON_MESSAGE) {
    return t(locale, 'cli.historyErrorNoReason')
  }

  const split = message.indexOf(HALT_CODE_SEPARATOR)
  const code = split === -1 ? message : message.slice(0, split)

  if (!isHaltCode(code)) {
    return message
  }

  const sentence = t(locale, HALT_SPEC[code].messageKey, { brand: BRAND.name })
  const detail = split === -1 ? '' : message.slice(split + HALT_CODE_SEPARATOR.length).trim()

  if (detail === '' || detail === code) {
    return sentence
  }

  return t(locale, 'cli.historyErrorDetail', {
    message: sentence,
    detail: truncateDisplay(detail, HALT_DETAIL_MAX_WIDTH),
  })
}

function isHaltCode(value: string): value is HaltCode {
  return Object.hasOwn(HALT_SPEC, value)
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
    formatSpendUsd(locale, session.costUsd),
    formatSessionStatus(locale, session.status),
  ].join('  ')
}
