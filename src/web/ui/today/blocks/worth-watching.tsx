import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { freshCalls, stopBreaches } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { ListIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

const WORTH_MAX = 6
// The morning brief is written once a day.
const BRIEF_POLL_MS = 600_000

/** "Đáng xem hôm nay": the brief's one-line verdict, then holdings through their stop and the
 *  buy calls standing now. */
export function WorthWatching() {
  const reading = useBlock(ROUTES.brief, { everyMs: BRIEF_POLL_MS })

  return (
    <BlockFrame
      title={tr('ui.office.today.worth')}
      colour="yellow"
      icon={<ListIcon />}
      reading={reading}
    >
      {(brief) => <WorthList verdict={brief.text?.verdict ?? []} />}
    </BlockFrame>
  )
}

function WorthList({ verdict }: { readonly verdict: readonly string[] }) {
  const breaches = stopBreaches.value.map((stop) => ({
    key: `stop:${stop.instrument.market}:${stop.instrument.ticker}`,
    ticker: stop.instrument.ticker,
    note: tr('ui.office.tape.breach'),
    isBreach: true,
  }))
  const calls = freshCalls.value.map((call) => ({
    key: `call:${call.id}`,
    ticker: call.instrument.ticker,
    note: tr('ui.office.tape.call'),
    isBreach: false,
  }))
  const rows = [...breaches, ...calls].slice(0, WORTH_MAX)

  if (verdict.length === 0 && rows.length === 0) {
    return <p class="meta">{tr('ui.office.today.noWorth')}</p>
  }

  return (
    <>
      {verdict.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <div class="row-list">
        {rows.map((row) => (
          <div key={row.key} class={row.isBreach ? 'row is-breach' : 'row'}>
            <b>{row.ticker}</b>
            <span class="row-note">{row.note}</span>
          </div>
        ))}
      </div>
    </>
  )
}
