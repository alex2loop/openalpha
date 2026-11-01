import type {
  RestingExitWire,
  TradeStatusResponse,
  UnmirroredOrderWire,
} from '@/app/server/wire/orders'
import { translateDisplayText } from '@/i18n'
import { cancelExit } from '@/web/state/orders'
import { locale } from '@/web/state/session'
import { formatQuantity } from '@/web/text/figures'
import { joinInline, joinList } from '@/web/text/glyphs'
import { formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { CopyButton } from '@/web/ui/kit/copy-button'

// What settles a row the exchange never named, typed in chat after checking the exchange.
const RECONCILE_COMMAND = '/trade reconcile'

interface ExitsProps {
  readonly status: TradeStatusResponse
  readonly reread: () => void
}

/** What protects the book at the exchange, what does not, and what the exchange took that the
 *  ledger lacks. Setting or moving an exit stays `/trade exit` in chat; here it can only be
 *  cancelled. */
export function OrderExits({ status, reread }: ExitsProps) {
  const hasProtection = status.exits.length > 0 || status.unguarded.length > 0

  return (
    <>
      {hasProtection && <h3 class="sub-head">{tr('ui.office.orders.exits')}</h3>}
      {status.exits.map((exit) => (
        <ExitRow key={`${exit.venue}:${exit.instrument.ticker}`} exit={exit} reread={reread} />
      ))}
      {status.unguarded.map((position) => (
        <p key={`${position.venue}:${position.instrument.ticker}`} class="strip is-caution">
          {tr('ui.office.orders.unguarded', {
            quantity: formatQuantity(position.quantity - position.guarded),
            ticker: position.instrument.ticker,
            venue: toVenueName(position.venue),
          })}
        </p>
      ))}
      {status.unguardedResidue.length > 0 && (
        <p class="meta">
          {tr('ui.office.orders.residue', { names: joinList(status.unguardedResidue) })}
        </p>
      )}
      {hasProtection && <p class="meta">{tr('ui.office.orders.exitHint')}</p>}
      {status.unmirrored.length > 0 && <Unbooked rows={status.unmirrored} />}
    </>
  )
}

function ExitRow({
  exit,
  reread,
}: {
  readonly exit: RestingExitWire
  readonly reread: () => void
}) {
  const { market, ticker } = exit.instrument
  const levels = tr('ui.office.orders.levels', {
    takeProfit: formatMarketPrice(market, exit.takeProfit),
    stopLoss: formatMarketPrice(market, exit.stopLoss),
  })

  return (
    <div class="strip">
      <span>
        {joinInline([
          `${formatQuantity(exit.quantity)} ${ticker}`,
          levels,
          toVenueName(exit.venue),
        ])}
      </span>
      <Button kind="destructive" size="small" onClick={() => askCancel(exit, reread)}>
        {tr('ui.office.orders.cancelExit')}
      </Button>
    </div>
  )
}

function askCancel(exit: RestingExitWire, reread: () => void): void {
  const { ticker } = exit.instrument

  askConfirm({
    title: tr('ui.office.orders.cancelExit'),
    lines: [tr('ui.office.orders.cancelAsk', { ticker, venue: toVenueName(exit.venue) })],
    confirmLabel: tr('ui.office.orders.cancelExit'),
    isDestructive: true,
    // Read again whatever the answer: a cancel that timed out may still have gone through.
    confirm: () => cancelExit(ticker, exit.venue).finally(reread),
  })
}

/** Read-only: a row with an order id is booked by the sync; one without needs the operator to look at
 *  the exchange first, then settle it in chat. */
function Unbooked({ rows }: { readonly rows: readonly UnmirroredOrderWire[] }) {
  return (
    <>
      <h3 class="sub-head">{tr('ui.office.orders.unbooked')}</h3>
      {rows.map((row) => (
        <div key={row.token} class="strip is-grey">
          <span>
            {joinInline([
              tr(`ui.office.orders.side.${row.side}`),
              `${formatQuantity(row.filledQuantity ?? row.quantity)} ${row.instrument.ticker}`,
              ...(row.averagePrice === undefined
                ? []
                : [
                    tr('ui.office.orders.fillPrice', {
                      price: formatMarketPrice(row.instrument.market, row.averagePrice),
                    }),
                  ]),
              toVenueName(row.venue),
            ])}
          </span>
          <span class="meta">{toUnbookedReason(row.failure)}</span>
          {row.orderId === undefined ? (
            <UnbookedNoId token={row.token} />
          ) : (
            <span class="meta">{tr('ui.office.orders.unbookedHint')}</span>
          )}
        </div>
      ))}
    </>
  )
}

function UnbookedNoId({ token }: { readonly token: string }) {
  return (
    <>
      <span class="meta">{tr('ui.office.orders.unbookedNoId', { token })}</span>
      <div class="step-actions">
        <CopyButton
          text={`${RECONCILE_COMMAND} ${token}`}
          label={tr('ui.office.orders.copyToken')}
        />
      </div>
    </>
  )
}

// The sentence `/trade` prints for the code; a code this page does not know reads as the generic
// line, never as the code itself.
function toUnbookedReason(code: string): string {
  return translateDisplayText(locale.value, {
    key: `trading.order.unmirrored.reason.${code}`,
    fallback: tr('ui.office.orders.unbookedReason'),
  })
}
