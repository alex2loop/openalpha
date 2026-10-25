import { effect } from '@preact/signals'
import { render } from 'preact'

import { takeTokenFromHash } from '@/web/api/token'
import { brand, loadUntilReady, locale } from '@/web/state/session'
import { App } from '@/web/ui/shell/app'

const ROOT_ID = 'root'

const root = document.getElementById(ROOT_ID)

// A route served from a Bun HTML bundle cannot carry `frame-ancestors` or `X-Frame-Options`, so
// the page itself refuses to run inside a frame: it renders nothing and never reads the token.
if (root !== null && window.top === window.self) {
  // First, before anything can read or log the address: the token leaves the URL at once.
  takeTokenFromHash()
  render(<App />, root)
  addEventListener('pageshow', (event) => (event.persisted ? boot() : undefined))
  await boot()
}

/** One page life: undone on `pagehide`, run again when the back-forward cache restores the page. */
async function boot(): Promise<void> {
  const controller = new AbortController()
  const stopDocumentSync = effect(() => {
    document.documentElement.lang = locale.value

    if (brand.value !== undefined) {
      document.title = brand.value
    }
  })

  addEventListener(
    'pagehide',
    () => {
      controller.abort()
      stopDocumentSync()
    },
    { once: true }
  )
  await loadUntilReady(controller.signal)
}
