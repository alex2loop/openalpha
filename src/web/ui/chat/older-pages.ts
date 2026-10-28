import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

// How near the top the next older page starts loading, so it lands before the reader reaches it.
const LOAD_AHEAD_PX = 160

interface OlderPagesInput {
  /** The scrolling list. */
  readonly list: { readonly current: HTMLElement | null }
  /** The oldest message held; a new one is a page put in front, or the first page landing. */
  readonly oldest: unknown
  /** An older page exists and none is loading or failed (a failure waits for the button). */
  readonly canLoad: boolean
  readonly loadOlder: () => void
}

interface Measure {
  readonly top: number
  readonly height: number
}

/** Loads the next older page as the reader scrolls near the top, and keeps the lines in view where
 *  they were when it is put in front. The first page opens at the newest line. Returns the list's
 *  scroll handler, which the list's own `onScroll` attaches and drops with it. */
export function useOlderPages(input: OlderPagesInput): () => void {
  const { list, oldest, canLoad } = input
  const latest = useRef(input)
  const shown = useRef<unknown>(undefined)
  const before = useRef<Measure | undefined>(undefined)

  latest.current = input

  // Read while rendering, before the new page is in the list.
  if (oldest !== shown.current && list.current !== null) {
    before.current = { top: list.current.scrollTop, height: list.current.scrollHeight }
  }

  useLayoutEffect(() => {
    const element = list.current
    const wasEmpty = shown.current === undefined

    shown.current = oldest

    if (element === null || oldest === undefined) {
      return
    }

    // Assigned, not added to: the browser's own scroll anchoring may already have moved it.
    element.scrollTop =
      wasEmpty || before.current === undefined
        ? element.scrollHeight
        : before.current.top + element.scrollHeight - before.current.height
  }, [oldest])

  // A page too short to scroll, or one that held nothing to show, leaves the top in reach.
  useEffect(() => {
    const element = list.current

    if (canLoad && element !== null && isNearTop(element)) {
      latest.current.loadOlder()
    }
  }, [oldest, canLoad])

  return () => {
    const element = list.current

    if (latest.current.canLoad && element !== null && isNearTop(element)) {
      latest.current.loadOlder()
    }
  }
}

function isNearTop(element: HTMLElement): boolean {
  return element.scrollTop <= LOAD_AHEAD_PX
}
