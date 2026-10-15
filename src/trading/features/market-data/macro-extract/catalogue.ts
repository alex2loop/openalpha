/** Bounds sit well past anything VN has printed in twenty years: outside them is a misread. */

type MacroSeriesOrigin = 'report' | 'press'
/** A change can fall below zero and the text says so in words ("giảm 2,1%"); a level cannot, and
 *  the words before it name a move to it ("giảm xuống 51,9"), not its sign. */
type MacroSeriesMeasure = 'change' | 'level'

export interface MacroSeriesSpec {
  readonly id: string
  readonly origin: MacroSeriesOrigin
  readonly measure: MacroSeriesMeasure
  readonly description: string
  readonly minimum: number
  readonly maximum: number
  readonly quarterly: boolean
}

const MACRO_SERIES: readonly MacroSeriesSpec[] = Object.freeze([
  {
    id: 'vn-gdp-yoy',
    origin: 'report',
    measure: 'change',
    quarterly: true,
    minimum: -15,
    maximum: 20,
    description: 'GDP growth of the quarter against the same quarter a year earlier, percent',
  },
  {
    id: 'vn-cpi-yoy',
    origin: 'report',
    measure: 'change',
    quarterly: false,
    minimum: -5,
    maximum: 30,
    description: 'CPI of the month against the same month a year earlier, percent',
  },
  {
    id: 'vn-iip-yoy',
    origin: 'report',
    measure: 'change',
    quarterly: false,
    minimum: -30,
    maximum: 40,
    description:
      'Industrial production index (IIP) of the month against the same month a year earlier, percent',
  },
  {
    id: 'vn-retail-yoy',
    origin: 'report',
    measure: 'change',
    quarterly: false,
    minimum: -30,
    maximum: 50,
    description:
      'Retail sales of goods and consumer services in the month against the same month a year earlier, percent',
  },
  {
    id: 'vn-exports',
    origin: 'report',
    measure: 'level',
    quarterly: false,
    minimum: 5,
    maximum: 150,
    description: 'Goods exports in the month, billion USD',
  },
  {
    id: 'vn-imports',
    origin: 'report',
    measure: 'level',
    quarterly: false,
    minimum: 5,
    maximum: 150,
    description: 'Goods imports in the month, billion USD',
  },
  {
    id: 'vn-fdi-disbursed-ytd',
    origin: 'report',
    measure: 'level',
    quarterly: false,
    minimum: 0,
    maximum: 80,
    description: 'Disbursed (realised) FDI from January to the end of the month, billion USD',
  },
  {
    id: 'vn-credit-growth-ytd',
    origin: 'report',
    measure: 'change',
    quarterly: false,
    minimum: -10,
    maximum: 40,
    description: 'Credit growth of the economy since the end of last year, percent',
  },
  {
    id: 'vn-investment-yoy',
    origin: 'report',
    measure: 'change',
    quarterly: true,
    minimum: -30,
    maximum: 50,
    description:
      'Total social investment of the quarter against the same quarter a year earlier, percent',
  },
  {
    id: 'vn-visitors',
    origin: 'report',
    measure: 'level',
    quarterly: false,
    minimum: 0,
    maximum: 10,
    description: 'International visitor arrivals in the month, million',
  },
  {
    id: 'vn-pmi',
    origin: 'press',
    measure: 'level',
    quarterly: false,
    minimum: 30,
    maximum: 70,
    description: 'S&P Global Vietnam Manufacturing PMI for the month, index points',
  },
  {
    id: 'vn-public-investment-plan-pct',
    origin: 'press',
    measure: 'level',
    quarterly: false,
    minimum: 0,
    maximum: 110,
    description: 'Public investment disbursed so far this year, percent of the annual plan',
  },
])

export const REPORT_SERIES = MACRO_SERIES.filter((series) => series.origin === 'report')
export const PRESS_SERIES = MACRO_SERIES.filter((series) => series.origin === 'press')
