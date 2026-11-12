import type { ScreenFactWire } from '@/app/server/wire/market'
import { termOfFact } from '@/i18n'
import { DOWN_GLYPH, UP_GLYPH } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { GroupHelp, Term } from '@/web/ui/glossary/term'
import { SectionHeading } from '@/web/ui/kit/section-heading'

import './fact-grid.css'

/** The groups of a board's facts in the order the daemon lists them. */
const SCREEN_GROUPS: readonly ScreenFactWire['group'][] = Object.freeze([
  'valuation',
  'profitability',
  'growth',
  'health',
  'price',
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
          group={group}
          heading={text}
          facts={facts.filter((fact) => fact.group === group)}
        />
      ))}
    </div>
  )
}

function FactGroup({
  group,
  heading,
  facts,
}: {
  readonly group: string
  readonly heading: string
  readonly facts: readonly Fact[]
}) {
  if (facts.length === 0) {
    return null
  }

  return (
    <section class="fact-group">
      <h4 class="fact-heading">
        <SectionHeading text={heading} />
        <GroupHelp heading={group} />
      </h4>
      <dl class="fact-list">
        {facts.map(({ id, label, value }) => (
          <div key={id + label} class="fact">
            <dt>
              <FactLabel id={id} label={label} />
            </dt>
            <dd class={toneClassOf(value)}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// A signed reading wears the up or down color, so a fall reads as one before its number does.
function toneClassOf(value: string): string | undefined {
  if (value.startsWith(UP_GLYPH)) {
    return 'is-up-text'
  }

  return value.startsWith(DOWN_GLYPH) ? 'is-down-text' : undefined
}

// A label the glossary explains is a term; any other reads as it always did.
function FactLabel({ id, label }: { readonly id: string; readonly label: string }) {
  const term = termOfFact(id)

  return term === undefined ? label : <Term id={term}>{label}</Term>
}
