import { useEffect, useErrorBoundary, useRef, useState } from 'preact/hooks'

import type { PublicBriefDocument } from '@/app/server/wire/public-brief'
import { LanguageSwitch } from '@/web/brief/language-switch'
import { type LatestState, loadLatest } from '@/web/brief/load'
import { PRIVACY_HREF, PrivacyPage, usePrivacyRoute } from '@/web/brief/privacy'
import { Reminder } from '@/web/brief/reminder'
import { ScreenList } from '@/web/brief/screen-list'
import { drawShareCard, shareBlob } from '@/web/brief/share-card'
import {
  createTranslate,
  type Locale,
  rememberChoice,
  startLocale,
  type Translate,
} from '@/web/brief/strings'
import { formatDay } from '@/web/brief/today'
import { Button } from '@/web/ui/kit/button'
import { BriefBody } from '@/web/ui/reader/brief-body'

// The address of the web app, which the build stamps in.
declare const APP_URL: string

interface DocumentProps {
  readonly doc: PublicBriefDocument
  readonly locale: Locale
  readonly t: Translate
}

interface PageProps {
  readonly t: Translate
  readonly locale: Locale
  readonly onLocale: (locale: Locale) => void
}

interface BodyProps {
  readonly t: Translate
  readonly locale: Locale
  readonly latest: LatestState | undefined
  readonly onRetry: () => void
}

type ShareCard =
  | { readonly kind: 'drawing' }
  | { readonly kind: 'ready'; readonly blob: Blob }
  | { readonly kind: 'failed' }

/** The brief on a phone: the newest document the Worker holds, in the reader's language. */
export function App() {
  const [locale, setLocale] = useState(startLocale)
  const isPrivacy = usePrivacyRoute()

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const onLocale = (next: Locale) => {
    rememberChoice(next)
    setLocale(next)
  }

  if (isPrivacy) {
    return <PrivacyPage t={createTranslate(locale)} locale={locale} onLocale={onLocale} />
  }

  return <Page t={createTranslate(locale)} locale={locale} onLocale={onLocale} />
}

// A read per attempt; a new attempt, or leaving the page, abandons the one in flight.
function useLatest(attempt: number): LatestState | undefined {
  const [latest, setLatest] = useState<LatestState | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    setLatest(undefined)
    loadLatest(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) {
          setLatest(state)
        }
      })
      // A read answers its failure as a state; a rejection is only its own abort.
      .catch(() => undefined)

    return () => controller.abort()
  }, [attempt])

  return latest
}

// The read lives here, so the privacy page asks the Worker for nothing.
function Page({ t, locale, onLocale }: PageProps) {
  const [attempt, setAttempt] = useState(0)
  const latest = useLatest(attempt)
  const onRetry = () => setAttempt((count) => count + 1)
  const doc = latest !== undefined && 'doc' in latest ? latest.doc : undefined

  return (
    <div class="app">
      <header class="app-head">
        <h1 class="app-title">{headingOf(t, latest)}</h1>
        {doc !== undefined && <ShareButton doc={doc} locale={locale} t={t} />}
      </header>
      <main class="flow app-main">
        <Body t={t} locale={locale} latest={latest} onRetry={onRetry} />
      </main>
      <footer class="flow app-foot">
        <p class="meta">{t('ui.brief.disclaimer')}</p>
        <Reminder t={t} locale={locale} />
        <LanguageSwitch t={t} locale={locale} onLocale={onLocale} />
        <a href={PRIVACY_HREF}>{t('ui.brief.privacy.title')}</a>
        <a href={APP_URL}>{t('ui.brief.openApp')}</a>
      </footer>
    </div>
  )
}

// The day sits in the heading only when the brief is not today's: the newest one, or the copy kept
// for when there is no network.
function headingOf(t: Translate, latest: LatestState | undefined): string {
  if (latest?.kind === 'offline' || (latest?.kind === 'ready' && !latest.isToday)) {
    return t('ui.brief.heading.latest', { day: formatDay(latest.doc.day) })
  }

  return t('ui.brief.heading.today')
}

function Body({ t, locale, latest, onRetry }: BodyProps) {
  if (latest === undefined) {
    return <p class="meta">{t('ui.brief.loading')}</p>
  }

  switch (latest.kind) {
    case 'empty':
      return <p class="app-message">{t('ui.brief.empty')}</p>
    case 'failed':
      return <Failed t={t} onRetry={onRetry} />
    case 'offline':
      return (
        <>
          <p class="app-notice">{t('ui.brief.offline')}</p>
          <GuardedBrief doc={latest.doc} locale={locale} t={t} onRetry={onRetry} />
        </>
      )
    case 'ready':
      return <GuardedBrief doc={latest.doc} locale={locale} t={t} onRetry={onRetry} />
  }
}

function Failed({ t, onRetry }: Pick<BodyProps, 't' | 'onRetry'>) {
  return (
    <div class="flow app-message">
      <p>{t('ui.brief.failed')}</p>
      <Button onClick={onRetry}>{t('ui.brief.retry')}</Button>
    </div>
  )
}

// A document that passed the read can still fail to lay out; the page then says it failed, as it
// does for a read that failed, and a retry starts from a clean boundary.
function GuardedBrief({ doc, locale, t, onRetry }: DocumentProps & Pick<BodyProps, 'onRetry'>) {
  const [error, reset] = useErrorBoundary()

  if (error !== undefined) {
    return (
      <Failed
        t={t}
        onRetry={() => {
          reset()
          onRetry()
        }}
      />
    )
  }

  return <Brief doc={doc} locale={locale} t={t} />
}

// The body with the screen lists before its cautions; the disclaimer closes the page in its footer.
// A brief carries no AI label: none of its sections is written by a model.
function Brief({ doc, locale, t }: DocumentProps) {
  return (
    <BriefBody text={doc.briefs[locale]} labels={{ cautions: t('ui.brief.cautions') }}>
      {doc.screens[locale].map((screen) => (
        <ScreenList key={screen.market} screen={screen} />
      ))}
    </BriefBody>
  )
}

// The card is drawn as soon as the brief shows, so a tap hands it to the share sheet at once: a
// phone only shares inside the tap that asked.
function ShareButton({ doc, locale, t }: DocumentProps) {
  const [card, setCard] = useState<ShareCard>({ kind: 'drawing' })
  const [attempt, setAttempt] = useState(0)
  const translate = useRef(t)

  translate.current = t

  useEffect(() => {
    const controller = new AbortController()

    setCard({ kind: 'drawing' })
    drawShareCard({
      day: formatDay(doc.day),
      headline: doc.headline[locale],
      disclaimer: translate.current('ui.brief.disclaimer'),
      address: location.host,
      signal: controller.signal,
    }).then(
      (blob) => !controller.signal.aborted && setCard({ kind: 'ready', blob }),
      () => !controller.signal.aborted && setCard({ kind: 'failed' })
    )

    return () => controller.abort()
  }, [doc, locale, attempt])

  const share = () => {
    if (card.kind === 'ready') {
      shareBlob(card.blob).catch(() => setCard({ kind: 'failed' }))
    } else {
      setAttempt((count) => count + 1)
    }
  }

  return (
    <div class="app-share">
      <Button size="small" disabled={card.kind === 'drawing'} onClick={share}>
        {t('ui.brief.share')}
      </Button>
      {card.kind === 'failed' && (
        <p class="meta" role="alert">
          {t('ui.brief.shareFailed')}
        </p>
      )}
    </div>
  )
}
