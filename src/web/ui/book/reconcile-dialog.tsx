import { useBlockRead } from '@/web/state/block'
import { readReconcile } from '@/web/state/orders'
import { state } from '@/web/state/session'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { ReconcileVenue } from '@/web/ui/book/reconcile-venue'
import { Button } from '@/web/ui/kit/button'
import { FailureStrip } from '@/web/ui/kit/failure-strip'
import { openModal } from '@/web/ui/kit/modal'
import { Skeleton } from '@/web/ui/kit/skeleton'

/** Đối chiếu với sàn: the book against each venue's own balances. Nothing here writes the ledger
 *  except a sync, which books only what the venue filled. */
export function openReconcileDialog(): void {
  const handle = openModal({
    title: tr('ui.office.reconcile.title'),
    body: <ReconcileBody />,
    footer: <Button onClick={() => handle.close()}>{tr('ui.office.common.close')}</Button>,
    wide: true,
  })
}

function ReconcileBody() {
  const reading = useBlockRead(readReconcile)
  const { data, error } = reading

  if (data === undefined) {
    return error === undefined ? (
      <Skeleton />
    ) : (
      <FailureStrip failure={error} retry={reading.retry} />
    )
  }

  return (
    <>
      <div class="step-actions">
        <CheckedAt readAt={reading.readAt} />
        <Button size="small" onClick={reading.retry}>
          {tr('ui.office.reconcile.again')}
        </Button>
      </div>
      {error !== undefined && <FailureStrip failure={error} retry={reading.retry} />}
      {data.text.matched !== null && <p>{data.text.matched}</p>}
      {data.venues.length === 0 && <p class="empty-note">{tr('ui.office.reconcile.none')}</p>}
      {data.venues.map((venue) => (
        <ReconcileVenue key={venue.venue} venue={venue} recheck={reading.retry} />
      ))}
      {data.text.cashNote !== null && <p class="meta">{data.text.cashNote}</p>}
    </>
  )
}

function CheckedAt({ readAt }: { readonly readAt: number | undefined }) {
  const timeZone = state.value?.timeZone

  if (readAt === undefined || timeZone === undefined) {
    return null
  }

  return (
    <span class="meta">
      {tr('ui.office.reconcile.checkedAt', { time: formatClock(readAt, timeZone) })}
    </span>
  )
}
