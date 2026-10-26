import { effect, untracked } from '@preact/signals'

import type { PointerDeps } from '@/web/scene/overlay/pointer'
import type { RendererHost, SceneRenderer } from '@/web/scene/renderer'
import { attachInteraction, type Interaction } from '@/web/scene/overlay/interact'
import { showViewNote } from '@/web/scene/overlay/view-note'
import { sceneView, setSceneView } from '@/web/state/prefs'

// How long the line about falling back to 2D stays up.
const FALLBACK_NOTE_MS = 6_000
const CONTEXT_LOST_EVENT = 'webglcontextlost'

/** The 2D renderer, kept for every return to it, and the host that shows the chosen one. */
export interface Renderers {
  readonly flat: SceneRenderer
  readonly host: RendererHost
}

/** The canvas's input, attached once the loop it steps on exists and re-attached on each swap. */
export interface InputSlot {
  current: Interaction | undefined
}

interface ViewDeps {
  readonly renderers: Renderers
  readonly element: HTMLElement
  readonly input: InputSlot
  readonly pointer: PointerDeps
  /** The composer's lazy `import()` of the 3D renderer, the only way to it. */
  readonly load3d: () => Promise<() => SceneRenderer>
}

// The renderer the operator chose, behind the host, with the input on its canvas. 3D loads once by
// `import()`; a failed load, a mount without WebGL or a lost context falls back to 2D with its line.
export function startViews(deps: ViewDeps): () => void {
  const views: ViewState = {
    canvas: new AbortController(),
    isStopped: false,
    noteTimer: undefined,
  }
  const off = effect(() => {
    const chosen = sceneView.value

    untracked(() => (chosen === '2d' ? showFlat(deps, views) : showDeep(deps, views)))
  })

  return () => {
    views.isStopped = true
    off()
    clearTimeout(views.noteTimer)
    showViewNote(undefined)
    views.canvas.abort()
    detachInput(deps.input)
  }
}

function showFlat(deps: ViewDeps, views: ViewState): void {
  showViewNote(undefined)
  showView(deps, views, deps.renderers.flat)
}

function showDeep(deps: ViewDeps, views: ViewState): void {
  const fallback = () => fallBack(deps, views)

  showViewNote('loading')
  deps
    .load3d()
    .then((create) => {
      if (views.isStopped || sceneView.peek() !== '3d') {
        return
      }

      showView(deps, views, create())
      watchContext(deps.element, views.canvas.signal, fallback)
      showViewNote(undefined)
    })
    .catch(() => {
      if (!views.isStopped) {
        fallback()
      }
    })
}

function fallBack(deps: ViewDeps, views: ViewState): void {
  setSceneView('2d')
  showView(deps, views, deps.renderers.flat)
  showViewNote('fallback')
  clearTimeout(views.noteTimer)
  views.noteTimer = setTimeout(() => showViewNote(undefined), FALLBACK_NOTE_MS)
}

interface ViewState {
  canvas: AbortController
  isStopped: boolean
  noteTimer: ReturnType<typeof setTimeout> | undefined
}

// The listeners on the old canvas go before its renderer unmounts (a 3D unmount loses its context
// on purpose), and the input follows the new canvas.
function showView(deps: ViewDeps, views: ViewState, next: SceneRenderer): void {
  views.canvas.abort()
  views.canvas = new AbortController()
  detachInput(deps.input)
  deps.renderers.host.swap(next)
  deps.input.current = attachInput(deps.element, deps.pointer)
  deps.pointer.wake()
}

// The canvas's input, once the renderer has put its canvas in.
function attachInput(element: HTMLElement, deps: PointerDeps): Interaction | undefined {
  const canvas = element.querySelector('canvas')

  return canvas === null ? undefined : attachInteraction(canvas, deps)
}

function detachInput(input: InputSlot): void {
  input.current?.detach()
  input.current = undefined
}

function watchContext(element: HTMLElement, signal: AbortSignal, onLost: () => void): void {
  element
    .querySelector('canvas')
    ?.addEventListener(CONTEXT_LOST_EVENT, onLost, { signal, once: true })
}
