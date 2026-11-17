import type { ApiErrorCode } from '@/app/server/wire/errors'
import type { ApiRouteContext } from '@/app/types'
import type { SourceResult } from '@/trading/api'
import { apiError } from '@/app/server/http/dispatch'
import { localeOf } from '@/app/server/routes/params'
import { bindLocale } from '@/i18n'

const AMBIGUOUS_SYMBOL = 'source.ambiguous-symbol'
const REFERENCE_BARS_ONLY = 'market-data.reference-bars-only'

type UnavailableResult = Extract<SourceResult<unknown>, { readonly kind: 'unavailable' }>

/** An ambiguous symbol is a 409 that says so: without its sentence the app could only guess. A
 *  market with no price history of its own is `unavailable` with the reason, not an unknown name. */
export function sourceError(
  ctx: ApiRouteContext,
  result: UnavailableResult,
  symbol?: string
): Response {
  const { translate } = bindLocale(localeOf(ctx))

  if (result.caveats.some((caveat) => caveat.code === REFERENCE_BARS_ONLY)) {
    return apiError('unavailable', translate(`trading.caveat.${REFERENCE_BARS_ONLY}`))
  }

  const ambiguous = result.caveats.find((caveat) => caveat.code === AMBIGUOUS_SYMBOL)

  if (ambiguous === undefined || symbol === undefined) {
    return apiError(sourceErrorCode(result))
  }

  const message = translate(`trading.caveat.${AMBIGUOUS_SYMBOL}`, {
    ...ambiguous.detail,
    ticker: symbol,
  })

  return apiError('conflict', message)
}

function sourceErrorCode(result: UnavailableResult): ApiErrorCode {
  if (result.caveats.some((caveat) => caveat.code === AMBIGUOUS_SYMBOL)) {
    return 'conflict'
  }

  if (result.reason === 'unsupported') {
    return 'not_found'
  }

  return result.reason === 'failed' ? 'upstream_failed' : 'unavailable'
}
