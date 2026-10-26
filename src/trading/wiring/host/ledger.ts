import type { z } from 'zod'

import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { ValidationError } from '@/core/errors'
import { FieldValidationError, toFieldValidationError } from '@/core/field-errors'
import { toFieldLabel } from '@/trading/features/ledger/fields'
import { ledgerDraftInput, ledgerEditDraftInput } from '@/trading/features/portfolio/tools/input'
import { marketInput } from '@/trading/kernel/surface/surface'
import { bounded, scoped } from '@/trading/wiring/host/scope'

export type LedgerMethods = Pick<
  TradingHost,
  'listLedger' | 'previewLedger' | 'recordLedger' | 'updateLedgerEntry' | 'deleteLedgerEntry'
>

type DraftSchemas = ReturnType<typeof draftSchemas>

/** The field a whole-book refusal belongs to, so a form marks it there rather than at the top. */
const REFUSAL_FIELDS: ReadonlyMap<string, string> = new Map([
  ['errors.ledgerFxRateUnstated', 'operatorFxRate'],
  ['errors.ledgerCashShort', 'amount'],
  ['errors.ledgerCurrencyShort', 'amount'],
])

/** The same draft schemas the ledger tools use, built once: they resolve the venue and currency a
 *  row may omit, so a route that parsed its own would accept rows this one refuses. */
function draftSchemas(deps: TradingHostDeps): {
  readonly record: ReturnType<typeof ledgerDraftInput>
  readonly edit: ReturnType<typeof ledgerEditDraftInput>
} {
  const { marketData, portfolio } = deps.services
  const scope = {
    markets: marketInput(marketData.markets()),
    venues: portfolio,
    quotes: marketData,
    baseCurrency: deps.baseCurrency,
  }

  return { record: ledgerDraftInput(scope), edit: ledgerEditDraftInput(scope) }
}

function parseDraft<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    throw toFieldValidationError(parsed.error, 'ledger draft', toFieldLabel)
  }

  return parsed.data
}

export function ledgerMethods(deps: TradingHostDeps): LedgerMethods {
  const schemas = draftSchemas(deps)
  const { portfolio } = deps.services

  return {
    listLedger: (request) =>
      scoped(deps, request.signal, (scope) =>
        portfolio.historyAbsolute({
          limit: bounded(request.limit, deps.limits.maximumHistoryItems),
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          ...(request.range === undefined ? {} : { range: request.range }),
          ...(request.instrument === undefined ? {} : { instrument: request.instrument }),
          signal: scope.signal,
        })
      ),

    previewLedger: (request) => previewLedger(deps, schemas, request),
    recordLedger: (request) => recordLedger(deps, schemas, request),

    updateLedgerEntry: (request) =>
      scoped(deps, request.signal, (scope) =>
        withRefusalFields(
          portfolio.update({
            ref: request.entryId,
            draft: parseDraft(schemas.edit, request.draft),
            ...(request.typedPrice === undefined ? {} : { typedPrice: request.typedPrice }),
            now: scope.now,
            signal: scope.signal,
          })
        )
      ),

    deleteLedgerEntry: (request) =>
      scoped(deps, request.signal, (scope) =>
        portfolio.remove({ ref: request.entryId, now: scope.now, signal: scope.signal })
      ),
  }
}

function previewLedger(
  deps: TradingHostDeps,
  schemas: DraftSchemas,
  request: Parameters<TradingHost['previewLedger']>[0]
): ReturnType<TradingHost['previewLedger']> {
  return scoped(deps, request.signal, (scope) =>
    deps.services.portfolio.previewRecord({
      draft: parseDraft(schemas.record, request.draft),
      ...(request.entryId === undefined ? {} : { replacing: request.entryId }),
      now: scope.now,
      signal: scope.signal,
    })
  )
}

/** A row in another currency that states no rate is refused before it is written: the day's market
 *  rate would otherwise be booked as what the operator paid, a rate nobody saw. */
function recordLedger(
  deps: TradingHostDeps,
  schemas: DraftSchemas,
  request: Parameters<TradingHost['recordLedger']>[0]
): ReturnType<TradingHost['recordLedger']> {
  const { portfolio } = deps.services

  // Asked inside the write, after its replay lookup: a retried request whose first answer was lost
  // gets its row back, never a refusal from a book that already holds it.
  return scoped(deps, request.signal, (scope) =>
    withRefusalFields(
      portfolio.record({
        draft: parseDraft(schemas.record, request.draft),
        ...(request.typedPrice === undefined ? {} : { typedPrice: request.typedPrice }),
        idempotencyKey: request.idempotencyKey,
        requiresStatedRate: true,
        now: scope.now,
        signal: scope.signal,
      })
    )
  )
}

async function withRefusalFields<T>(write: Promise<T>): Promise<T> {
  try {
    return await write
  } catch (error: unknown) {
    const isPlain = error instanceof ValidationError && !(error instanceof FieldValidationError)
    const message = isPlain ? error.operator : undefined
    const path = message === undefined ? undefined : REFUSAL_FIELDS.get(message.key)

    if (!isPlain || message === undefined || path === undefined) {
      throw error
    }

    throw new FieldValidationError(error.message, [{ path, message }])
  }
}
