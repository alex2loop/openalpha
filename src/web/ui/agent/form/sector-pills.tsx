import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { AgentForm } from '@/web/ui/agent/form/form-state'
import { pluralKey } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { tr } from '@/web/text/tr'
import { toggle } from '@/web/ui/agent/form/fields'

interface SectorChoice {
  readonly sector: string
  readonly label: string
}

/** "Ngành": the sectors the ticked markets file, as pills; a market that files none adds none, so
 *  the field shows only when one does. None picked means every sector. */
export function SectorPills({ form }: { readonly form: AgentForm }) {
  const choices = useSectorChoices(form)
  const picked = form.sectors.value.filter((sector) => form.sectorChoices.value.includes(sector))

  if (choices.length === 0) {
    return null
  }

  return (
    <fieldset class="form-field">
      <legend class="form-label">{tr('ui.office.agent.sectors')}</legend>
      <div class="form-pills">
        {choices.map((choice) => (
          <button
            key={choice.sector}
            type="button"
            class={picked.includes(choice.sector) ? 'form-pill is-on' : 'form-pill'}
            aria-pressed={picked.includes(choice.sector)}
            onClick={() => {
              form.sectors.value = toggle(
                form.sectors.value,
                choice.sector,
                !picked.includes(choice.sector)
              )
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <SectorsHint count={picked.length} />
    </fieldset>
  )
}

function SectorsHint({ count }: { readonly count: number }) {
  if (count === 0) {
    return <p class="meta">{tr('ui.office.form.sectorsNone')}</p>
  }

  return (
    <p class="meta">
      {tr(pluralKey(count, 'ui.office.form.sectorsSomeOne', 'ui.office.form.sectorsSome'), {
        count,
      })}
    </p>
  )
}

// Read again whenever the ticked markets change; the read before is aborted, and so is one in flight
// when the dialog closes. A failed read keeps the choices it had.
function useSectorChoices(form: AgentForm): readonly SectorChoice[] {
  const choices = useSignal<readonly SectorChoice[]>([])
  const markets = form.markets.value

  useEffect(() => {
    const controller = new AbortController()

    readSectors(markets, controller.signal).then(
      (read) => {
        choices.value = read
        form.sectorChoices.value = read.map((choice) => choice.sector)
      },
      // A failed read and this effect's own abort both leave the pills as they were.
      () => undefined
    )

    return () => controller.abort()
  }, [markets.join()])

  return choices.value
}

async function readSectors(
  markets: readonly string[],
  signal: AbortSignal
): Promise<readonly SectorChoice[]> {
  const answers = await Promise.all(
    markets.map((market) => getJson(ROUTES.sectors, { query: { market }, signal }))
  )
  const seen = new Map<string, SectorChoice>()

  for (const sector of answers.flatMap((answer) => answer.sectors)) {
    seen.set(sector.sector, { sector: sector.sector, label: sector.label })
  }

  return [...seen.values()]
}
