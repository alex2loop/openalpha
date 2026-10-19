import type { SlashContext, SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { QuoteConvention } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { PriceUnconfirmedError } from '@/trading/features/market-data/reads/typed-price'
import { INDENT } from '@/trading/render/layout'
import { formatPrice, formatQuotedPrice, renderBoardScaleNotes } from '@/trading/render/money'

const CONFIRM_TOKEN = 'confirm'

interface PriceConfirmSurface {
  readonly command: string
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
}

/** Runs a write whose price the operator typed, handing it the arguments without a trailing
 *  `confirm`. One held as far from the market is answered with the question and a button that sends
 *  the same command again, confirmed; nothing is held. */
export async function runWithPriceConfirm(
  ctx: SlashContext,
  surface: PriceConfirmSurface,
  write: (typed: SlashContext, typedPrice: TypedPrice) => Promise<SlashResult>
): Promise<SlashResult> {
  const confirmed = ctx.args.at(-1)?.toLowerCase() === CONFIRM_TOKEN

  try {
    return confirmed
      ? await write({ ...ctx, args: ctx.args.slice(0, -1) }, 'confirmed')
      : await write(ctx, 'unconfirmed')
  } catch (err: unknown) {
    if (err instanceof PriceUnconfirmedError) {
      return renderPriceConfirm(ctx, err, surface)
    }

    throw err
  }
}

function renderPriceConfirm(
  ctx: SlashContext,
  err: PriceUnconfirmedError,
  surface: PriceConfirmSurface
): SlashResult {
  const { locale } = ctx
  const { market } = err.instrument
  const convention = surface.marketData.quoteConvention(market)
  const question = t(locale, 'errors.priceFarFromMarket', {
    ticker: err.instrument.ticker,
    price: priceIn(locale, err.price, convention),
    latest: priceIn(locale, err.latest.price, convention),
    day: formatDay(locale, err.latest.at),
  })
  const notes = renderBoardScaleNotes(locale, [{ market, ...convention }]).map(
    (note) => `${INDENT[1]}${note}`
  )

  return {
    kind: 'text',
    text: [question, ...notes].join('\n'),
    affordances: [
      {
        label: t(locale, 'trading.render.affordance.savePrice'),
        command: `/${surface.command} ${[...ctx.args, CONFIRM_TOKEN].join(' ')}`,
      },
    ],
  }
}

function priceIn(locale: Locale, value: number, convention?: QuoteConvention): string {
  return convention === undefined
    ? formatPrice(locale, value)
    : formatQuotedPrice(locale, value, convention)
}
