import { useEffect, useRef, useState } from 'preact/hooks'

import type { PublicBriefDocument } from '@/app/server/wire/public-brief'
import { type LatestState, loadLatest } from '@/web/brief/load'
import { ScreenList } from '@/web/brief/screen-list'
import { drawShareCard, shareBlob } from '@/web/brief/share-card'
import {
  type Locale,
  publishLocale,
  rememberChoice,
  startLocale,
  type Translate,
  toTranslate,
} from '@/web/brief/strings'
import { formatDay } from '@/web/brief/today'
import { Button } from '@/web/ui/kit/button'
import { Segmented } from '@/web/ui/kit/segmented'
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
  readonly latest: LatestState | undefined
  readonly onLocale: (locale: Locale) => void
  readonly onRetry: () => void
}

type ShareCard =
  | { readonly kind: 'drawing' }
  | { readonly kind: 'ready'; readonly blob: Blob }
  | { readonly kind: 'failed' }

/** The brief on a phone: the newest document the Worker holds, in the reader's language. */
export function App() {
  const [locale, setLocale] = useState(startLocale)
  const [attempt, setAttempt] = useState(0)
  const latest = useLatest(attempt)

  useEffect(() => {
    document.documentElement.lang = locale
    publishLocale(locale)
  }, [locale])

  return (
    <Page
      t={toTranslate(locale)}
      locale={locale}
      latest={latest}
      onLocale={(next) => {
        rememberChoice(next)
        setLocale(next)
      }}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  )
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

function Page({ t, locale, latest, onLocale, onRetry }: PageProps) {
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
        <Segmented
          label={t('ui.brief.languageLabel')}
          value={locale}
          options={[
            { value: 'vi', label: t('ui.brief.language.vi') },
            { value: 'en', label: t('ui.brief.language.en') },
          ]}
          onChange={onLocale}
        />
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

function Body({ t, locale, latest, onRetry }: Omit<PageProps, 'onLocale'>) {
  if (latest === undefined) {
    return <p class="meta">{t('ui.brief.loading')}</p>
  }

  switch (latest.kind) {
    case 'empty':
      return <p class="app-message">{t('ui.brief.empty')}</p>
    case 'failed':
      return (
        <div class="flow app-message">
          <p>{t('ui.brief.failed')}</p>
          <Button onClick={onRetry}>{t('ui.brief.retry')}</Button>
        </div>
      )
    case 'offline':
      return (
        <>
          <p class="app-notice">{t('ui.brief.offline')}</p>
          <Brief doc={latest.doc} locale={locale} t={t} />
        </>
      )
    case 'ready':
      return <Brief doc={latest.doc} locale={locale} t={t} />
  }
}

// The body, then the screen lists; the disclaimer closes the page in its footer. A brief carries no
// AI label: none of its sections is written by a model.
function Brief({ doc, locale, t }: DocumentProps) {
  return (
    <>
      <BriefBody text={doc.briefs[locale]} labels={{ cautions: t('ui.brief.cautions') }} />
      {doc.screens[locale].map((screen) => (
        <ScreenList key={screen.market} screen={screen} />
      ))}
    </>
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
