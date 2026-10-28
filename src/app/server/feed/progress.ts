import type { ProgressWire } from '@/app/server/wire/live'
import type { Locale } from '@/core/types/locale'
import type { RunProgressMessage } from '@/engine/api'
import { toResearchMilestone } from '@/channels/api'
import { scrubCredentials } from '@/core/security/credentials'
import { isResearchProgress } from '@/engine/api'
import { translateDisplayText } from '@/i18n'

/** Renders one bus progress message for the wire, in the daemon's language. Its params are scrubbed
 *  first and the text is rendered from the scrubbed copy, because a research question or a host
 *  detail can carry anything. Undefined when the channels print nothing for it either. */
export function toProgressWire(
  message: RunProgressMessage,
  locale: Locale,
  at: number
): ProgressWire | undefined {
  const safe = scrubStrings(message)
  const params = safe.params === undefined ? {} : { params: safe.params }

  if (!isResearchProgress(safe)) {
    return {
      key: safe.key,
      ...params,
      text: translateDisplayText(locale, safe),
      mode: safe.mode,
      at,
    }
  }

  const milestone = toResearchMilestone(safe, locale)

  if (milestone === undefined) {
    return undefined
  }

  // A research step with no mode is a running line, replaced by the next one.
  return {
    key: safe.key,
    ...params,
    text: milestone.text,
    mode: 'mode' in safe ? safe.mode : 'transient',
    at,
  }
}

function scrubStrings<T>(value: T): T {
  // why-safe: strings map to strings and every key and element is kept, so the copy has the same
  // shape as `value`; the cast only restores the type the structural walk cannot carry.
  return walkScrub(value) as T
}

function walkScrub(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubCredentials(value)
  }

  if (Array.isArray(value)) {
    return value.map(walkScrub)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walkScrub(item)]))
  }

  return value
}
