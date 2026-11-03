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
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { ChoiceLine, defaultModelOf, type ModelChoice } from '@/web/ui/settings/model-chain'
import { ActionRow } from '@/web/ui/settings/row'

/** The tiers a visitor may change, in the order the page lists them. The worker refuses any other. */
const TIERS = ['debate', 'research', 'research-heavy', 'extraction'] as const
/** Most models one tier may try in turn. */
const MAX_CHAIN = 3

type Tier = (typeof TIERS)[number]
type Drafts = Readonly<Record<Tier, Signal<readonly ModelChoice[]>>>

const TIER_TITLES = Object.freeze({
  debate: 'ui.office.edition.tiers.debate',
  research: 'ui.office.edition.tiers.research',
  'research-heavy': 'ui.office.edition.tiers.researchHeavy',
  extraction: 'ui.office.edition.tiers.extraction',
} as const satisfies Record<Tier, MessageKey>)
const TIER_HINTS = Object.freeze({
  debate: 'ui.office.edition.tiers.debateHint',
  research: 'ui.office.edition.tiers.researchHint',
  'research-heavy': 'ui.office.edition.tiers.researchHeavyHint',
  extraction: 'ui.office.edition.tiers.extractionHint',
} as const satisfies Record<Tier, MessageKey>)

interface TiersRead {
  readonly saved: Readonly<Record<Tier, readonly ModelChoice[]>>
  readonly catalog: ProviderCatalogResponse
}

/** Hạng mô hình: the model each kind of AI work tries first, and the ones it falls back to. The
 *  worker's engine reads them once when it starts, so a save asks first and then restarts it. */
export function TierChain() {
  const loaded = useLoad(loadTiers).value

  if (loaded.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (loaded.status === 'failed') {
    return <p class="failure-line">{toFailureText(loaded.failure)}</p>
  }

  return <TierEditor read={loaded.value} />
}

async function loadTiers(abort: AbortSignal): Promise<TiersRead> {
  const [tree, catalog] = await Promise.all([
    readConfigTree(abort),
    getJson(ROUTES.providers, { signal: abort }),
  ])
  const tiers = isTree(tree.model_tiers) ? tree.model_tiers : {}

  // Safe: `fromEntries` widens the keys to `string`; `TIERS` holds every key of the record.
  return {
    saved: Object.fromEntries(
      TIERS.map((tier) => [tier, toChoices(tiers[tier])])
    ) as TiersRead['saved'],
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

function TierEditor({ read }: { readonly read: TiersRead }) {
  // Safe: as above, `TIERS` holds every key of `Drafts`.
  const drafts = useMemo(
    () => Object.fromEntries(TIERS.map((tier) => [tier, signal(read.saved[tier])])) as Drafts,
    []
  )
  const isChanged = TIERS.some(
    (tier) => JSON.stringify(drafts[tier].value) !== JSON.stringify(read.saved[tier])
  )
  const isReady = TIERS.every((tier) =>
    drafts[tier].value.every((choice) => choice.provider !== '' && choice.model.trim() !== '')
  )

  return (
    <>
      <p class="meta">{tr('ui.office.edition.tiers.note')}</p>
      {TIERS.map((tier) => (
        <TierRow key={tier} tier={tier} draft={drafts[tier]} catalog={read.catalog} />
      ))}
      <div class="setting-actions">
        <Button
          size="small"
          kind="commit"
          disabled={!(isChanged && isReady)}
          onClick={() => askToSave(drafts)}
        >
          {tr('ui.office.edition.tiers.save')}
        </Button>
      </div>
    </>
  )
}

interface TierRowProps {
  readonly tier: Tier
  readonly draft: Signal<readonly ModelChoice[]>
  readonly catalog: ProviderCatalogResponse
}

function TierRow({ tier, draft, catalog }: TierRowProps) {
  const [first] = catalog.providers

  return (
    <ActionRow title={tr(TIER_TITLES[tier])} note={tr(TIER_HINTS[tier])}>
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
      </div>
    </ActionRow>
  )
}

// The page waits for the engine to come back after the restart.
function askToSave(drafts: Drafts): void {
  askRestart({
    confirmLabel: tr('ui.office.edition.tiers.confirm'),
    confirm: async () => {
      const body = {
        model_tiers: Object.fromEntries(
          TIERS.map((tier) => [
            tier,
            drafts[tier].value.map(({ provider, model }) => ({ provider, model: model.trim() })),
          ])
        ),
      }

      await sendJson('POST', ROUTES.configWrite, { body })
      restartEngine()
    },
  })
}
