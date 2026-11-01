import type {
  CashTxnDraft,
  DividendTxnDraft,
  HeldInstrument,
  LedgerEntry,
  LedgerEntryView,
  LedgerTxn,
  LedgerTxnDraft,
  TradeTxnDraft,
  TransferTxnDraft,
} from '@/trading/features/ledger/types'
import type { SessionReader } from '@/trading/features/market-data/resolve'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { FxConversion } from '@/trading/kernel/market/market-capability'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { sha256Hex } from '@/core/utils/hash'
import { namesFxRate } from '@/trading/features/ledger/fx-rate'
import { resolveSettlementDay } from '@/trading/features/ledger/settlement'
import { toConversion } from '@/trading/features/market-data/reads/fx'

type MonetaryDraft = CashTxnDraft | TradeTxnDraft | DividendTxnDraft | TransferTxnDraft

export interface LedgerWriteDeps {
  readonly markets: MarketRegistry
  /** Settlement advances over sessions the market actually ran, not weekday arithmetic. */
  readonly marketDataStore: SessionReader
  readonly fx: FxRates
  readonly baseCurrency: CurrencyCode
}

interface FinalizeOptions {
  readonly draft: LedgerTxnDraft
  readonly signal: AbortSignal
}

/** The fixed-order tagged tuple every draft canonicalizes to. Absent optional fields occupy `null`
 *  so an omitted note cannot shift a later field into an earlier position and collide with a
 *  different transaction. */
export async function buildRequestFingerprint(options: FinalizeOptions): Promise<string> {
  const { draft } = options
  const head = [draft.kind, draft.at, draft.note ?? null]

  return sha256Hex(JSON.stringify([...head, ...economicFields(draft)]))
}

function economicFields(draft: LedgerTxnDraft): readonly (string | number | null)[] {
  switch (draft.kind) {
    case 'split':
    case 'distribution':
      return [...heldFields(draft), draft.quantityDelta, null, null, null, null]
    case 'dividend':
      return [
        ...heldFields(draft),
        draft.amount,
        draft.currency,
        draft.operatorFxRate ?? null,
        null,
        null,
      ]
    case 'buy':
    case 'sell':
    case 'rights':
      return [
        ...heldFields(draft),
        draft.quantity,
        draft.currency,
        draft.operatorFxRate ?? null,
        draft.unitPrice,
        draft.fee,
      ]
    case 'transfer':
      return transferFields(draft)
    default:
      return cashFields(draft)
  }
}

function transferFields(draft: TransferTxnDraft): readonly (string | number | null)[] {
  const { fromVenue, venue, amount, currency, fee } = draft

  return [fromVenue, venue, null, amount, currency, fee, draft.operatorFxRate ?? null, null]
}

function cashFields(draft: CashTxnDraft): readonly (string | number | null)[] {
  const { venue, amount, currency } = draft

  return [venue, null, null, amount, currency, draft.operatorFxRate ?? null, null, null]
}

/** The custodian is part of a held row's identity: the same figures on two venues are two real
 *  trades, and a fingerprint blind to the venue reports the second as a duplicate of the first.
 *  Every arm that carries an instrument goes through here, so a new one cannot omit it. */
function heldFields(held: HeldInstrument): readonly string[] {
  return [held.venue, held.instrument.market, held.instrument.ticker]
}

/** Resolves everything a persisted transaction must carry before it can be appended: the owning
 *  market's settlement day and, for a monetary draft, its FX provenance. An unavailable required
 *  rate aborts here rather than persisting a transaction whose base-currency value is a guess. */
export async function finalizeTransaction(
  deps: LedgerWriteDeps,
  options: FinalizeOptions
): Promise<LedgerTxn> {
  const { draft } = options

  if (!isMonetaryDraft(draft)) {
    return { ...draft, settledAt: await settlementFor(deps, draft, options.signal) }
  }

  const conversion = await resolveConversion(deps, draft, options.signal)
  const settledAt = await settlementFor(deps, draft, options.signal)

  return toMonetaryTxn(draft, settledAt, conversion)
}

/** An edit states the figures the operator typed; what no edit can type survives it: the note,
 *  and the leg a triggered exit filled on a sale that is still a sale. */
export function withKeptAnnotations(draft: LedgerTxnDraft, previous: LedgerTxn): LedgerTxnDraft {
  const note = draft.note ?? previous.note
  const kept = note === undefined ? draft : { ...draft, note }

  if (kept.kind !== 'sell' || kept.closeReason !== undefined || previous.kind !== 'sell') {
    return kept
  }

  return previous.closeReason === undefined ? kept : { ...kept, closeReason: previous.closeReason }
}

/** A share-count adjustment moves no money, so it is the one arm that carries no conversion. */
function isMonetaryDraft(draft: LedgerTxnDraft): draft is MonetaryDraft {
  return draft.kind !== 'split' && draft.kind !== 'distribution'
}

/** Rebuilt per arm rather than spread from the union: `operatorFxRate` and `fxRateConfirmed` are
 *  request input and must not survive onto the persisted transaction, and a spread over a union
 *  loses that guarantee. */
function toMonetaryTxn(
  draft: MonetaryDraft,
  settledAt: TradingDay,
  conversion: FxConversion
): LedgerTxn {
  const base = {
    at: draft.at,
    settledAt,
    conversion,
    currency: draft.currency,
    ...(draft.note === undefined ? {} : { note: draft.note }),
  }

  switch (draft.kind) {
    case 'dividend':
      return {
        ...base,
        kind: draft.kind,
        instrument: draft.instrument,
        venue: draft.venue,
        amount: draft.amount,
      }
    case 'buy':
    case 'sell':
    case 'rights':
      return {
        ...base,
        kind: draft.kind,
        instrument: draft.instrument,
        venue: draft.venue,
        quantity: draft.quantity,
        unitPrice: draft.unitPrice,
        fee: draft.fee,
        ...('closeReason' in draft && draft.closeReason !== undefined
          ? { closeReason: draft.closeReason }
          : {}),
      }
    case 'transfer':
      return {
        ...base,
        kind: draft.kind,
        fromVenue: draft.fromVenue,
        venue: draft.venue,
        amount: draft.amount,
        fee: draft.fee,
      }
    default:
      return { ...base, kind: draft.kind, venue: draft.venue, amount: draft.amount }
  }
}

function settlementFor(
  deps: LedgerWriteDeps,
  draft: LedgerTxnDraft,
  signal: AbortSignal
): Promise<TradingDay> {
  const market = marketFor(deps, draft)

  if (market === null) {
    return Promise.resolve(draft.at)
  }

  // `resolveSettlementDay` returns early for every non-trade kind, so a cash movement cannot drift
  // off its own day even though the market is in scope here.
  return resolveSettlementDay(deps.marketDataStore, { transaction: draft, market, signal })
}

function marketFor(deps: LedgerWriteDeps, draft: LedgerTxnDraft): Market | null {
  return 'instrument' in draft ? deps.markets.find(draft.instrument.market) : null
}

async function resolveConversion(
  deps: LedgerWriteDeps,
  draft: MonetaryDraft,
  signal: AbortSignal
): Promise<FxConversion> {
  const { operatorFxRate } = draft

  if (namesFxRate(draft) && draft.currency === deps.baseCurrency) {
    throw new ValidationError(`${draft.currency} row carries an exchange rate`, {
      key: 'errors.ledgerFxSameCurrency',
      params: { currency: draft.currency },
    })
  }

  if (operatorFxRate !== undefined) {
    return assertOperatorRate(operatorFxRate, {
      fromCurrency: draft.currency,
      toCurrency: deps.baseCurrency,
      asOf: draft.at,
    })
  }

  if (draft.previewedConversion !== undefined) {
    return draft.previewedConversion
  }

  const result = await deps.fx.convert({
    fromCurrency: draft.currency,
    toCurrency: deps.baseCurrency,
    asOf: draft.at,
    onDay: true,
    signal,
  })

  if (result.kind === 'unavailable') {
    throw new ValidationError(
      `no exchange rate for ${draft.currency}->${deps.baseCurrency} on ${draft.at}`,
      {
        key: 'errors.ledgerFxUnavailable',
        params: { from: draft.currency, to: deps.baseCurrency, day: { day: draft.at } },
      }
    )
  }

  return toConversion(result.value)
}

/** An approved operator rate is persisted as operator provenance rather than silently blended with
 *  a provider one, so a later audit can tell which number the operator chose. */
function assertOperatorRate(
  rate: number,
  pair: {
    readonly fromCurrency: CurrencyCode
    readonly toCurrency: CurrencyCode
    readonly asOf: TradingDay
  }
): FxConversion {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ValidationError(`operator exchange rate must be finite and positive, got ${rate}`, {
      key: 'errors.ledgerFxInvalid',
    })
  }

  return { ...pair, rate, source: 'operator' }
}

/** The one receipt a mutation returns. It carries identity and dates only — never an amount, so
 *  the same view is safe for an agent surface and an operator one. */
export function toEntryView(entry: LedgerEntry): LedgerEntryView {
  const { transaction } = entry

  return {
    id: entry.id,
    transactionKind: transaction.kind,
    at: transaction.at,
    settledAt: transaction.settledAt,
    ...('instrument' in transaction ? { instrument: transaction.instrument } : {}),
    ...(transaction.note === undefined ? {} : { note: transaction.note }),
    ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
  }
}
