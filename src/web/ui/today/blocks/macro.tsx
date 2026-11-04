import type { MacroResponse } from '@/app/server/wire/market'
import type { MessageKey } from '@/i18n'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { isAnalysisOnly } from '@/web/state/edition'
import { openMarketTab } from '@/web/state/market-tab'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { formatFixed, formatFixedFraction, PERCENT } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { GlobeIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

const REGIME_KEYS: Readonly<Record<'risk-on' | 'neutral' | 'risk-off', MessageKey>> = Object.freeze(
  {
    'risk-on': 'trading.regime.risk-on',
    neutral: 'trading.regime.neutral',
    'risk-off': 'trading.regime.risk-off',
  }
)
export const MACRO_POLL_MS = 300_000
const LEVEL_DIGITS = 2

export type ReadyMacro = Extract<MacroResponse, { readonly status: 'ready' }>
export type MacroDriver = ReadyMacro['drivers'][number]

/** "Bối cảnh vĩ mô": the risk regime and the daemon's one-sentence lean; the web edition, which names
 *  no regime, lists each driver's own reading. */
export function Macro() {
  const reading = useBlock(ROUTES.macro, { everyMs: MACRO_POLL_MS })

  useRereadAfterRefresh(reading.retry)

  return (
    <BlockFrame
      title={tr('trading.brief.block.macro')}
      colour="blue"
      icon={<GlobeIcon />}
      reading={reading}
      dataTo={reading.data?.status === 'ready' ? reading.data.asOf : undefined}
      action={
        <Button kind="tertiary" size="small" onClick={() => openMarketTab('market')}>
          {tr('ui.office.market.seeAll')}
        </Button>
      }
    >
      {(macro) => <MacroReading macro={macro} />}
    </BlockFrame>
  )
}

/** The regime and the daemon's lean; an unavailable reading leaves its caveats to say why. */
export function MacroReading({ macro }: { readonly macro: MacroResponse }) {
  if (macro.status === 'unavailable') {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  if (isAnalysisOnly.value) {
    return <DriverReadings drivers={macro.drivers} />
  }

  return (
    <div class="stack">
      <span class={`regime-tag is-${macro.regime}`}>{tr(REGIME_KEYS[macro.regime])}</span>
      {macro.lean !== undefined && <p class="lead">{macro.lean}</p>}
    </div>
  )
}

/** A driver's reading in its own unit: a rate as a percent, an index as its level. */
export function formatDriverValue(driver: Pick<MacroDriver, 'unit' | 'value'>): string {
  return driver.unit === 'percent'
    ? formatFixedFraction(driver.value / PERCENT)
    : formatFixed(driver.value, LEVEL_DIGITS)
}

function DriverReadings({ drivers }: { readonly drivers: ReadyMacro['drivers'] }) {
  if (drivers.length === 0) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  return (
    <div class="row-list">
      {drivers.map((driver) => (
        <div key={driver.id} class="row">
          <span>{driver.label}</span>
          <b class="row-price">{formatDriverValue(driver)}</b>
        </div>
      ))}
    </div>
  )
}
