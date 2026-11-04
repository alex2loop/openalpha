import { z } from 'zod'

import type { LedgerEntry } from '@/trading/api'
import { BROWSER_MARKETS } from '@/app/browser/edition'
import { operatorMessageOf, ValidationError } from '@/core/errors'
import {
  BUILT_IN_VENUES,
  isVenueRefShape,
  marketRef,
  resolveTradingConfig,
  TRADING_CONFIG_SECTION,
  VN_EQUITY_SELL_TAX,
  venueRef,
} from '@/trading/api'

/** Most venues one visitor keeps. A book rarely spans more than a handful of brokers, and every
 *  venue is a name in each form that asks where a trade sits. */
const MAX_CUSTOM_VENUES = 8

/** The installed config refuses a rate above five percent a side as a misplaced decimal; the page
 *  states the same ceiling so a typo is told apart from a fee. */
const MAX_FEE_PERCENT = 5

/** The markets a venue the visitor adds may hold. World gold is read for reference and no venue
 *  holds it, so it is not offered. */
const CUSTOM_VENUE_MARKETS = Object.freeze(['equity-vn', 'crypto', 'gold-vn'] as const)

const CustomVenueSchema = z.strictObject({
  id: z.string().refine(isVenueRefShape, 'must be a venue id'),
  market: z.enum(CUSTOM_VENUE_MARKETS),
  fee_percent: z.number().min(0).max(MAX_FEE_PERCENT),
})

/** What the visitor added: hand-traded venues, each with the market it holds and one fee, as a
 *  percent of the trade's value, for a buy and a sell alike. */
export const CustomVenuesSchema = z.array(CustomVenueSchema).max(MAX_CUSTOM_VENUES)

export type CustomVenues = z.infer<typeof CustomVenuesSchema>
type CustomVenue = z.infer<typeof CustomVenueSchema>

/** The venues a stored payload holds, or `undefined` when it is not a set this edition boots with.
 *  A stored row is untrusted on every start, so it passes the same checks a save does. */
export function parseCustomVenues(value: unknown): CustomVenues | undefined {
  const parsed = CustomVenuesSchema.safeParse(value)

  if (!parsed.success) {
    return undefined
  }

  try {
    assertCustomVenues(parsed.data)

    return parsed.data
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return undefined
    }

    throw err
  }
}

/** Refuses what the schema cannot see, then asks the installed config to resolve the section, so
 *  the rules for a hand-traded venue (fees, markets) keep their one owner there. Ids shared with a
 *  built-in venue or a market are refused here first: composition would refuse the market clash at
 *  start, which a stored set must never reach. */
export function assertCustomVenues(venues: CustomVenues): void {
  const seen = new Set<string>()

  for (const { id } of venues) {
    if (BUILT_IN_VENUES.includes(venueRef(id))) {
      throw refusal('errors.customVenueBuiltIn', id)
    }

    if (BROWSER_MARKETS.has(marketRef(id))) {
      throw refusal('errors.customVenueMarketName', id)
    }

    if (seen.has(id)) {
      throw refusal('errors.customVenueDuplicate', id)
    }

    seen.add(id)
  }

  assertResolves(venues)
}

interface VenueChange {
  readonly before: CustomVenues
  readonly after: CustomVenues
  /** Every row of the book. */
  readonly rows: readonly LedgerEntry[]
}

/** Refuses dropping a venue a ledger row still names, so no row is left on a venue the book no
 *  longer knows. Reads the whole book: removing a venue is rare and the book is bounded. */
export function assertRowsStay({ before, after, rows }: VenueChange): void {
  const kept = new Set(after.map(({ id }) => id))

  for (const { id } of before) {
    const named = kept.has(id) ? 0 : rows.filter((row) => namesVenue(row, id)).length

    if (named > 0) {
      throw refusal('errors.customVenueInUse', id, { count: named })
    }
  }
}

// A transfer names its source as well as the venue it lands on.
function namesVenue({ transaction }: LedgerEntry, id: string): boolean {
  return transaction.venue === id || ('fromVenue' in transaction && transaction.fromVenue === id)
}

/** The `[trading.venues]` section the installed version reads for the same venues. */
export function toRawVenues(venues: CustomVenues): Record<string, object> {
  return Object.fromEntries(venues.map((venue) => [venue.id, toRawVenue(venue)]))
}

function assertResolves(venues: CustomVenues): void {
  try {
    resolveTradingConfig({
      extensions: { [TRADING_CONFIG_SECTION]: { venues: toRawVenues(venues) } },
      locale: {},
    })
  } catch (err: unknown) {
    throw new ValidationError(
      'custom venues do not resolve',
      operatorMessageOf(err) ?? { key: 'errors.customVenueInvalid' },
      err
    )
  }
}

// A rate is a fraction of the value, never a percent. A Vietnamese stock sale also carries the
// statutory tax on top of the broker's fee, so leaving it out would understate every sale.
function toRawVenue(venue: CustomVenue): object {
  const rate = Number((venue.fee_percent / 100).toFixed(6))

  return {
    markets: [venue.market],
    fees: {
      buy: rate,
      sell: rate,
      ...(venue.market === 'equity-vn' ? { sell_tax: VN_EQUITY_SELL_TAX } : {}),
    },
  }
}

function refusal(key: string, id: string, params: Record<string, number> = {}): ValidationError {
  return new ValidationError(`custom venue ${id} is refused`, {
    key,
    params: { venue: id.toUpperCase(), ...params },
  })
}
