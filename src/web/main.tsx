import { computed, effect, untracked } from '@preact/signals'
import { render } from 'preact'

import { authState } from '@/web/api/auth-state'
import { takeCodeFromHash } from '@/web/api/sign-in'
import { disposeClock } from '@/web/scene/clock/clock'
import { startAgents } from '@/web/state/agents'
import { pageTitle, startAttention } from '@/web/state/attention'
import { disposeBreakpoints } from '@/web/state/breakpoints'
import { sessionTitleOf, startChat } from '@/web/state/chat'
import { openedSession, startChatHistory } from '@/web/state/chat-history'
import { startCost } from '@/web/state/cost'
import { startEstimates } from '@/web/state/estimates'
import { startFeed } from '@/web/state/feed'
import { startMarket } from '@/web/state/market'
import { startNotices } from '@/web/state/notices'
import { CHAT_TAB_PARAM, setChatOnly } from '@/web/state/pane'
import { disposePrefs } from '@/web/state/prefs'
import { startQuietCommands } from '@/web/state/quiet-command'
import { startRestartWatch } from '@/web/state/restart'
import { brand, loadUntilReady, locale, state } from '@/web/state/session'
import { removeStorage } from '@/web/state/storage'
import { startUpdate } from '@/web/state/update'
import { startAgentFormRequests } from '@/web/ui/agent/form/agent-form'
import { createKeyHandler } from '@/web/ui/keys/keys'
import { openKeysDialog } from '@/web/ui/keys/keys-dialog'
import { App } from '@/web/ui/shell/app'

const ROOT_ID = 'root'
// An older page kept the API token under this key; it must not linger in this browser.
const RETIRED_TOKEN_KEY = 'office.token'

/** `chatTab` is the session a tab opened for one chat (`?chat=`) shows. */
interface LiveOptions {
  readonly chatTab?: string
}

const root = document.getElementById(ROOT_ID)

// A source run serves the page through Bun's `routes`, which carry no headers, so the page itself
// refuses to run inside a frame: it renders nothing and never trades a sign-in code.
if (root !== null && window.top === window.self) {
  removeStorage('local', RETIRED_TOKEN_KEY)
  removeStorage('session', RETIRED_TOKEN_KEY)
  // Before anything can read or log the address: the code leaves the URL at once.
  const code = takeCodeFromHash()
  const chatTab = new URLSearchParams(location.search).get(CHAT_TAB_PARAM) ?? undefined

  if (chatTab !== undefined) {
    setChatOnly()
  }

  render(<App />, root)
  // A page restored from the back-forward cache has no socket, polls or loads left: start over.
  addEventListener('pageshow', (event) => (event.persisted ? location.reload() : undefined))
  boot(code, { ...(chatTab === undefined ? {} : { chatTab }) })
}

/** One page life, undone by one stop on `pagehide`: the feed runs while a session is signed in. */
function boot(code: string | undefined, options: LiveOptions): void {
  const controller = new AbortController()
  const isSignedIn = computed(() => authState.value === 'ok' && state.value !== undefined)
  const stopDocumentSync = effect(() => {
    const title = options.chatTab === undefined ? pageTitle.value : resolveChatTabTitle()

    document.documentElement.lang = locale.value

    if (title !== undefined && document.title !== title) {
      document.title = title
    }
  })
  const stopFeedSync = effect(() =>
    isSignedIn.value ? untracked(() => startLive(options)) : undefined
  )

  addEventListener(
    'pagehide',
    () => {
      controller.abort()
      stopDocumentSync()
      stopFeedSync()
      disposeClock()
      disposePrefs()
      disposeBreakpoints()
    },
    { once: true }
  )
  // Its loads catch their own failures into the session signals and its waits never reject.
  loadUntilReady(controller.signal, code).catch(() => undefined)
}

// A chat tab keeps its chat's name, not the count that needs the operator.
function resolveChatTabTitle(): string | undefined {
  const session = openedSession.value

  return session === undefined ? brand.value : sessionTitleOf(session)
}

// Untracked: what a start reads must never restart the feed when it changes. A chat tab starts only
// what its chat, its approvals and its title read.
function startLive({ chatTab }: LiveOptions): () => void {
  const stops = [
    startFeed(),
    startNotices(),
    startChat(),
    startQuietCommands(),
    startChatHistory(chatTab),
    startEstimates(),
    startAttention(),
    ...(chatTab === undefined ? startOffice() : []),
  ]

  return () => {
    for (const stop of stops) {
      stop()
    }
  }
}

function startOffice(): readonly (() => void)[] {
  return [
    startCost(),
    startAgents(),
    startAgentFormRequests(),
    startMarket(),
    startRestartWatch(),
    startUpdate(),
    createKeyHandler({ openList: openKeysDialog }),
  ]
}
