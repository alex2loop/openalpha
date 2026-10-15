// Imported as text, not read from disk, so `bun build --compile` embeds every skill in the binary.
// App passes these to the one engine-owned `SkillCatalog` alongside the canonical user, configured,
// and plugin directories; trading owns no parser, cache, or visibility rule of its own. The record
// is keyed by the front-matter name the catalog indexes on, and annotated with the whole
// `SkillName` record, so a missing skill and an unknown one are both compile errors.
import type { SkillName } from '@/trading/kernel/skill'
import { ConfigError } from '@/core/errors'
import { readSkillMeta } from '@/engine/api'
import behavioralFinance from '@/trading/skills/behavioral-finance/SKILL.md' with { type: 'text' }
import capitalAllocation from '@/trading/skills/capital-allocation/SKILL.md' with { type: 'text' }
import correlationAnalysis from '@/trading/skills/correlation-analysis/SKILL.md' with {
  type: 'text',
}
import crowdingAndUnwind from '@/trading/skills/crowding-and-unwind/SKILL.md' with { type: 'text' }
import cryptoAnalysis from '@/trading/skills/crypto-analysis/SKILL.md' with { type: 'text' }
import cryptoExecution from '@/trading/skills/crypto-execution/SKILL.md' with { type: 'text' }
import drawdownResponse from '@/trading/skills/drawdown-response/SKILL.md' with { type: 'text' }
import exitManagement from '@/trading/skills/exit-management/SKILL.md' with { type: 'text' }
import goldAnalysis from '@/trading/skills/gold-analysis/SKILL.md' with { type: 'text' }
import intrinsicValue from '@/trading/skills/intrinsic-value/SKILL.md' with { type: 'text' }
import inversion from '@/trading/skills/inversion/SKILL.md' with { type: 'text' }
import macroLiquidityAnalysis from '@/trading/skills/macro-liquidity-analysis/SKILL.md' with {
  type: 'text',
}
import moatAnalysis from '@/trading/skills/moat-analysis/SKILL.md' with { type: 'text' }
import portfolioRiskAnalysis from '@/trading/skills/portfolio-risk-analysis/SKILL.md' with {
  type: 'text',
}
import profitTaking from '@/trading/skills/profit-taking/SKILL.md' with { type: 'text' }
import qualityScreen from '@/trading/skills/quality-screen/SKILL.md' with { type: 'text' }
import recover from '@/trading/skills/recover/SKILL.md' with { type: 'text' }
import researchScoping from '@/trading/skills/research-scoping/SKILL.md' with { type: 'text' }
import technicalAnalysis from '@/trading/skills/technical-analysis/SKILL.md' with { type: 'text' }
import trackRecordReading from '@/trading/skills/track-record-reading/SKILL.md' with {
  type: 'text',
}
import vnDailyBuy from '@/trading/skills/vn-daily-buy/SKILL.md' with { type: 'text' }
import vnDeepDive from '@/trading/skills/vn-deep-dive/SKILL.md' with { type: 'text' }
import vnDividendAnalysis from '@/trading/skills/vn-dividend-analysis/SKILL.md' with {
  type: 'text',
}
import vnEarningsPlaybook from '@/trading/skills/vn-earnings-playbook/SKILL.md' with {
  type: 'text',
}
import vnExecution from '@/trading/skills/vn-execution/SKILL.md' with { type: 'text' }
import vnMarketRules from '@/trading/skills/vn-market-rules/SKILL.md' with { type: 'text' }
import vnSectorRotation from '@/trading/skills/vn-sector-rotation/SKILL.md' with { type: 'text' }
import vnValuation from '@/trading/skills/vn-valuation/SKILL.md' with { type: 'text' }

export const TRADING_SKILLS: Readonly<Record<SkillName, string>> = Object.freeze({
  'behavioral-finance': behavioralFinance,
  'capital-allocation': capitalAllocation,
  'correlation-analysis': correlationAnalysis,
  'crowding-and-unwind': crowdingAndUnwind,
  'crypto-analysis': cryptoAnalysis,
  'crypto-execution': cryptoExecution,
  'drawdown-response': drawdownResponse,
  'exit-management': exitManagement,
  'gold-analysis': goldAnalysis,
  'intrinsic-value': intrinsicValue,
  inversion,
  'macro-liquidity-analysis': macroLiquidityAnalysis,
  'moat-analysis': moatAnalysis,
  'portfolio-risk-analysis': portfolioRiskAnalysis,
  'profit-taking': profitTaking,
  'quality-screen': qualityScreen,
  recover,
  'research-scoping': researchScoping,
  'technical-analysis': technicalAnalysis,
  'track-record-reading': trackRecordReading,
  'vn-daily-buy': vnDailyBuy,
  'vn-deep-dive': vnDeepDive,
  'vn-dividend-analysis': vnDividendAnalysis,
  'vn-earnings-playbook': vnEarningsPlaybook,
  'vn-execution': vnExecution,
  'vn-market-rules': vnMarketRules,
  'vn-sector-rotation': vnSectorRotation,
  'vn-valuation': vnValuation,
})

/** Front-matter `name@version` for every embedded trading skill, hashed into the calculation
 *  versions so a skill edit separates recorded populations exactly as a strategy edit does. An
 *  unreadable version would fold two populations into one hash, so it fails the boot. */
export function skillVersions(): readonly string[] {
  return Object.entries(TRADING_SKILLS)
    .map(([name, text]) => {
      const version = readSkillMeta(text)?.version

      if (version === undefined || version.trim() === '') {
        throw new ConfigError(`trading skill '${name}' declares no version`)
      }

      return `${name}@${version}`
    })
    .sort()
}
