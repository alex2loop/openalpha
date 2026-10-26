import { useEffect, useRef } from 'preact/hooks'

import type { FrameSpec } from '@/web/scene/render2d/figure-spec'
import type { Look } from '@/web/scene/sprites/parts'
import { characterSprite } from '@/web/scene/render2d/characters'
import { FIGURE } from '@/web/scene/types'

import './portrait.css'

// Facing the reader, at rest, eyes open.
const PORTRAIT_FRAME: FrameSpec = Object.freeze({
  isBack: false,
  isBob: false,
  isBlink: false,
  isWorking: false,
  finish: 0,
})

/** One person's sprite, `size` CSS px tall, its pixels kept square at any zoom. Decoration: the
 *  name beside it says who it is. */
export function Portrait({ look, size }: { readonly look: Look; readonly size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const g = ref.current?.getContext('2d')

    if (g === null || g === undefined) {
      return
    }

    g.clearRect(0, 0, FIGURE.w, FIGURE.h)
    g.drawImage(characterSprite(look, PORTRAIT_FRAME), 0, 0)
  }, [look])

  return (
    <canvas
      ref={ref}
      class="portrait"
      width={FIGURE.w}
      height={FIGURE.h}
      style={{ height: `${size}px` }}
    />
  )
}
