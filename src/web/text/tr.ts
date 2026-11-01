import { type MessageKey, t } from '@/i18n'
import { ApiFailure } from '@/web/api/client'
import { brand, locale } from '@/web/state/session'

const FAILURE_KEYS: Readonly<Partial<Record<ApiFailure['code'], MessageKey>>> = Object.freeze({
  unreachable: 'ui.office.error.unreachable',
  timeout: 'ui.office.error.timeout',
  bad_response: 'ui.office.error.badResponse',
  unavailable: 'ui.office.error.unavailable',
  stopping: 'ui.office.error.stopping',
  upstream_failed: 'ui.office.error.upstreamFailed',
})

/** Reads `locale` and `brand` signals, so a component calling it re-renders when either changes. */
export function tr(key: MessageKey, params?: Record<string, string | number>): string {
  const name = brand.value

  return t(locale.value, key, name === undefined ? params : { brand: name, ...params })
}

/** The daemon's own sentence when it sent one, else the page's line for the failure. */
export function toFailureText(failure: ApiFailure): string {
  if (failure.message !== '') {
    return failure.message
  }

  return tr(FAILURE_KEYS[failure.code] ?? 'ui.office.error.generic')
}

/** As `toFailureText`, for whatever a failed call threw: a failure the page did not expect reads
 *  as the generic line. */
export function toErrorText(error: unknown): string {
  return error instanceof ApiFailure ? toFailureText(error) : tr('ui.office.error.generic')
}
