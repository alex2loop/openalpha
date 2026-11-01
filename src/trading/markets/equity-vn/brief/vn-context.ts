import type { BriefContext, BriefHome } from '@/trading/markets/brief-context'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import { readVnEvents } from '@/trading/markets/equity-vn/brief/events-read'
import {
  VN_MACRO_DRIVERS,
  VN_MACRO_FORMULA_VERSION,
  VN_MARKET_REF,
  VN_MARKET_REGION,
} from '@/trading/markets/equity-vn/policy'

/** The brief context as the VN builders read it: its board is the VN cross-section. */
export type VnBriefContext = BriefContext<CrossSection>

export const VN_BRIEF_HOME: BriefHome<CrossSection> = Object.freeze({
  market: VN_MARKET_REF,
  region: VN_MARKET_REGION,
  macroDrivers: VN_MACRO_DRIVERS,
  macroFormulaVersion: VN_MACRO_FORMULA_VERSION,
  namesOf: (board: CrossSection) =>
    board.names.map((name) => ({
      instrument: name.record.instrument,
      ...(name.turnover === undefined ? {} : { turnover: name.turnover }),
    })),
  sectorsOf: (board: CrossSection) => board.sectors,
  readEvents: readVnEvents,
})
