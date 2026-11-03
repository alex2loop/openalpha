import { useEffect } from 'preact/hooks'

import type { AnalysesResponse } from '@/app/server/wire/analysis'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { CompareLink } from '@/web/edition/install-line'
import { useBlockRead } from '@/web/state/block'
import { onWireEvent } from '@/web/state/events'
import { tr } from '@/web/text/tr'
import { AiLabel } from '@/web/ui/kit/ai-label'
import { BulbIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

type Analysis = AnalysesResponse['analyses'][number]
type Side = Analysis['bull']

interface AnalysesProps {
  /** Narrows the list to one name; absent lists the newest analyses of every name. */
  readonly instrument?: { readonly market: string; readonly ticker: string }
}

/** The analyses stored on this device, newest first. Each one opens with the AI label and the
 *  models' display names, then both sides in the same layout and the same order every time, then the
 *  claims the evidence checked. Nothing here closes on a side. */
export function Analyses({ instrument }: AnalysesProps) {
  const reading = useBlockRead((abort) =>
    getJson(ROUTES.analyses, {
      ...(instrument === undefined ? {} : { query: instrument }),
      signal: abort,
    })
  )

  // A run that finished may have stored one.
  useEffect(() => onWireEvent('run_finished', reading.retry), [])

  return (
    <BlockFrame
      title={tr('ui.office.edition.analysis.title')}
      colour="peach"
      icon={<BulbIcon />}
      reading={reading}
    >
      {({ analyses }) =>
        analyses.length === 0 ? (
          <p class="empty-note">{tr('ui.office.edition.analysis.empty')}</p>
        ) : (
          <>
            {analyses.map((analysis) => (
              <AnalysisCard key={analysis.id} analysis={analysis} />
            ))}
            <p class="meta">
              {tr('trading.analysis.web-scope')} <CompareLink row="verdict-levels" />
            </p>
          </>
        )
      }
    </BlockFrame>
  )
}

function AnalysisCard({ analysis }: { readonly analysis: Analysis }) {
  const { ticker } = analysis.instrument
  const params = { ticker }

  return (
    <article class="analysis-card">
      <h3 class="sub-head">
        {tr('ui.office.edition.analysis.head', { ticker, day: analysis.at })}
      </h3>
      <AiLabel models={analysis.models} />
      {analysis.evidenceThrough !== undefined && (
        <p class="meta">
          {tr('ui.office.edition.analysis.through', { day: analysis.evidenceThrough })}
        </p>
      )}
      <SideView side={analysis.bull} title={tr('trading.analysis.case-bull', params)} />
      <SideView side={analysis.bear} title={tr('trading.analysis.case-bear', params)} />
      <ClaimList analysis={analysis} />
      {analysis.caveats.map((caveat) => (
        <p key={caveat.code} class="meta">
          {caveat.text}
        </p>
      ))}
    </article>
  )
}

function SideView({ side, title }: { readonly side: Side; readonly title: string }) {
  return (
    <section class="analysis-side">
      <h4 class="sub-head">{title}</h4>
      <p>{side.summary}</p>
      {side.invalidators.length > 0 && (
        <>
          <p class="meta">{tr('ui.office.edition.analysis.wrongIf')}</p>
          <ul>
            {side.invalidators.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function ClaimList({ analysis }: { readonly analysis: Analysis }) {
  if (analysis.claims.length === 0) {
    return null
  }

  return (
    <section class="analysis-side">
      <h4 class="sub-head">{tr('ui.office.edition.analysis.claims')}</h4>
      <ul>
        {analysis.claims.map((claim) => (
          <li key={claim.id}>
            {claim.text} ({tr(`ui.office.edition.analysis.verdict.${claim.verdict}`)})
          </li>
        ))}
      </ul>
    </section>
  )
}
