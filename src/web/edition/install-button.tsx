import { openCompare } from '@/web/edition/guide/compare'
import { breakpoint } from '@/web/state/breakpoints'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { DownloadIcon } from '@/web/ui/kit/icons'

/** The header's nudge toward the installed version: it opens the comparison page, which says what
 *  the installed version adds and holds the install link. A phone keeps the icon and says the label
 *  to a screen reader; the tip names the benefit in full. */
export function InstallButton() {
  const label = tr('ui.office.edition.install.label')

  return (
    <Button kind="commit" title={tr('ui.office.edition.install.tip')} onClick={() => openCompare()}>
      {breakpoint.value === 'phone' ? (
        <>
          <DownloadIcon />
          <span class="sr">{label}</span>
        </>
      ) : (
        label
      )}
    </Button>
  )
}
