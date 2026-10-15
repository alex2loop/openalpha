import type { LocalizedText } from '@/cli/types'
import { parseDuration } from '@/core/utils/time'

type DurationFlagResult =
  | { readonly kind: 'value'; readonly ms: number }
  | { readonly kind: 'error'; readonly error: LocalizedText }

const REASON_KEYS = {
  invalid: 'cli.durationInvalid',
  range: 'cli.durationOutOfRange',
} as const

export function parseDurationFlag(raw: string, flag: string): DurationFlagResult {
  const parsed = parseDuration(raw)

  return parsed.kind === 'value'
    ? parsed
    : { kind: 'error', error: { key: REASON_KEYS[parsed.reason], params: { flag, value: raw } } }
}
