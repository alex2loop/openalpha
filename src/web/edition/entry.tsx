import { computed, effect, untracked } from '@preact/signals'

import { bootOffice, canRunPage, renderPage } from '@/web/boot'
import { openConsentDialog } from '@/web/edition/consent-dialog'
import { startFileSave } from '@/web/edition/file-save'
import { openConnectFailed } from '@/web/edition/keys-panel'
import { holdKey, workerKeys } from '@/web/edition/keys-store'
import { type ConnectResult, finishOpenRouterConnect } from '@/web/edition/openrouter-oauth'
import { Refused } from '@/web/edition/refused'
import { editionPhase, startEdition } from '@/web/edition/worker-link'
import { declareWebEdition } from '@/web/state/edition'
import { state } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { openSettings } from '@/web/ui/settings/settings'
import { App } from '@/web/ui/shell/app'
import { StatusLine } from '@/web/ui/shell/status-line'

const OPENROUTER = 'openrouter'

if (canRunPage()) {
  const lifetime = new AbortController()
  let pendingConnect: Promise<ConnectResult | undefined> | undefined = finishOpenRouterConnect(
    lifetime.signal
  )
  const stopEdition = startEdition(workerKeys)
  // Compared by value: a second `ready` after a restart must not boot the office twice.
  const phaseKind = computed(() => editionPhase.value.kind)

  declareWebEdition()

  renderPage(<EditionApp />)
  addEventListener(
    'pagehide',
    () => {
      lifetime.abort()
      stopEdition()
    },
    { once: true }
  )
  // The office runs while the worker serves it; a restart or a refusal ends it, and the next ready
  // starts it again over a fresh read of the session.
  effect(() => {
    if (phaseKind.value !== 'ready') {
      return undefined
    }

    const connect = pendingConnect

    pendingConnect = undefined
    connect?.then(showConnect).catch(() => undefined)

    const stopOffice = untracked(() => bootOffice({}))
    const stopSave = startFileSave()

    return () => {
      stopSave()
      stopOffice()
      state.value = undefined
    }
  })
}

function EditionApp() {
  const phase = editionPhase.value

  switch (phase.kind) {
    case 'starting':
      return <StatusLine text={tr('ui.office.loading')} />
    case 'restarting':
      return <StatusLine text={tr('ui.office.edition.restarting')} />
    case 'refused':
      return <Refused reason={phase.reason} />
    case 'ready':
      return <App />
  }
}

// A key OpenRouter handed over is held in this page's memory and sent to nobody until the visitor
// agrees to it.
function showConnect(result: ConnectResult | undefined): void {
  if (result === undefined) {
    return
  }

  if ('failed' in result) {
    openConnectFailed()

    return
  }

  holdKey('ai', { provider: OPENROUTER, key: result.key, remembered: false })
  openSettings('providers')
  openConsentDialog('ai', OPENROUTER)
}
