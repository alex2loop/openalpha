import type { MessageKey } from '@/i18n'
import { toLegalParams } from '@/web/edition/legal/legal-text'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { Markdown } from '@/web/ui/markdown/markdown'

import '@/web/edition/guide/guide.css'

export interface LegalPage {
  readonly title: MessageKey
  /** One markdown section per key, in reading order. */
  readonly sections: readonly MessageKey[]
}

export interface OpenLegalOptions {
  /** Where the visitor came from; the page then offers a way back there. */
  readonly back?: (() => void) | undefined
}

/** Opens a legal page over the office or a refusal: the document's version line, then its sections.
 *  Nothing here asks for agreement. */
export function openLegalPage(page: LegalPage, options: OpenLegalOptions): void {
  openModal({
    title: tr(page.title),
    wide: true,
    body: <LegalBody sections={page.sections} />,
    footer: (
      <>
        {options.back !== undefined && (
          <Button onClick={options.back}>{tr('ui.office.edition.legal.back')}</Button>
        )}
        <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>
      </>
    ),
  })
}

function LegalBody({ sections }: { readonly sections: readonly MessageKey[] }) {
  const params = toLegalParams()

  return (
    <div class="legal-doc">
      <div class="meta">
        <Markdown text={tr('ui.office.edition.legal.version', params)} isLinked={false} />
      </div>
      {sections.map((key) => (
        <Markdown key={key} text={tr(key, params)} isLinked={false} />
      ))}
    </div>
  )
}
