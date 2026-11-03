import { computed, effect, untracked } from '@preact/signals'

import { bootOffice, canRunPage, renderPage } from '@/web/boot'
import { openConsentDialog } from '@/web/edition/consent-dialog'
import { startDataStatus } from '@/web/edition/data-status'
import { startFileSave } from '@/web/edition/file-save'
import { EditionFooter } from '@/web/edition/guide/footer'
import { openConnectFailed } from '@/web/edition/keys-panel'
import { holdKey, OPENROUTER, workerKeys } from '@/web/edition/keys-store'
import { type ConnectResult, finishOpenRouterConnect } from '@/web/edition/openrouter-oauth'
import { Refused } from '@/web/edition/refused'
import { type EditionPhase, editionPhase, startEdition } from '@/web/edition/worker-link'
import { declareWebEdition } from '@/web/state/edition'
import { locale, state } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { ModalHost } from '@/web/ui/kit/modal'
import { openSettings } from '@/web/ui/settings/settings'
import { App } from '@/web/ui/shell/app'
import { StatusLine } from '@/web/ui/shell/status-line'

if (canRunPage()) {
  const lifetime = new AbortController()
  let pendingConnect: Promise<ConnectResult | undefined> | undefined = finishOpenRouterConnect(
    lifetime.signal
  )
  const stopEdition = startEdition(workerKeys)
  // Compared by value: a second `ready` after a restart must not boot the office twice.
  const phaseKind = computed(() => editionPhase.value.kind)

  declareWebEdition()
  // The page is announced in the language it shows, also before the office runs and when it refuses.
  effect(() => {
    document.documentElement.lang = locale.value
  })

  renderPage(<EditionShell />)
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
    const stopDataStatus = startDataStatus()
    const stopSave = startFileSave()

    return () => {
      stopSave()
      stopOffice()
      stopDataStatus()
      state.value = undefined
    }
  })
}

// The footer is under every phase, so its links work on a refusal and while the office loads. The
// office mounts its own dialog host once it has a session; until then the shell holds one.
function EditionShell() {
  const phase = editionPhase.value
  const isOfficeLoaded = phase.kind === 'ready' && state.value !== undefined

  return (
    <div class="edition-shell">
      <EditionApp phase={phase} />
      {!isOfficeLoaded && <ModalHost />}
      <EditionFooter />
    </div>
  )
}

function EditionApp({ phase }: { readonly phase: EditionPhase }) {
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
