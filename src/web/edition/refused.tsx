import type { MessageKey } from '@/i18n'
import { type EditionPhase, takeOver } from '@/web/edition/worker-link'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

import './edition.css'

type Refusal = Extract<EditionPhase, { readonly kind: 'refused' }>['reason']

const LINES: Readonly<Record<Refusal, MessageKey>> = Object.freeze({
  locked: 'ui.office.edition.storage.locked',
  'taken-over': 'ui.office.edition.storage.takenOver',
  unsupported: 'ui.office.edition.storage.unsupported',
  'newer-schema': 'ui.office.edition.storage.newerData',
  'storage-full': 'ui.office.edition.storage.full',
  'worker-failed': 'ui.office.edition.storage.workerFailed',
})

// Locked offers to take the database here; a browser that cannot keep data has nothing to try
// again; every other state, a worker that broke included, is cured by reading the page again.
function Action({ reason }: { readonly reason: Refusal }) {
  if (reason === 'locked') {
    return (
      <Button kind="commit" onClick={takeOver}>
        {tr('ui.office.edition.storage.takeOver')}
      </Button>
    )
  }

  return reason === 'unsupported' ? null : (
    <Button kind="commit" onClick={() => location.reload()}>
      {tr('ui.office.offline.reload')}
    </Button>
  )
}

/** A full page in place of the office when the database cannot be served: another tab holds it
 *  (take it here, or stay), another tab took it, the browser cannot keep it, it is newer than this
 *  page, the device is out of room, or the worker broke. The page offers the one thing that can
 *  help and nothing else. */
export function Refused({ reason }: { readonly reason: Refusal }) {
  return (
    <main class="edition-refused">
      <p role="alert">{tr(LINES[reason])}</p>
      <Action reason={reason} />
    </main>
  )
}
