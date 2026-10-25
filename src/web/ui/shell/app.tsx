import { authState } from '@/web/api/token'
import { brand, isStarting, isUnreachable, sessionFailure, state } from '@/web/state/session'
import { toFailureText, tr } from '@/web/text/tr'
import { Header } from '@/web/ui/shell/header'
import { Panes } from '@/web/ui/shell/panes'
import { SignIn } from '@/web/ui/shell/sign-in'
import { StatusLine } from '@/web/ui/shell/status-line'

import './app.css'

/** The page grid (header | main | command bar slot), behind the loading, failure and sign-in
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
    <div class="app">
      <Header />
      <Panes />
      <footer class="command-bar glass" />
    </div>
  )
}
