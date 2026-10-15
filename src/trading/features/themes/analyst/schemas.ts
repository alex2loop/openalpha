import { z } from 'zod'

import type { JsonOutputContract } from '@/core/llm'
import { toResearchOutputContract } from '@/engine/api'
import {
  EARNINGS_VERDICTS,
  SECTOR_EFFECTS,
  SECTOR_LINKAGES,
  THEME_ID_PATTERN,
  THEME_MATURITIES,
} from '@/trading/features/themes/types'
import { ICB_SUPERSECTORS } from '@/trading/kernel/market/market-data'

const MAXIMUM_CLAIMS = 6
export const MAXIMUM_CITATIONS = 6
const MAXIMUM_SOURCES = 6
const MAXIMUM_CONDITIONS = 4
/** A theme is a multi-month view; a shorter horizon is a trade, not a theme. */
const MINIMUM_HORIZON_MONTHS = 3
const MAXIMUM_HORIZON_MONTHS = 60
const MAXIMUM_TITLE_CHARS = 120
export const MAXIMUM_CLAIM_TEXT_CHARS = 400
const MAXIMUM_SUMMARY_CHARS = 700
/** A theme reaches a few sectors clearly; more is a list, not a judgment. */
export const MAXIMUM_SECTORS = 3
const MAXIMUM_CHAIN_CLAIMS = 4
export const MINIMUM_RATING = 1
export const MAXIMUM_RATING = 5
const MAXIMUM_EPS_GROWTH_PCT = 300
const MINIMUM_EPS_GROWTH_PCT = -100
export const MAXIMUM_TARGET_PE = 200

/** Discovery proposes at most this many per run, so the operator's queue stays readable. */
export const MAXIMUM_PROPOSALS = 3

const CLAIM = z.object({
  text: z.string().min(1).max(MAXIMUM_CLAIM_TEXT_CHARS),
  evidence: z.array(z.string().min(1)).min(1).max(MAXIMUM_CITATIONS),
})
const WEB = z.object({ url: z.url(), title: z.string().min(1) })
const READ_FIELDS = {
  summary: z.string().min(1).max(MAXIMUM_SUMMARY_CHARS),
  supporting: z.array(CLAIM).max(MAXIMUM_CLAIMS),
  counter: z.array(CLAIM).min(1).max(MAXIMUM_CLAIMS),
  probabilityPct: z.int().min(0).max(100),
  horizonMonths: z.int().min(MINIMUM_HORIZON_MONTHS).max(MAXIMUM_HORIZON_MONTHS),
  maturity: z.enum(THEME_MATURITIES),
  web: z.array(WEB).max(MAXIMUM_SOURCES),
}

const THEME_UPDATE_SCHEMA = z.object({
  ...READ_FIELDS,
  status: z.enum(['active', 'weakening']),
  invalidatedBy: z.int().min(1).max(MAXIMUM_CONDITIONS).optional(),
})
export type ThemeUpdateReply = z.infer<typeof THEME_UPDATE_SCHEMA>

const THEME_DISCOVERY_SCHEMA = z.object({
  proposals: z
    .array(
      z.object({
        ...READ_FIELDS,
        id: z.string().regex(new RegExp(THEME_ID_PATTERN)),
        title: z.string().min(1).max(MAXIMUM_TITLE_CHARS),
        thesis: z.string().min(1).max(MAXIMUM_SUMMARY_CHARS),
        beneficiaries: z.array(z.enum(ICB_SUPERSECTORS)).max(MAXIMUM_SECTORS),
        invalidation: z
          .array(z.string().min(1).max(MAXIMUM_CLAIM_TEXT_CHARS))
          .min(1)
          .max(MAXIMUM_CONDITIONS),
      })
    )
    .max(MAXIMUM_PROPOSALS),
})
export type ThemeDiscoveryReply = z.infer<typeof THEME_DISCOVERY_SCHEMA>
export type ThemeProposalReply = ThemeDiscoveryReply['proposals'][number]

const RATING = z.int().min(MINIMUM_RATING).max(MAXIMUM_RATING)
const SHARE_PCT = z.int().min(0).max(100)
const SCENARIO = z.object({
  probabilityPct: SHARE_PCT,
  epsGrowthPct: z.number().min(MINIMUM_EPS_GROWTH_PCT).max(MAXIMUM_EPS_GROWTH_PCT),
  targetPe: z.number().positive().max(MAXIMUM_TARGET_PE),
  summary: z.string().min(1).max(MAXIMUM_CLAIM_TEXT_CHARS),
})

const THEME_SECTOR_SCHEMA = z.object({
  sectors: z
    .array(
      z.object({
        sector: z.enum(ICB_SUPERSECTORS),
        linkage: z.enum(SECTOR_LINKAGES),
        effect: z.enum(SECTOR_EFFECTS),
        chain: z.string().min(1).max(MAXIMUM_SUMMARY_CHARS),
        criteria: z.object({
          demandGrowth: RATING,
          earningsGrowth: RATING,
          pricingPower: RATING,
          profitability: RATING,
          competition: RATING,
          governmentSupport: RATING,
          supplyDemand: RATING,
          capitalCycle: RATING,
          macroSensitivity: RATING,
          duration: RATING,
        }),
        supporting: z.array(CLAIM).max(MAXIMUM_CLAIMS),
        counter: z.array(CLAIM).min(1).max(MAXIMUM_CLAIMS),
        web: z.array(WEB).max(MAXIMUM_SOURCES),
      })
    )
    .max(MAXIMUM_SECTORS),
})
export type ThemeSectorReply = z.infer<typeof THEME_SECTOR_SCHEMA>
export type SectorEntryReply = ThemeSectorReply['sectors'][number]

const THEME_COMPANY_SCHEMA = z.object({
  estimatedRevenueSharePct: SHARE_PCT,
  forwardSharePct: SHARE_PCT,
  direction: z.enum(SECTOR_EFFECTS),
  exposureBasis: z.array(CLAIM).min(1).max(MAXIMUM_CLAIMS),
  verdict: z.enum(EARNINGS_VERDICTS),
  chain: z.array(CLAIM).min(1).max(MAXIMUM_CHAIN_CLAIMS),
  pricedIn: CLAIM,
  scenarios: z.object({ bull: SCENARIO, base: SCENARIO, bear: SCENARIO }),
  risks: z.array(CLAIM).min(1).max(MAXIMUM_CLAIMS),
  catalysts: z.array(CLAIM).max(MAXIMUM_CLAIMS),
  invalidation: z
    .array(z.string().min(1).max(MAXIMUM_CLAIM_TEXT_CHARS))
    .min(1)
    .max(MAXIMUM_CONDITIONS),
  horizonMonths: z.int().min(MINIMUM_HORIZON_MONTHS).max(MAXIMUM_HORIZON_MONTHS),
  web: z.array(WEB).max(MAXIMUM_SOURCES),
})
export type ThemeCompanyReply = z.infer<typeof THEME_COMPANY_SCHEMA>

/** The shape written into the prompt: a provider drops the wire contract while tools are offered,
 *  so a reply that may research has only this to go on. */
function toReplyShape(contract: JsonOutputContract): string {
  return `Return only JSON matching this schema:\n${JSON.stringify(contract.schema)}`
}

const UPDATE_CONTRACT = toResearchOutputContract('theme_update', THEME_UPDATE_SCHEMA)
const DISCOVERY_CONTRACT = toResearchOutputContract('theme_discovery', THEME_DISCOVERY_SCHEMA)
const SECTOR_CONTRACT = toResearchOutputContract('theme_sectors', THEME_SECTOR_SCHEMA)
const COMPANY_CONTRACT = toResearchOutputContract('theme_company', THEME_COMPANY_SCHEMA)

export const THEME_UPDATE_REPLY = Object.freeze({
  schema: THEME_UPDATE_SCHEMA,
  contract: UPDATE_CONTRACT,
  shape: toReplyShape(UPDATE_CONTRACT),
})
export const THEME_DISCOVERY_REPLY = Object.freeze({
  schema: THEME_DISCOVERY_SCHEMA,
  contract: DISCOVERY_CONTRACT,
  shape: toReplyShape(DISCOVERY_CONTRACT),
})
export const THEME_SECTOR_REPLY = Object.freeze({
  schema: THEME_SECTOR_SCHEMA,
  contract: SECTOR_CONTRACT,
  shape: toReplyShape(SECTOR_CONTRACT),
})
export const THEME_COMPANY_REPLY = Object.freeze({
  schema: THEME_COMPANY_SCHEMA,
  contract: COMPANY_CONTRACT,
  shape: toReplyShape(COMPANY_CONTRACT),
})
