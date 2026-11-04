import { type Signal, useSignal } from '@preact/signals'

import { translateDisplayText } from '@/i18n'
import { sendJson } from '@/web/api/client'
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
import { askConfirm } from '@/web/ui/kit/confirm'
import { IDENTIFIER_INPUT } from '@/web/ui/kit/identifier-input'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'
import { ActionRow } from '@/web/ui/settings/row'

// The worker checks every one of these again and refuses what it cannot take: the page states them
// so a form that cannot be accepted never offers its button. The ids are the ones the engine reads.
const MARKETS = ['equity-vn', 'crypto', 'gold-vn'] as const
const MAX_VENUES = 8
const MAX_FEE_PERCENT = 5
const MAX_ID_CHARS = 32
const COMBINING_MARKS = /[̀-ͯ]/g
const NON_ID_RUN = /[^a-z0-9]+/g
const LEADING_NON_LETTERS = /^[^a-z]+/
const TRAILING_DASHES = /-+$/

interface Venue {
  readonly id: string
  readonly market: string
  readonly fee_percent: number
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

  return <VenueEditor saved={loaded.value} />
}

async function loadVenues(abort: AbortSignal): Promise<readonly Venue[]> {
  const tree = await readConfigTree(abort)

  return Array.isArray(tree.custom_venues) ? tree.custom_venues.filter(isTree).flatMap(toVenue) : []
}

function toVenue(entry: Readonly<Record<string, unknown>>): readonly Venue[] {
  const id = readText(entry.id)
  const market = readText(entry.market)

  return id === undefined || market === undefined || typeof entry.fee_percent !== 'number'
    ? []
    : [{ id, market, fee_percent: entry.fee_percent }]
}

function VenueEditor({ saved }: { readonly saved: readonly Venue[] }) {
  return (
    <>
      <p class="meta">{tr('ui.office.edition.venues.intro')}</p>
      <ActionRow title={tr('ui.office.edition.venues.listTitle')}>
        {saved.length === 0 && <p class="meta">{tr('ui.office.edition.venues.empty')}</p>}
        {saved.map((venue) => (
          <VenueLine key={venue.id} venue={venue} saved={saved} />
        ))}
      </ActionRow>
      {saved.length < MAX_VENUES ? (
        <AddForm saved={saved} />
      ) : (
        <p class="meta">{tr('ui.office.edition.venues.full', { count: MAX_VENUES })}</p>
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
          askConfirm({
            title: tr('ui.office.edition.venues.removeAsk', { name }),
            lines: [tr('ui.office.edition.venues.removeBody', { name })],
            confirmLabel: tr('ui.office.edition.venues.remove'),
            isDestructive: true,
            keepLabel: tr('ui.office.edition.common.keep'),
            confirm: () => save(saved.filter(({ id }) => id !== venue.id)),
          })
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

function AddForm({ saved }: { readonly saved: readonly Venue[] }) {
  const fields: AddDraft = {
    name: useSignal(''),
    market: useSignal(MARKETS[0]),
    fee: useSignal(''),
  }
  const id = toVenueId(fields.name.value)
  const percent = toPercent(fields.fee.value)
  const draft: Venue | undefined =
    id === '' || percent === undefined
      ? undefined
      : { id, market: fields.market.value, fee_percent: percent }

  return (
    <ActionRow
      title={tr('ui.office.edition.venues.addTitle')}
      note={tr('ui.office.edition.venues.feeNote')}
    >
      <div class="setting-controls">
        <AddFields fields={fields} />
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
                askToAdd([...saved, draft])
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

function AddFields({ fields }: { readonly fields: AddDraft }) {
  const { name, market, fee } = fields

  return (
    <div class="setting-controls">
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
        {MARKETS.map((ref) => (
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
    </div>
  )
}

function askToAdd(venues: readonly Venue[]): void {
  askRestart({
    confirmLabel: tr('ui.office.edition.venues.confirm'),
    confirm: () => save(venues),
  })
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
function toVenueId(name: string): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(NON_ID_RUN, '-')
    .replace(LEADING_NON_LETTERS, '')
    .slice(0, MAX_ID_CHARS)
    .replace(TRAILING_DASHES, '')
}

// A comma is a decimal point to a Vietnamese reader.
function toPercent(text: string): number | undefined {
  const value = Number(text.trim().replace(',', '.'))

  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= MAX_FEE_PERCENT
    ? value
    : undefined
}
