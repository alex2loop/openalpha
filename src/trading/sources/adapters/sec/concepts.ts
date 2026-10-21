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
  { line: 'netProfitToParent', tags: Object.freeze(['NetIncomeLoss']) },
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

/** Cover-page share count, on its own taxonomy. */
export const SHARES_CONCEPT = Object.freeze({
  taxonomy: 'dei',
  tag: 'EntityCommonStockSharesOutstanding',
})
