import type { TargetedMouseEvent } from 'preact'
import { signal, useSignal } from '@preact/signals'
import { useLayoutEffect, useRef } from 'preact/hooks'

import { pluralKey } from '@/i18n'
import { fillInput } from '@/web/state/command'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { ESCAPE_KEY, trapFocus } from '@/web/ui/kit/focus-trap'
import { CloseIcon } from '@/web/ui/kit/icons'
import { closePopover, resolveFocusReturn } from '@/web/ui/kit/popover'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { ReportView } from '@/web/ui/markdown/markdown'
import { loadReport, type ReaderContent, type ReaderSource } from '@/web/ui/reader/load-report'
import { NextSteps } from '@/web/ui/reader/next-steps'
import { QuoteAsk } from '@/web/ui/reader/quote-ask'
import { Toc } from '@/web/ui/reader/toc'

import './reader.css'

const PAPER_ID = 'reader-paper'
const TITLE_ID = 'reader-title'

interface OpenReader {
  readonly source: ReaderSource
  readonly opener: HTMLElement | undefined
  readonly seq: number
}

const current = signal<OpenReader | undefined>(undefined)
let readerSeq = 0

/** Opens the page's one reader over the office; a second call replaces the first. Focus moves into
 *  it and returns to the element that had it when it closes. */
export function openReader(source: ReaderSource): void {
  // A reader that replaces another keeps the first one's return target.
  const opener = current.value?.opener ?? resolveFocusReturn(document.activeElement)

  closePopover()
  readerSeq++
  current.value = { source, opener, seq: readerSeq }
}

/** Mounted once by the shell; a reader open when the shell leaves (a sign-out) closes with it. */
export function ReaderHost() {
  const entry = current.value

  useLayoutEffect(() => closeReader, [])

  return entry === undefined ? null : <ReaderView key={entry.seq} source={entry.source} />
}

function closeReader(): void {
  const entry = current.value

  if (entry === undefined) {
    return
  }

  current.value = undefined

  if (entry.opener?.isConnected === true) {
    entry.opener.focus()
  }
}

function ReaderView({ source }: { readonly source: ReaderSource }) {
  const paper = useRef<HTMLDivElement>(null)
  const attempt = useSignal(0)

  useLayoutEffect(() => {
    const listeners = new AbortController()

    document.addEventListener('keydown', onKey, { signal: listeners.signal })
    paper.current?.focus()

    return () => listeners.abort()
  }, [])

  return (
    <div class="reader scrim" onPointerDown={dismissOnScrim}>
      <div
        ref={paper}
        id={PAPER_ID}
        class="reader-paper solid-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
      >
        <button
          type="button"
          class="icon-button reader-close"
          aria-label={tr('ui.office.common.close')}
          onClick={closeReader}
        >
          <CloseIcon />
        </button>
        <ReaderBody
          key={attempt.value}
          source={source}
          onRetry={() => {
            attempt.value++
          }}
        />
      </div>
    </div>
  )
}

function dismissOnScrim(event: TargetedMouseEvent<HTMLDivElement>): void {
  if (event.target === event.currentTarget) {
    closeReader()
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key === ESCAPE_KEY) {
    event.preventDefault()
    closeReader()
    return
  }

  if (event.key === 'Tab') {
    trapFocus(event, `#${PAPER_ID}`)
  }
}

interface ReaderBodyProps {
  readonly source: ReaderSource
  readonly onRetry: () => void
}

// The read ends with the body: closing the reader, or trying again, aborts it.
function ReaderBody({ source, onRetry }: ReaderBodyProps) {
  const loaded = useLoad((abort) => loadReport(source, abort))
  const result = loaded.value

  if (result.status === 'loading') {
    return (
      <div class="reader-main">
        <h2 id={TITLE_ID}>{tr('ui.office.reader.loading')}</h2>
        <Skeleton lines={6} />
      </div>
    )
  }

  if (result.status === 'failed') {
    return (
      <div class="reader-main">
        <h2 id={TITLE_ID}>{tr('ui.office.reader.missing')}</h2>
        <div class="strip is-problem" role="alert">
          <span>{toFailureText(result.failure)}</span>
          <Button size="small" onClick={onRetry}>
            {tr('ui.office.common.retry')}
          </Button>
        </div>
      </div>
    )
  }

  return result.value === undefined ? <Missing /> : <ReportPage content={result.value} />
}

function Missing() {
  return (
    <div class="reader-main">
      <h2 id={TITLE_ID}>{tr('ui.office.reader.missing')}</h2>
    </div>
  )
}

function ReportPage({ content }: { readonly content: ReaderContent }) {
  const column = useRef<HTMLDivElement>(null)
  const { title, doc, canAsk } = content
  const count = doc.sources.length

  return (
    <>
      <div ref={column} class="reader-main">
        <h2 id={TITLE_ID}>{title}</h2>
        {count > 0 && (
          <p class="meta">
            {tr(pluralKey(count, 'ui.office.common.sourcesOne', 'ui.office.common.sources'), {
              count,
            })}
          </p>
        )}
        <ReportView doc={doc} isAnchored />
        <NextSteps doc={doc} onFill={closeReader} />
      </div>
      <Toc doc={doc} />
      {canAsk && (
        <QuoteAsk
          scroller={column}
          onAsk={(quote) => {
            closeReader()
            fillInput(`${tr('ui.office.reader.quote', { quote, title })} `)
          }}
        />
      )}
    </>
  )
}
