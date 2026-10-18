import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { QuoteView } from '@/trading/kernel/market/market-capability'
import type { PriceWriter } from '@/trading/kernel/surface/agent-json'
import { createTool } from '@/core/tool'
import { toAgentJson, writtenQuote } from '@/trading/kernel/surface/agent-json'
import { instrumentQueryInput, type MarketSchema } from '@/trading/kernel/surface/surface'
import { formatInstant } from '@/trading/render/datetime'
import { formatScaledPrice } from '@/trading/render/money'

interface QuoteWriter {
  readonly locale: Locale
  readonly timezone: string
}

export function createMarketPriceTool(
  marketData: MarketDataService,
  markets: MarketSchema,
  timezone: string
): ToolDefinition {
  return createTool({
    name: 'market_price',
    description:
      'The quote for one instrument - from our own market data, never the web. Answers two readings, never one: `previousClose` is what the last settled session closed at and the day it settled, and the quote itself is what the instrument is trading at now. Freshness is in the result and you must carry it into your answer: `observed.day` says which session the live reading came from and `observed.kind` says whether it is `live` or a `close`, so state that session whenever you quote it, and never call it "now" or "today" unless `observed.day` is today - a market that has printed no price yet answers with its last close, and saying so is the answer. `observed.observedAt` is when that reading was taken, in the operator\'s time zone - say it when you quote a live price. Quote the two with the session each belongs to named and never blend them, and the same rule holds against any figure computed from the settled close - a position weight, a P&L, a portfolio value, a suggestion level. Use market_bars for any earlier session, a range, or volume.',
    inputSchema: z.strictObject({
      ...instrumentQueryInput(markets),
    }),
    capability: 'net',
    // Eager for the same reason as market_overview: the prompt routes price asks here by name, and a
    // model that cannot see the schema sends the operator to a broker site for a number we hold.
    eager: true,
    presentation: { label: 'Price', emoji: '💵', detailKeys: ['ticker'] },
    async execute(args, ctx): Promise<string> {
      const now = Date.now()
      const result = await marketData.quote({
        ticker: args.ticker,
        ...(args.market === undefined ? {} : { market: args.market }),
        withPreviousClose: true,
        now,
        signal: ctx.signal,
      })

      return toAgentJson(
        result.kind === 'available'
          ? { ...result, value: agentQuoteView(result.value, { locale: ctx.locale, timezone }) }
          : result
      )
    },
  })
}

/** The reading with every price written as the market's board shows it, so the scale travels with
 *  the number rather than in a `display` field the model would have to apply. */
function agentQuoteView(view: QuoteView, writer: QuoteWriter): unknown {
  const { locale, timezone } = writer
  const price: PriceWriter = (value) => formatScaledPrice(locale, value, view)
  const { display: _display, quote, previousClose, observed, ...rest } = view
  const { observedAt: _observedAt, ...pricedQuote } = quote

  return {
    ...rest,
    observed: { ...observed, observedAt: formatInstant(locale, observed.observedAt, timezone) },
    quote: writtenQuote(pricedQuote, price),
    ...(previousClose === undefined
      ? {}
      : { previousClose: { ...previousClose, price: price(previousClose.price) } }),
  }
}
