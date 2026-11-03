import { grantConsent, type KeySlot } from '@/web/edition/keys-store'
import { providerInfo } from '@/web/edition/providers'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

/** The notice before the first send to a provider: what leaves this device, to whom, and the one
 *  button that agrees. Nothing is sent to the provider until it is pressed, and each provider and
 *  each kind of key (AI, search) is its own agreement. */
export function openConsentDialog(slot: KeySlot, provider: string): void {
  const info = providerInfo(slot, provider)
  const params = { provider: info.name }
  let handle: ModalHandle | undefined

  handle = openModal({
    title: tr('ui.office.edition.consent.title', params),
    body: (
      <>
        <p>
          {tr(
            slot === 'ai'
              ? 'ui.office.edition.consent.whatAi'
              : 'ui.office.edition.consent.whatSearch',
            params
          )}
        </p>
        <p class="meta">{tr('ui.office.edition.consent.where', params)}</p>
        <p class="meta">
          <a href={info.policyUrl} target="_blank" rel="noopener noreferrer">
            {tr('ui.office.edition.consent.policy', params)}
          </a>
        </p>
        <p class="meta">{tr('ui.office.edition.consent.withdraw')}</p>
      </>
    ),
    footer: (
      <>
        <Button
          kind="commit"
          onClick={() => {
            grantConsent(slot, provider)
            handle?.close()
          }}
        >
          {tr('ui.office.edition.consent.agree', params)}
        </Button>
        <Button onClick={() => handle?.close()}>{tr('ui.office.edition.consent.decline')}</Button>
      </>
    ),
  })
}
