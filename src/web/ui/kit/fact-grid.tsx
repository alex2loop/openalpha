import { useSignal } from '@preact/signals'

import type { ScreenFactWire } from '@/app/server/wire/market'
import { INLINE_SEPARATOR } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

import './fact-grid.css'

/** The groups in the order the daemon lists them. */
const GROUPS: readonly ScreenFactWire['group'][] = Object.freeze([
  'price',
  'valuation',
  'flow',
  'derivatives',
])

/** What the daemon read for a name, laid out as it lists it: a heading per group, each fact a label
 *  on the left and its value on the right with the name's place among its peers as a muted suffix.
 *  The rarely needed readings wait behind a toggle. */
export function FactGrid({ facts }: { readonly facts: readonly ScreenFactWire[] }) {
  const isMore = useSignal(false)
  const hasMore = facts.some((fact) => fact.secondary === true)
  const shown = isMore.value ? facts : facts.filter((fact) => fact.secondary !== true)

  if (facts.length === 0) {
    return null
  }

  return (
    <div class="fact-grid">
      {GROUPS.map((group) => (
        <FactGroup key={group} group={group} facts={shown.filter((fact) => fact.group === group)} />
      ))}
      {hasMore && (
        <button
          type="button"
          class="fact-more"
          aria-expanded={isMore.value}
          onClick={() => {
            isMore.value = !isMore.value
          }}
        >
          {tr(isMore.value ? 'ui.office.facts.less' : 'ui.office.facts.more')}
        </button>
      )}
    </div>
  )
}

function FactGroup({
  group,
  facts,
}: {
  readonly group: ScreenFactWire['group']
  readonly facts: readonly ScreenFactWire[]
}) {
  if (facts.length === 0) {
    return null
  }

  return (
    <section class="fact-group">
      <h4 class="fact-heading">{tr(`trading.render.screen.group.${group}`)}</h4>
      <dl class="fact-list">
        {facts.map(({ id, label, value, rank }) => (
          <div key={id + label} class="fact">
            <dt>{label}</dt>
            <dd>
              {value}
              {rank !== undefined && (
                <span class="fact-rank">{` ${INLINE_SEPARATOR} ${rank}`}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
