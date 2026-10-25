import { effect } from '@preact/signals'
import { render } from 'preact'

import { takeTokenFromHash } from '@/web/api/token'
import { brand, loadBrand, loadSession, locale } from '@/web/state/session'
import { App } from '@/web/ui/shell/app'

const ROOT_ID = 'root'

// First, before anything can read or log the address: the token leaves the URL at once.
takeTokenFromHash()

const root = document.getElementById(ROOT_ID)

if (root !== null) {
  await startPage(root)
}

async function startPage(container: HTMLElement): Promise<void> {
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
  render(<App />, container)
  await Promise.all([loadBrand(controller.signal), loadSession(controller.signal)])
}
