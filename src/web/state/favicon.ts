import { effect } from '@preact/signals'

import { needsYou } from '@/web/state/notices'

const FAVICON_PX = 32
const FAVICON_DOT_TOKEN = '--badgeStop'
const FAVICON_TYPE = 'image/png'

// While something needs the operator the tab's icon is a dot, drawn here and swapped in as an
// object URL; every swap and the stop revoke the one before.
export function startFavicon(): () => void {
  const link = document.createElement('link')
  const held: { url: string | undefined; isShown: boolean | undefined; isStopped: boolean } = {
    url: undefined,
    isShown: undefined,
    isStopped: false,
  }
  const revoke = (): void => {
    if (held.url !== undefined) {
      URL.revokeObjectURL(held.url)
      held.url = undefined
    }
  }
  const stopSync = effect(() => {
    const isNeeded = needsYou.value > 0

    if (isNeeded === held.isShown) {
      return
    }

    held.isShown = isNeeded
    link.remove()
    revoke()

    if (isNeeded) {
      drawDot((blob) => {
        if (held.isStopped || held.isShown !== true) {
          return
        }

        revoke()
        held.url = URL.createObjectURL(blob)
        link.rel = 'icon'
        link.href = held.url
        document.head.append(link)
      })
    }
  })

  return () => {
    held.isStopped = true
    stopSync()
    link.remove()
    revoke()
  }
}

function drawDot(onDrawn: (blob: Blob) => void): void {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const half = FAVICON_PX / 2

  if (context === null) {
    return
  }

  canvas.width = FAVICON_PX
  canvas.height = FAVICON_PX
  context.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue(FAVICON_DOT_TOKEN)
    .trim()
  context.beginPath()
  context.arc(half, half, half, 0, 2 * Math.PI)
  context.fill()
  canvas.toBlob((blob) => (blob === null ? undefined : onDrawn(blob)), FAVICON_TYPE)
}
