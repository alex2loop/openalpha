import { computed, effect, untracked } from '@preact/signals'
import { type ComponentChild, render } from 'preact'

import { authState } from '@/web/api/auth-state'
import { disposeClock } from '@/web/scene/clock/clock'
import { startAgents } from '@/web/state/agents'
import { pageTitle, startAttention } from '@/web/state/attention'
import { disposeBreakpoints } from '@/web/state/breakpoints'
import { sessionTitleOf, startChat } from '@/web/state/chat'
import { openedSession, startChatHistory } from '@/web/state/chat-history'
import { startCost } from '@/web/state/cost'
import { isAnalysisOnly, offers } from '@/web/state/edition'
import { startEstimates } from '@/web/state/estimates'
import { startFeed } from '@/web/state/feed'
import { startFirstRun } from '@/web/state/first-run'
import { startMarket } from '@/web/state/market'
import { startNotices } from '@/web/state/notices'
import { disposePrefs } from '@/web/state/prefs'
import { startQuietCommands } from '@/web/state/quiet-command'
import { startRestartWatch } from '@/web/state/restart'
import { brand, loadUntilReady, locale, state } from '@/web/state/session'
import { startUpdate } from '@/web/state/update'
import { startAgentFormRequests } from '@/web/ui/agent/form/agent-form'
import { createKeyHandler } from '@/web/ui/keys/keys'
import { openKeysDialog } from '@/web/ui/keys/keys-dialog'

const ROOT_ID = 'root'

/** `chatTab` is the session a tab opened for one chat (`?chat=`) shows; `code` is the sign-in code
 *  the address carried. */
interface OfficeOptions {
  readonly chatTab?: string
  readonly code?: string
}

/** A source run serves the page through Bun's `routes`, which carry no headers, so the page itself
 *  refuses to run inside a frame: it renders nothing and never trades a sign-in code. */
export function canRunPage(): boolean {
  return document.getElementById(ROOT_ID) !== null && window.top === window.self
}

/** Renders `view` into the page's root; call it only where `canRunPage` is true. */
export function renderPage(view: ComponentChild): void {
  const root = document.getElementById(ROOT_ID)

  if (root === null) {
    return
  }

  render(view, root)
  // A page restored from the back-forward cache has no socket, polls or loads left: start over.
  addEventListener('pageshow', (event) => (event.persisted ? location.reload() : undefined))
}

/** One page life, undone by the returned stop or by `pagehide`: the feed runs while a session is
 *  signed in. A stop leaves the page-wide watchers (clock, preferences, breakpoints) running, so
 *  the same page can boot again; only `pagehide` ends those. */
export function bootOffice(options: OfficeOptions): () => void {
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

  function stop(): void {
    controller.abort()
    stopDocumentSync()
    stopFeedSync()
  }

  addEventListener(
    'pagehide',
    () => {
      stop()
      disposeClock()
      disposePrefs()
      disposeBreakpoints()
    },
    { once: true, signal: controller.signal }
  )
  // Its loads catch their own failures into the session signals and its waits never reject.
  loadUntilReady(controller.signal, options.code).catch(() => undefined)

  return stop
}

// A chat tab keeps its chat's name, not the count that needs the operator.
function resolveChatTabTitle(): string | undefined {
  const session = openedSession.value

  return session === undefined ? brand.value : sessionTitleOf(session)
}

// Untracked: what a start reads must never restart the feed when it changes. A chat tab starts only
// what its chat, its approvals and its title read. What an edition does not offer is not started.
function startLive({ chatTab }: OfficeOptions): () => void {
  const stops = [
    startFeed(),
    ...(offers('schedules') ? [startNotices()] : []),
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
    startFirstRun(),
    ...(offers('agents') ? [startAgents(), startAgentFormRequests()] : []),
    startMarket(),
    ...(isAnalysisOnly.value ? [] : [startRestartWatch(), startUpdate()]),
    createKeyHandler({ openList: openKeysDialog }),
  ]
}
