import type { AgentForm } from '@/web/ui/agent/form/form-state'
import { loadToolTiers } from '@/web/state/agents'
import { formatUsd } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { toFailureText, tr } from '@/web/text/tr'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { useLoad } from '@/web/ui/kit/use-load'

// The option that runs on the primary model.
const DEFAULT_TIER = ''

interface TierOption {
  readonly tier: string
  readonly label: string
}

/** "Model": the primary as "Mặc định", then each configured tier whose every model can call tools,
 *  with the model it tries first and what a run there has cost. Models are set in config, never here. */
export function ModelSelect({ form }: { readonly form: AgentForm }) {
  const tiers = useLoad(loadToolTiers).value
  const options = tiers.status === 'ready' ? tiers.value.map(toOption) : []
  const current = form.modelTier.value
  // A tier the list does not hold yet (still loading, or no longer offered) stays selectable.
  const isListed = current === DEFAULT_TIER || options.some((option) => option.tier === current)

  return (
    <label class="form-field form-label">
      {tr('ui.office.form.model')}
      <select
        value={current}
        onChange={(event) => {
          form.modelTier.value = event.currentTarget.value
        }}
      >
        <option value={DEFAULT_TIER}>{tr('ui.office.form.modelDefault')}</option>
        {!isListed && <option value={current}>{current}</option>}
        {options.map((option) => (
          <option key={option.tier} value={option.tier}>
            {option.label}
          </option>
        ))}
      </select>
      {tiers.status === 'failed' && (
        <span class="failure-line">{toFailureText(tiers.failure)}</span>
      )}
      <FieldNote message={form.fields.value.get('modelTier')} />
    </label>
  )
}

function toOption(tier: Awaited<ReturnType<typeof loadToolTiers>>[number]): TierOption {
  const [first] = tier.models
  const cost = first?.perRunUsd

  return {
    tier: tier.tier,
    label: joinInline([
      tier.tier,
      ...(first === undefined ? [] : [first.model]),
      ...(cost === undefined ? [] : [tr('ui.office.form.modelCost', { cost: formatUsd(cost) })]),
    ]),
  }
}
