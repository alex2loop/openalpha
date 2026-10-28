import { useSignal } from '@preact/signals'

import { knownMarkets } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { Segmented } from '@/web/ui/kit/segmented'
import { IndexContributors } from '@/web/ui/market/index-contributors'
import { IndexValuation } from '@/web/ui/market/index-valuation'

import './index-reading.css'

/** The indexes the daemon breaks down, by the code it takes and the name a reader knows it by. */
const INDEXES = Object.freeze([
  { code: 'VNINDEX', label: 'VN-Index' },
  { code: 'VN30', label: 'VN30' },
  { code: 'HNX', label: 'HNX' },
] as const)

type IndexCode = (typeof INDEXES)[number]['code']

/** Mã dẫn dắt chỉ số and Định giá, for the region's market that breaks an index down. Each part
 *  reads on its own, so the rest of the tab never waits on either. */
export function IndexReading({ region }: { readonly region: string }) {
  const code = useSignal<IndexCode>('VNINDEX')
  const market = knownMarkets.value.find(
    (candidate) => candidate.region === region && candidate.hasIndexes && candidate.enabled
  )

  if (market === undefined) {
    return null
  }

  const index = INDEXES.find((candidate) => candidate.code === code.value) ?? INDEXES[0]

  return (
    <>
      <Segmented
        label={tr('ui.office.market.index.pick')}
        className="index-pick"
        value={index.code}
        options={INDEXES.map((choice) => ({ value: choice.code, label: choice.label }))}
        onChange={(value) => {
          code.value = value
        }}
      />
      <IndexContributors
        key={`${market.market}:${index.code}`}
        market={market.market}
        index={index}
      />
      <IndexValuation key={`${market.market}:${index.code}`} market={market.market} index={index} />
    </>
  )
}
