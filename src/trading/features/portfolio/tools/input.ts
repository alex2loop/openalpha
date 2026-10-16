import { z } from 'zod'

import type { LedgerTxnDraft, LedgerTxnDraftInput } from '@/trading/features/ledger/types'
import type { CurrencyCode, InstrumentRef, MarketRef, VenueRef } from '@/trading/kernel/instrument'
import type { ProfilePatch } from '@/trading/kernel/operator/profile'
import { LOCALES } from '@/core/types/locale'
import { definedOnly } from '@/core/utils/collections'
import { isResolvedDraft } from '@/trading/features/ledger/draft'
import {
  CASH_TXN_KINDS,
  QUANTITY_TXN_KINDS,
  SELL_ALL,
  TRADE_TXN_KINDS,
  TRANSFER_TXN_KIND,
} from '@/trading/features/ledger/types'
import {
  cashCurrency,
  fxRateConfirmed,
  operatorFxRate,
} from '@/trading/features/portfolio/tools/fx-input'
import { currencyCode } from '@/trading/kernel/instrument'
import {
  INVESTMENT_GOALS,
  INVESTMENT_HORIZONS,
  RISK_LEVELS,
} from '@/trading/kernel/operator/profile'
import {
  dayInput,
  type MarketSchema,
  PRICE_INPUT_UNITS,
  tickerInput,
  venueInput,
} from '@/trading/kernel/surface/surface'

const MAXIMUM_NOTE_LENGTH = 280
const RISK_LEVEL_DESCRIPTION =
  'Overall risk tolerance, for the usual case where the operator gives one answer. It seeds both riskCapacity and riskWillingness, so send it alone.'
const RISK_CAPACITY_DESCRIPTION =
  'What the operator can afford to risk. Send only when capacity and willingness differ, paired with riskWillingness and never with riskLevel.'
const RISK_WILLINGNESS_DESCRIPTION =
  'What the operator is willing to risk. Send only when capacity and willingness differ, paired with riskCapacity and never with riskLevel.'
const RISK_MIX_MESSAGE =
  'riskLevel is derived from riskCapacity and riskWillingness, so the two cannot both be sent. Call again with riskLevel alone, or with the split pair alone.'

const positiveAmount = z.number().positive()
/** A share-count adjustment runs in either direction, so it is bounded by being a change at all. */
const quantityDelta = z
  .number()
  .refine((value) => value !== 0, 'must not be zero')
  .describe(
    'Change in units held: positive for a split or stock dividend that adds shares, negative for a reverse split.'
  )
const fraction = z
  .number()
  .min(0)
  .max(1)
  .describe('Share of NAV as a fraction, 0 to 1; 0.1 means ten percent.')
const note = z
  .string()
  .max(MAXIMUM_NOTE_LENGTH)
  .optional()
  .describe(
    `Free-text note, up to ${MAXIMUM_NOTE_LENGTH} characters. Omit unless the operator said something worth keeping with the row.`
  )
const at = dayInput.describe('Trading day the transaction settled or was executed, YYYY-MM-DD.')

/** Booked in the book's base currency unless it names another: a venue may hold cash in a currency
 *  its markets quote in. The venue is required: with no instrument there is no market to resolve a
 *  sole holder from. */
const cashDraft = z.strictObject({
  kind: z
    .enum(CASH_TXN_KINDS)
    .describe(
      'deposit adds cash, withdrawal removes it, fee books a charge, loss writes off an amount.'
    ),
  at,
  note,
  venue: venueInput.describe('The venue holding the cash.'),
  amount: positiveAmount.describe('Amount, in `currency`.'),
  currency: cashCurrency,
  operatorFxRate,
  fxRateConfirmed,
})

/** Cash moving between two of the operator's own venues. The fee is stated, never priced from a
 *  configured rate, so it is required. */
const transferDraft = z.strictObject({
  kind: z.literal(TRANSFER_TXN_KIND).describe('Move cash between two of your own venues.'),
  at,
  note,
  fromVenue: venueInput.describe('The venue the cash leaves.'),
  venue: venueInput.describe('The venue the cash arrives at.'),
  amount: positiveAmount.describe('Amount, in `currency`.'),
  fee: z.number().min(0).describe('What moving it cost, in `currency`.'),
  currency: cashCurrency,
  operatorFxRate,
  fxRateConfirmed,
})

const riskLevel = z.enum(RISK_LEVELS)
const capSet = z.strictObject({
  maximumPositionPctNav: fraction,
  maximumSegmentPctNav: fraction,
  maximumEtfPctNav: fraction.optional(),
  minimumEtfPctNav: fraction.optional(),
})

/** Consumer-side: the draft schema needs the venue answers and nothing else the portfolio holds. */
interface DraftVenues {
  recordVenues(market: MarketRef): readonly VenueRef[]
  venuesHolding(market: MarketRef): readonly VenueRef[]
}

/** Consumer-side: the draft needs the currency a market quotes in, which only the registry knows. */
interface DraftQuotes {
  quoteConvention(market: MarketRef): { readonly currency: CurrencyCode } | undefined
}

interface LedgerDraftScope {
  readonly markets: MarketSchema
  readonly venues: DraftVenues
  readonly quotes: DraftQuotes
  readonly baseCurrency: CurrencyCode
}

/** What a new transaction may say. `all` rides the quantity slot rather than a second union arm:
 *  `kind` discriminates the union, and a close is a sell however its size is stated.
 *
 *  An instrument row never states its currency: a market quotes in exactly one, so a caller stating
 *  it could only restate it or be refused after the operator had already approved the row. A cash
 *  row may name one other than the base, and still names its venue, which has no market to resolve
 *  it from. A share-count adjustment moves no money and carries no currency at all. */
export function ledgerDraftInput(scope: LedgerDraftScope): z.ZodType<LedgerTxnDraftInput> {
  const instrument = instrumentInputOf(scope.markets)
  const venue = venueInput.optional()

  return z
    .discriminatedUnion('kind', [
      cashDraft,
      transferDraft,
      tradeDraftInput(instrument, venue),
      dividendDraftInput(instrument, venue),
      quantityAdjustmentDraftInput(instrument, venue),
    ])
    .transform((parsed, ctx): LedgerTxnDraftInput => {
      if (!('instrument' in parsed)) {
        const { currency, ...rest } = parsed

        return definedOnly({
          ...rest,
          currency: currency === undefined ? scope.baseCurrency : currencyCode(currency),
        })
      }

      const held = heldVenue(scope.venues, parsed, ctx)
      const quoted = scope.quotes.quoteConvention(parsed.instrument.market)

      if (held === undefined) {
        return z.NEVER
      }

      if ('quantityDelta' in parsed) {
        return definedOnly({ ...parsed, venue: held })
      }

      // why-safe: the trade schema refuses "all" on anything but a sell, the one `SellAllDraft`
      // shape; the inferred type cannot carry that refinement.
      return quoted === undefined
        ? unregisteredMarket(parsed.instrument.market, ctx)
        : (definedOnly({
            ...parsed,
            venue: held,
            currency: quoted.currency,
          }) as LedgerTxnDraftInput)
    })
}

/** The market schema is built from the registered set, so this is reachable only if the registry
 *  changed under the schema. Refused rather than defaulted: no currency is a safe guess. */
function unregisteredMarket(market: MarketRef, ctx: z.RefinementCtx): never {
  ctx.addIssue({
    code: 'custom',
    path: ['instrument'],
    message: `no registered market ${market}`,
  })

  return z.NEVER
}

/** A cash dividend, which names the holding it was paid on but is not a trade in it. */
function dividendDraftInput(
  instrument: ReturnType<typeof instrumentInputOf>,
  venue: z.ZodOptional<typeof venueInput>
) {
  return z.strictObject({
    kind: z.literal('dividend').describe('A cash dividend paid on a holding.'),
    at,
    note,
    operatorFxRate,
    fxRateConfirmed,
    instrument,
    venue,
    amount: positiveAmount.describe(
      "Cash received, in the instrument's market currency, after tax."
    ),
  })
}

/** A share-count adjustment moves no money, so it accepts no currency or FX input at all. */
function quantityAdjustmentDraftInput(
  instrument: ReturnType<typeof instrumentInputOf>,
  venue: z.ZodOptional<typeof venueInput>
) {
  return z.strictObject({
    kind: z
      .enum(QUANTITY_TXN_KINDS)
      .describe('split or distribution; changes the unit count without money moving.'),
    at,
    note,
    instrument,
    venue,
    quantityDelta,
  })
}

/** A buy, sell or rights allotment. The two refinements are the slash grammar's own rules, so the
 *  tool cannot admit a row `/record` would refuse. */
function tradeDraftInput(
  instrument: ReturnType<typeof instrumentInputOf>,
  venue: z.ZodOptional<typeof venueInput>
) {
  return (
    z
      .strictObject({
        kind: z
          .enum(TRADE_TXN_KINDS)
          .describe('buy, sell, or rights (a rights allotment, which states its own fee).'),
        at,
        note,
        operatorFxRate,
        fxRateConfirmed,
        instrument,
        venue,
        quantity: z
          .union([positiveAmount, z.literal(SELL_ALL)])
          .describe(`How many units. "${SELL_ALL}" sells the whole position and needs no count.`),
        unitPrice: positiveAmount.describe(`Price paid per unit. ${PRICE_INPUT_UNITS}`),
        fee: z
          .number()
          .min(0)
          .optional()
          .describe("What the broker charged. Omit it and the market's configured rate prices it."),
      })
      .refine((parsed) => parsed.quantity !== SELL_ALL || parsed.kind === 'sell', {
        message: `only a sell may set quantity to "${SELL_ALL}"`,
        path: ['quantity'],
      })
      // The same rule the slash grammar applies: a rights allotment is not brokered at the standard
      // rate, so no configured rate may price its fee.
      .refine((parsed) => parsed.kind !== 'rights' || parsed.fee !== undefined, {
        message: 'a rights allotment states its own fee',
        path: ['fee'],
      })
  )
}

/** The custodian this row is booked under: the one the operator named, once the registry agrees it
 *  holds the market, or the only one that does. A venue no registry knows is refused here rather
 *  than at the write, where it would already have printed its own unresolved catalog key to the
 *  operator and asked them to approve a row `validate` then rejects. */
function heldVenue(
  venues: DraftVenues,
  draft: { readonly instrument: InstrumentRef; readonly venue?: VenueRef | undefined },
  ctx: z.RefinementCtx
): VenueRef | undefined {
  if (draft.venue === undefined) {
    return soleVenue(venues, draft.instrument.market, ctx)
  }

  const holders = venues.venuesHolding(draft.instrument.market)

  if (holders.includes(draft.venue)) {
    return draft.venue
  }

  ctx.addIssue({
    code: 'custom',
    path: ['venue'],
    message:
      holders.length === 0
        ? noHolderMessage(draft.instrument.market)
        : `no registered venue ${draft.venue} holds ${draft.instrument.market}; the ones that do: ${holders.join(', ')}`,
  })

  return undefined
}

/** The custodian the ledger names for this market, or an issue offering what it could not choose
 *  between - a guess would book the cost basis under the wrong one. */
function soleVenue(
  venues: DraftVenues,
  market: MarketRef,
  ctx: z.RefinementCtx
): VenueRef | undefined {
  const candidates = venues.recordVenues(market)
  const [only] = candidates

  if (candidates.length === 1 && only !== undefined) {
    return only
  }

  ctx.addIssue({
    code: 'custom',
    path: ['venue'],
    message:
      candidates.length === 0
        ? noHolderMessage(market)
        : `more than one venue holds ${market}; name the one holding it: ${candidates.join(', ')}`,
  })

  return undefined
}

function noHolderMessage(market: MarketRef): string {
  return `no registered venue holds ${market}`
}

/** An edit restates a row that already carries a quantity and a fee, so it never takes `all` and
 *  never omits the fee: re-resolving either would move a settled figure the operator never named. */
export function ledgerEditDraftInput(scope: LedgerDraftScope): z.ZodType<LedgerTxnDraft> {
  return ledgerDraftInput(scope).transform((draft, ctx) => {
    if (!isResolvedDraft(draft)) {
      ctx.addIssue({
        code: 'custom',
        message: `an edit states its own fee and cannot set quantity to "${SELL_ALL}"`,
      })

      return z.NEVER
    }

    return draft
  })
}

/** A repeated record replaces the whole corresponding record and must therefore be complete; no
 *  handler invents merge semantics for a partial one. The watchlist is deliberately absent: whole
 *  replacement is the wrong shape for a list an operator curates one name at a time, and
 *  `watchlist_update` owns adding and removing. */
export function profilePatchInput(markets: MarketSchema): z.ZodType<ProfilePatch> {
  const instrument = instrumentInputOf(markets)

  return z
    .strictObject({
      preferredLocale: z
        .enum(LOCALES)
        .optional()
        .describe('Language the operator wants to be answered in.'),
      riskLevel: riskLevel.optional().describe(RISK_LEVEL_DESCRIPTION),
      riskCapacity: riskLevel.optional().describe(RISK_CAPACITY_DESCRIPTION),
      riskWillingness: riskLevel.optional().describe(RISK_WILLINGNESS_DESCRIPTION),
      horizons: z
        .record(z.string(), z.enum(INVESTMENT_HORIZONS))
        .optional()
        .describe('One short or long per portfolio segment, such as {"crypto":"short"}.'),
      goal: z
        .enum(INVESTMENT_GOALS)
        .optional()
        .describe('What the book is for: preserve capital, produce income, or grow.'),
      exclusions: z
        .array(instrument)
        .optional()
        .describe('Instruments never to suggest. Replaces the whole list, so send every one.'),
      segmentTargets: z
        .record(z.string(), fraction)
        .optional()
        .describe('Target NAV share per portfolio segment, as fractions summing to at most 1.'),
      caps: z
        .record(z.string(), capSet)
        .optional()
        .describe('Position and segment NAV ceilings per portfolio segment.'),
      maximumSectorPctNav: fraction.optional(),
      reservePctNav: fraction.optional(),
      regimeScale: fraction.optional(),
      riskPerTradePctNav: fraction.optional(),
      maximumOpenRiskPctNav: fraction.optional(),
      entryTranchePct: fraction
        .optional()
        .describe('Share of a new buy placed first; the rest waits for the plan to confirm.'),
      takeProfitTranchePct: fraction
        .optional()
        .describe('Share of a position sold at the first take-profit, and in a reduce.'),
    })
    .superRefine(assertRiskLevelAlone)
    .transform((parsed) => {
      // why-safe: segment keys arrive as plain strings, and `assertPatch` refuses any the registry
      // does not hold before a merged profile can exist.
      return definedOnly(parsed) as ProfilePatch
    })
}

/** A summary level and either of the two readings it summarizes are rival answers to one question,
 *  so a patch carrying both is rejected rather than silently resolved. */
function assertRiskLevelAlone(
  value: {
    readonly riskLevel?: unknown
    readonly riskCapacity?: unknown
    readonly riskWillingness?: unknown
  },
  ctx: z.RefinementCtx
): void {
  if (
    value.riskLevel === undefined ||
    (value.riskCapacity === undefined && value.riskWillingness === undefined)
  ) {
    return
  }

  ctx.addIssue({ code: 'custom', path: ['riskLevel'], message: RISK_MIX_MESSAGE })
}

function instrumentInputOf(markets: MarketSchema) {
  return z
    .strictObject({ market: markets, ticker: tickerInput })
    .describe('The instrument, named by its market and ticker together.')
}
