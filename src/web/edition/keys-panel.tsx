import { type Signal, useSignal } from '@preact/signals'

import { openConsentDialog } from '@/web/edition/consent-dialog'
import { InstallLine } from '@/web/edition/install-line'
import {
  consentGiven,
  consentId,
  forgetKey,
  heldKeys,
  holdKey,
  type KeySlot,
  SLOT_PROVIDERS,
} from '@/web/edition/keys-store'
import { beginOpenRouterConnect } from '@/web/edition/openrouter-oauth'
import { providerInfo } from '@/web/edition/providers'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { openModal } from '@/web/ui/kit/modal'
import { ActionRow } from '@/web/ui/settings/row'

/** OpenRouter sent the visitor back without a key: say so and point to pasting one. */
export function openConnectFailed(): void {
  const handle = openModal({
    title: tr('ui.office.edition.keys.connect'),
    body: <p>{tr('ui.office.edition.keys.connectFailed')}</p>,
    footer: <Button onClick={() => handle.close()}>{tr('ui.office.common.close')}</Button>,
  })
}

const SLOTS: readonly KeySlot[] = ['ai', 'search']
const OPENROUTER = 'openrouter'

/** Key AI và tìm kiếm: one key for the AI provider and one for web search. Each is its own field
 *  because DeepSeek's AI key and its search key are different keys. A key is sent to its provider
 *  only after the visitor agreed to that provider, and "Xoá key" takes the key and the agreement. */
export function KeysPanel() {
  return (
    <>
      <p class="meta">{tr('ui.office.edition.keys.intro')}</p>
      {SLOTS.map((slot) => (
        <SlotRow key={slot} slot={slot} />
      ))}
      <ActionRow title={tr('ui.office.edition.keys.chatgptTitle')}>
        <InstallLine row="chatgpt-plan" />
      </ActionRow>
    </>
  )
}

function SlotRow({ slot }: { readonly slot: KeySlot }) {
  const entry = heldKeys.value[slot]

  return (
    <ActionRow
      title={tr(`ui.office.edition.keys.${slot}.title`)}
      note={tr(`ui.office.edition.keys.${slot}.note`)}
    >
      {entry !== undefined && <HeldKey slot={slot} provider={entry.provider} />}
      <KeyForm slot={slot} isReplacing={entry !== undefined} />
    </ActionRow>
  )
}

function HeldKey({ slot, provider }: { readonly slot: KeySlot; readonly provider: string }) {
  const info = providerInfo(slot, provider)
  const isAgreed = consentGiven.value[consentId(slot, provider)] !== undefined

  return (
    <div class="key-held">
      <p>{tr('ui.office.edition.keys.held', { provider: info.name })}</p>
      {!isAgreed && (
        <p class="strip is-caution">
          {tr('ui.office.edition.keys.unsent')}{' '}
          <Button size="small" onClick={() => openConsentDialog(slot, provider)}>
            {tr('ui.office.edition.keys.review')}
          </Button>
        </p>
      )}
      <Button
        size="small"
        kind="destructive"
        onClick={() =>
          askConfirm({
            title: tr('ui.office.edition.keys.removeAsk', { provider: info.name }),
            lines: [tr('ui.office.edition.keys.removeBody', { provider: info.name })],
            confirmLabel: tr('ui.office.edition.keys.remove'),
            isDestructive: true,
            keepLabel: tr('ui.office.edition.common.keep'),
            confirm: () => forgetKey(slot),
          })
        }
      >
        {tr('ui.office.edition.keys.remove')}
      </Button>
    </div>
  )
}

interface KeyDraft {
  readonly provider: Signal<string>
  readonly text: Signal<string>
  readonly isRemembered: Signal<boolean>
}

function KeyForm({ slot, isReplacing }: { readonly slot: KeySlot; readonly isReplacing: boolean }) {
  const draft: KeyDraft = {
    provider: useSignal<string>(SLOT_PROVIDERS[slot][0]),
    text: useSignal(''),
    isRemembered: useSignal(false),
  }

  return (
    <div class="key-form">
      {slot === 'ai' && draft.provider.value === OPENROUTER && <ConnectRow />}
      <KeyFields slot={slot} draft={draft} />
      <label>
        <input
          type="checkbox"
          checked={draft.isRemembered.value}
          onChange={(event) => {
            draft.isRemembered.value = event.currentTarget.checked
          }}
        />
        {tr('ui.office.edition.keys.remember')}
      </label>
      <p class="meta">{tr('ui.office.edition.keys.rememberNote')}</p>
      <SaveRow slot={slot} draft={draft} isReplacing={isReplacing} />
    </div>
  )
}

function ConnectRow() {
  return (
    <div class="setting-actions">
      <Button
        size="small"
        kind="ai"
        onClick={() => beginOpenRouterConnect().catch(() => undefined)}
      >
        {tr('ui.office.edition.keys.connect')}
      </Button>
      <span class="meta">{tr('ui.office.edition.keys.connectNote')}</span>
    </div>
  )
}

function KeyFields({ slot, draft }: { readonly slot: KeySlot; readonly draft: KeyDraft }) {
  return (
    <div class="setting-controls">
      <select
        aria-label={tr('ui.office.edition.keys.provider')}
        value={draft.provider.value}
        onChange={(event) => {
          draft.provider.value = event.currentTarget.value
        }}
      >
        {SLOT_PROVIDERS[slot].map((id) => (
          <option key={id} value={id}>
            {providerInfo(slot, id).name}
          </option>
        ))}
      </select>
      <input
        type="password"
        autocomplete="off"
        spellcheck={false}
        aria-label={tr('ui.office.edition.keys.field')}
        placeholder={tr('ui.office.edition.keys.field')}
        value={draft.text.value}
        onInput={(event) => {
          draft.text.value = event.currentTarget.value
        }}
      />
    </div>
  )
}

interface SaveRowProps {
  readonly slot: KeySlot
  readonly draft: KeyDraft
  readonly isReplacing: boolean
}

function SaveRow({ slot, draft, isReplacing }: SaveRowProps) {
  const info = providerInfo(slot, draft.provider.value)

  function save(): void {
    const key = draft.text.value.trim()
    const provider = draft.provider.value

    if (key === '') {
      return
    }

    holdKey(slot, { provider, key, remembered: draft.isRemembered.value })
    draft.text.value = ''

    if (consentGiven.value[consentId(slot, provider)] === undefined) {
      openConsentDialog(slot, provider)
    }
  }

  return (
    <div class="setting-actions">
      <Button size="small" kind="commit" disabled={draft.text.value.trim() === ''} onClick={save}>
        {tr(isReplacing ? 'ui.office.edition.keys.replace' : 'ui.office.edition.keys.save')}
      </Button>
      <a href={info.keyUrl} target="_blank" rel="noopener noreferrer">
        {tr('ui.office.edition.keys.get', { provider: info.name })}
      </a>
    </div>
  )
}
