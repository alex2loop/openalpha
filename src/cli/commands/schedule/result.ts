import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { SchedulerCommandResult } from '@/scheduler/api'
import { t } from '@/i18n'

type SchedulerJobFailure = Exclude<SchedulerCommandResult, { kind: 'job' }>

interface JobFailureText {
  readonly result: SchedulerJobFailure
  readonly id: string
  readonly locale: Locale
  /** Shown when the id itself was unusable, and when the operation could not start. */
  readonly usageKey: MessageKey
  readonly rejectedKey: MessageKey
}

export function formatJobFailure(input: JobFailureText): string {
  const { result, id, locale } = input

  if (result.kind === 'invalid') {
    return t(locale, input.usageKey)
  }

  if (result.kind === 'not_found') {
    return t(locale, 'cli.scheduleNoJobWithId', { id })
  }

  if (result.kind === 'ambiguous') {
    return t(locale, 'cli.scheduleAmbiguousJob', { id })
  }

  return t(locale, input.rejectedKey)
}
