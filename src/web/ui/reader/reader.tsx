import type { TargetedMouseEvent } from 'preact'
import { signal, useSignal } from '@preact/signals'
import { useLayoutEffect, useRef } from 'preact/hooks'

import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { ESCAPE_KEY, trapFocus } from '@/web/ui/kit/focus-trap'
import { closePopover, resolveFocusReturn } from '@/web/ui/kit/popover'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { BriefPage } from '@/web/ui/reader/brief-page'
import { loadReport, type ReaderSource } from '@/web/ui/reader/load-report'
import { ReaderFrame, TITLE_ID } from '@/web/ui/reader/page'
import { ReportPage } from '@/web/ui/reader/report-page'

import './reader.css'

const PAPER_ID = 'reader-paper'

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
      <ReaderFrame title={tr('ui.office.reader.loading')} onClose={closeReader}>
        <div class="reader-main">
          <Skeleton lines={6} />
        </div>
      </ReaderFrame>
    )
  }

  if (result.status === 'failed') {
    return (
      <ReaderFrame title={tr('ui.office.reader.missing')} onClose={closeReader}>
        <div class="reader-main">
          <div class="strip is-problem" role="alert">
            <span>{toFailureText(result.failure)}</span>
            <Button size="small" onClick={onRetry}>
              {tr('ui.office.common.retry')}
            </Button>
          </div>
        </div>
      </ReaderFrame>
    )
  }

  const content = result.value

  if (content === undefined) {
    return <ReaderFrame title={tr('ui.office.reader.missing')} onClose={closeReader} />
  }

  return content.kind === 'brief' ? (
    <BriefPage content={content} onClose={closeReader} />
  ) : (
    <ReportPage content={content} onClose={closeReader} />
  )
}
