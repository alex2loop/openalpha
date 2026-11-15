import type { OverviewFlowBalanceWire, OverviewResponse } from '@/app/server/wire/overview'
import { formatDay } from '@/i18n'
import { overviewBlock, selectRegionOverview } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { formatCount, formatSignedCompactAmount } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { CoinIcon } from '@/web/ui/kit/icons'
import { FlowBars } from '@/web/ui/market/flow-bars'
import { BlockHead, ReadLine } from '@/web/ui/today/block-frame'

type FlowParty = 'foreign' | 'proprietary' | 'others'
type OverviewBlock = OverviewResponse['markets'][number]

interface PartyRow {
  readonly party: FlowParty
  readonly net: number
  readonly mean: OverviewFlowBalanceWire['foreignMean']
}

/** Who bought and who sold on the market's latest session: foreign investors, proprietary desks and
 *  everyone else, each with its net and recent average, the sessions charted, then the sentences that
 *  read them. A market that does not measure it leaves the block out. */
export function FlowBalance({ region }: { readonly region: string }) {
  return selectRegionOverview(region).map((block) =>
    block.flowBalance === undefined ? null : (
      <MarketFlowBalance key={block.market} block={block} balance={block.flowBalance} />
    )
  )
}

interface MarketFlowBalanceProps {
  readonly block: OverviewBlock
  readonly balance: OverviewFlowBalanceWire
}

function MarketFlowBalance({ block, balance }: MarketFlowBalanceProps) {
  return (
    <section class="block">
      <BlockHead
        title={tr('trading.flow.heading', { day: formatDay(locale.value, balance.session) })}
        colour="teal"
        icon={<CoinIcon />}
      />
      <div class="flow">
        <ReadLine readAt={overviewBlock.view.value.readAt} dataTo={balance.session} />
        <div class="row-list">
          {toPartyRows(balance).map((row) => (
            <div key={row.party} class="row">
              <b>{tr(`trading.flow.party.${row.party}`)}</b>
              <span>{formatSignedCompactAmount(row.net)}</span>
              <span class="meta">{row.mean === undefined ? '' : formatMean(row.mean)}</span>
            </div>
          ))}
        </div>
        <p class="meta">{tr('ui.office.market.amountsIn', { currency: block.currency })}</p>
        <FlowBars
          label={tr('trading.flow.party.foreign')}
          values={balance.days.map((day) => day.foreignNet)}
        />
        <FlowBars
          label={tr('trading.flow.party.proprietary')}
          values={balance.days.map((day) => day.proprietaryNet)}
        />
        {balance.reading.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  )
}

function toPartyRows(balance: OverviewFlowBalanceWire): readonly PartyRow[] {
  return [
    { party: 'foreign', net: balance.foreignNet, mean: balance.foreignMean },
    { party: 'proprietary', net: balance.proprietaryNet, mean: balance.proprietaryMean },
    { party: 'others', net: balance.othersNet, mean: undefined },
  ]
}

function formatMean(mean: NonNullable<PartyRow['mean']>): string {
  return tr('trading.flow.mean', {
    sessions: formatCount(mean.sessions),
    value: formatSignedCompactAmount(mean.value),
  })
}
