import type { ReconcileResponse } from '@/app/server/wire/money'
import {
  type ReconcileMismatch,
  type SyncAnswer,
  syncAnswers,
  syncingVenues,
  syncVenue,
  toCashKind,
} from '@/web/state/orders'
import { formatAmount, formatQuantity } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { toFailureText, tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'
import { openSettings } from '@/web/ui/settings/settings'

type VenueReading = ReconcileResponse['venues'][number]

interface VenueProps {
  readonly venue: VenueReading
  /** Reads every venue again. */
  readonly recheck: () => void
}

/** One venue's block: what disagrees, or why it was not compared, and its fill sync. */
export function ReconcileVenue({ venue, recheck }: VenueProps) {
  return (
    <section class="block">
      <h3 class="sub-head">{toVenueName(venue.venue)}</h3>
      <VenueState venue={venue} recheck={recheck} />
      {venue.canSync && <SyncRow venue={venue.venue} recheck={recheck} />}
    </section>
  )
}

function VenueState({ venue, recheck }: VenueProps) {
  const name = toVenueName(venue.venue)

  switch (venue.uncompared) {
    case 'unreachable':
      return (
        <div class="strip is-problem">
          <span>{tr('ui.office.reconcile.unreachable', { venue: name })}</span>
          <Button size="small" onClick={recheck}>
            {tr('ui.office.common.retry')}
          </Button>
          <Button size="small" onClick={() => openSettings('data')}>
            {tr('ui.office.today.doctor')}
          </Button>
        </div>
      )
    case 'keyless':
      return (
        <div class="strip is-grey">
          <span>
            {tr('ui.office.reconcile.keyless', {
              venue: name,
              variables: (venue.missingCredentials ?? []).join(', '),
            })}
          </span>
          <Button size="small" onClick={() => openSettings('exchanges')}>
            {tr('ui.office.doctor.open', { section: tr('ui.office.settings.exchanges') })}
          </Button>
        </div>
      )
    case 'unsupported':
      return <p class="meta">{tr('ui.office.reconcile.unsupported', { venue: name })}</p>
    case undefined:
      return venue.mismatches.length === 0 ? (
        <p class="meta">{tr('ui.office.reconcile.matches')}</p>
      ) : (
        venue.mismatches.map((mismatch) => (
          <MismatchRow key={mismatch.asset} venue={venue.venue} mismatch={mismatch} />
        ))
      )
  }
}

/** A mismatch is not sure to be an error, so it reads as a caution, and nothing is written until
 *  the operator saves the prefilled row. */
function MismatchRow({
  venue,
  mismatch,
}: {
  readonly venue: string
  readonly mismatch: ReconcileMismatch
}) {
  const figure = mismatch.cash ? formatAmount : formatQuantity
  const size = `${figure(Math.abs(mismatch.delta))} ${mismatch.asset}`
  const isVenueAhead = mismatch.delta < 0

  return (
    <div class="strip is-caution">
      <span>
        {joinInline([
          tr(isVenueAhead ? 'ui.office.reconcile.more' : 'ui.office.reconcile.less', {
            venue: toVenueName(venue),
            delta: size,
          }),
          tr('ui.office.reconcile.bookVenue', {
            booked: figure(mismatch.booked),
            held: figure(mismatch.held),
          }),
        ])}
      </span>
      <Button size="small" onClick={() => openFix(venue, mismatch)}>
        {fixLabel(mismatch)}
      </Button>
    </div>
  )
}

function fixLabel(mismatch: ReconcileMismatch): string {
  const cashKind = toCashKind(mismatch)

  if (cashKind !== undefined) {
    return tr(`trading.ledger.kind.${cashKind}`)
  }

  const params = { quantity: formatQuantity(Math.abs(mismatch.delta)), asset: mismatch.asset }

  return mismatch.delta < 0
    ? tr('ui.office.reconcile.add', params)
    : tr('ui.office.reconcile.sell', params)
}

// The price stays empty: only the operator knows what they paid.
function openFix(venue: string, mismatch: ReconcileMismatch): void {
  const amount = Math.abs(mismatch.delta)
  const cashKind = toCashKind(mismatch)

  if (cashKind !== undefined) {
    openTradeDialog({ kind: cashKind, venue, currency: mismatch.asset, amount })
    return
  }

  openTradeDialog({
    kind: mismatch.delta < 0 ? 'buy' : 'sell',
    venue,
    ticker: mismatch.asset,
    quantity: amount,
  })
}

function SyncRow({ venue, recheck }: { readonly venue: string; readonly recheck: () => void }) {
  const name = toVenueName(venue)
  const isBusy = syncingVenues.value.has(venue)
  const answer = syncAnswers.value.get(venue)

  return (
    <>
      <div class="step-actions">
        <Button
          size="small"
          disabled={isBusy}
          onClick={() => {
            syncVenue(venue)
              .finally(recheck)
              .catch(() => undefined)
          }}
        >
          {tr(isBusy ? 'ui.office.reconcile.syncing' : 'ui.office.reconcile.sync', { venue: name })}
        </Button>
      </div>
      <p class="meta">{tr('ui.office.reconcile.syncNote')}</p>
      {answer !== undefined && <SyncReply answer={answer} />}
    </>
  )
}

function SyncReply({ answer }: { readonly answer: SyncAnswer }) {
  switch (answer.kind) {
    case 'answered':
      return <p class="daemon-text">{answer.text}</p>
    case 'refused':
      return (
        <p class="failure-line" role="alert">
          {toFailureText(answer.failure)}
        </p>
      )
    case 'slow':
      return <p class="strip is-caution">{tr('ui.office.reconcile.syncSlow')}</p>
  }
}
