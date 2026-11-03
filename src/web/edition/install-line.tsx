import type { MessageKey } from '@/i18n'
import { tr } from '@/web/text/tr'

/** The one line a part of the page shows where the web edition stops and the installed version
 *  goes on. `line` is the sentence; the comparison page's row it belongs to links from here. */
export function InstallLine({ line }: { readonly line: MessageKey }) {
  return <p class="meta install-line">{tr(line)}</p>
}
