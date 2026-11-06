import { ApiFailure } from '@/web/api/client'
import { FilePanel } from '@/web/edition/file-panel'
import { StorageStatus } from '@/web/edition/storage-status'
import { wipeEverything } from '@/web/edition/wipe'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { Credits } from '@/web/ui/settings/credits'
import { ActionRow, type SectionProps } from '@/web/ui/settings/row'

/** Dữ liệu trên máy: where the visitor's data lives and the one way to delete all of it. */
export function DataPanel({ reopen }: SectionProps) {
  return (
    <>
      <FilePanel reopen={reopen} />
      <ActionRow
        title={tr('ui.office.edition.data.where')}
        note={tr('ui.office.edition.data.whereBody')}
      >
        <Button
          size="small"
          kind="destructive"
          onClick={() =>
            askConfirm({
              title: tr('ui.office.edition.data.wipeAsk'),
              lines: [
                tr('ui.office.edition.data.wipeBody'),
                tr('ui.office.edition.data.wipeExport'),
              ],
              confirmLabel: tr('ui.office.edition.data.wipe'),
              isDestructive: true,
              keepLabel: tr('ui.office.edition.common.keep'),
              onBack: reopen,
              confirm: finishWipe,
            })
          }
        >
          {tr('ui.office.edition.data.wipe')}
        </Button>
      </ActionRow>
      <StorageStatus />
      <Credits />
    </>
  )
}

async function finishWipe(): Promise<void> {
  try {
    await wipeEverything()
  } catch {
    throw new ApiFailure(0, 'generic', { message: tr('ui.office.edition.data.wipeFailed') })
  }

  location.reload()
}
