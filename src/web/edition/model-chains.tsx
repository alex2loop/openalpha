import type { ComponentChildren } from 'preact'
import { type Signal, signal } from '@preact/signals'
import { useMemo } from 'preact/hooks'

import type { ProviderCatalogResponse } from '@/app/server/wire/config'
import type { MessageKey } from '@/i18n'
import { getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { askRestart } from '@/web/edition/restart-confirm'
import { restartEngine } from '@/web/edition/worker-link'
import { isTree, readConfigTree } from '@/web/state/settings'
import { readText } from '@/web/text/fields'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Fold } from '@/web/ui/kit/fold'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { ChoiceLine, defaultModelOf, type ModelChoice } from '@/web/ui/settings/model-chain'
import { ActionRow, type SectionProps } from '@/web/ui/settings/row'

/** The tiers a visitor may give a model of their own, in the order the page lists them. The worker
 *  refuses any other. */
const TIERS = ['debate', 'research', 'research-heavy'] as const
/** Most models one chain may try in turn. */
const MAX_CHAIN = 3

type Tier = (typeof TIERS)[number]
type Chain = Signal<readonly ModelChoice[]>

interface Drafts {
  readonly main: Chain
  readonly tiers: Readonly<Record<Tier, Chain>>
}

const TIER_TITLES = Object.freeze({
  debate: 'ui.office.edition.tiers.debate',
  research: 'ui.office.edition.tiers.research',
  'research-heavy': 'ui.office.edition.tiers.researchHeavy',
} as const satisfies Record<Tier, MessageKey>)
const TIER_HINTS = Object.freeze({
  debate: 'ui.office.edition.tiers.debateHint',
  research: 'ui.office.edition.tiers.researchHint',
  'research-heavy': 'ui.office.edition.tiers.researchHeavyHint',
} as const satisfies Record<Tier, MessageKey>)

interface ModelsRead {
  readonly saved: {
    readonly main: readonly ModelChoice[]
    readonly tiers: Readonly<Record<Tier, readonly ModelChoice[]>>
  }
  readonly catalog: ProviderCatalogResponse
}

/** Mô hình AI: the main model every AI work runs on, and the tiers a visitor gave one of their own.
 *  The worker's engine reads them once when it starts, so a save asks first and then restarts it. */
export function ModelChains({ reopen }: SectionProps) {
  const loaded = useLoad(loadModels).value

  if (loaded.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (loaded.status === 'failed') {
    return <p class="failure-line">{toFailureText(loaded.failure)}</p>
  }

  return <ModelsEditor read={loaded.value} reopen={reopen} />
}

async function loadModels(abort: AbortSignal): Promise<ModelsRead> {
  const [tree, catalog] = await Promise.all([
    readConfigTree(abort),
    getJson(ROUTES.providers, { signal: abort }),
  ])
  const tiers = isTree(tree.model_tiers) ? tree.model_tiers : {}

  return {
    saved: {
      main: toChoices(tree.models),
      // Safe: `fromEntries` widens the keys to `string`; `TIERS` holds every key of the record.
      tiers: Object.fromEntries(
        TIERS.map((tier) => [tier, toChoices(tiers[tier])])
      ) as ModelsRead['saved']['tiers'],
    },
    catalog,
  }
}

function toChoices(entries: unknown): readonly ModelChoice[] {
  return Array.isArray(entries)
    ? entries.filter(isTree).map((entry) => ({
        provider: readText(entry.provider) ?? '',
        model: readText(entry.model) ?? '',
      }))
    : []
}

function ModelsEditor({ read, reopen }: SectionProps & { readonly read: ModelsRead }) {
  const drafts = useMemo(() => toDrafts(read.saved), [])
  const savedBody = useMemo(() => JSON.stringify(toBody(toDrafts(read.saved))), [])
  const chains = [drafts.main, ...TIERS.map((tier) => drafts.tiers[tier])]
  const isChanged = JSON.stringify(toBody(drafts)) !== savedBody
  const isReady =
    drafts.main.value.length > 0 &&
    chains.every((chain) =>
      chain.value.every((choice) => choice.provider !== '' && choice.model.trim() !== '')
    )

  return (
    <>
      <p class="meta">{tr('ui.office.edition.tiers.note')}</p>
      <ChainRow
        title={tr('ui.office.edition.tiers.main')}
        note={tr('ui.office.edition.tiers.mainHint')}
        draft={drafts.main}
        catalog={read.catalog}
      />
      <Fold title={tr('ui.office.edition.tiers.advanced')}>
        <p class="meta">{tr('ui.office.edition.tiers.advancedNote')}</p>
        {TIERS.map((tier) => (
          <TierRow key={tier} tier={tier} drafts={drafts} catalog={read.catalog} />
        ))}
      </Fold>
      <div class="setting-actions">
        <Button
          size="small"
          kind="commit"
          disabled={!(isChanged && isReady)}
          onClick={() => askToSave(drafts, reopen)}
        >
          {tr('ui.office.edition.tiers.save')}
        </Button>
      </div>
    </>
  )
}

function toDrafts(saved: ModelsRead['saved']): Drafts {
  return {
    main: signal(saved.main),
    // Safe: as above, `TIERS` holds every key of the record.
    tiers: Object.fromEntries(
      TIERS.map((tier) => [tier, signal(saved.tiers[tier])])
    ) as Drafts['tiers'],
  }
}

interface TierRowProps {
  readonly tier: Tier
  readonly drafts: Drafts
  readonly catalog: ProviderCatalogResponse
}

function TierRow({ tier, drafts, catalog }: TierRowProps) {
  const draft = drafts.tiers[tier]
  const title = tr(TIER_TITLES[tier])
  const note = tr(TIER_HINTS[tier])

  if (draft.value.length === 0) {
    return (
      <ActionRow title={title} note={note}>
        <p class="meta">{tr('ui.office.edition.tiers.inherits')}</p>
        <div class="setting-actions">
          <Button
            size="small"
            onClick={() => {
              draft.value = drafts.main.value
            }}
          >
            {tr('ui.office.edition.tiers.override')}
          </Button>
        </div>
      </ActionRow>
    )
  }

  return (
    <ChainRow title={title} note={note} draft={draft} catalog={catalog}>
      <Button
        size="small"
        onClick={() => {
          draft.value = []
        }}
      >
        {tr('ui.office.edition.tiers.clear')}
      </Button>
    </ChainRow>
  )
}

interface ChainRowProps {
  readonly title: string
  readonly note: string
  readonly draft: Chain
  readonly catalog: ProviderCatalogResponse
  readonly children?: ComponentChildren
}

function ChainRow({ title, note, draft, catalog, children }: ChainRowProps) {
  const [first] = catalog.providers

  return (
    <ActionRow title={title} note={note}>
      {draft.value.map((choice, index) => (
        // The chain is an ordered list of entries with no id of their own.
        <ChoiceLine key={index} index={index} choice={choice} draft={draft} catalog={catalog} />
      ))}
      <div class="setting-actions">
        {draft.value.length < MAX_CHAIN && first !== undefined && (
          <Button
            size="small"
            onClick={() => {
              draft.value = [
                ...draft.value,
                { provider: first.id, model: defaultModelOf(catalog, first.id) },
              ]
            }}
          >
            {tr('ui.office.edition.tiers.addFallback')}
          </Button>
        )}
        {draft.value.length > 1 && (
          <Button
            size="small"
            onClick={() => {
              draft.value = draft.value.slice(0, -1)
            }}
          >
            {tr('ui.office.edition.tiers.removeFallback')}
          </Button>
        )}
        {children}
      </div>
    </ActionRow>
  )
}

function toChain(chain: Chain): readonly { readonly provider: string; readonly model: string }[] {
  return chain.value.map(({ provider, model }) => ({ provider, model: model.trim() }))
}

/** What a save sends: the main chain, and only the tiers given a chain of their own. */
function toBody(drafts: Drafts) {
  return {
    models: toChain(drafts.main),
    model_tiers: Object.fromEntries(
      TIERS.filter((tier) => drafts.tiers[tier].value.length > 0).map((tier) => [
        tier,
        toChain(drafts.tiers[tier]),
      ])
    ),
  }
}

// The page waits for the engine to come back after the restart.
function askToSave(drafts: Drafts, reopen: () => void): void {
  askRestart({
    confirmLabel: tr('ui.office.edition.tiers.confirm'),
    onBack: reopen,
    confirm: async () => {
      await sendJson('POST', ROUTES.configWrite, { body: toBody(drafts) })
      restartEngine()
    },
  })
}
