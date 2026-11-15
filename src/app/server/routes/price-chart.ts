import type { TradingPriceChartResponse } from '@/app/server/wire/price-chart'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { toPriceChartWire } from '@/app/server/mappers/price-chart'
import { hostOf, localeOf, parseInstrument, parseOneOf } from '@/app/server/routes/params'
import { sourceError } from '@/app/server/routes/source-error'
import { DEFAULT_PRICE_WINDOW, PRICE_WINDOWS } from '@/trading/api'

async function handlePriceChart(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const instrument = parseInstrument(query)
  const raw = query.get('window')
  const window = raw === null ? DEFAULT_PRICE_WINDOW : parseOneOf(raw, PRICE_WINDOWS)

  if (instrument === null || window === null) {
    return apiError('invalid_body')
  }

  const host = hostOf(ctx)
  const [result, sector] = await Promise.all([
    host.getPriceChart({ instrument, window, signal: req.signal }),
    host.getInstrumentSector({ instrument, signal: req.signal }),
  ])

  if (result.kind === 'unavailable') {
    return sourceError(ctx, result, instrument.ticker)
  }

  return json(
    toPriceChartWire(
      {
        market: instrument.market,
        ticker: instrument.ticker,
        ...(sector === undefined ? {} : { sector }),
        chart: result.value,
        provenance: result.provenance,
        caveats: result.caveats,
      },
      localeOf(ctx)
    ) satisfies TradingPriceChartResponse
  )
}

export const PRICE_CHART_ROUTES = [
  {
    method: 'GET',
    path: '/v1/price-chart',
    auth: true,
    capability: 'ohlcv',
    handler: handlePriceChart,
  },
] as const satisfies readonly ApiRouteSpec[]
