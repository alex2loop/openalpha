import type { OverviewResponse } from '@/app/server/wire/overview'
import { FactGrid } from '@/web/ui/kit/fact-grid'

type OverviewBlock = OverviewResponse['markets'][number]

/** The readings `/overview` prints under a market's rows, each fact a label and its value under the
 *  CLI's heading. A market with none leaves the block out; the sources line ends the market's
 *  section, below every figure it covers. */
export function Readings({ block }: { readonly block: OverviewBlock }) {
  const { sections } = block

  if (sections === undefined) {
    return null
  }

  return (
    <FactGrid
      facts={sections.flatMap(({ kind, facts }) => facts.map((fact) => ({ ...fact, group: kind })))}
      headings={sections.map(({ kind, heading }) => ({ group: kind, text: heading }))}
    />
  )
}
