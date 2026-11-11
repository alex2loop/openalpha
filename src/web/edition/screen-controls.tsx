import type { ScreenResponse } from '@/app/server/wire/market'
import type { MessageKey } from '@/i18n'
import { type Bound, hasLimits } from '@/web/edition/screen-bounds'
import { labelled, SORT_LABELS } from '@/web/edition/screen-columns'
import {
  type BaseSortKey,
  type BoardFactor,
  FACTOR_SORT_PREFIX,
  METRIC_SORT_PREFIX,
  type MetricColumn,
  metricKey,
  NO_SORT,
  type SortDirection,
} from '@/web/edition/screen-sort'
import {
  type BoardView,
  clearFilters,
  isFiltered,
  type Scope,
  setSort,
  updateView,
} from '@/web/edition/screen-view'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Fold } from '@/web/ui/kit/fold'

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
  /** How many names the filters leave, of how many on the board. */
  readonly tally: { readonly shown: number; readonly total: number }
}

/** The order and the filters the visitor sets on the board. Every choice is theirs and every
 *  default is neutral: ticker order, nothing filtered out. */
export function ScreenControls(props: ControlsProps) {
  return (
    <>
      <SearchBar market={props.market} view={props.view} />
      <BoardTally {...props.tally} />
      <SortBar {...props} />
      <FilterBar {...props} />
      <LimitsFold {...props} />
    </>
  )
}

function SearchBar({ market, view }: Pick<ControlsProps, 'market' | 'view'>) {
  const label = tr('ui.office.edition.screen.filter.search')

  return (
    <div class="sort-bar">
      <input
        type="search"
        class="screen-size"
        autocomplete="off"
        aria-label={label}
        placeholder={label}
        value={view.query}
        onInput={(event) => updateView(market, { query: event.currentTarget.value })}
      />
    </div>
  )
}

function SortBar({ market, view, baseKeys, metrics, factors }: ControlsProps) {
  const options = [
    ...baseKeys.map((key) => ({ value: key, label: tr(SORT_LABELS[key]) })),
    ...metrics.map((column) => ({
      value: `${METRIC_SORT_PREFIX}${metricKey(column)}`,
      label: labelled(column.label, column.sessions),
    })),
    ...factors.map(({ id, label }) => ({ value: `${FACTOR_SORT_PREFIX}${id}`, label })),
  ]

  return (
    <>
      <SortRow
        label="ui.office.edition.screen.sortBy"
        value={view.sort}
        direction={view.direction}
        options={options}
        onSort={(sort) => setSort(market, sort)}
        onDirection={(direction) => updateView(market, { direction })}
      />
      <SortRow
        label="ui.office.edition.screen.thenBy"
        value={view.thenSort}
        direction={view.thenDirection}
        options={options.filter(({ value }) => value !== view.sort)}
        onSort={(thenSort) => updateView(market, { thenSort })}
        onDirection={(thenDirection) => updateView(market, { thenDirection })}
        isOptional
      />
    </>
  )
}

interface SortOption {
  readonly value: string
  readonly label: string
}

interface SortRowProps {
  readonly label: MessageKey
  readonly value: string
  readonly direction: SortDirection
  readonly options: readonly SortOption[]
  readonly onSort: (sort: string) => void
  readonly onDirection: (direction: SortDirection) => void
  /** The sort may be left unchosen, and has no direction then. */
  readonly isOptional?: true
}

function SortRow({
  label,
  value,
  direction,
  options,
  onSort,
  onDirection,
  isOptional,
}: SortRowProps) {
  return (
    <div class="sort-bar">
      <label class="sort-key">
        <span>{tr(label)}</span>
        <select value={value} onChange={(event) => onSort(event.currentTarget.value)}>
          {isOptional === true && (
            <option value={NO_SORT}>{tr('ui.office.edition.screen.sortNone')}</option>
          )}
          {options.map(({ value: key, label: name }) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {value !== NO_SORT && (
        <Button size="small" onClick={() => onDirection(direction === 'asc' ? 'desc' : 'asc')}>
          {tr(
            direction === 'asc'
              ? 'ui.office.edition.screen.ascending'
              : 'ui.office.edition.screen.descending'
          )}
        </Button>
      )}
    </div>
  )
}

function FilterBar({ market, view, sectors, bounds, kinds }: ControlsProps) {
  return (
    <div class="sort-bar">
      {kinds !== undefined && <KindSelect market={market} view={view} kinds={kinds} />}
      <ScopeSelect market={market} view={view} />
      {sectors.length > 0 && <SectorSelect market={market} view={view} sectors={sectors} />}
      {isFiltered(view, bounds) && (
        <Button size="small" onClick={() => clearFilters(market)}>
          {tr('ui.office.edition.screen.filter.clear')}
        </Button>
      )}
    </div>
  )
}

// The limits are many and seldom all wanted, so they fold away until one is set.
function LimitsFold({ market, view, bounds }: Pick<ControlsProps, 'market' | 'view' | 'bounds'>) {
  if (bounds.length === 0) {
    return null
  }

  return (
    <Fold
      title={tr('ui.office.edition.screen.filter.limits')}
      isOpenInitially={hasLimits(bounds, view.bounds)}
    >
      <div class="sort-bar">
        {bounds.map(({ id, label, sessions }) => (
          <LimitInput
            key={id}
            label={labelled(label, sessions)}
            value={view.bounds[id] ?? ''}
            onInput={(typed) => updateView(market, { bounds: { ...view.bounds, [id]: typed } })}
          />
        ))}
      </div>
    </Fold>
  )
}

/** How many names the filters leave. */
function BoardTally({ shown, total }: ControlsProps['tally']) {
  return (
    <div class="sort-bar">
      <p class="meta">{tr('ui.office.edition.screen.filter.count', { shown, total })}</p>
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
