import type { LedgerEntryWire } from '@/app/server/wire/money'
import { formatDay } from '@/i18n'
import { locale } from '@/web/state/session'
import { isTradeEntry } from '@/web/state/trade'
import { formatAmount, formatQuantity } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

interface RowCells {
  readonly instrument?: { readonly market: string; readonly ticker: string }
  readonly name: string
  readonly quantity: string
  readonly price: string
}

interface LedgerRowProps {
  readonly entry: LedgerEntryWire
  /** The row just saved, marked once. */
  readonly isFlashed: boolean
}

/** One ledger line, every cell on one line: the day, the kind, the name, the quantity and the
 *  price or amount. The venue and note ride in the hover title. A buy or a sell can be edited. */
export function LedgerRow({ entry, isFlashed }: LedgerRowProps) {
  const cells = describeEntry(entry)

  return (
    <div
      class={isFlashed ? 'ledger-row is-flash' : 'ledger-row'}
      title={joinInline([entry.venue, entry.note ?? ''].filter(Boolean))}
    >
      <span class="ledger-cell">{formatDay(locale.value, entry.at)}</span>
      <span class="ledger-cell">{tr(`trading.ledger.kind.${entry.kind}`)}</span>
      <b class="ledger-cell">
        {cells.instrument === undefined ? (
          cells.name
        ) : (
          <TickerLink ticker={cells.instrument.ticker} market={cells.instrument.market} />
        )}
      </b>
      <span class="ledger-cell is-end">{cells.quantity}</span>
      <span class="ledger-cell is-end">{cells.price}</span>
      {isTradeEntry(entry) ? (
        <button type="button" class="ledger-edit" onClick={() => openTradeDialog({ entry })}>
          {tr('ui.office.common.edit')}
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}

function describeEntry(entry: LedgerEntryWire): RowCells {
  switch (entry.kind) {
    case 'buy':
    case 'sell':
    case 'rights':
      return {
        instrument: entry.instrument,
        name: entry.instrument.ticker,
        quantity: formatQuantity(entry.quantity),
        price: formatMarketPrice(entry.instrument.market, entry.unitPrice),
      }
    case 'dividend':
      return {
        instrument: entry.instrument,
        name: entry.instrument.ticker,
        quantity: '',
        price: `${formatAmount(entry.amount)} ${entry.currency}`,
      }
    case 'split':
    case 'distribution':
      return {
        instrument: entry.instrument,
        name: entry.instrument.ticker,
        quantity: formatQuantity(entry.quantityDelta),
        price: '',
      }
    default:
      return {
        name: entry.currency,
        quantity: '',
        price: `${formatAmount(entry.amount)} ${entry.currency}`,
      }
  }
}
