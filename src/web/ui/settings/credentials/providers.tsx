import type { ProviderCatalogResponse } from '@/app/server/wire/config'
import type { ChatgptAuthStatus } from '@/app/server/wire/sign-in'
import type { SettingsSection } from '@/web/state/settings'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import {
  type Credential,
  pickedProviders,
  readChatgpt,
  readCredentials,
} from '@/web/state/credentials'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { openAddProviderDialog } from '@/web/ui/settings/credentials/add-provider-dialog'
import { ChatgptCard } from '@/web/ui/settings/credentials/chatgpt-card'
import { CredentialRow, ServerOnlyNote } from '@/web/ui/settings/credentials/credential-row'
import { preselectModelProvider } from '@/web/ui/settings/model-chain'

/** The catalog provider that signs in with a ChatGPT account instead of taking a key. */
const CHATGPT_PROVIDER = 'openai-chatgpt'
const MODELS_SECTION: SettingsSection = 'agents'

type CatalogProvider = ProviderCatalogResponse['providers'][number]

interface ProvidersRead {
  readonly credentials: readonly Credential[]
  readonly catalog: ProviderCatalogResponse
  /** Providers a model of the running chain or a tier is served by. */
  readonly used: ReadonlySet<string>
  readonly chatgpt: ChatgptAuthStatus
}

interface ProvidersSectionProps {
  readonly reopen: () => void
  readonly openSection: (section: SettingsSection) => void
}

/** Nhà cung cấp: a card for each provider a model uses, whose key is saved, or that was just picked,
 *  with its key row or, for ChatGPT, the account. */
export function ProvidersSection(props: ProvidersSectionProps) {
  const read = useLoad(loadProviders).value

  if (read.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (read.status === 'failed') {
    return <p class="failure-line">{toFailureText(read.failure)}</p>
  }

  const { catalog } = read.value
  const chatgpt = catalog.providers.find((provider) => provider.id === CHATGPT_PROVIDER)

  return (
    <>
      <ServerOnlyNote />
      {catalog.providers
        .filter((provider) => isShown(provider, read.value))
        .map((provider) => (
          <ProviderCard key={provider.id} provider={provider} read={read.value} {...props} />
        ))}
      <div class="setting-actions">
        <Button
          size="small"
          onClick={() => openAddProviderDialog({ catalog, chatgpt, onBack: props.reopen })}
        >
          {tr('ui.office.providers.add')}
        </Button>
      </div>
    </>
  )
}

async function loadProviders(signal: AbortSignal): Promise<ProvidersRead> {
  const [{ credentials }, catalog, models, chatgpt] = await Promise.all([
    readCredentials(signal),
    getJson(ROUTES.providers, { signal }),
    getJson(ROUTES.models, { signal }),
    readChatgpt(signal),
  ])
  const used = models.tiers.flatMap((tier) => tier.models.map((model) => model.provider))

  return { credentials, catalog, used: new Set(used), chatgpt }
}

function isShown(provider: CatalogProvider, read: ProvidersRead): boolean {
  if (read.used.has(provider.id) || pickedProviders.value.includes(provider.id)) {
    return true
  }

  if (provider.id === CHATGPT_PROVIDER) {
    return read.chatgpt.signedIn
  }

  // A variable two providers share shows on the one it was listed for.
  const credential = credentialOf(provider, read)

  return credential?.subject === provider.id && credential.set
}

// The variable the config reads for the provider; else the one it shares by catalog default.
function credentialOf(provider: CatalogProvider, read: ProvidersRead): Credential | undefined {
  const providerRows = read.credentials.filter((credential) => credential.group === 'provider')

  return (
    providerRows.find((credential) => credential.subject === provider.id) ??
    providerRows.find((credential) => credential.name === provider.envVar)
  )
}

interface ProviderCardProps extends ProvidersSectionProps {
  readonly provider: CatalogProvider
  readonly read: ProvidersRead
}

function ProviderCard({ provider, read, reopen, openSection }: ProviderCardProps) {
  const credential = credentialOf(provider, read)

  return (
    <section class="setting-row">
      <h3 class="setting-title">{provider.displayName}</h3>
      {provider.id === CHATGPT_PROVIDER ? (
        <ChatgptCard status={read.chatgpt} providerName={provider.displayName} onBack={reopen} />
      ) : (
        credential !== undefined && <CredentialRow credential={credential} reopen={reopen} />
      )}
      {!read.used.has(provider.id) && (
        <div class="setting-actions">
          <p class="meta">{tr('ui.office.providers.noModel')}</p>
          <Button
            size="small"
            onClick={() => {
              preselectModelProvider(provider.id)
              openSection(MODELS_SECTION)
            }}
          >
            {tr('ui.office.providers.addModel')}
          </Button>
        </div>
      )}
    </section>
  )
}
