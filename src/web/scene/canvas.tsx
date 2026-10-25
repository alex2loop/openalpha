import { effect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { SceneRenderer } from '@/web/scene/renderer'
import type { SimView } from '@/web/scene/types'
import { setSceneZone } from '@/web/scene/clock/clock'
import { PerfReadout } from '@/web/scene/overlay/perf-readout'
import { createRenderer2d } from '@/web/scene/render2d/renderer-2d'
import { createSimLoop } from '@/web/scene/sim/loop'
import { view } from '@/web/scene/view'
import { state } from '@/web/state/session'

import './canvas.css'

const NO_ACTORS: SimView['actors'] = Object.freeze([])

/** The office scene: the mounted renderer driven by the sim loop, sized to its pane. */
export function SceneCanvas() {
  const host = useRef<HTMLDivElement>(null)
  const [renderer] = useState(createRenderer2d)

  useEffect(() => {
    const element = host.current

    return element === null ? undefined : mountScene(element, renderer)
  }, [renderer])

  useEffect(() => effect(syncSceneZone), [])

  return (
    <div class="scene">
      <div ref={host} class="scene-host" />
      <PerfReadout renderer={renderer} />
    </div>
  )
}

// Everything it arms, the returned stop releases: loop, observer, listeners, renderer.
function mountScene(element: HTMLElement, renderer: SceneRenderer): () => void {
  const listeners = new AbortController()

  renderer.mount(element)

  const loop = createSimLoop({
    step: () => false,
    draw: (alpha, now) => renderer.draw({ floor: view.value.floor, alpha, actors: NO_ACTORS }, now),
    resume: () => undefined,
    nextDueAt: () => Number.POSITIVE_INFINITY,
  })
  const resize = new ResizeObserver(() => loop.wake())

  resize.observe(element)
  watchResolution(loop.wake, listeners.signal)
  loop.start()

  return () => {
    loop.stop()
    resize.disconnect()
    listeners.abort()
    renderer.unmount()
  }
}

// A move to a screen of another pixel density redraws at the new density; the query is re-armed for
// the density it lands on.
function watchResolution(onChange: () => void, signal: AbortSignal): void {
  if (signal.aborted) {
    return
  }

  const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)

  query.addEventListener(
    'change',
    () => {
      onChange()
      watchResolution(onChange, signal)
    },
    { signal, once: true }
  )
}

// The operator's `[locale] timezone` until the home market's zone is read.
function syncSceneZone(): void {
  const timeZone = state.value?.timeZone

  if (timeZone !== undefined) {
    setSceneZone(timeZone)
  }
}
