import type { UpdateResponse } from '@/app/server/wire/system'
import { update } from '@/web/state/update'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { CopyButton } from '@/web/ui/kit/copy-button'
import { openModal } from '@/web/ui/kit/modal'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { toSafeHref } from '@/web/ui/markdown/inline'

import '@/web/ui/dialogs/dialogs.css'
import './settings.css'

/** Có gì mới: what changed since the running version and how to upgrade on the server. The page
 *  never upgrades itself. `onBack` is where Đóng returns, Cài đặt when it opened the dialog. */
export function openUpdateDialog({ onBack }: { readonly onBack: () => void }): void {
  openModal({
    title: tr('ui.office.update.notes'),
    body: <UpdateBody />,
    footer: <Button onClick={onBack}>{tr('ui.office.common.close')}</Button>,
  })
}

function UpdateBody() {
  const answer = update.value

  if (answer === undefined) {
    return <Skeleton lines={3} />
  }

  if (!answer.enabled) {
    return <p class="meta">{tr('ui.office.update.off')}</p>
  }

  if (!answer.newer) {
    return <p class="meta">{tr('ui.office.update.latest')}</p>
  }

  const pageHref = answer.url === null ? undefined : toSafeHref(answer.url)

  return (
    <div class="dialog-form">
      <Notes answer={answer} />
      <p>{tr('ui.office.update.howTo')}</p>
      <div class="setting-actions">
        <code class="update-command mono">{answer.upgradeCommand}</code>
        <CopyButton text={answer.upgradeCommand} label={tr('ui.office.update.copy')} />
      </div>
      <p class="meta">{tr('ui.office.update.keeps')}</p>
      {pageHref !== undefined && (
        <a href={pageHref} target="_blank" rel="noopener noreferrer">
          {tr('ui.office.update.page')}
        </a>
      )}
    </div>
  )
}

function Notes({ answer }: { readonly answer: UpdateResponse }) {
  if (answer.notes.length === 0) {
    return <p class="meta">{tr('ui.office.update.noNotes')}</p>
  }

  return (
    <div class="row-list">
      {answer.notes.map((note) => (
        <div key={note.version} class="setting-job">
          <div class="setting-actions">
            <b class="mono">{note.version}</b>
            {note.important && (
              <span class="level-pill is-warn">{tr('ui.office.update.important')}</span>
            )}
          </div>
          {note.summary !== undefined && <p class="meta">{note.summary}</p>}
        </div>
      ))}
    </div>
  )
}
