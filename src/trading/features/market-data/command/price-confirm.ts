import type { OperatorMessage } from '@/core/errors'
import type { Affordance, SlashContext, SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { QuoteConvention } from '@/trading/render/money'
import { isWord } from '@/core/utils/text'
import { bindLocale, formatDay, t } from '@/i18n'
import { InstrumentUnlistedError } from '@/trading/features/market-data/reads/listed-name'
import { PriceUnconfirmedError } from '@/trading/features/market-data/reads/typed-price'
import { INDENT } from '@/trading/render/layout'
import { formatPrice, formatQuotedPrice, renderBoardScaleNotes } from '@/trading/render/money'

const CONFIRM_TOKEN = 'confirm'

interface PriceConfirmSurface {
  readonly command: string
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
}

/** Runs a write whose price or name the operator typed, handing it the arguments without a trailing
 *  `confirm`. A price held as far from the market, or a name no stored list has, is answered with
 *  the question and a button that sends the same command again, confirmed; nothing is held. */
export async function runWithPriceConfirm(
  ctx: SlashContext,
  surface: PriceConfirmSurface,
  write: (typed: SlashContext, typedPrice: TypedPrice) => Promise<SlashResult>
): Promise<SlashResult> {
  const confirmed = isWord(ctx.args.at(-1), CONFIRM_TOKEN)

  try {
    return confirmed
      ? await write({ ...ctx, args: ctx.args.slice(0, -1) }, 'confirmed')
      : await write(ctx, 'unconfirmed')
  } catch (err: unknown) {
    if (err instanceof PriceUnconfirmedError) {
      return renderPriceConfirm(ctx, err, surface)
    }

    if (err instanceof InstrumentUnlistedError && err.operator !== undefined) {
      return renderUnlistedConfirm(ctx, err.operator, surface)
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
    affordances: [confirmAffordance(ctx, surface, 'trading.render.affordance.savePrice')],
  }
}

function renderUnlistedConfirm(
  ctx: SlashContext,
  question: OperatorMessage,
  surface: PriceConfirmSurface
): SlashResult {
  return {
    kind: 'text',
    text: bindLocale(ctx.locale).translate(question.key, question.params),
    affordances: [confirmAffordance(ctx, surface, 'trading.render.affordance.recordAsTyped')],
  }
}

function confirmAffordance(
  ctx: SlashContext,
  surface: PriceConfirmSurface,
  label: MessageKey
): Affordance {
  return {
    label: t(ctx.locale, label),
    command: `/${surface.command} ${[...ctx.args, CONFIRM_TOKEN].join(' ')}`,
  }
}

function priceIn(locale: Locale, value: number, convention?: QuoteConvention): string {
  return convention === undefined
    ? formatPrice(locale, value)
    : formatQuotedPrice(locale, value, convention)
}
