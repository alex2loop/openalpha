import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'

import { tr } from '@/web/text/tr'
import { CloseIcon } from '@/web/ui/kit/icons'
import { NextSteps } from '@/web/ui/reader/next-steps'
import { QuoteAsk } from '@/web/ui/reader/quote-ask'
import { Toc, type TocEntry } from '@/web/ui/reader/toc'

export const TITLE_ID = 'reader-title'

interface FrameProps {
  readonly title: string
  /** A line of its own under the title: the day, or what the report read. */
  readonly meta?: string | undefined
  readonly onClose: () => void
  readonly children?: ComponentChildren
}

/** The dialog's header, with the title and the close button, over its body. */
export function ReaderFrame({ title, meta, onClose, children }: FrameProps) {
  return (
    <>
      <header class="reader-head">
        <div class="reader-heading">
          <h2 id={TITLE_ID}>{title}</h2>
          {meta !== undefined && meta !== '' && <p class="meta">{meta}</p>}
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label={tr('ui.office.common.close')}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div class="reader-body">{children}</div>
    </>
  )
}

interface PageProps extends Omit<FrameProps, 'children'> {
  readonly entries: readonly TocEntry[]
  /** Every word of the page, for the names it mentions. */
  readonly plainText: string
  /** A passage the reader selects can be quoted into a question; absent when none may be. */
  readonly onAsk?: (quote: string) => void
  readonly children: ComponentChildren
}

/** A loaded page: its text in a column that scrolls, the contents beside it. */
export function ReaderPage({ entries, plainText, onAsk, onClose, children, ...frame }: PageProps) {
  const column = useRef<HTMLDivElement>(null)

  return (
    <ReaderFrame {...frame} onClose={onClose}>
      <div ref={column} class="reader-main">
        {children}
        <NextSteps text={plainText} onFill={onClose} />
      </div>
      <Toc entries={entries} scroller={column} />
      {onAsk !== undefined && <QuoteAsk scroller={column} onAsk={onAsk} />}
    </ReaderFrame>
  )
}
