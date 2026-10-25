import type { TargetedSubmitEvent } from 'preact'
import { useSignal } from '@preact/signals'
import { useEffect, useMemo } from 'preact/hooks'

import { authState, saveToken } from '@/web/api/token'
import { loadSession, sessionFailure } from '@/web/state/session'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { SignInFields } from '@/web/ui/shell/sign-in-fields'
import { SignInIntro } from '@/web/ui/shell/sign-in-intro'

import './sign-in.css'

const FAILURE_LINE_ID = 'sign-in-failure'

/** Shown while there is no accepted token. The token is saved before the session load that tests
 *  it, so the request carries it; a refusal clears it again. */
export function SignIn() {
  const token = useSignal('')
  const remember = useSignal(true)
  const isBusy = useSignal(false)
  const controller = useMemo(() => new AbortController(), [])
  const failureText = resolveFailureText()

  useEffect(() => () => controller.abort(), [controller])

  function submit(event: TargetedSubmitEvent<HTMLFormElement>): void {
    event.preventDefault()
    const value = token.value.trim()

    if (value === '' || isBusy.value) {
      return
    }

    isBusy.value = true
    saveToken(value, { remember: remember.value })
    loadSession(controller.signal).finally(() => {
      isBusy.value = false
    })
  }

  return (
    <div class="sign-in">
      <form class="sign-in-card" onSubmit={submit}>
        <SignInIntro />
        <SignInFields
          token={token}
          remember={remember}
          describedBy={failureText === undefined ? undefined : FAILURE_LINE_ID}
        />
        {failureText !== undefined && (
          <p id={FAILURE_LINE_ID} class="sign-in-failure" role="alert">
            {failureText}
          </p>
        )}
        <Button kind="commit" type="submit" disabled={isBusy.value}>
          {tr('ui.office.signIn.open')}
        </Button>
        <p class="sign-in-note">{tr('ui.office.signIn.note')}</p>
      </form>
    </div>
  )
}

// The latest attempt wins: a timeout after a refusal shows the timeout, not "not accepted".
function resolveFailureText(): string | undefined {
  const failure = sessionFailure.value

  if (failure !== undefined && failure.code !== 'unauthorized') {
    return toFailureText(failure)
  }

  return authState.value === 'refused' ? tr('ui.office.signIn.refused') : undefined
}
