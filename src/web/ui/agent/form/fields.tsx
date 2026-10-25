import type { AgentFocusWire } from '@/app/server/wire/agents'
import type { AgentForm } from '@/web/ui/agent/form/form-state'
import { knownMarkets } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { resolveAgentId } from '@/web/ui/agent/form/form-state'
import { Segmented } from '@/web/ui/kit/segmented'

// What one `spawn` call may start, as the daemon takes it: 1 to this many.
const MAX_SPAWN_CHOICE = 4
const SPAWN_CHOICES = Array.from({ length: MAX_SPAWN_CHOICE }, (_, index) => index + 1)
const BUDGET_STEP = '0.05'
const PROMPT_ROWS = 4
const HORIZONS = ['short', 'long'] as const satisfies readonly Horizon[]

type Horizon = NonNullable<AgentFocusWire['horizon']>

interface FieldProps {
  readonly form: AgentForm
}

/** Tên, and the id made from it: shown, and editable until the agent exists. */
export function NameField({ form }: FieldProps) {
  const agentId = resolveAgentId(form)

  return (
    <div class="form-field">
      <label class="form-label">
        {tr('ui.office.form.name')}
        <input
          type="text"
          value={form.name.value}
          placeholder={tr('ui.office.form.namePlaceholder')}
          onInput={(event) => {
            form.name.value = event.currentTarget.value
          }}
        />
      </label>
      {form.existing === undefined ? (
        <input
          type="text"
          class="mono form-id"
          aria-label={tr('ui.office.form.idNote', { id: agentId })}
          value={agentId}
          onInput={(event) => {
            form.typedId.value = event.currentTarget.value
          }}
        />
      ) : null}
      <p class="meta">{tr('ui.office.form.idNote', { id: agentId })}</p>
    </div>
  )
}

export function PromptField({ form }: FieldProps) {
  return (
    <label class="form-field form-label">
      {tr('ui.office.form.prompt')}
      <textarea
        rows={PROMPT_ROWS}
        value={form.prompt.value}
        placeholder={tr('ui.office.form.promptPlaceholder')}
        onInput={(event) => {
          form.prompt.value = event.currentTarget.value
        }}
      />
    </label>
  )
}

/** The markets it follows; none shares the operator's own view and drives the real book. */
export function MarketsField({ form }: FieldProps) {
  const picked = form.markets.value

  return (
    <fieldset class="form-field">
      <legend class="form-label">{tr('ui.office.form.markets')}</legend>
      <div class="form-pills">
        {knownMarkets.value.map((market) => (
          <label key={market.market} class="form-check">
            <input
              type="checkbox"
              checked={picked.includes(market.market)}
              onChange={(event) => {
                form.markets.value = toggle(picked, market.market, event.currentTarget.checked)
              }}
            />
            {market.label}
          </label>
        ))}
      </div>
      {picked.length === 0 && <p class="agent-note">{tr('ui.office.form.marketsNone')}</p>}
    </fieldset>
  )
}

// Pressing the chosen horizon again leaves it unset.
export function HorizonField({ form }: FieldProps) {
  return (
    <div class="form-field">
      <span class="form-label">{tr('ui.office.common.horizon')}</span>
      <Segmented<Horizon | ''>
        label={tr('ui.office.common.horizon')}
        value={form.horizon.value ?? ''}
        options={HORIZONS.map((value) => ({ value, label: tr(`trading.horizon.${value}`) }))}
        onChange={(value) => {
          form.horizon.value = value === '' || value === form.horizon.value ? undefined : value
        }}
      />
    </div>
  )
}

export function BudgetField({ form }: FieldProps) {
  return (
    <label class="form-field form-label">
      {tr('ui.office.form.budget')}
      <input
        type="number"
        class="form-number"
        min="0"
        step={BUDGET_STEP}
        value={form.budget.value}
        onInput={(event) => {
          form.budget.value = event.currentTarget.value
        }}
      />
      <span class="meta">{tr('ui.office.form.budgetNote')}</span>
    </label>
  )
}

/** "Cho phép tự tạo agent con", and how many one call may start. */
export function SpawnField({ form }: FieldProps) {
  const isOn = form.maxSpawn.value > 0

  return (
    <div class="form-field form-row">
      <label class="form-check">
        <input
          type="checkbox"
          checked={isOn}
          onChange={(event) => {
            form.maxSpawn.value = event.currentTarget.checked ? 1 : 0
          }}
        />
        {tr('ui.office.form.spawn')}
      </label>
      {isOn && (
        <label class="form-check">
          {tr('ui.office.form.spawnMax')}
          <select
            value={String(form.maxSpawn.value)}
            onChange={(event) => {
              form.maxSpawn.value = Number(event.currentTarget.value)
            }}
          >
            {SPAWN_CHOICES.map((count) => (
              <option key={count} value={String(count)}>
                {count}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

/** The list with `value` in or out. */
export function toggle(list: readonly string[], value: string, isIn: boolean): readonly string[] {
  const rest = list.filter((held) => held !== value)

  return isIn ? [...rest, value] : rest
}
