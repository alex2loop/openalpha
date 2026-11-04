import { DataStatus } from '@/web/edition/data-status'
import { readBlock, withCautions } from '@/web/state/block'
import { isAnalysisOnly } from '@/web/state/edition'
import { homeRegion, knownMarkets, overviewBlock, selectOverview } from '@/web/state/market'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { tr } from '@/web/text/tr'
import { TrendIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { MarketSections, selectBoard } from '@/web/ui/today/blocks/market-section'

/** "Thị trường Việt Nam" or "Thị trường Mỹ": the home region's markets, titled by that region (the
 *  generic home market until the region is read). */
export function HomeMarket() {
  // The overview is shared with the other markets' block, so this one re-read serves both.
  useRereadAfterRefresh(overviewBlock.retry)

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
      showReadLine={!isAnalysisOnly.value}
    >
      {() => (
        <>
          <DataStatus dataTo={board?.asOf} />
          <MarketSections blocks={blocks} />
        </>
      )}
    </BlockFrame>
  )
}
