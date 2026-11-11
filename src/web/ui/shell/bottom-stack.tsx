import { useEffect, useRef } from 'preact/hooks'

import { UndoBar } from '@/web/ui/kit/undo-bar'
import { OfflineBar } from '@/web/ui/shell/offline-bar'

const RESERVE_PROPERTY = '--stackReserve'

/** The offline bar, then the undo bar under it. It tells the page how much of the screen's foot it
 *  takes, so a popover keeps clear of it. */
export function BottomStack({ isDocked }: { readonly isDocked?: true }) {
  const stack = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = stack.current

    if (element === null) {
      return
    }

    const root = document.documentElement
    const measure = () => {
      const { top, height } = element.getBoundingClientRect()
      const reserve = height === 0 ? 0 : Math.max(0, window.innerHeight - top)

      root.style.setProperty(RESERVE_PROPERTY, `${Math.ceil(reserve)}px`)
    }
    const watch = new ResizeObserver(measure)

    watch.observe(element)
    watch.observe(root)
    measure()

    return () => {
      watch.disconnect()
      root.style.removeProperty(RESERVE_PROPERTY)
    }
  }, [])

  return (
    <div ref={stack} class={isDocked === true ? 'bottom-stack is-docked' : 'bottom-stack'}>
      <OfflineBar />
      <UndoBar />
    </div>
  )
}
