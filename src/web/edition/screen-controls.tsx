import { SORT_LABELS } from '@/web/edition/screen-columns'
import {
  type BaseSortKey,
  type BoardFactor,
  FACTOR_SORT_PREFIX,
  type SortDirection,
} from '@/web/edition/screen-sort'
import {
  type BoardView,
  clearFilters,
  isFiltered,
  type Scope,
  updateView,
} from '@/web/edition/screen-view'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

const SCOPE_LABELS = Object.freeze({
  all: 'ui.office.edition.screen.scope.all',
  held: 'ui.office.edition.screen.scope.held',
  watched: 'ui.office.edition.screen.scope.watched',
} as const)
const SCOPES = Object.freeze(Object.keys(SCOPE_LABELS) as Scope[])

interface ControlsProps {
  readonly market: string
  /** The visitor's view with each choice the board cannot honour already dropped. */
  readonly view: BoardView
  readonly baseKeys: readonly BaseSortKey[]
  readonly factors: readonly BoardFactor[]
  readonly sectors: readonly string[]
}

/** The order and the filters the visitor sets on the board. Every choice is theirs and every
 *  default is neutral: ticker order, nothing filtered out. */
export function ScreenControls({ market, view, baseKeys, factors, sectors }: ControlsProps) {
  return (
    <>
      <SortBar market={market} view={view} baseKeys={baseKeys} factors={factors} />
      <FilterBar market={market} view={view} baseKeys={baseKeys} sectors={sectors} />
    </>
  )
}

function SortBar({
  market,
  view,
  baseKeys,
  factors,
}: Pick<ControlsProps, 'market' | 'view' | 'baseKeys' | 'factors'>) {
  const direction: SortDirection = view.direction

  return (
    <div class="sort-bar">
      <select
        aria-label={tr('ui.office.edition.screen.sortBy')}
        value={view.sort}
        onChange={(event) => updateView(market, { sort: event.currentTarget.value })}
      >
        {baseKeys.map((key) => (
          <option key={key} value={key}>
            {tr(SORT_LABELS[key])}
          </option>
        ))}
        {factors.map(({ id, label }) => (
          <option key={id} value={`${FACTOR_SORT_PREFIX}${id}`}>
            {label}
          </option>
        ))}
      </select>
      <Button
        size="small"
        onClick={() => updateView(market, { direction: direction === 'asc' ? 'desc' : 'asc' })}
      >
        {tr(
          direction === 'asc'
            ? 'ui.office.edition.screen.ascending'
            : 'ui.office.edition.screen.descending'
        )}
      </Button>
    </div>
  )
}

function FilterBar({
  market,
  view,
  baseKeys,
  sectors,
}: Pick<ControlsProps, 'market' | 'view' | 'baseKeys' | 'sectors'>) {
  return (
    <div class="sort-bar">
      <select
        aria-label={tr('ui.office.edition.screen.filter.scope')}
        value={view.scope}
        onChange={(event) => updateView(market, { scope: toScope(event.currentTarget.value) })}
      >
        {SCOPES.map((scope) => (
          <option key={scope} value={scope}>
            {tr(SCOPE_LABELS[scope])}
          </option>
        ))}
      </select>
      {sectors.length > 0 && (
        <select
          aria-label={tr('ui.office.edition.screen.filter.sector')}
          value={view.sector}
          onChange={(event) => updateView(market, { sector: event.currentTarget.value })}
        >
          <option value="">{tr('ui.office.edition.screen.filter.sectorAll')}</option>
          {sectors.map((sector) => (
            <option key={sector} value={sector}>
              {sectorName(sector)}
            </option>
          ))}
        </select>
      )}
      <SizeFilters market={market} view={view} baseKeys={baseKeys} />
      {isFiltered(view) && (
        <Button size="small" onClick={() => clearFilters(market)}>
          {tr('ui.office.edition.screen.filter.clear')}
        </Button>
      )}
    </div>
  )
}

// Offered only where the board carries the figure, so a market without it shows no dead field.
function SizeFilters({
  market,
  view,
  baseKeys,
}: Pick<ControlsProps, 'market' | 'view' | 'baseKeys'>) {
  return (
    <>
      {baseKeys.includes('turnover') && (
        <SizeInput
          label={tr('ui.office.edition.screen.filter.minTurnover')}
          value={view.minTurnover}
          onInput={(minTurnover) => updateView(market, { minTurnover })}
        />
      )}
      {baseKeys.includes('marketCap') && (
        <>
          <SizeInput
            label={tr('ui.office.edition.screen.filter.minMarketCap')}
            value={view.minMarketCap}
            onInput={(minMarketCap) => updateView(market, { minMarketCap })}
          />
          <SizeInput
            label={tr('ui.office.edition.screen.filter.maxMarketCap')}
            value={view.maxMarketCap}
            onInput={(maxMarketCap) => updateView(market, { maxMarketCap })}
          />
        </>
      )}
    </>
  )
}

function SizeInput({
  label,
  value,
  onInput,
}: {
  readonly label: string
  readonly value: string
  readonly onInput: (value: string) => void
}) {
  return (
    <input
      type="text"
      class="screen-size"
      inputMode="decimal"
      autocomplete="off"
      aria-label={label}
      placeholder={label}
      value={value}
      onInput={(event) => onInput(event.currentTarget.value)}
    />
  )
}

function toScope(value: string): Scope {
  return SCOPES.find((scope) => scope === value) ?? 'all'
}
