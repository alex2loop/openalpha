import { authState } from '@/web/api/auth-state'
import { isChatOnly } from '@/web/state/pane'
import {
  brand,
  connection,
  isStarting,
  isUnreachable,
  sessionFailure,
  state,
} from '@/web/state/session'
import { toFailureText, tr } from '@/web/text/tr'
import { Announcer } from '@/web/ui/a11y/announcer'
import { SkipLink } from '@/web/ui/a11y/skip-link'
import { ChatPanel } from '@/web/ui/chat/chat-panel'
import { CommandBar } from '@/web/ui/command/command-bar'
import { ModalHost } from '@/web/ui/kit/modal'
import { UndoBar } from '@/web/ui/kit/undo-bar'
import { ReaderHost } from '@/web/ui/reader/reader'
import { Header } from '@/web/ui/shell/header'
import { OfflineBar } from '@/web/ui/shell/offline-bar'
import { PaneBar } from '@/web/ui/shell/pane-bar'
import { isCommandBarFloating, Panes } from '@/web/ui/shell/panes'
import { SignIn } from '@/web/ui/shell/sign-in'
import { StatusLine } from '@/web/ui/shell/status-line'

import './app.css'

/** The page grid (header | pane bar when narrow | main | command bar unless it floats over main),
 *  behind the loading, starting, failure and sign-in screens. A loaded session stays on screen when a later
 *  load fails. A chat tab is its chat pane and the command bar alone: no scene, panel or header
 *  mounts. */
export function App() {
  if (isUnreachable.value) {
    return <StatusLine text={tr('ui.office.error.unreachable')} />
  }

  if (isStarting.value) {
    return <StatusLine text={tr('ui.office.starting')} />
  }

  if (brand.value === undefined) {
    return <StatusLine text={tr('ui.office.loading')} />
  }

  if (authState.value !== 'ok') {
    return <SignIn />
  }

  if (state.value === undefined) {
    const failure = sessionFailure.value

    return (
      <StatusLine text={failure === undefined ? tr('ui.office.loading') : toFailureText(failure)} />
    )
  }

  const { status } = connection.value
  const appClass = status === 'offline' || status === 'full' ? 'app is-offline' : 'app'

  if (isChatOnly.value) {
    return (
      <div class={`${appClass} is-chat-only`}>
        <main class="panes" data-pane="chat">
          <ChatPanel />
        </main>
        <PageBottom hasCommandBar />
      </div>
    )
  }

  return (
    <div class={appClass}>
      <SkipLink />
      <Header />
      <PaneBar />
      <Panes />
      <PageBottom hasCommandBar={!isCommandBarFloating.value} />
    </div>
  )
}

// What every page keeps: the hosts that float over the panes, and the box to type in while it does
// not float over them.
function PageBottom({ hasCommandBar }: { readonly hasCommandBar: boolean }) {
  return (
    <>
      <div class="bottom-stack">
        <OfflineBar />
        <UndoBar />
      </div>
      {hasCommandBar && <CommandBar />}
      <ModalHost />
      <ReaderHost />
      <Announcer />
    </>
  )
}
