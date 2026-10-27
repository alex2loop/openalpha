import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import {
  type Credential,
  isServerOnly,
  removeCredential,
  saveCredential,
} from '@/web/state/credentials'
import { brand } from '@/web/state/session'
import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { CopyButton } from '@/web/ui/kit/copy-button'
import { IDENTIFIER_INPUT } from '@/web/ui/kit/identifier-input'

import './credentials.css'

export const KEY_SET_COMMAND = 'key set'
export const RESTART_COMMAND = 'restart --background'

interface CredentialRowProps {
  readonly credential: Credential
  /** Brings Cài đặt back after the removal question. */
  readonly reopen: () => void
}

/** One key variable: whether the server holds it, Đổi to paste a new one, Bỏ to take it out. The
 *  value goes to the daemon once and is never read back. */
export function CredentialRow({ credential, reopen }: CredentialRowProps) {
  const isSaved = useSignal(false)
  const isEditing = useSignal(false)
  const { name } = credential
  const isSet = credential.set || isSaved.value

  if (isServerOnly.value) {
    return <ServerOnlyRow credential={credential} />
  }

  return (
    <div class="setting-job credential-row">
      <div class="setting-actions">
        <b class="mono">{name}</b>
        <StatePill isSet={isSet} fromShell={credential.fromShell} />
        {!isEditing.value && (
          <RowActions
            name={name}
            isSet={isSet}
            onChange={() => {
              isEditing.value = true
            }}
            reopen={reopen}
          />
        )}
      </div>
      {isEditing.value && (
        <KeyField
          name={name}
          onSaved={() => {
            isSaved.value = true
            isEditing.value = false
          }}
          onClose={() => {
            isEditing.value = false
          }}
        />
      )}
      <RowNotes name={name} isSaved={isSaved.value} winsOver={isSet && credential.fromShell} />
    </div>
  )
}

// What the operator should know after a save, and when the server's own environment wins over the
// saved key.
function RowNotes({
  name,
  isSaved,
  winsOver,
}: {
  readonly name: string
  readonly isSaved: boolean
  readonly winsOver: boolean
}) {
  return (
    <>
      {isSaved && <p class="meta">{tr('ui.office.credentials.saved')}</p>}
      {winsOver && <p class="meta">{tr('ui.office.credentials.fromShell', { name })}</p>}
    </>
  )
}

function RowActions({
  name,
  isSet,
  onChange,
  reopen,
}: {
  readonly name: string
  readonly isSet: boolean
  readonly onChange: () => void
  readonly reopen: () => void
}) {
  return (
    <>
      <Button size="small" onClick={onChange}>
        {tr('ui.office.credentials.change')}
      </Button>
      {isSet && (
        <Button size="small" kind="destructive" onClick={() => askRemove(name, reopen)}>
          {tr('ui.office.credentials.remove')}
        </Button>
      )}
    </>
  )
}

/** Over `public_url`: the command that sets the key on the server, never a field. */
function ServerOnlyRow({ credential }: { readonly credential: Credential }) {
  const command = buildServerCommand(`${KEY_SET_COMMAND} ${credential.name}`)

  return (
    <div class="setting-job credential-row">
      <div class="setting-actions">
        <b class="mono">{credential.name}</b>
        <StatePill isSet={credential.set} fromShell={credential.fromShell} />
      </div>
      <div class="setting-actions">
        <code class="credential-command">{command}</code>
        <CopyButton text={command} label={tr('ui.office.credentials.copy')} />
      </div>
    </div>
  )
}

/** Over `public_url`, once per section: keys change on the server, then the daemon restarts. */
export function ServerOnlyNote() {
  if (!isServerOnly.value) {
    return null
  }

  const command = buildServerCommand(RESTART_COMMAND)

  return (
    <div class="setting-job">
      <p class="meta">{tr('ui.office.credentials.exposed')}</p>
      <div class="setting-actions">
        <code class="credential-command">{command}</code>
        <CopyButton text={command} label={tr('ui.office.credentials.copy')} />
      </div>
    </div>
  )
}

/** A terminal command on the server, which the product's binary spells in lower case. */
export function buildServerCommand(words: string): string {
  return `${(brand.value ?? '').toLowerCase()} ${words}`
}

/** Saved in the key file, else from the server's environment, else missing. */
function StatePill({ isSet, fromShell }: { readonly isSet: boolean; readonly fromShell: boolean }) {
  if (isSet) {
    return <span class="level-pill is-ok">{tr('ui.office.credentials.set')}</span>
  }

  return fromShell ? (
    <span class="level-pill is-ok">{tr('ui.office.credentials.fromEnvironment')}</span>
  ) : (
    <span class="level-pill is-warn">{tr('ui.office.credentials.unset')}</span>
  )
}

function askRemove(name: string, reopen: () => void): void {
  askConfirm({
    title: tr('ui.office.credentials.remove'),
    lines: [tr('ui.office.credentials.removeAsk', { name })],
    confirmLabel: tr('ui.office.credentials.remove'),
    isDestructive: true,
    onBack: reopen,
    confirm: () => removeCredential(name, new AbortController().signal),
  })
}

interface KeyFieldProps {
  readonly name: string
  readonly onSaved: () => void
  readonly onClose: () => void
}

/** The pasted key lives only in this field: cleared when it is sent, and gone when it closes. */
function KeyField({ name, onSaved, onClose }: KeyFieldProps) {
  const { value, isBusy, failure, send } = useKeySend(name, onSaved)

  return (
    <>
      <div class="form-row">
        <input
          type="password"
          class="mono"
          autocomplete="off"
          {...IDENTIFIER_INPUT}
          aria-label={tr('ui.office.credentials.paste')}
          placeholder={tr('ui.office.credentials.paste')}
          value={value.value}
          onInput={(event) => {
            value.value = event.currentTarget.value
          }}
        />
        <Button kind="commit" disabled={isBusy.value || value.value === ''} onClick={send}>
          {tr('ui.office.common.save')}
        </Button>
        <Button disabled={isBusy.value} onClick={onClose}>
          {tr('ui.office.common.cancel')}
        </Button>
      </div>
      {failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value}
        </p>
      )}
    </>
  )
}

// One send at a time (the button is off until it answers), never retried; an unmount aborts it.
function useKeySend(name: string, onSaved: () => void) {
  const value = useSignal('')
  const isBusy = useSignal(false)
  const failure = useSignal<string | undefined>(undefined)
  const running = useRef<AbortController | undefined>(undefined)

  useEffect(
    () => () => {
      running.current?.abort()
      value.value = ''
    },
    []
  )

  function send(): void {
    const controller = new AbortController()
    const sent = value.value

    running.current = controller
    value.value = ''
    isBusy.value = true
    failure.value = undefined
    saveCredential(name, sent, controller.signal)
      .then(onSaved, (error: unknown) => {
        if (!controller.signal.aborted) {
          failure.value = toErrorText(error)
        }
      })
      .finally(() => {
        isBusy.value = false
      })
  }

  return { value, isBusy, failure, send }
}
