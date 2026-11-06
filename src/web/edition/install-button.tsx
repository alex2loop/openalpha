import { installUrl } from '@/web/edition/guide/product'
import { breakpoint } from '@/web/state/breakpoints'
import { tr } from '@/web/text/tr'
import { DownloadIcon } from '@/web/ui/kit/icons'

/** The header's nudge toward the installed version: a link to the install steps in the README, in
 *  a new tab. A phone keeps the icon and says the label to a screen reader; the tip names the
 *  benefit in full. */
export function InstallButton() {
  const label = tr('ui.office.edition.install.label')

  return (
    <a
      class="btn btn-ai btn-regular"
      href={installUrl()}
      target="_blank"
      rel="noopener noreferrer"
      title={tr('ui.office.edition.install.tip')}
    >
      <DownloadIcon />
      {breakpoint.value === 'phone' ? <span class="sr">{label}</span> : label}
    </a>
  )
}
