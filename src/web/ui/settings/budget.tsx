import type { CostReport } from '@/app/server/wire/system'
import { cost } from '@/web/state/cost'
import { isTree, saveConfig } from '@/web/state/settings'
import { toDecimal } from '@/web/text/decimal'
import { tr } from '@/web/text/tr'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { SettingRow, useDraft } from '@/web/ui/settings/row'

const BUDGET_STEP = '0.5'

/** Ngân sách AI: the most the daemon may spend a day and a month; 0 is no limit. */
export function BudgetRow() {
  const caps = cost.value?.caps

  return caps === undefined ? <Skeleton lines={2} /> : <BudgetFields caps={caps} />
}

function BudgetFields({ caps }: { readonly caps: CostReport['caps'] }) {
  const { draft, isChanged, markSaved } = useDraft({
    day: String(caps.dailyUsd),
    month: String(caps.monthlyUsd),
  })
  const day = toDecimal(draft.value.day)
  const month = toDecimal(draft.value.month)

  return (
    <SettingRow
      title={tr('ui.office.settings.budget')}
      note={tr('ui.office.settings.budgetNote')}
      timing="restart"
      isChanged={isChanged}
      isReady={day !== undefined && month !== undefined}
      onSave={async () => {
        await saveBudget({ day, month })
        markSaved()
      }}
    >
      <div class="form-row">
        <CapField
          label={tr('ui.office.settings.budgetDay')}
          value={draft.value.day}
          onInput={(typed) => {
            draft.value = { ...draft.value, day: typed }
          }}
        />
        <CapField
          label={tr('ui.office.settings.budgetMonth')}
          value={draft.value.month}
          onInput={(typed) => {
            draft.value = { ...draft.value, month: typed }
          }}
        />
      </div>
    </SettingRow>
  )
}

async function saveBudget(caps: {
  readonly day: number | undefined
  readonly month: number | undefined
}): Promise<void> {
  await saveConfig(
    (tree) => ({
      ...tree,
      budget: {
        ...(isTree(tree.budget) ? tree.budget : {}),
        max_daily_usd: caps.day,
        max_monthly_usd: caps.month,
      },
    }),
    'budget'
  )
}

interface CapFieldProps {
  readonly label: string
  readonly value: string
  readonly onInput: (value: string) => void
}

function CapField({ label, value, onInput }: CapFieldProps) {
  return (
    <label class="form-field form-label">
      {label}
      <input
        type="number"
        class="form-number"
        min="0"
        step={BUDGET_STEP}
        value={value}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
    </label>
  )
}
