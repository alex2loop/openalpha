import { useEffect, useRef } from 'preact/hooks'

/** Reads again the moment a fact a read depended on becomes known after mount (the book arriving,
 *  the daemon's time zone, the agent roster); one already known at mount is the first read's. */
export function useRetryWhenKnown(isKnown: boolean, retry: () => void): void {
  const wasKnown = useRef(isKnown)

  useEffect(() => {
    if (isKnown && !wasKnown.current) {
      retry()
    }

    wasKnown.current = isKnown
  }, [isKnown])
}
