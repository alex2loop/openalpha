import { readBlock, withCautions } from '@/web/state/block'
import { homeRegion, knownMarkets, overviewBlock, selectOverview } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { TrendIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { MarketSections, selectBoard } from '@/web/ui/today/blocks/market-section'

/** "Thị trường Việt Nam" or "Thị trường Mỹ": the home region's markets, titled by that region (the
 *  generic home market until the region is read). */
export function HomeMarket() {
  const blocks = selectOverview('home')
  const board = selectBoard(blocks)
  const home = homeRegion()
  const region = knownMarkets.value.find((market) => market.region === home)?.regionLabel

  return (
    <BlockFrame
      title={
        region === undefined
          ? tr('ui.office.today.homeUnknown')
          : tr('ui.office.today.home', { region })
      }
      colour="green"
      icon={<TrendIcon />}
      reading={withCautions(readBlock(overviewBlock), blocks)}
      dataTo={board?.asOf}
    >
      {() => <MarketSections blocks={blocks} />}
    </BlockFrame>
  )
}
