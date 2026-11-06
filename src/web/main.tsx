import { readCodeFromHash } from '@/web/api/sign-in'
import { bootOffice, canRunPage, renderPage } from '@/web/boot'
import { CHAT_TAB_PARAM, setChatOnly } from '@/web/state/pane'
import { removeStorage } from '@/web/state/storage'
import { App } from '@/web/ui/shell/app'

// An older page kept the API token under this key; it must not linger in this browser.
const RETIRED_TOKEN_KEY = 'office.token'

if (canRunPage()) {
  removeStorage('local', RETIRED_TOKEN_KEY)
  removeStorage('session', RETIRED_TOKEN_KEY)

  // Before anything can read or log the address: the code leaves the URL once the daemon answers it.
  const code = readCodeFromHash()
  const chatTab = new URLSearchParams(location.search).get(CHAT_TAB_PARAM) ?? undefined

  if (chatTab !== undefined) {
    setChatOnly()
  }

  renderPage(<App />)
  bootOffice({
    ...(code === undefined ? {} : { code }),
    ...(chatTab === undefined ? {} : { chatTab }),
  })
}
