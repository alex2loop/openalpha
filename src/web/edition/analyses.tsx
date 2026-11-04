import { useEffect } from 'preact/hooks'

import type { AnalysesResponse } from '@/app/server/wire/analysis'
import { formatDay } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { CompareLink } from '@/web/edition/install-line'
import { useBlockRead } from '@/web/state/block'
import { onWireEvent } from '@/web/state/events'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { ReplyText } from '@/web/ui/chat/history-message'
import { BulbIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

type Analysis = AnalysesResponse['analyses'][number]

interface AnalysesProps {
  /** Narrows the list to one name; absent lists the newest analyses of every name. */
  readonly instrument?: { readonly market: string; readonly ticker: string }
}

/** The analyses stored on this device, newest first. Each is the text the chat answered with, laid
 *  out the same way, so nothing here closes on a side. */
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
              <CompareLink row="verdict-levels" />
            </p>
          </>
        )
      }
    </BlockFrame>
  )
}

function AnalysisCard({ analysis }: { readonly analysis: Analysis }) {
  return (
    <article class="analysis-card">
      <h3 class="sub-head">
        {tr('ui.office.edition.analysis.head', {
          ticker: analysis.instrument.ticker,
          day: formatDay(locale.value, analysis.at),
        })}
      </h3>
      <ReplyText text={analysis.text} isProse={false} />
    </article>
  )
}
