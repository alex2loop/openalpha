import type { MessageKey } from '@/i18n'
import { readBlock, withCautions } from '@/web/state/block'
import {
  knownMarkets,
  marketsBlock,
  overviewBlock,
  profileBlock,
  selectRegionOverview,
} from '@/web/state/market'
import {
  type MarketSubTab,
  marketRegion,
  marketRegions,
  marketSubTab,
  pickMarketRegion,
} from '@/web/state/market-tab'
import { isSegmentOn } from '@/web/state/profile'
import { tr } from '@/web/text/tr'
import { FailureStrip } from '@/web/ui/book/failure-strip'
import { TrendIcon } from '@/web/ui/kit/icons'
import { Segmented } from '@/web/ui/kit/segmented'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { MacroFull } from '@/web/ui/market/macro-full'
import { NewsList } from '@/web/ui/market/news-list'
import { RefreshButton } from '@/web/ui/market/refresh-button'
import { Session } from '@/web/ui/market/session'
import { Themes } from '@/web/ui/market/themes'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { MarketSections, selectBoard } from '@/web/ui/today/blocks/market-section'

import './market.css'

const SUB_TAB_KEYS = Object.freeze({
  market: 'ui.office.market.tab.market',
  news: 'ui.office.market.tab.news',
  themes: 'ui.office.market.tab.themes',
} as const satisfies Record<MarketSubTab, MessageKey>)
const SUB_TABS: readonly MarketSubTab[] = Object.freeze(['market', 'news', 'themes'])

/** Thị trường: the full macro reading, prices and last session, the news, and the themes; a region
 *  picker for the first two (themes read Vietnam only). */
export function Market() {
  const subTab = marketSubTab.value

  return (
    <div class="market-tab">
      <div class="market-bar">
        <Segmented
          isTabs
          label={tr('ui.office.panel.market')}
          value={subTab}
          options={SUB_TABS.map((value) => ({ value, label: tr(SUB_TAB_KEYS[value]) }))}
          onChange={(value) => {
            marketSubTab.value = value
          }}
        />
        {subTab !== 'themes' && <RegionPicker />}
        {subTab === 'market' && <RefreshButton />}
      </div>
      <SubTabBody subTab={subTab} />
    </div>
  )
}

function RegionPicker() {
  const region = marketRegion.value
  const regions = marketRegions.value

  if (region === undefined || regions.length < 2) {
    return null
  }

  return (
    <Segmented
      label={tr('ui.office.market.region')}
      value={region}
      options={regions.map((choice) => ({ value: choice.region, label: choice.label }))}
      onChange={pickMarketRegion}
    />
  )
}

function SubTabBody({ subTab }: { readonly subTab: MarketSubTab }) {
  const region = marketRegion.value

  if (subTab === 'themes') {
    return <Themes />
  }

  if (region === undefined) {
    const { error, retry } = readBlock(marketsBlock)

    return error === undefined ? <Skeleton /> : <FailureStrip failure={error} retry={retry} />
  }

  return subTab === 'news' ? (
    <NewsList key={region} region={region} />
  ) : (
    <MarketView key={region} region={region} />
  )
}

function MarketView({ region }: { readonly region: string }) {
  return (
    <>
      <MacroFull region={region} />
      <RegionPrices region={region} />
      <Session region={region} />
      <MoreMarkets region={region} />
    </>
  )
}

// The region's markets as Hôm nay shows them; a row opens the ticker card.
function RegionPrices({ region }: { readonly region: string }) {
  const blocks = selectRegionOverview(region)
  const label = marketRegions.value.find((choice) => choice.region === region)?.label ?? region

  return (
    <BlockFrame
      title={label}
      colour="green"
      icon={<TrendIcon />}
      reading={withCautions(readBlock(overviewBlock), blocks)}
      dataTo={selectBoard(blocks)?.asOf}
    >
      {() => <MarketSections blocks={blocks} />}
    </BlockFrame>
  )
}

// A market of the region the profile leaves off reads nothing here until it is turned on.
function MoreMarkets({ region }: { readonly region: string }) {
  const profile = profileBlock.view.value.data
  const isAnyOff =
    profile !== undefined &&
    knownMarkets.value.some(
      (market) => market.region === region && !isSegmentOn(profile, market.segment)
    )

  return isAnyOff ? <p class="meta">{tr('ui.office.market.moreMarkets')}</p> : null
}
