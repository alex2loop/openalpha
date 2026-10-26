import { authState } from '@/web/api/sign-in'
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
import { CommandBar } from '@/web/ui/command/command-bar'
import { ModalHost } from '@/web/ui/kit/modal'
import { ReaderHost } from '@/web/ui/reader/reader'
import { Header } from '@/web/ui/shell/header'
import { OfflineBar } from '@/web/ui/shell/offline-bar'
import { PaneBar } from '@/web/ui/shell/pane-bar'
import { Panes } from '@/web/ui/shell/panes'
import { SignIn } from '@/web/ui/shell/sign-in'
import { StatusLine } from '@/web/ui/shell/status-line'
import { Tape } from '@/web/ui/tape/tape'

import './app.css'

/** The page grid (header | pane bar when narrow | tape | main | command bar), behind the loading,
 *  failure and sign-in screens. A loaded session stays on screen when a later load fails. */
export function App() {
  if (isUnreachable.value) {
    return <StatusLine text={tr('ui.office.error.unreachable')} />
  }

  if (brand.value === undefined || isStarting.value) {
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

  return (
    <div class={connection.value.status === 'offline' ? 'app is-offline' : 'app'}>
      <SkipLink />
      <Header />
      <PaneBar />
      <Tape />
      <Panes />
      <OfflineBar />
      <CommandBar />
      <ModalHost />
      <ReaderHost />
      <Announcer />
    </div>
  )
}
