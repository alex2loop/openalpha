import { useEffect } from 'preact/hooks'

import { openCompare } from '@/web/edition/guide/compare'
import { openFirstRunOnce } from '@/web/edition/guide/first-run'
import { openGuide } from '@/web/edition/guide/guide'
import { FUNDING_URL } from '@/web/edition/guide/product'
import { openAiNotice } from '@/web/edition/legal/ai-notice'
import { openPrivacy } from '@/web/edition/legal/privacy'
import { openTerms } from '@/web/edition/legal/terms'
import { state } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

import './guide.css'

/** The strip under every page of the web edition: the guide, the comparison, the three legal
 *  pages and the support link. It stays mounted through every phase, so it also opens the first-run introduction once
 *  the office has loaded (after the shell's own dialog host has handed over to the office's). */
export function EditionFooter() {
  const isLoaded = state.value !== undefined

  useEffect(() => {
    if (isLoaded) {
      openFirstRunOnce()
    }
  }, [isLoaded])

  return (
    <nav class="edition-footer" aria-label={tr('ui.office.edition.footer.label')}>
      <Button kind="ghost" size="small" onClick={openGuide}>
        {tr('ui.office.edition.footer.guide')}
      </Button>
      <Button kind="ghost" size="small" onClick={() => openCompare()}>
        {tr('ui.office.edition.footer.compare')}
      </Button>
      <Button kind="ghost" size="small" onClick={() => openPrivacy()}>
        {tr('ui.office.edition.footer.privacy')}
      </Button>
      <Button kind="ghost" size="small" onClick={() => openTerms()}>
        {tr('ui.office.edition.footer.terms')}
      </Button>
      <Button kind="ghost" size="small" onClick={() => openAiNotice()}>
        {tr('ui.office.edition.footer.ai')}
      </Button>
      <a
        class="btn btn-ghost btn-small"
        href={FUNDING_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {tr('ui.office.edition.footer.support')}
      </a>
    </nav>
  )
}
