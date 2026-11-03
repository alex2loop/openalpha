import type { AccountLines } from '@/trading/kernel/market/annual-accounts'

type FlowLine = Extract<
  keyof AccountLines,
  'netRevenue' | 'grossProfit' | 'netProfitToParent' | 'operatingCashFlow' | 'capitalExpenditure'
>
type InstantLine = Extract<keyof AccountLines, 'totalAssets' | 'totalEquity'>

interface Concept<L extends keyof AccountLines> {
  readonly line: L
  /** In order of preference: a filer reports one of these, and the first that answers wins. */
  readonly tags: readonly string[]
}

export interface TaxonomyConcepts {
  readonly taxonomy: string
  readonly flows: readonly Concept<FlowLine>[]
  readonly instants: readonly Concept<InstantLine>[]
}

/** Annual flows, from the calendar-year frames. A 10-Q flow is year-to-date and the frames carry no
 *  three-month Q4, so no quarter rows are read. Expenses and outflows are positive amounts. */
export const FLOW_CONCEPTS: readonly Concept<FlowLine>[] = Object.freeze([
  {
    line: 'netRevenue',
    tags: Object.freeze([
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
    ]),
  },
  { line: 'grossProfit', tags: Object.freeze(['GrossProfit']) },
  {
    line: 'netProfitToParent',
    // Several banks and utilities (PNC, Truist, AEP) tag only the figure after preferred dividends.
    tags: Object.freeze(['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic']),
  },
  {
    line: 'operatingCashFlow',
    tags: Object.freeze(['NetCashProvidedByUsedInOperatingActivities']),
  },
  {
    line: 'capitalExpenditure',
    tags: Object.freeze(['PaymentsToAcquirePropertyPlantAndEquipment']),
  },
])

/** Balance-sheet instants, from the quarter-end instant frames, each kept for the fiscal year that
 *  closes on its date. Equity is the consolidated figure that includes the minority, as
 *  `totalEquity` is everywhere else. */
export const INSTANT_CONCEPTS: readonly Concept<InstantLine>[] = Object.freeze([
  { line: 'totalAssets', tags: Object.freeze(['Assets']) },
  {
    line: 'totalEquity',
    tags: Object.freeze([
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
      'StockholdersEquity',
    ]),
  },
])

export const US_GAAP_CONCEPTS: TaxonomyConcepts = Object.freeze({
  taxonomy: 'us-gaap',
  flows: FLOW_CONCEPTS,
  instants: INSTANT_CONCEPTS,
})

/** A foreign issuer's 20-F or 40-F lines. Profit falls back to the consolidated figure, minority
 *  included, where the parent's share is not tagged. */
const IFRS_FLOW_CONCEPTS: readonly Concept<FlowLine>[] = Object.freeze([
  { line: 'netRevenue', tags: Object.freeze(['Revenue', 'RevenueFromContractsWithCustomers']) },
  { line: 'grossProfit', tags: Object.freeze(['GrossProfit']) },
  {
    line: 'netProfitToParent',
    tags: Object.freeze(['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss']),
  },
  { line: 'operatingCashFlow', tags: Object.freeze(['CashFlowsFromUsedInOperatingActivities']) },
  {
    line: 'capitalExpenditure',
    tags: Object.freeze(['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities']),
  },
])

const IFRS_INSTANT_CONCEPTS: readonly Concept<InstantLine>[] = Object.freeze([
  { line: 'totalAssets', tags: Object.freeze(['Assets']) },
  { line: 'totalEquity', tags: Object.freeze(['Equity']) },
])

const IFRS_CONCEPTS: TaxonomyConcepts = Object.freeze({
  taxonomy: 'ifrs-full',
  flows: IFRS_FLOW_CONCEPTS,
  instants: IFRS_INSTANT_CONCEPTS,
})

/** The taxonomies a company's own facts are read under, first match wins: a filer uses one. */
export const COMPANY_FACT_TAXONOMIES: readonly TaxonomyConcepts[] = Object.freeze([
  IFRS_CONCEPTS,
  US_GAAP_CONCEPTS,
])

/** Cover-page share count, on its own taxonomy. */
export const SHARES_CONCEPT = Object.freeze({
  taxonomy: 'dei',
  tag: 'EntityCommonStockSharesOutstanding',
})
