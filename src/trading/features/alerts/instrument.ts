import type { CreateAlertOptions } from '@/trading/features/alerts/types'
import type { MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { resolveInstrument } from '@/trading/features/market-data/resolve'

/** The market and ticker an alert is armed on, named as the arming surface typed them. A name the
 *  registry cannot place is a refusal, not a guess. */
export async function resolveAlertInstrument(
  deps: { readonly markets: MarketRegistry },
  options: CreateAlertOptions
): Promise<Extract<Awaited<ReturnType<typeof resolveInstrument>>, { readonly kind: 'resolved' }>> {
  const { instrument } = options.draft
  const resolution = await resolveInstrument(deps.markets, {
    ticker: instrument.ticker,
    ...(instrument.market === undefined ? {} : { market: instrument.market }),
    signal: options.signal,
  })

  if (resolution.kind !== 'resolved') {
    const name = `${instrument.market === undefined ? '' : `${instrument.market}:`}${instrument.ticker}`

    throw new ValidationError(`instrument is not supported: ${name}`, {
      key: 'errors.instrumentNotSupported',
      params: { name },
    })
  }

  return resolution
}
