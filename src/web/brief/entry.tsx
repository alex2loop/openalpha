import { render } from 'preact'

import { App } from '@/web/brief/app'
import { registerServiceWorker } from '@/web/brief/register-service-worker'

const ROOT_ID = 'root'
const root = document.getElementById(ROOT_ID)

if (root !== null) {
  render(<App />, root)
  registerServiceWorker()
}
