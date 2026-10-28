import { effect, type ReadonlySignal, signal } from '@preact/signals'

export type Breakpoint = 'wide' | 'narrow' | 'phone'

// Below this width one pane shows at a time; below the phone width the header and dialogs compact.
const NARROW_PX = 900
const PHONE_PX = 600
// Every stylesheet selects on this attribute, so the two widths live here only.
const LAYOUT_ATTRIBUTE = 'data-layout'

const narrowQuery = matchMedia(`(width < ${NARROW_PX}px)`)
const phoneQuery = matchMedia(`(width < ${PHONE_PX}px)`)
const lifetime = new AbortController()
const band = signal<Breakpoint>(readBand())

for (const query of [narrowQuery, phoneQuery]) {
  query.addEventListener('change', syncBand, { signal: lifetime.signal })
}

const stopDocumentSync = effect(() => {
  document.documentElement.setAttribute(LAYOUT_ATTRIBUTE, band.value)
})

/** The page's layout band, from the viewport width. */
export const breakpoint: ReadonlySignal<Breakpoint> = band

/** Releases the media listeners and the document sync; idempotent. */
export function disposeBreakpoints(): void {
  lifetime.abort()
  stopDocumentSync()
}

function syncBand(): void {
  band.value = readBand()
}

function readBand(): Breakpoint {
  if (phoneQuery.matches) {
    return 'phone'
  }

  return narrowQuery.matches ? 'narrow' : 'wide'
}
