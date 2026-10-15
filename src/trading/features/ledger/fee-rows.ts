import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { FillSource, LedgerTxn, TradeTxn } from '@/trading/features/ledger/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { TradeCost } from '@/trading/markets/cost'
import { t } from '@/i18n'
import {
  estimatedFee,
  FEE_MISMATCH_TOLERANCE,
  feeDivergence,
  resolveTradeCost,
} from '@/trading/markets/cost'
import { formatFraction, formatSignedFraction, renderVenueName } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'

/** Who a written row is shown to. The operator sees every figure and is told what to do about a
 *  fee; the agent sees no figure and is told what the row already says, because it reads an
 *  instruction to itself and books a second row. */
export type WriteAudience = 'confirmation' | 'receipt'

const FEE_RATE_KEYS = {
  confirmation: 'trading.render.ledger.feeRate',
  receipt: 'trading.render.ledger.feeRateReceipt',
} satisfies Record<WriteAudience, MessageKey>
const FEE_IN_BASE_KEYS = {
  confirmation: 'trading.render.ledger.feeInBase',
  receipt: 'trading.render.ledger.feeInBaseReceipt',
} satisfies Record<WriteAudience, MessageKey>
const VENUE_ROW_KEYS = {
  venue: 'trading.render.ledger.feeFromVenue',
  venueSized: 'trading.render.ledger.sizedByVenue',
  venuePriced: 'trading.render.ledger.pricedByVenue',
} satisfies Record<Exclude<FillSource, 'operator'>, MessageKey>

interface FeeRowOptions {
  readonly costs: TradingCosts
  readonly audience: WriteAudience
  readonly fillSource: FillSource
}

/** What the reader can check the row against: where its figures came from when the venue supplied
 *  them, and the rate any fee they stated implies. A row the venue sized against a stated fee earns
 *  both, because neither half answers for the other. */
export function renderFeeRows(
  locale: Locale,
  txn: LedgerTxn,
  options: FeeRowOptions
): readonly string[] {
  if (txn.kind !== 'buy' && txn.kind !== 'sell') {
    return []
  }

  if (options.fillSource === 'operator') {
    return renderStatedFeeRows(locale, txn, options)
  }

  const sized = `${INDENT[1]}${renderVenueRow(locale, txn, options.fillSource)}`

  return options.fillSource === 'venueSized'
    ? [sized, ...renderStatedFeeRows(locale, txn, options)]
    : [sized]
}

/** The rate the stated fee implies and how far it sits from the configured one. Absent when the
 *  venue has no configured rate - there is nothing to measure against, and a zero would read as
 *  agreement. */
function renderStatedFeeRows(
  locale: Locale,
  txn: TradeTxn,
  options: FeeRowOptions
): readonly string[] {
  const cost: TradeCost | undefined = resolveTradeCost(txn.venue, options.costs)

  if (cost === undefined) {
    return []
  }

  const rateValue = txn.kind === 'buy' ? cost.buyRate : cost.sellRate
  const rate = formatFraction(locale, rateValue)
  const divergence = feeDivergence(txn.fee, estimatedFee(txn.quantity * txn.unitPrice, rateValue))

  const rateRow =
    divergence === undefined || Math.abs(divergence) <= FEE_MISMATCH_TOLERANCE
      ? t(locale, FEE_RATE_KEYS[options.audience], { rate })
      : t(locale, 'trading.render.ledger.feeMismatch', {
          rate,
          divergence: formatSignedFraction(locale, divergence),
        })

  return [`${INDENT[1]}${rateRow}`, ...renderDeliveredRow(locale, txn, { ...options, cost })]
}

/** Which figures the exchange supplied, so a size and a price it reported are never read as ones
 *  the operator recalled. */
function renderVenueRow(
  locale: Locale,
  txn: TradeTxn,
  source: Exclude<FillSource, 'operator'>
): string {
  return t(locale, VENUE_ROW_KEYS[source], { venue: venueName(locale, txn) })
}

/** A venue billing a buy in the asset it delivers credits fewer units than were ordered, and by an
 *  amount only the exchange knows - the shortfall is the maker or the taker rate depending on how
 *  the order filled. The row cannot derive it, so it asks for the credited figure instead. Not
 *  asked of a row the venue sized: that quantity is already the credited one. */
function renderDeliveredRow(
  locale: Locale,
  txn: TradeTxn,
  options: FeeRowOptions & { readonly cost: TradeCost }
): readonly string[] {
  if (options.fillSource === 'venueSized') {
    return []
  }
  if (txn.kind !== 'buy' || options.cost.feeAsset !== 'base') {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, FEE_IN_BASE_KEYS[options.audience], {
      venue: venueName(locale, txn),
      ticker: txn.instrument.ticker,
    })}`,
  ]
}

function venueName(locale: Locale, txn: TradeTxn): string {
  return renderVenueName(locale, txn.venue)
}
