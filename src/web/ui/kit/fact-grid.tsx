import type { ScreenFactWire } from '@/app/server/wire/market'
import { tr } from '@/web/text/tr'

import './fact-grid.css'

/** The groups of a board's facts in the order the daemon lists them. */
const SCREEN_GROUPS: readonly ScreenFactWire['group'][] = Object.freeze([
  'price',
  'valuation',
  'flow',
  'derivatives',
])

/** One reading of the grid: a label on the left and its value on the right. `group` names the
 *  heading it sits under. */
interface Fact {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly group: string
}

/** A heading over the facts of one `group`. */
interface FactHeading {
  readonly group: string
  readonly text: string
}

/** What the daemon read, laid out as it lists it: a heading per group, each fact a label on the
 *  left and its value on the right. A board's facts take the screen's group headings; another list
 *  names its own. */
export function FactGrid({
  facts,
  headings,
}: {
  readonly facts: readonly Fact[]
  readonly headings?: readonly FactHeading[]
}) {
  const groups: readonly FactHeading[] =
    headings ??
    SCREEN_GROUPS.map((group) => ({ group, text: tr(`trading.render.screen.group.${group}`) }))

  if (facts.length === 0) {
    return null
  }

  return (
    <div class="fact-grid">
      {groups.map(({ group, text }) => (
        <FactGroup
          key={group}
          heading={text}
          facts={facts.filter((fact) => fact.group === group)}
        />
      ))}
    </div>
  )
}

function FactGroup({
  heading,
  facts,
}: {
  readonly heading: string
  readonly facts: readonly Fact[]
}) {
  if (facts.length === 0) {
    return null
  }

  return (
    <section class="fact-group">
      <h4 class="fact-heading">{heading}</h4>
      <dl class="fact-list">
        {facts.map(({ id, label, value }) => (
          <div key={id + label} class="fact">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
