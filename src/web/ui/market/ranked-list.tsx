import type { ComponentChildren } from 'preact'

import { formatSignedPercent, toneOfPercent } from '@/web/text/figures'

import './ranked-list.css'

interface RankedRow {
  readonly key: string
  readonly label: ComponentChildren
  /** The figure the list is ranked by, as printed. */
  readonly figure: string
  /** The row's own move, as a percent; a row with none leaves its place empty. */
  readonly changePct?: number | undefined
}

interface RankedListProps {
  readonly title: string
  /** What the figures span, said beside the title; a window the title already says is left off. */
  readonly note?: string | undefined
  readonly rows: readonly RankedRow[]
}

/** A short ranked list under its own title: a name, the figure it is ranked by, and its move. */
export function RankedList({ title, note, rows }: RankedListProps) {
  if (rows.length === 0) {
    return null
  }

  return (
    <div class="flow">
      <h4 class="sub-head">
        {title}
        {note !== undefined && <span class="meta"> {note}</span>}
      </h4>
      <div class="row-list">
        {rows.map((row) => (
          <div key={row.key} class="row">
            <b>{row.label}</b>
            <span class="meta">{row.figure}</span>
            {row.changePct === undefined ? (
              <span />
            ) : (
              <span class={`pill is-${toneOfPercent(row.changePct)}`}>
                {formatSignedPercent(row.changePct)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Ranked lists side by side while each keeps room for its name, figure and move, stacked below. */
export function RankedLists({ children }: { readonly children: ComponentChildren }) {
  return <div class="ranked-lists">{children}</div>
}
