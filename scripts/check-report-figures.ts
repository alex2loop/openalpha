#!/usr/bin/env bun
import type { ToolAudience } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type { SuggestionReportDeps } from '@/trading/features/suggestion/report'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import { renderAgentReport } from '@/trading/features/suggestion/report'
import { buildSuggestionId } from '@/trading/features/suggestion/types'
import { factorComposite } from '@/trading/kernel/factor'
import {
  currencyCode,
  marketRef,
  strategyId,
  ticker,
  tradingDay,
} from '@/trading/kernel/instrument'
import { formatQuantity } from '@/trading/render/format'
import { formatPriceIn } from '@/trading/render/money'

const LOCALES: readonly Locale[] = ['en', 'vi']
const AUDIENCES: readonly ToolAudience[] = ['agent', 'operator']
const CURRENCY = currencyCode('VND')
const AT = tradingDay('2026-09-29')
const LOT_SIZE = 100
const LEVELS = Object.freeze({
  entry: 43_000,
  stop: 38_900,
  target: 55_500,
  takeProfit: 47_150,
  riskReward: 2,
})
/** A sale's levels mirror a buy's: the stop above the price, the target and take-profit below it. */
const SALE_LEVELS = Object.freeze({
  ...LEVELS,
  stop: LEVELS.target,
  target: LEVELS.stop,
  takeProfit: LEVELS.stop,
})
const ORDER = Object.freeze({ units: 1_300, policyUnits: 7_700, sizePctNav: 0.03 })

/** Three holdings a model must not be able to tell apart: the same weight and the same share banked
 *  at the take-profit, with a different cost, and a different size. */
const BASE_HOLDING: HeldPosition = {
  units: 400,
  unitCostNative: 42_330,
  settledUnits: 200,
  openLotCount: 3,
  firstAcquiredAt: tradingDay('2026-09-24'),
  pctNav: 0.0851,
  settlesOn: tradingDay('2026-10-01'),
}
const COST_VARIANT: HeldPosition = { ...BASE_HOLDING, unitCostNative: 51_170 }
const SIZE_VARIANT: HeldPosition = { ...BASE_HOLDING, units: 800, settledUnits: 400 }

type Arm = (held: HeldPosition) => StoredSuggestion

interface Leak {
  readonly arm: string
  readonly locale: Locale
  readonly audience: ToolAudience
  readonly problem: string
}

const ARMS: Readonly<Record<string, Arm>> = Object.freeze({
  'hold framed as a buy': (held) => holdOf(held, { direction: 'buy' }),
  'hold framed as a sale': (held) => holdOf(held, { direction: 'reduce' }),
  'hold on a fund': (held) => holdOf(held, { direction: 'buy', reviewOnly: true }),
  'buy adding to a holding': (held) => actionableOf(held, 'buy'),
  'reduce of a holding': (held) => actionableOf(held, 'reduce'),
  'buy carrying the holding\'s own caveats': (held) => ({
    ...actionableOf(held, 'buy'),
    caveats: operatorCaveatsOf(held),
  }),
})

const REPORT_DEPS: SuggestionReportDeps = {
  suggestions: {
    summarize: () => Promise.reject(new Error('fixture')),
    listResolved: () => Promise.resolve([]),
  },
  marketData: {
    quoteConvention: () => undefined,
    minimumRiskReward: () => undefined,
    boardLot: () => ({ size: LOT_SIZE }),
    trailsStop: () => true,
  },
  profiles: { get: () => Promise.reject(new Error('fixture')) },
  costs: {},
  defaultVenues: {},
  timezone: 'UTC',
}

function baseOf(held: HeldPosition): Omit<StoredSuggestion, 'action'> {
  return {
    id: buildSuggestionId(0),
    createdAt: 0,
    instrument: { market: marketRef('equity-vn'), ticker: ticker('VGC') },
    at: AT,
    authoredLocale: 'vi',
    profile: { riskLevel: 'balanced', goal: 'grow', saved: true },
    horizon: 'long',
    strategyId: strategyId('equity-vn'),
    strategyVersion: '1.0.0',
    calculationVersions: [],
    conviction: 'medium',
    citations: [],
    provenance: [],
    caveats: [],
    factorScores: [],
    composite: factorComposite({
      score: 0.43,
      band: 'high',
      bearish: false,
      bullish: true,
      coverage: 0.9,
      coverageBelowMinimum: false,
      agreementBelowMinimum: false,
    }),
    held,
    quote: { price: LEVELS.entry, currency: CURRENCY, observedAt: 0, changePct: 0.58 },
    takeProfitTranchePct: 0.25,
  }
}

function holdOf(
  held: HeldPosition,
  frame: { readonly direction: 'buy' | 'reduce'; readonly reviewOnly?: true }
): StoredSuggestion {
  const levels = frame.direction === 'reduce' ? SALE_LEVELS : LEVELS

  return {
    ...baseOf(held),
    ...levels,
    ...(frame.reviewOnly === undefined ? {} : { reviewOnly: frame.reviewOnly }),
    action: 'hold',
    direction: frame.direction,
    holdReasonCodes: ['cap-exhausted'],
  }
}

function actionableOf(held: HeldPosition, action: 'buy' | 'reduce'): StoredSuggestion {
  return {
    ...baseOf(held),
    ...(action === 'reduce' ? SALE_LEVELS : LEVELS),
    ...ORDER,
    action,
    thesis: 'fixture',
  }
}

/** Figures read off the holding's cost, so a report that prints them changes with the cost. */
function operatorCaveatsOf(held: HeldPosition): StoredSuggestion['caveats'] {
  const underwater = 1 - LEVELS.entry / held.unitCostNative

  return [
    { code: 'suggestion.averaging-down', detail: { underwater } },
    { code: 'suggestion.averaging-down-net', detail: { underwater } },
    { code: 'suggestion.recent-exit', detail: { realizedLoss: underwater, sessions: 4 } },
  ]
}

function reportOf(
  suggestion: StoredSuggestion,
  view: { readonly locale: Locale; readonly audience: ToolAudience }
): Promise<string> {
  return renderAgentReport(REPORT_DEPS, {
    result: { kind: 'completed', suggestion, reused: false },
    locale: view.locale,
    audience: view.audience,
    signal: new AbortController().signal,
  })
}

/** Figures that may never appear, whatever the audience: the cost, and the size the caps allowed. */
function forbiddenFigures(locale: Locale, audience: ToolAudience): readonly string[] {
  const quoted = { currency: CURRENCY }
  const always = [
    formatPriceIn(locale, BASE_HOLDING.unitCostNative, quoted),
    formatQuantity(locale, ORDER.policyUnits),
  ]

  // The operator's own client is sent the order quantity; every other reader is sent none.
  return audience === 'operator' ? always : [...always, formatQuantity(locale, ORDER.units)]
}

/** The operator's own client is sent the order quantity and the weight, which imply the size, so
 *  only the cost has to leave that report unchanged. Every other reader gets neither. */
function variantsFor(audience: ToolAudience): readonly HeldPosition[] {
  return audience === 'operator' ? [COST_VARIANT] : [COST_VARIANT, SIZE_VARIANT]
}

async function leaksOf(
  name: string,
  arm: Arm,
  view: { readonly locale: Locale; readonly audience: ToolAudience }
): Promise<readonly Leak[]> {
  const report = await reportOf(arm(BASE_HOLDING), view)
  const variants = await Promise.all(variantsFor(view.audience).map((held) => reportOf(arm(held), view)))
  const leaked = forbiddenFigures(view.locale, view.audience).filter((figure) =>
    report.includes(figure)
  )
  const problems = [
    ...leaked.map((figure) => `prints ${figure}`),
    ...(variants.every((variant) => variant === report)
      ? []
      : ['changes with the holding\'s cost or size']),
  ]

  return problems.map((problem) => ({ arm: name, ...view, problem }))
}

async function main(): Promise<void> {
  const checks = Object.entries(ARMS).flatMap(([name, arm]) =>
    LOCALES.flatMap((locale) =>
      AUDIENCES.map((audience) => leaksOf(name, arm, { locale, audience }))
    )
  )
  const leaks = (await Promise.all(checks)).flat()

  if (leaks.length > 0) {
    for (const leak of leaks) {
      console.error(`  ${leak.arm} (${leak.locale}, ${leak.audience}): ${leak.problem}`)
    }

    console.error(
      `FAIL: ${leaks.length} report leak(s) - a line stating the holding's size or cost needs its Withheld twin`
    )
    process.exit(1)
  }

  console.log(`check-report-figures: PASS (${checks.length} reports)`)
}

await main()
