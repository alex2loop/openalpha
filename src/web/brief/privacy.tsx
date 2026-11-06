import { useEffect, useState } from 'preact/hooks'

import type { Locale, Translate } from '@/web/brief/strings'
import { LanguageSwitch } from '@/web/brief/language-switch'
import { InlineText } from '@/web/ui/markdown/inline-view'

// What the privacy texts name: the brand, the maintainer and the repository address, which the
// build derives from the same sources as the web version's legal texts, and the Cloudflare policy.
declare const PRIVACY_PARAMS: Readonly<Record<string, string>>

/** The address that opens the privacy page: a fragment, so the static host needs no route. */
export const PRIVACY_HREF = '#privacy'
const BRIEF_HREF = '#'

interface PrivacyPageProps {
  readonly t: Translate
  readonly locale: Locale
  readonly onLocale: (locale: Locale) => void
}

/** Whether the address asks for the privacy page; follows the back button and the links. */
export function usePrivacyRoute(): boolean {
  const [isPrivacy, setIsPrivacy] = useState(isPrivacyAddress)

  useEffect(() => {
    const controller = new AbortController()

    window.addEventListener(
      'hashchange',
      () => {
        setIsPrivacy(isPrivacyAddress())
        window.scrollTo(0, 0)
      },
      { signal: controller.signal }
    )

    return () => controller.abort()
  }, [])

  return isPrivacy
}

/** What the app keeps about its reader, who serves it, what the brief is and who runs it. */
export function PrivacyPage({ t, locale, onLocale }: PrivacyPageProps) {
  return (
    <div class="app">
      <header class="app-head">
        <h1 class="app-title">{t('ui.brief.privacy.title')}</h1>
      </header>
      <main class="flow app-main">
        <p class="meta">{t('ui.brief.privacy.version')}</p>
        <h2 class="sub-head">{t('ui.brief.privacy.kept.heading')}</h2>
        <p>{t('ui.brief.privacy.kept.body')}</p>
        <h2 class="sub-head">{t('ui.brief.privacy.host.heading')}</h2>
        <p>
          <InlineText text={t('ui.brief.privacy.host.body', PRIVACY_PARAMS)} />
        </p>
        <h2 class="sub-head">{t('ui.brief.privacy.advice.heading')}</h2>
        <p>{t('ui.brief.disclaimer')}</p>
        <h2 class="sub-head">{t('ui.brief.privacy.owner.heading')}</h2>
        <p>
          <InlineText text={t('ui.brief.privacy.owner.body', PRIVACY_PARAMS)} />
        </p>
      </main>
      <footer class="flow app-foot">
        <LanguageSwitch t={t} locale={locale} onLocale={onLocale} />
        <a href={BRIEF_HREF}>{t('ui.brief.privacy.back')}</a>
      </footer>
    </div>
  )
}

function isPrivacyAddress(): boolean {
  return location.hash === PRIVACY_HREF
}
