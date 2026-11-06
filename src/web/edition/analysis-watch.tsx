import { useSignal } from '@preact/signals'

import type { AnalysisWire } from '@/app/server/wire/analysis'
import { formatDay, type MessageKey } from '@/i18n'
import { SUGGEST_COMMAND } from '@/web/state/command'
import { locale } from '@/web/state/session'
import { qualifyName } from '@/web/state/watch'
import { tr } from '@/web/text/tr'
import { RunButton } from '@/web/ui/command/run-button'
import { WatchButton } from '@/web/ui/ticker/watch-button'

import './edition.css'

const SIDES = [
  { side: 'bull', label: 'trading.analysis.wrong-bull' },
  { side: 'bear', label: 'trading.analysis.wrong-bear' },
] as const satisfies readonly {
  readonly side: keyof AnalysisWire['conditions']
  label: MessageKey
}[]

/** The user's own watch list out of one analysis: what each side named that would show it wrong,
 *  the day it was written, and the two ways to keep an eye on it. The conditions are the model's
 *  statements; the box lists them and adds nothing. */
export function AnalysisWatch({ analysis }: { readonly analysis: AnalysisWire }) {
  const failure = useSignal<string | undefined>(undefined)
  const { instrument } = analysis
  const name = qualifyName(instrument)

  return (
    <section class="watch-box">
      <h4 class="watch-box-head">{tr('ui.office.edition.analysis.watchTitle')}</h4>
      <p class="meta">
        {tr('ui.office.edition.analysis.watchDate', { day: formatDay(locale.value, analysis.at) })}
      </p>
      {SIDES.map(({ side, label }) => (
        <Conditions key={side} label={label} lines={analysis.conditions[side]} />
      ))}
      <div class="card-actions">
        <WatchButton
          ticker={instrument.ticker}
          market={instrument.market}
          failure={failure}
          size="small"
        />
        <RunButton
          command={`${SUGGEST_COMMAND} ${name}`}
          label={tr('ui.office.edition.analysis.again')}
          kind="ai"
          size="small"
        />
        {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
      </div>
      <p class="meta">{tr('trading.analysis.web-scope')}</p>
    </section>
  )
}

function Conditions({
  label,
  lines,
}: {
  readonly label: MessageKey
  readonly lines: readonly string[]
}) {
  return (
    <div class="watch-side">
      <h5 class="watch-side-head">{tr(label)}</h5>
      {lines.length === 0 ? (
        <p class="meta">{tr('trading.analysis.wrong-none')}</p>
      ) : (
        <ul class="watch-list">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
