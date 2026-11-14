import { useEffect, useRef, useState } from 'preact/hooks'

// The width drawn before the element is measured, and the least one that still holds the gutters.
const FALLBACK_WIDTH = 360
const MIN_WIDTH = 240

// The width of the element the ref is put on, followed until the component unmounts.
export function useWidth(): {
  readonly ref: { current: HTMLDivElement | null }
  readonly width: number
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)

  useEffect(() => {
    const element = ref.current

    if (element === null) {
      return undefined
    }

    const observer = new ResizeObserver(([entry]) => {
      const measured = entry?.contentRect.width ?? 0

      if (measured > 0) {
        setWidth(Math.max(MIN_WIDTH, Math.round(measured)))
      }
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
