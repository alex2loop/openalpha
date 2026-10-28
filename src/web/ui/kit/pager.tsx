import type { Signal } from '@preact/signals'

import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

import './pager.css'

interface PagerProps {
  /** The page shown, from 0. */
  readonly page: Signal<number>
  readonly size: number
  /** The rows read so far. */
  readonly total: number
  /** The daemon holds rows beyond `total`. */
  readonly hasMore: boolean
  readonly isLoading: boolean
  readonly onLoadMore: () => void
}

/** "1-4 / 12" with the buttons to turn the page; at the end of what was read, "Next" becomes "Load
 *  more" while the daemon holds more. */
export function Pager({ page, size, total, hasMore, isLoading, onLoadMore }: PagerProps) {
  if (total === 0 && !hasMore) {
    return null
  }

  const from = page.value * size
  const to = Math.min(total, from + size)
  const hasNext = to < total
  const readsMore = !hasNext && hasMore

  return (
    <div class="pager">
      <span class="meta">{`${total === 0 ? 0 : from + 1}-${to} / ${total}`}</span>
      <span class="pager-buttons">
        <Button
          size="small"
          disabled={page.value === 0}
          onClick={() => {
            page.value--
          }}
        >
          {tr('ui.office.common.prev')}
        </Button>
        <Button
          size="small"
          disabled={readsMore ? isLoading : !hasNext}
          onClick={
            readsMore
              ? onLoadMore
              : () => {
                  page.value++
                }
          }
        >
          {tr(readsMore ? 'ui.office.book.loadMore' : 'ui.office.common.next')}
        </Button>
      </span>
    </div>
  )
}
