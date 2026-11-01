import type { CredentialsResponse } from '@/app/server/wire/credentials'
import { type Credential, readCredentials } from '@/web/state/credentials'
import { type ConfigTree, isTree, readConfigTree, saveConfig } from '@/web/state/settings'
import { readText } from '@/web/text/fields'
import { toFailureText, tr } from '@/web/text/tr'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { CredentialRow, ServerOnlyNote } from '@/web/ui/settings/credentials/credential-row'
import { SettingRow, useDraft } from '@/web/ui/settings/row'

interface ToolsRead {
  readonly credentials: readonly Credential[]
  readonly webSearch: CredentialsResponse['webSearch']
  /** `[web_search] provider` as the file holds it, the running one when the file names none. */
  readonly provider: string
}

/** Công cụ: which provider searches the web, with its key, and the optional data source keys. */
export function ToolsSection({ reopen }: { readonly reopen: () => void }) {
  const read = useLoad(loadTools).value

  if (read.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (read.status === 'failed') {
    return <p class="failure-line">{toFailureText(read.failure)}</p>
  }

  const { credentials } = read.value
  const search = credentials.filter((credential) => credential.group === 'search')
  const sources = credentials.filter((credential) => credential.group === 'source')

  return (
    <>
      <ServerOnlyNote />
      <SearchRow read={read.value} />
      {search.map((credential) => (
        <CredentialRow key={credential.name} credential={credential} reopen={reopen} />
      ))}
      {sources.length > 0 && (
        <section class="setting-row">
          <h3 class="setting-title">{tr('ui.office.tools.sourceKeys')}</h3>
          {sources.map((credential) => (
            <CredentialRow key={credential.name} credential={credential} reopen={reopen} />
          ))}
          <p class="meta">{tr('ui.office.tools.sourceNote')}</p>
        </section>
      )}
    </>
  )
}

async function loadTools(signal: AbortSignal): Promise<ToolsRead> {
  const [{ credentials, webSearch }, tree] = await Promise.all([
    readCredentials(signal),
    readConfigTree(signal),
  ])
  const section = isTree(tree.web_search) ? tree.web_search : {}

  return { credentials, webSearch, provider: readText(section.provider) ?? webSearch.provider }
}

// The key row below reads the variable the running config names; a provider that needs another
// is refused by the daemon's check, with its sentence on this row.
function SearchRow({ read }: { readonly read: ToolsRead }) {
  const { draft, isChanged, markSaved } = useDraft(read.provider)

  return (
    <SettingRow
      title={tr('ui.office.tools.search')}
      timing="restart"
      isChanged={isChanged}
      onSave={async () => {
        await saveConfig((tree) => withSearchProvider(tree, draft.value), 'webSearch')
        markSaved()
      }}
    >
      <select
        aria-label={tr('ui.office.tools.searchProvider')}
        value={draft.value}
        onChange={(event) => {
          draft.value = event.currentTarget.value
        }}
      >
        {read.webSearch.providers.map((provider) => (
          <option key={provider} value={provider}>
            {provider}
          </option>
        ))}
      </select>
    </SettingRow>
  )
}

function withSearchProvider(tree: ConfigTree, provider: string): ConfigTree {
  const section = isTree(tree.web_search) ? tree.web_search : {}

  return { ...tree, web_search: { ...section, provider } }
}
