import type { ScreenResponse } from '@/app/server/wire/market'
import type { Bound } from '@/web/edition/screen-bounds'
import { labelled, SORT_LABELS } from '@/web/edition/screen-columns'
import {
  type BaseSortKey,
  type BoardFactor,
  FACTOR_SORT_PREFIX,
  METRIC_SORT_PREFIX,
  type MetricColumn,
  metricKey,
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
  readonly metrics: readonly MetricColumn[]
  readonly factors: readonly BoardFactor[]
  readonly sectors: readonly string[]
  /** The limits the board's figures allow. */
  readonly bounds: readonly Bound[]
  /** The kinds of instrument the market lists, where it lists more than one. */
  readonly kinds: ScreenResponse['kinds']
}

/** The order and the filters the visitor sets on the board. Every choice is theirs and every
 *  default is neutral: ticker order, nothing filtered out. */
export function ScreenControls(props: ControlsProps) {
  return (
    <>
      <SortBar {...props} />
      <FilterBar {...props} />
    </>
  )
}

function SortBar({ market, view, baseKeys, metrics, factors }: ControlsProps) {
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
        {metrics.map((column) => (
          <option key={metricKey(column)} value={`${METRIC_SORT_PREFIX}${metricKey(column)}`}>
            {labelled(column.label, column.sessions)}
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

function FilterBar({ market, view, sectors, bounds, kinds }: ControlsProps) {
  return (
    <div class="sort-bar">
      {kinds !== undefined && <KindSelect market={market} view={view} kinds={kinds} />}
      <ScopeSelect market={market} view={view} />
      {sectors.length > 0 && <SectorSelect market={market} view={view} sectors={sectors} />}
      {bounds.map(({ id, label, sessions }) => (
        <LimitInput
          key={id}
          label={labelled(label, sessions)}
          value={view.bounds[id] ?? ''}
          onInput={(typed) => updateView(market, { bounds: { ...view.bounds, [id]: typed } })}
        />
      ))}
      {isFiltered(view, bounds) && (
        <Button size="small" onClick={() => clearFilters(market)}>
          {tr('ui.office.edition.screen.filter.clear')}
        </Button>
      )}
    </div>
  )
}

function ScopeSelect({ market, view }: Pick<ControlsProps, 'market' | 'view'>) {
  return (
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
  )
}

function SectorSelect({
  market,
  view,
  sectors,
}: Pick<ControlsProps, 'market' | 'view' | 'sectors'>) {
  return (
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
  )
}

// Choosing a kind asks for another board, so the board reads again; the first kind is the one the
// market serves when none is asked.
export function KindSelect({
  market,
  view,
  kinds,
}: Pick<ControlsProps, 'market' | 'view'> & {
  readonly kinds: NonNullable<ControlsProps['kinds']>
}) {
  return (
    <select
      aria-label={tr('ui.office.edition.screen.filter.kind')}
      value={view.kind === '' ? kinds[0]?.kind : view.kind}
      onChange={(event) => updateView(market, { kind: event.currentTarget.value })}
    >
      {kinds.map(({ kind, label }) => (
        <option key={kind} value={kind}>
          {label}
        </option>
      ))}
    </select>
  )
}

function LimitInput({
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
