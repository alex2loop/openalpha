import type { Signal } from '@preact/signals'

import { tr } from '@/web/text/tr'

const TOKEN_FIELD_ID = 'sign-in-token'

interface SignInFieldsProps {
  readonly token: Signal<string>
  readonly remember: Signal<boolean>
  readonly describedBy: string | undefined
}

export function SignInFields({ token, remember, describedBy }: SignInFieldsProps) {
  return (
    <>
      <label class="sign-in-label" for={TOKEN_FIELD_ID}>
        {tr('ui.office.signIn.label')}
      </label>
      <input
        id={TOKEN_FIELD_ID}
        class="sign-in-field"
        type="password"
        autocomplete="off"
        placeholder={tr('ui.office.signIn.placeholder')}
        value={token}
        aria-describedby={describedBy}
        onInput={(event) => {
          token.value = event.currentTarget.value
        }}
      />
      <label class="sign-in-remember">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => {
            remember.value = event.currentTarget.checked
          }}
        />
        {tr('ui.office.signIn.remember')}
      </label>
    </>
  )
}
