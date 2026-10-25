import { readBlock } from '@/web/state/block'
import { overviewBlock, selectOverview } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { CoinIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { MarketSections } from '@/web/ui/today/blocks/market-section'

/** "Thị trường khác": every market outside the home region. */
export function OtherMarkets() {
  const blocks = selectOverview('other')

  return (
    <BlockFrame
      title={tr('ui.office.today.other')}
      colour="peach"
      icon={<CoinIcon />}
      reading={readBlock(overviewBlock)}
    >
      {() => <MarketSections blocks={blocks} />}
    </BlockFrame>
  )
}
