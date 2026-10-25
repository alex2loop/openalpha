import { authState } from '@/web/api/token'
import {
  brand,
  connection,
  isStarting,
  isUnreachable,
  sessionFailure,
  state,
} from '@/web/state/session'
import { toFailureText, tr } from '@/web/text/tr'
import { CommandBar } from '@/web/ui/command/command-bar'
import { ModalHost } from '@/web/ui/kit/modal'
import { Header } from '@/web/ui/shell/header'
import { OfflineBar } from '@/web/ui/shell/offline-bar'
import { Panes } from '@/web/ui/shell/panes'
import { SignIn } from '@/web/ui/shell/sign-in'
import { StatusLine } from '@/web/ui/shell/status-line'

import './app.css'

/** The page grid (header | main | command bar), behind the loading, failure and sign-in
 *  screens. A loaded session stays on screen when a later load fails. */
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
      <Header />
      <Panes />
      <OfflineBar />
      <CommandBar />
      <ModalHost />
    </div>
  )
}
