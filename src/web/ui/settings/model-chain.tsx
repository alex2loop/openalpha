import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { ProviderCatalogResponse } from '@/app/server/wire/config'
import { translateDisplayText } from '@/i18n'
import { getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { locale } from '@/web/state/session'
import { type ConfigTree, isTree, readConfigTree, saveConfig } from '@/web/state/settings'
import { readText } from '@/web/text/fields'
import { MS_PER_SECOND } from '@/web/text/time-units'
import { toErrorText, toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { SettingRow, useDraft } from '@/web/ui/settings/row'

// What a provider's own entry carries beyond its key variable; another provider leaves it behind.
const PROVIDER_BOUND_KEYS: ReadonlySet<string> = new Set([
  'base_url',
  'provider_sort',
  'provider_only',
  'provider_order',
  'provider_allow_fallbacks',
])

interface ChainRead {
  readonly entries: readonly ConfigTree[]
  readonly defaults: ConfigTree
  readonly catalog: ProviderCatalogResponse
}

/** One entry of the chain as the operator edits it: who serves it and which model. */
interface ModelChoice {
  readonly provider: string
  readonly model: string
}

type TestResult =
  | { readonly kind: 'ok'; readonly seconds: number }
  | { readonly kind: 'failed'; readonly reason: string }

/** Nhà cung cấp và model: the models the daemon tries in order. A change is written to the
 *  config file and applies when the daemon next starts. */
export function ModelChainRow() {
  const chain = useLoad(loadChain).value

  if (chain.status === 'loading') {
    return <Skeleton lines={2} />
  }

  if (chain.status === 'failed') {
    return <p class="failure-line">{toFailureText(chain.failure)}</p>
  }

  return <ChainEditor chain={chain.value} />
}

async function loadChain(signal: AbortSignal): Promise<ChainRead> {
  const [tree, catalog] = await Promise.all([
    readConfigTree(signal),
    getJson(ROUTES.providers, { signal }),
  ])
  const models = Array.isArray(tree.models) ? tree.models : []

  return {
    entries: models.filter(isTree),
    defaults: isTree(tree.model_defaults) ? tree.model_defaults : {},
    catalog,
  }
}

function ChainEditor({ chain }: { readonly chain: ChainRead }) {
  const { entries, defaults, catalog } = chain
  const { draft, isChanged, markSaved } = useDraft(
    entries.map((entry) => ({
      provider: readText(entry.provider) ?? readText(defaults.provider) ?? '',
      model: readText(entry.model) ?? '',
    }))
  )

  return (
    <SettingRow
      title={tr('ui.office.settings.models')}
      timing="restart"
      isChanged={isChanged}
      isReady={draft.value.every((choice) => choice.model.trim() !== '')}
      extra={<TestButton />}
      onSave={async () => {
        await saveConfig((tree) => withChoices(tree, draft.value, catalog), 'models')
        markSaved()
      }}
    >
      {draft.value.map((choice, index) => (
        <ChoiceLine
          // The chain is an ordered list of entries with no id of their own.
          key={index}
          index={index}
          choice={choice}
          draft={draft}
          catalog={catalog}
        />
      ))}
    </SettingRow>
  )
}

interface ChoiceLineProps {
  readonly index: number
  readonly choice: ModelChoice
  readonly draft: Signal<readonly ModelChoice[]>
  readonly catalog: ProviderCatalogResponse
}

function ChoiceLine({ index, choice, draft, catalog }: ChoiceLineProps) {
  const listId = `model-options-${index}`
  const providers = catalog.providers.some((entry) => entry.id === choice.provider)
    ? catalog.providers
    : [...catalog.providers, { id: choice.provider, displayName: choice.provider }]

  function edit(next: Partial<ModelChoice>): void {
    draft.value = draft.value.map((held, at) => (at === index ? { ...held, ...next } : held))
  }

  return (
    <div class="form-row">
      <select
        aria-label={tr('ui.office.settings.models')}
        value={choice.provider}
        onChange={(event) => edit({ provider: event.currentTarget.value })}
      >
        {providers.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.displayName}
          </option>
        ))}
      </select>
      <input
        type="text"
        class="mono"
        list={listId}
        aria-label={tr('ui.office.form.model')}
        value={choice.model}
        onInput={(event) => edit({ model: event.currentTarget.value })}
      />
      <datalist id={listId}>
        {catalog.catalogModels
          .filter((entry) => entry.provider === choice.provider)
          .map((entry) => (
            <option key={entry.model} value={entry.model} />
          ))}
      </datalist>
    </div>
  )
}

// The test goes through the model the daemon runs now, which a saved but unapplied change is not.
function TestButton() {
  const result = useSignal<TestResult | undefined>(undefined)
  const isBusy = useSignal(false)
  const running = useRef<AbortController | undefined>(undefined)

  useEffect(() => () => running.current?.abort(), [])

  return (
    <>
      <Button
        size="small"
        disabled={isBusy.value}
        onClick={() => runTest({ result, isBusy, running })}
      >
        {isBusy.value ? tr('ui.office.settings.testing') : tr('ui.office.settings.testModel')}
      </Button>
      {result.value !== undefined && <TestLine result={result.value} />}
    </>
  )
}

function TestLine({ result }: { readonly result: TestResult }) {
  return result.kind === 'ok' ? (
    <span class="meta">{tr('ui.office.settings.testOk', { seconds: result.seconds })}</span>
  ) : (
    <span class="failure-line">{tr('ui.office.settings.testFail', { reason: result.reason })}</span>
  )
}

interface TestState {
  readonly result: Signal<TestResult | undefined>
  readonly isBusy: Signal<boolean>
  readonly running: { current: AbortController | undefined }
}

function runTest({ result, isBusy, running }: TestState): void {
  const controller = new AbortController()
  const startedAt = performance.now()

  running.current?.abort()
  running.current = controller
  isBusy.value = true
  result.value = undefined
  sendJson('POST', ROUTES.providersTest, { body: {}, signal: controller.signal })
    .then(
      (answer) => {
        result.value = answer.ok
          ? {
              kind: 'ok',
              seconds: Math.max(1, Math.round((performance.now() - startedAt) / MS_PER_SECOND)),
            }
          : { kind: 'failed', reason: describeCode(answer.code) }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          result.value = { kind: 'failed', reason: toErrorText(error) }
        }
      }
    )
    .finally(() => {
      if (running.current === controller) {
        isBusy.value = false
      }
    })
}

// The provider's error class in words; one the catalog does not know prints as it is.
function describeCode(code: string): string {
  return translateDisplayText(locale.value, { key: `llmErrors.${code}`, fallback: code })
}

function withChoices(
  tree: ConfigTree,
  choices: readonly ModelChoice[],
  catalog: ProviderCatalogResponse
): ConfigTree {
  const defaults = isTree(tree.model_defaults) ? tree.model_defaults : {}
  const models = Array.isArray(tree.models) ? tree.models : []

  return {
    ...tree,
    models: models.map((entry: unknown, index) => {
      const choice = choices[index]

      return isTree(entry) && choice !== undefined
        ? withChoice(entry, choice, { defaults, catalog })
        : entry
    }),
  }
}

// Another provider than the entry serves today takes its key variable and leaves the old one's
// endpoint tuning behind; the same provider only changes the model. The key itself is never here.
function withChoice(
  entry: ConfigTree,
  choice: ModelChoice,
  {
    defaults,
    catalog,
  }: { readonly defaults: ConfigTree; readonly catalog: ProviderCatalogResponse }
): ConfigTree {
  const current = readText(entry.provider) ?? readText(defaults.provider)

  if (choice.provider === current) {
    return { ...entry, model: choice.model }
  }

  const kept = Object.entries(entry).filter(
    ([key]) => !PROVIDER_BOUND_KEYS.has(key) && key !== 'api_key_env'
  )
  const envVar = catalog.providers.find((provider) => provider.id === choice.provider)?.envVar

  return {
    ...Object.fromEntries(kept),
    provider: choice.provider,
    model: choice.model,
    ...(envVar === undefined || envVar === '' ? {} : { api_key_env: envVar }),
  }
}
