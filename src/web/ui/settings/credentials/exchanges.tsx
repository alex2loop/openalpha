import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { DoctorReport } from '@/app/server/wire/system'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { type Credential, groupBySubject, readCredentials } from '@/web/state/credentials'
import { pendingRestart } from '@/web/state/settings'
import { toFailureText, tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { CredentialRow, ServerOnlyNote } from '@/web/ui/settings/credentials/credential-row'
import { useLatestRead } from '@/web/ui/settings/data-health'

const VENUE_CHECK = 'venues'
const ONLINE_FLAG = 1

/** Sàn giao dịch: each exchange's key rows, what the daemon's check says of the keys it runs with,
 *  and which permissions a key needs. */
export function ExchangesSection({ reopen }: { readonly reopen: () => void }) {
  const read = useLoad(readCredentials).value

  if (read.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (read.status === 'failed') {
    return <p class="failure-line">{toFailureText(read.failure)}</p>
  }

  const venues = groupBySubject(read.value.credentials, 'venue')

  return (
    <>
      <ServerOnlyNote />
      {venues.map(([venue, credentials]) => (
        <VenueBlock key={venue} venue={venue} credentials={credentials} reopen={reopen} />
      ))}
      {venues.length > 0 && <KeyCheck />}
      <p class="meta">{tr('ui.office.exchanges.note')}</p>
    </>
  )
}

function VenueBlock({
  venue,
  credentials,
  reopen,
}: {
  readonly venue: string
  readonly credentials: readonly Credential[]
  readonly reopen: () => void
}) {
  const title = toVenueName(venue)

  return (
    <section class="setting-row">
      <h3 class="setting-title">{title}</h3>
      {credentials.map((credential) => (
        <CredentialRow key={credential.name} credential={credential} reopen={reopen} />
      ))}
    </section>
  )
}

/** Khóa này: the daemon's venue check, offline when the section opens and against the exchanges
 *  on Kiểm tra lại. It reads the keys the daemon started with. */
function KeyCheck() {
  const report = useSignal<DoctorReport | undefined>(undefined)
  const { failure, isBusy, run } = useLatestRead()
  const read = (online: boolean): void =>
    run(async (signal) => {
      report.value = await getJson(ROUTES.doctor, {
        signal,
        query: online ? { check: VENUE_CHECK, online: ONLINE_FLAG } : { check: VENUE_CHECK },
      })
    })

  useEffect(() => read(false), [])

  return (
    <section class="setting-row">
      <h3 class="setting-title">{tr('ui.office.exchanges.thisKey')}</h3>
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
      {report.value === undefined && failure.value === undefined && <Skeleton lines={2} />}
      {report.value?.checks.map((check, index) => (
        <p key={`${check.check}:${index}`} class="meta">
          {check.detail ?? check.name}
        </p>
      ))}
      {pendingRestart.value.includes('credentials') && (
        <p class="meta">{tr('ui.office.exchanges.beforeRestart')}</p>
      )}
      <div class="setting-actions">
        <Button size="small" disabled={isBusy.value} onClick={() => read(true)}>
          {isBusy.value ? tr('ui.office.data.rechecking') : tr('ui.office.common.recheck')}
        </Button>
      </div>
    </section>
  )
}
