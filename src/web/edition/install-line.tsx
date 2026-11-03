import type { FeatureId } from '@/web/edition/guide/features'
import { openCompare } from '@/web/edition/guide/compare'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

/** A link to the comparison page, scrolled to the job it names. */
export function CompareLink({ row }: { readonly row: FeatureId }) {
  return (
    <Button kind="tertiary" size="small" onClick={() => openCompare(row)}>
      {tr('ui.office.edition.compare.link')}
    </Button>
  )
}

/** The one line a part of the page shows where the web edition stops and the installed version
 *  goes on: the row's own sentence, and the link to that row on the comparison page. */
export function InstallLine({ row }: { readonly row: FeatureId }) {
  return (
    <p class="meta install-line">
      {tr(`ui.office.edition.compare.${row}.installed`)} <CompareLink row={row} />
    </p>
  )
}
