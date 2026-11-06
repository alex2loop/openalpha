import { useEffect, useRef, useState } from 'preact/hooks'

import type { PublicBriefDocument } from '@/app/server/wire/public-brief'
import { type LatestState, loadLatest } from '@/web/brief/load'
import { ScreenList } from '@/web/brief/screen-list'
import { drawShareCard, shareBlob } from '@/web/brief/share-card'
import {
  type Locale,
  loadStrings,
  rememberLocale,
  resolveLocale,
  type Translate,
  toTranslate,
} from '@/web/brief/strings'
import { Button } from '@/web/ui/kit/button'
import { Segmented } from '@/web/ui/kit/segmented'
import { BriefBody } from '@/web/ui/reader/brief-body'

// The address of the web app, which the build stamps in.
declare const APP_URL: string

const RETRY_MARK = '↻'

interface Loaded<T> {
  readonly value: T
}

type SharePhase = 'idle' | 'working' | 'failed'

interface PageProps {
  readonly t: Translate
  readonly locale: Locale
  readonly latest: LatestState | undefined
  readonly onLocale: (locale: Locale) => void
  readonly onRetry: () => void
}

/** The brief on a phone: the newest document the Worker holds, in the reader's language. */
export function App() {
  const [locale, setLocale] = useState(resolveLocale)
  const [attempt, setAttempt] = useState(0)
  const catalogs = useLoaded(loadStrings, attempt)
  const latest = useLoaded(loadLatest, attempt)
  const retry = () => setAttempt((count) => count + 1)

  useEffect(() => {
    document.documentElement.lang = locale
    rememberLocale(locale)
  }, [locale])

  if (catalogs === undefined) {
    return <div class="app" aria-busy="true" />
  }

  if (catalogs.value === undefined) {
    return <WordsFailed onRetry={retry} />
  }

  return (
    <Page
      t={toTranslate(catalogs.value, locale)}
      locale={locale}
      latest={latest?.value}
      onLocale={setLocale}
      onRetry={retry}
    />
  )
}

// A read per attempt; a new attempt, or leaving the page, abandons the one in flight.
function useLoaded<T>(
  load: (signal: AbortSignal) => Promise<T>,
  attempt: number
): Loaded<T> | undefined {
  const [loaded, setLoaded] = useState<Loaded<T> | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    setLoaded(undefined)
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setLoaded({ value })
        }
      })
      // A read answers its failure as a value; a rejection is only its own abort.
      .catch(() => undefined)

    return () => controller.abort()
  }, [attempt])

  return loaded
}

// Without the words there is nothing to say it in: only a mark to try again.
function WordsFailed({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div class="app">
      <Button onClick={onRetry}>{RETRY_MARK}</Button>
    </div>
  )
}

function Page({ t, locale, latest, onLocale, onRetry }: PageProps) {
  const doc = latest !== undefined && 'doc' in latest ? latest.doc : undefined

  return (
    <div class="app">
      <header class="app-head">
        <h1 class="app-title">{headingOf(t, locale, latest)}</h1>
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
function headingOf(t: Translate, locale: Locale, latest: LatestState | undefined): string {
  if (latest?.kind === 'offline' || (latest?.kind === 'ready' && !latest.isToday)) {
    return t('ui.brief.heading.latest', { day: latest.doc.briefs[locale].title })
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
function Brief({
  doc,
  locale,
  t,
}: {
  readonly doc: PublicBriefDocument
  readonly locale: Locale
  readonly t: Translate
}) {
  return (
    <>
      <BriefBody text={doc.briefs[locale]} labels={{ cautions: t('ui.brief.cautions') }} />
      {doc.screens[locale].map((screen) => (
        <ScreenList key={screen.market} screen={screen} />
      ))}
    </>
  )
}

function ShareButton({
  doc,
  locale,
  t,
}: {
  readonly doc: PublicBriefDocument
  readonly locale: Locale
  readonly t: Translate
}) {
  const [phase, setPhase] = useState<SharePhase>('idle')
  const pending = useRef<AbortController | undefined>(undefined)

  useEffect(() => () => pending.current?.abort(), [])

  const share = () => {
    const controller = new AbortController()

    pending.current = controller
    setPhase('working')
    drawShareCard({
      day: doc.briefs[locale].title,
      headline: doc.headline[locale],
      disclaimer: t('ui.brief.disclaimer'),
      address: location.host,
      signal: controller.signal,
    })
      .then(shareBlob)
      .then(
        () => setPhase('idle'),
        () => setPhase(controller.signal.aborted ? 'idle' : 'failed')
      )
  }

  return (
    <div class="app-share">
      <Button size="small" disabled={phase === 'working'} onClick={share}>
        {t('ui.brief.share')}
      </Button>
      {phase === 'failed' && (
        <p class="meta" role="alert">
          {t('ui.brief.shareFailed')}
        </p>
      )}
    </div>
  )
}
