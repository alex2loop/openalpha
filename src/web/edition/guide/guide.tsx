import type { MessageKey } from '@/i18n'
import { openCompare } from '@/web/edition/guide/compare'
import { openFirstRun } from '@/web/edition/guide/first-run'
import { cliName, INSTALL_URL } from '@/web/edition/guide/product'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { Markdown } from '@/web/ui/markdown/markdown'

import './guide.css'

const SECTIONS: readonly MessageKey[] = Object.freeze([
  'ui.office.edition.guide.section.record',
  'ui.office.edition.guide.section.screen',
  'ui.office.edition.guide.section.analysis',
  'ui.office.edition.guide.section.datatime',
  'ui.office.edition.guide.section.missing',
  'ui.office.edition.guide.section.move',
])

/** The help button's page: short sections with the commands a visitor types, each in its own
 *  words, then the way to the comparison and back to the first-run introduction. */
export function openGuide(): void {
  openModal({
    title: tr('ui.office.edition.guide.title'),
    wide: true,
    body: <GuideBody />,
    footer: (
      <>
        <Button onClick={() => openFirstRun()}>
          {tr('ui.office.edition.guide.reopenFirstRun')}
        </Button>
        <Button onClick={() => openCompare()}>{tr('ui.office.edition.guide.openCompare')}</Button>
        <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>
      </>
    ),
  })
}

function GuideBody() {
  const params = { installUrl: INSTALL_URL, cliName: cliName() }

  return (
    <div class="guide">
      <p>{tr('ui.office.edition.guide.intro')}</p>
      {SECTIONS.map((key) => (
        <Markdown key={key} text={tr(key, params)} isLinked={false} />
      ))}
    </div>
  )
}
