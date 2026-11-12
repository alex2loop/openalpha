import type { ComponentChildren } from 'preact'

import './status-line.css'

const BLOCKS = Object.freeze([0, 1, 2])

/** One line in place of the page while it loads, or when it cannot, and what the reader can do
 *  about it beneath. A load in progress shows three blocks rising in turn above the line, like the
 *  office going up. */
export function StatusLine({
  text,
  isBusy = false,
  children,
}: {
  readonly text: string
  readonly isBusy?: boolean
  readonly children?: ComponentChildren
}) {
  return (
    <div class="status-line" role="status">
      <div class="status-stack">
        {isBusy && (
          <span class="status-build" aria-hidden="true">
            {BLOCKS.map((block) => (
              <i key={block} />
            ))}
          </span>
        )}
        {text}
        {children}
      </div>
    </div>
  )
}
