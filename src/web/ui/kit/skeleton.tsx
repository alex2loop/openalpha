import { reducedMotion } from '@/web/state/prefs'

import './skeleton.css'

const DEFAULT_LINES = 3

interface SkeletonProps {
  readonly lines?: number
  /** `lines` for text; `rows` for a list of a name, a price and a move, as the panel's rows read. */
  readonly shape?: 'lines' | 'rows'
}

/** Grey shapes where a block's figures will be, while its first read is under way. */
export function Skeleton({ lines = DEFAULT_LINES, shape = 'lines' }: SkeletonProps) {
  const className = reducedMotion.value ? 'skeleton is-still' : 'skeleton'
  const items = Array.from({ length: lines }, (_, line) => line)

  return (
    <div class={className} aria-hidden="true">
      {shape === 'rows'
        ? items.map((line) => (
            // The rows are identical and never reorder.
            <span key={line} class="skeleton-row">
              <span class="skeleton-bar is-name" />
              <span class="skeleton-bar is-price" />
              <span class="skeleton-bar is-move" />
            </span>
          ))
        : items.map((line) => <span key={line} class="skeleton-bar is-line" />)}
    </div>
  )
}
