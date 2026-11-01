import { type Signal, useSignal } from '@preact/signals'

import type { ProviderCatalogResponse } from '@/app/server/wire/config'
import { isServerOnly, pickProvider } from '@/web/state/credentials'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { openModal } from '@/web/ui/kit/modal'
import { openChatgptSignIn } from '@/web/ui/settings/credentials/chatgpt-card'

const QUICK_PICKS = 3

type CatalogProvider = ProviderCatalogResponse['providers'][number]

interface AddProviderRequest {
  readonly catalog: ProviderCatalogResponse
  /** The provider whose card is the ChatGPT sign-in rather than a key. */
  readonly chatgpt: CatalogProvider | undefined
  /** Back to Cài đặt, where a picked provider shows its key row. */
  readonly onBack: () => void
}

/** + Thêm nhà cung cấp: the first providers of the catalog, the ChatGPT sign-in, or any other. */
export function openAddProviderDialog(request: AddProviderRequest): void {
  openModal({
    title: tr('ui.office.settings.providers'),
    body: <AddProviderBody request={request} />,
    footer: <Button onClick={request.onBack}>{tr('ui.office.settings.toSettings')}</Button>,
  })
}

function AddProviderBody({ request }: { readonly request: AddProviderRequest }) {
  const isListOpen = useSignal(false)
  const { chatgpt, onBack } = request
  const keyed = request.catalog.providers.filter((provider) => provider.envVar !== '')

  function choose(provider: string): void {
    pickProvider(provider)
    onBack()
  }

  return (
    <>
      <p>{tr('ui.office.providers.pickNote')}</p>
      <div class="dialog-choices">
        {keyed.slice(0, QUICK_PICKS).map((provider) => (
          <Button key={provider.id} onClick={() => choose(provider.id)}>
            {provider.displayName}
          </Button>
        ))}
        {chatgpt !== undefined && !isServerOnly.value && (
          <Button onClick={() => openChatgptSignIn({ providerName: chatgpt.displayName, onBack })}>
            {tr('ui.office.chatgpt.signIn')}
          </Button>
        )}
      </div>
      <ProviderList providers={keyed} isOpen={isListOpen} choose={choose} />
    </>
  )
}

function ProviderList({
  providers,
  isOpen,
  choose,
}: {
  readonly providers: readonly CatalogProvider[]
  readonly isOpen: Signal<boolean>
  readonly choose: (provider: string) => void
}) {
  if (!isOpen.value) {
    return (
      <Button
        kind="tertiary"
        onClick={() => {
          isOpen.value = true
        }}
      >
        {tr('ui.office.providers.other')}
      </Button>
    )
  }

  return (
    <select
      aria-label={tr('ui.office.providers.other')}
      value=""
      onChange={(event) => choose(event.currentTarget.value)}
    >
      <option value="" disabled>
        {tr('ui.office.providers.other')}
      </option>
      {providers.map((provider) => (
        <option key={provider.id} value={provider.id}>
          {provider.displayName}
        </option>
      ))}
    </select>
  )
}
