import type { z } from 'zod'

import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { toFieldValidationError } from '@/core/field-errors'
import { toFieldLabel } from '@/trading/features/ledger/fields'
import { ledgerDraftInput, ledgerEditDraftInput } from '@/trading/features/portfolio/tools/input'
import { marketInput } from '@/trading/kernel/surface/surface'
import { bounded, scoped } from '@/trading/wiring/host/scope'

export type LedgerMethods = Pick<
  TradingHost,
  'listLedger' | 'recordLedger' | 'updateLedgerEntry' | 'deleteLedgerEntry'
>

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

    recordLedger: (request) =>
      scoped(deps, request.signal, (scope) =>
        portfolio.record({
          draft: parseDraft(schemas.record, request.draft),
          ...(request.typedPrice === undefined ? {} : { typedPrice: request.typedPrice }),
          idempotencyKey: request.idempotencyKey,
          now: scope.now,
          signal: scope.signal,
        })
      ),

    updateLedgerEntry: (request) =>
      scoped(deps, request.signal, (scope) =>
        portfolio.update({
          ref: request.entryId,
          draft: parseDraft(schemas.edit, request.draft),
          ...(request.typedPrice === undefined ? {} : { typedPrice: request.typedPrice }),
          now: scope.now,
          signal: scope.signal,
        })
      ),

    deleteLedgerEntry: (request) =>
      scoped(deps, request.signal, (scope) =>
        portfolio.remove({ ref: request.entryId, now: scope.now, signal: scope.signal })
      ),
  }
}
