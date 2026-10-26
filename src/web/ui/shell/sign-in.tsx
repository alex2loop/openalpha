import { UNAUTHORIZED_STATUS } from '@/web/api/client'
import { type AuthState, authState } from '@/web/api/sign-in'
import { brand, sessionFailure } from '@/web/state/session'
import { toFailureText, tr } from '@/web/text/tr'
import { SignInIntro } from '@/web/ui/shell/sign-in-intro'

import './sign-in.css'

// The daemon's sign-in code lifetime, for the line that says why a used link stopped working.
const CODE_LIFETIME_MINUTES = 5

/** Shown while this browser holds no session: how to open the page, and why the last try failed. */
export function SignIn() {
  const failureText = resolveFailureText(authState.value)

  return (
    <div class="sign-in">
      <div class="sign-in-card">
        <SignInIntro>
          {failureText !== undefined && (
            <p class="sign-in-failure" role="alert">
              {failureText}
            </p>
          )}
        </SignInIntro>
      </div>
    </div>
  )
}

// A load that failed for another reason than a 401 (a timeout, a restart) says so first.
function resolveFailureText(auth: AuthState): string | undefined {
  const failure = sessionFailure.value
  // The CLI binary is the product name in lower case.
  const command = (brand.value ?? '').toLowerCase()

  if (failure !== undefined && failure.status !== UNAUTHORIZED_STATUS) {
    return toFailureText(failure)
  }

  switch (auth) {
    case 'code-refused':
      return tr('ui.office.signIn.codeRefused', { minutes: CODE_LIFETIME_MINUTES })
    case 'cookie-blocked':
      return tr('ui.office.signIn.cookieBlocked', { brand: command })
    case 'ended':
      return tr('ui.office.signIn.ended', { brand: command })
    case 'ok':
    case 'signed-out':
      return undefined
  }
}
