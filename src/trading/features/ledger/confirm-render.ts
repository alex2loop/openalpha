import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { RecordPreview } from '@/trading/features/ledger/preview'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { formatDay, t } from '@/i18n'
import { renderDraftLine } from '@/trading/features/ledger/rows'
import { formatCount, SECTION_ICONS } from '@/trading/render/format'
import { INDENT, renderSectionTitle } from '@/trading/render/layout'
import { formatMoney, formatSignedMoney } from '@/trading/render/money'

interface FxPreviewOptions {
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  readonly ttlMs: number
}

/** What the row would do at the market rate, and the two ways to settle it. */
export function renderFxPreview(
  locale: Locale,
  preview: RecordPreview,
  options: FxPreviewOptions
): string {
  const txn = preview.transaction

  if (!('conversion' in txn)) {
    return ''
  }

  const { conversion } = txn
  const currency = conversion.fromCurrency
  const minutes = Math.round(options.ttlMs / MS_PER_MINUTE)

  return [
    renderSectionTitle(SECTION_ICONS.ledger, t(locale, 'trading.render.ledger.confirmTitle')),
    `${INDENT[1]}${renderDraftLine(locale, txn, options.marketData)}`,
    previewLine(locale, 'trading.render.ledger.confirmRate', {
      rate: formatMoney(locale, conversion.rate, conversion.toCurrency),
      currency,
      day: formatDay(locale, conversion.asOf),
    }),
    previewLine(locale, 'trading.render.ledger.confirmCash', {
      amount: formatSignedMoney(locale, preview.cashChangeBase, conversion.toCurrency),
    }),
    // A withdrawal is accepted only from currency cash the venue holds, so its cash leaves at cost.
    ...(txn.kind === 'withdrawal'
      ? [previewLine(locale, 'trading.render.ledger.confirmCashAtCost', { currency })]
      : []),
    previewLine(locale, 'trading.render.ledger.confirmWhy', { currency }),
    '',
    previewLine(locale, 'trading.render.ledger.confirmStated', {}),
    previewLine(locale, 'trading.render.ledger.confirmExpiry', {
      minutes: formatCount(locale, minutes),
    }),
  ].join('\n')
}

function previewLine(locale: Locale, key: MessageKey, params: Record<string, string>): string {
  return `${INDENT[1]}${t(locale, key, params)}`
}
