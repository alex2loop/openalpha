import type { OverviewResponse } from '@/app/server/wire/overview'
import { FactGrid } from '@/web/ui/kit/fact-grid'

type OverviewBlock = OverviewResponse['markets'][number]

/** The readings `/overview` prints under a market's rows, each fact a label and its value under the
 *  CLI's heading, then the sources they came from. A market with none leaves the block out. */
export function Readings({ block }: { readonly block: OverviewBlock }) {
  const { sections, sources } = block

  if (sections === undefined) {
    return null
  }

  return (
    <div class="flow">
      <FactGrid
        facts={sections.flatMap(({ kind, facts }) =>
          facts.map((fact) => ({ ...fact, group: kind }))
        )}
        headings={sections.map(({ kind, heading, note }) => ({
          group: kind,
          text: heading,
          ...(note === undefined ? {} : { note }),
        }))}
      />
      {sources !== undefined && <p class="meta">{sources}</p>}
    </div>
  )
}
