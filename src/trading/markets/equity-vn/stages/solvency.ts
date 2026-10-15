import type { Caveat } from '@/trading/kernel/caveat'
import type { FundamentalSnapshot, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { lowerBand } from '@/trading/kernel/conviction'
import {
  BANK_SECTOR,
  MAXIMUM_BANK_ASSETS_TO_EQUITY,
  MAXIMUM_DEBT_TO_EQUITY,
  MINIMUM_NET_MARGIN_PCT,
  MINIMUM_RETURN_ON_EQUITY_PCT,
  STRONG_RETURN_ON_EQUITY_PCT,
  VN_MARKET_REF,
} from '@/trading/markets/equity-vn/policy'
import { loweredDecision, STAGE_PASS } from '@/trading/markets/stage'

const SOLVENCY_STAGE_ID = 'equity-vn-solvency'
const SOLVENCY_STAGE_ORDER = 11

/** What the factor composite cannot express: a balance sheet that makes the equity story moot.
 *  Quality is one rank-normalized factor among eight, so a distressed name inside a distressed
 *  cohort still scores mid-pack — this is the floor that ranking cannot provide. */
export function createVnSolvencyStage(crossSection: CrossSectionCache): Stage {
  return {
    id: SOLVENCY_STAGE_ID,
    phase: 'gate',
    order: SOLVENCY_STAGE_ORDER,
    evaluate: (input) => evaluate(crossSection, input),
  }
}

async function evaluate(cache: CrossSectionCache, input: StageInput): Promise<StageDecision> {
  const { suggestion } = input

  // Buys only: a weak balance sheet argues for a reduce, so discounting one here would lower
  // conviction in exactly the call the evidence supports.
  if (suggestion.instrument.market !== VN_MARKET_REF || suggestion.action !== 'buy') {
    return STAGE_PASS
  }

  const section = await cache.get(suggestion.at, input.signal)
  const name = section.byTicker.get(suggestion.instrument.ticker)

  // An absent snapshot is already reported by the quality factor's own missing-input caveat.
  if (name === undefined || name.fundamental === null) {
    return STAGE_PASS
  }

  const leverage = leverageCaveat(name.fundamental, name.record)

  if (leverage !== undefined) {
    return loweredDecision(suggestion.conviction, 'low', [leverage])
  }

  return isWeaklyProfitable(name.fundamental)
    ? loweredDecision(suggestion.conviction, lowerBand(suggestion.conviction), [
        { code: 'suggestion.profitability-below-minimum' },
      ])
    : STAGE_PASS
}

/** Two measures for one question, because the provider publishes no debt-to-equity ratio for a VN
 *  bank and a bank's assets-to-equity is not comparable to an industrial's debt-to-equity anyway. */
function leverageCaveat(
  snapshot: FundamentalSnapshot,
  record: InstrumentRecord
): Caveat | undefined {
  return record.sector === BANK_SECTOR ? bankLeverageCaveat(snapshot) : debtLeverageCaveat(snapshot)
}

function debtLeverageCaveat(snapshot: FundamentalSnapshot): Caveat | undefined {
  const { debtToEquity } = snapshot

  if (debtToEquity === undefined || debtToEquity <= MAXIMUM_DEBT_TO_EQUITY) {
    return undefined
  }

  return {
    code: 'suggestion.leverage-above-maximum',
    detail: { value: debtToEquity, maximum: MAXIMUM_DEBT_TO_EQUITY },
  }
}

/** Assets to equity from the DuPont identity. A non-positive or absent return on assets makes the
 *  quotient meaningless rather than large, so it abstains: a bank that lost money last year would
 *  otherwise divide toward infinity and be floored for the loss rather than for its leverage, which
 *  is a different finding the profitability arm below already owns. */
function bankLeverageCaveat(snapshot: FundamentalSnapshot): Caveat | undefined {
  const { returnOnEquityPct, returnOnAssetsPct } = snapshot

  if (returnOnEquityPct === undefined || returnOnAssetsPct === undefined) {
    return undefined
  }

  if (returnOnAssetsPct <= 0) {
    return undefined
  }

  const assetsToEquity = returnOnEquityPct / returnOnAssetsPct

  if (assetsToEquity <= MAXIMUM_BANK_ASSETS_TO_EQUITY) {
    return undefined
  }

  return {
    code: 'suggestion.assets-to-equity-above-maximum',
    detail: { value: assetsToEquity, maximum: MAXIMUM_BANK_ASSETS_TO_EQUITY },
  }
}

/** A strong return on equity is the escape hatch: it excuses a thin margin, because one weak
 *  component describes a business model rather than a deteriorating one. */
function isWeaklyProfitable(snapshot: FundamentalSnapshot): boolean {
  const { returnOnEquityPct, netMarginPct } = snapshot

  if (returnOnEquityPct !== undefined && returnOnEquityPct >= STRONG_RETURN_ON_EQUITY_PCT) {
    return false
  }

  return (
    (returnOnEquityPct !== undefined && returnOnEquityPct < MINIMUM_RETURN_ON_EQUITY_PCT) ||
    (netMarginPct !== undefined && netMarginPct < MINIMUM_NET_MARGIN_PCT)
  )
}
