import { type Signal, useSignal } from '@preact/signals'

import { translateDisplayText } from '@/i18n'
import { ApiFailure, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { askRestart } from '@/web/edition/restart-confirm'
import { restartEngine } from '@/web/edition/worker-link'
import { locale } from '@/web/state/session'
import { isTree, readConfigTree } from '@/web/state/settings'
import { readText } from '@/web/text/fields'
import { formatFixedFraction, PERCENT } from '@/web/text/figures'
import { toFailureText, tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { Button } from '@/web/ui/kit/button'
import { IDENTIFIER_INPUT } from '@/web/ui/kit/identifier-input'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { ActionRow } from '@/web/ui/settings/row'

// The page offers its button only for a form with a name, a fee within the worker's ceiling and a
// name not already in the list. The worker checks again and refuses the rest (a built-in venue's
// name, a market's name). Its limits arrive with the saved venues.

// The combining marks, as escapes: web cannot import the folding core keeps.
const COMBINING_MARKS = /[\u0300-\u036f]/g
const NON_ID_RUN = /[^a-z0-9]+/g
const LEADING_NON_LETTERS = /^[^a-z]+/
const TRAILING_DASHES = /-+$/

interface Venue {
  readonly id: string
  readonly market: string
  readonly fee_percent: number
}

/** The worker's limits on a venue, as the config view carries them. */
interface Limits {
  readonly markets: readonly string[]
  readonly maxVenues: number
  readonly maxFeePercent: number
  readonly saleTaxPercent: number
  readonly maxIdChars: number
}

interface Loaded {
  readonly saved: readonly Venue[]
  readonly limits: Limits
}

/** Sàn khác: the hand-traded venues the visitor keeps beside the built-in ones. A save asks first
 *  and restarts the engine, which reads its venues once when it starts. */
export function VenuesPanel() {
  const loaded = useLoad(loadVenues).value

  if (loaded.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (loaded.status === 'failed') {
    return <p class="failure-line">{toFailureText(loaded.failure)}</p>
  }

  return <VenueEditor {...loaded.value} />
}

async function loadVenues(abort: AbortSignal): Promise<Loaded> {
  const tree = await readConfigTree(abort)

  return {
    saved: Array.isArray(tree.custom_venues)
      ? tree.custom_venues.filter(isTree).flatMap(toVenue)
      : [],
    limits: toLimits(tree.custom_venue_limits),
  }
}

function toLimits(value: unknown): Limits {
  const tree: Readonly<Record<string, unknown>> = isTree(value) ? value : {}

  if (!Array.isArray(tree.markets)) {
    throw new ApiFailure(0, 'bad_response')
  }

  return {
    markets: tree.markets.filter((market): market is string => typeof market === 'string'),
    maxVenues: toCount(tree.maxVenues),
    maxFeePercent: toCount(tree.maxFeePercent),
    saleTaxPercent: toCount(tree.saleTaxPercent),
    maxIdChars: toCount(tree.maxIdChars),
  }
}

function toCount(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ApiFailure(0, 'bad_response')
  }

  return value
}

function toVenue(entry: Readonly<Record<string, unknown>>): readonly Venue[] {
  const id = readText(entry.id)
  const market = readText(entry.market)

  return id === undefined || market === undefined || typeof entry.fee_percent !== 'number'
    ? []
    : [{ id, market, fee_percent: entry.fee_percent }]
}

function VenueEditor({ saved, limits }: Loaded) {
  return (
    <>
      <p class="meta">{tr('ui.office.edition.venues.intro')}</p>
      <ActionRow title={tr('ui.office.edition.venues.listTitle')}>
        {saved.length === 0 && <p class="meta">{tr('ui.office.edition.venues.empty')}</p>}
        {saved.map((venue) => (
          <VenueLine key={venue.id} venue={venue} saved={saved} />
        ))}
      </ActionRow>
      {saved.length < limits.maxVenues ? (
        <AddForm saved={saved} limits={limits} />
      ) : (
        <p class="meta">{tr('ui.office.edition.venues.full', { count: limits.maxVenues })}</p>
      )}
    </>
  )
}

function VenueLine({ venue, saved }: { readonly venue: Venue; readonly saved: readonly Venue[] }) {
  const name = toVenueName(venue.id)

  return (
    <div class="key-held">
      <p>
        {tr('ui.office.edition.venues.line', {
          name,
          market: toMarketName(venue.market),
          fee: formatFixedFraction(venue.fee_percent / PERCENT),
        })}
      </p>
      <Button
        size="small"
        kind="destructive"
        onClick={() =>
          askToSave(
            tr('ui.office.edition.venues.removeConfirm'),
            saved.filter(({ id }) => id !== venue.id),
            true
          )
        }
      >
        {tr('ui.office.edition.venues.remove')}
      </Button>
    </div>
  )
}

interface AddDraft {
  readonly name: Signal<string>
  readonly market: Signal<string>
  readonly fee: Signal<string>
}

function AddForm({ saved, limits }: { readonly saved: readonly Venue[]; readonly limits: Limits }) {
  const fields: AddDraft = {
    name: useSignal(''),
    market: useSignal(limits.markets[0] ?? ''),
    fee: useSignal(''),
  }
  const id = toVenueId(fields.name.value, limits.maxIdChars)
  const percent = toPercent(fields.fee.value, limits.maxFeePercent)
  const draft: Venue | undefined =
    id === '' || percent === undefined || saved.some((venue) => venue.id === id)
      ? undefined
      : { id, market: fields.market.value, fee_percent: percent }

  return (
    <ActionRow title={tr('ui.office.edition.venues.addTitle')} note={toFeeNote(limits)}>
      <div class="setting-controls">
        <AddFields fields={fields} markets={limits.markets} />
        {id !== '' && (
          <p class="meta">{tr('ui.office.edition.venues.idLine', { id: toVenueName(id) })}</p>
        )}
        <div class="setting-actions">
          <Button
            size="small"
            kind="commit"
            disabled={draft === undefined}
            onClick={() => {
              if (draft !== undefined) {
                askToSave(tr('ui.office.edition.venues.confirm'), [...saved, draft])
              }
            }}
          >
            {tr('ui.office.edition.venues.add')}
          </Button>
        </div>
      </div>
    </ActionRow>
  )
}

function toFeeNote({ maxFeePercent, saleTaxPercent }: Limits): string {
  return tr('ui.office.edition.venues.feeNote', {
    max: formatFixedFraction(maxFeePercent / PERCENT),
    tax: formatFixedFraction(saleTaxPercent / PERCENT),
  })
}

function AddFields({
  fields,
  markets,
}: {
  readonly fields: AddDraft
  readonly markets: readonly string[]
}) {
  const { name, market, fee } = fields

  return (
    <>
      <input
        type="text"
        {...IDENTIFIER_INPUT}
        aria-label={tr('ui.office.edition.venues.name')}
        placeholder={tr('ui.office.edition.venues.name')}
        value={name.value}
        onInput={(event) => {
          name.value = event.currentTarget.value
        }}
      />
      <select
        aria-label={tr('ui.office.edition.venues.market')}
        value={market.value}
        onChange={(event) => {
          market.value = event.currentTarget.value
        }}
      >
        {markets.map((ref) => (
          <option key={ref} value={ref}>
            {toMarketName(ref)}
          </option>
        ))}
      </select>
      <input
        type="text"
        inputMode="decimal"
        autocomplete="off"
        aria-label={tr('ui.office.edition.venues.fee')}
        placeholder={tr('ui.office.edition.venues.fee')}
        value={fee.value}
        onInput={(event) => {
          fee.value = event.currentTarget.value
        }}
      />
    </>
  )
}

// An add and a removal are one flow: the venues are saved, then the engine restarts.
function askToSave(confirmLabel: string, venues: readonly Venue[], isDestructive?: true): void {
  askRestart({ confirmLabel, isDestructive, confirm: () => save(venues) })
}

// The page waits for the engine to come back after the restart.
async function save(venues: readonly Venue[]): Promise<void> {
  await sendJson('POST', ROUTES.configWrite, { body: { custom_venues: venues } })
  restartEngine()
}

function toMarketName(market: string): string {
  return translateDisplayText(locale.value, { key: `trading.market.${market}`, fallback: market })
}

/** The id a name becomes: letters, digits and dashes, starting with a letter, as the engine reads a
 *  venue's id. Empty when the name has none. */
function toVenueId(name: string, maxChars: number): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(NON_ID_RUN, '-')
    .replace(LEADING_NON_LETTERS, '')
    .slice(0, maxChars)
    .replace(TRAILING_DASHES, '')
}

// A comma is a decimal point to a Vietnamese reader.
function toPercent(text: string, maxPercent: number): number | undefined {
  const value = Number(text.trim().replace(',', '.'))

  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= maxPercent
    ? value
    : undefined
}
