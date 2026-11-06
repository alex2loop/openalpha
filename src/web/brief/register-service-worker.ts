import { allowScriptUrl } from '@/web/brief/trusted-types'

/** The build writes the service worker at the app root under this name, so its scope is the app. */
const SERVICE_WORKER_URL = '/service-worker.js'

/** Registers the service worker once the page has loaded, so it never competes with the first
 *  paint. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return
  }

  allowScriptUrl(SERVICE_WORKER_URL)
  addEventListener(
    'load',
    () => {
      // The page works without it: a refused or failed registration only costs the offline copy.
      navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => undefined)
    },
    { once: true }
  )
}
