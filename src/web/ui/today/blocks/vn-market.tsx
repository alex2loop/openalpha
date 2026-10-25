import { readBlock } from '@/web/state/block'
import { overviewBlock, selectOverview } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { TrendIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { closeNoteOf, MarketSections } from '@/web/ui/today/blocks/market-section'

/** "Thị trường Việt Nam": the home region's markets. */
export function VnMarket() {
  const blocks = selectOverview('home')

  return (
    <BlockFrame
      title={tr('ui.office.today.vn')}
      colour="green"
      icon={<TrendIcon />}
      reading={readBlock(overviewBlock)}
      dataTo={blocks[0]?.asOf}
      closeNote={closeNoteOf(blocks[0])}
    >
      {() => <MarketSections blocks={blocks} />}
    </BlockFrame>
  )
}
