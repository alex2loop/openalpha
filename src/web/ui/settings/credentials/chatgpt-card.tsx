import { type Signal, signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { ChatgptAuthStatus } from '@/app/server/wire/sign-in'
import { isServerOnly, signOutChatgpt, watchChatgptSignIn } from '@/web/state/credentials'
import { joinInline } from '@/web/text/glyphs'
import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { CopyButton } from '@/web/ui/kit/copy-button'
import { openModal } from '@/web/ui/kit/modal'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { buildServerCommand } from '@/web/ui/settings/credentials/credential-row'

const AUTH_LOGIN_COMMAND = 'auth login'

type SignInView =
  | { readonly kind: 'starting' }
  | { readonly kind: 'waiting'; readonly code: string; readonly url: string }
  | { readonly kind: 'ended'; readonly text: string; readonly isFailure: boolean }

interface SignInRequest {
  /** The catalog's name for the provider, as the CLI's sign-in line names it. */
  readonly providerName: string
  /** Where the dialog returns, Cài đặt when it opened it. */
  readonly onBack: () => void
}

interface ChatgptCardProps extends SignInRequest {
  readonly status: ChatgptAuthStatus
}

/** The ChatGPT account the daemon signs in with, in place of a key: who, on which plan, and how to
 *  sign out; or how to sign in. */
export function ChatgptCard({ status, providerName, onBack }: ChatgptCardProps) {
  if (status.signedIn) {
    return (
      <div class="setting-job credential-row">
        <div class="setting-actions">
          <b>
            {joinInline([status.account ?? '', status.plan ?? ''].filter((part) => part !== ''))}
          </b>
          <Button size="small" kind="destructive" onClick={() => askSignOut(onBack)}>
            {tr('ui.office.chatgpt.signOut')}
          </Button>
        </div>
      </div>
    )
  }

  if (isServerOnly.value) {
    const command = buildServerCommand(AUTH_LOGIN_COMMAND)

    return (
      <div class="setting-actions">
        <code class="credential-command">{command}</code>
        <CopyButton text={command} label={tr('ui.office.credentials.copy')} />
      </div>
    )
  }

  return (
    <div class="setting-actions">
      <p class="meta">{tr('ui.office.chatgpt.signInNote')}</p>
      <Button size="small" onClick={() => openChatgptSignIn({ providerName, onBack })}>
        {tr('ui.office.chatgpt.signIn')}
      </Button>
    </div>
  )
}

function askSignOut(onBack: () => void): void {
  askConfirm({
    title: tr('ui.office.chatgpt.signOut'),
    lines: [tr('ui.office.chatgpt.signOutAsk')],
    confirmLabel: tr('ui.office.chatgpt.signOut'),
    isDestructive: true,
    onBack,
    confirm: signOutChatgpt,
  })
}

/** The device-code sign-in, which works wherever the daemon runs. Closing the dialog, Hủy
 *  included, stops asking; the daemon's own sign-in runs out on its timeout. */
export function openChatgptSignIn(request: SignInRequest): void {
  const view = signal<SignInView>({ kind: 'starting' })

  openModal({
    title: tr('ui.office.chatgpt.signIn'),
    body: <SignInBody view={view} providerName={request.providerName} />,
    footer: <SignInFooter view={view} onBack={request.onBack} />,
  })
}

function SignInFooter({
  view,
  onBack,
}: {
  readonly view: Signal<SignInView>
  readonly onBack: () => void
}) {
  const isEnded = view.value.kind === 'ended'

  return (
    <Button onClick={onBack}>
      {tr(isEnded ? 'ui.office.settings.toSettings' : 'ui.office.common.cancel')}
    </Button>
  )
}

function SignInBody({
  view,
  providerName,
}: {
  readonly view: Signal<SignInView>
  readonly providerName: string
}) {
  // The watch lives as long as the dialog: a close or a replacing dialog stops it.
  useEffect(
    () =>
      watchChatgptSignIn({
        onStatus: (status) => {
          view.value = toSignInView(status, providerName)
        },
        onFailure: (error) => {
          view.value = { kind: 'ended', text: toErrorText(error), isFailure: true }
        },
      }),
    []
  )

  const current = view.value

  if (current.kind === 'starting') {
    return <Skeleton lines={2} />
  }

  if (current.kind === 'ended') {
    return (
      <p class={current.isFailure ? 'failure-line' : ''} role="status">
        {current.text}
      </p>
    )
  }

  return (
    <>
      <p>{tr('ui.office.chatgpt.code', { code: current.code, url: current.url })}</p>
      <div class="setting-actions">
        <CopyButton text={current.code} label={tr('ui.office.credentials.copy')} />
        <a
          class="btn btn-secondary btn-small"
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {tr('ui.office.chatgpt.openPage')}
        </a>
      </div>
      <p class="meta">{tr('ui.office.chatgpt.waiting')}</p>
    </>
  )
}

function toSignInView(status: ChatgptAuthStatus, providerName: string): SignInView {
  const { login } = status

  if (login?.state === 'waiting' && login.method === 'device') {
    return { kind: 'waiting', code: login.userCode, url: login.verificationUrl }
  }

  if (login?.state === 'failed') {
    const reason =
      login.reason === 'timeout' ? tr('ui.office.chatgpt.expired') : tr('ui.office.error.generic')

    return { kind: 'ended', text: tr('cli.authLoginFailed', { reason }), isFailure: true }
  }

  if (login === undefined && status.signedIn) {
    return {
      kind: 'ended',
      text: tr('cli.authLoginSuccess', {
        provider: providerName,
        account: status.account ?? '',
        plan: status.plan ?? '',
      }),
      isFailure: false,
    }
  }

  return login === undefined
    ? { kind: 'ended', text: tr('ui.office.error.generic'), isFailure: true }
    : { kind: 'starting' }
}
