import type { OverviewResponse } from '@/app/server/wire/overview'
import { DepthLines, indentOf, toDepthLine } from '@/web/ui/markdown/depth-lines'

type OverviewBlock = OverviewResponse['markets'][number]

/** The readings `/overview` prints under a market's rows, each under its heading and in the CLI's
 *  own words, then the sources they came from. A market with none leaves the block out. */
export function Readings({ block }: { readonly block: OverviewBlock }) {
  const { sections, sources } = block

  if (sections === undefined) {
    return null
  }

  return (
    <div class="flow">
      {sections.map((section) => {
        const base = Math.min(...section.lines.map(indentOf))

        return (
          <div key={section.kind} class="flow">
            <h4 class="sub-head">{section.heading}</h4>
            <DepthLines lines={section.lines.map((line) => toDepthLine(line, base))} />
          </div>
        )
      })}
      {sources !== undefined && <p class="meta">{sources}</p>}
    </div>
  )
}
