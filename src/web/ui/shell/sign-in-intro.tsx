import type { ComponentChildren } from 'preact'

import { brand } from '@/web/state/session'
import { tr } from '@/web/text/tr'

/** `children` sit under the title, above the command they may point to. */
export function SignInIntro({ children }: { readonly children?: ComponentChildren }) {
  // The CLI binary is the product name in lower case.
  const command = tr('ui.office.signIn.command', { brand: (brand.value ?? '').toLowerCase() })

  return (
    <>
      <span class="logo sign-in-logo" aria-hidden="true" />
      <h1 class="sign-in-title">{tr('ui.office.signIn.title')}</h1>
      {children}
      <p class="sign-in-body">{tr('ui.office.signIn.body')}</p>
      <code class="sign-in-command mono">{command}</code>
    </>
  )
}
