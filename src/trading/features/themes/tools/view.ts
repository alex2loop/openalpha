import type { ToolDefinition } from '@/core/tool'
import type {
  Theme,
  ThemeId,
  ThemeReport,
  ThemeRunReads,
  ThemeScore,
  ThemeService,
} from '@/trading/features/themes/types'
import { createTool } from '@/core/tool'
import { toExpectedReturn } from '@/trading/features/themes/score/reads'
import { CLOSED_THEME_STATUSES } from '@/trading/features/themes/types'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { noInput } from '@/trading/kernel/surface/surface'

function toAgentScore(score: ThemeScore | undefined): {
  readonly score?: number
  readonly confidence?: ThemeScore['confidence']
} {
  return score === undefined ? {} : { score: score.value, confidence: score.confidence }
}

function toAgentSectors(themeId: ThemeId, reads: ThemeRunReads): unknown {
  return reads.sectors
    .filter((sector) => sector.themeId === themeId)
    .map((sector) => ({
      sector: sector.sector,
      linkage: sector.linkage,
      effect: sector.effect,
      ...toAgentScore(sector.score),
      chain: sector.chain,
      criteria: sector.criteria,
      supporting: sector.supporting.map((claim) => claim.text),
      counter: sector.counter.map((claim) => claim.text),
      stocks: reads.stocks
        .filter((stock) => stock.themeId === themeId && stock.sector === sector.sector)
        .map((stock) => ({
          ticker: stock.ticker,
          ...toAgentScore(stock.score),
          exposure: stock.exposure,
          exposureBasis: stock.exposureBasis.map((claim) => claim.text),
          verdict: stock.verdict,
          chain: stock.chain.map((claim) => claim.text),
          pricedIn: stock.pricedIn.text,
          scenarios: stock.scenarios,
          pe: stock.pe,
          expectedReturn: toExpectedReturn(stock),
          risks: stock.risks.map((claim) => claim.text),
          catalysts: stock.catalysts.map((claim) => claim.text),
          invalidation: stock.invalidation,
          horizonMonths: stock.horizonMonths,
          crowding: stock.crowding,
          earningsSurprise: stock.surprise,
          missingData: stock.missing,
        })),
    }))
}

function toAgentTheme(theme: Theme, report: ThemeReport): unknown {
  const read = report.reads.themes.find((entry) => entry.themeId === theme.id)
  const readRun = report.readRuns.get(theme.id)
  const chainRun = report.chainRuns.get(theme.id)

  return {
    id: theme.id,
    title: theme.title,
    thesis: theme.thesis,
    status: theme.status,
    maturity: theme.maturity,
    invalidation: theme.invalidation,
    readAt: readRun === undefined ? null : new Date(readRun.finishedAt).toISOString(),
    // Sectors and companies from an earlier check, when the last one could not reach them.
    ...(chainRun === undefined
      ? {}
      : { sectorsReadAt: new Date(chainRun.finishedAt).toISOString() }),
    missingData: readRun?.gaps ?? [],
    ...(read === undefined
      ? {}
      : {
          probabilityPct: read.probabilityPct,
          ...toAgentScore(read.score),
          previousProbabilityPct: read.previousProbabilityPct,
          horizonMonths: read.horizonMonths,
          summary: read.summary,
          supporting: read.supporting.map((claim) => claim.text),
          counter: read.counter.map((claim) => claim.text),
          invalidatedBy: read.invalidatedBy,
          beneficiaries: read.beneficiaries,
          sources: read.web,
        }),
    sectors: toAgentSectors(theme.id, report.reads),
  }
}

function toAgentThemeReport(report: ThemeReport): unknown {
  return {
    lastRunAt: report.run === undefined ? null : new Date(report.run.finishedAt).toISOString(),
    missingData: report.run?.gaps ?? [],
    trackRecord: report.scorecard.lines,
    themes: report.themes
      .filter((theme) => !CLOSED_THEME_STATUSES.includes(theme.status))
      .map((theme) => toAgentTheme(theme, report)),
  }
}

export function createThemesViewTool(themes: Pick<ThemeService, 'show'>): ToolDefinition {
  return createTool({
    name: 'themes_view',
    description:
      "Read the stored top-down theme report for Vietnamese equities: the investment themes the operator tracks, any found invalidated, and new ones waiting for the operator's approval, each with its probability (`probabilityPct`, percent) of playing out within `horizonMonths`, its maturity, a summary, the supporting and counter claims, and the conditions that would end it; a proposal also names the sectors it expects to gain (`beneficiaries`). Stored from earlier /themes runs, so it calls no model and may be days old: each theme's `readAt` says when it was last read and its `missingData` what that read could not see, since `/themes run <id>` re-reads one theme and leaves the rest as they were; `lastRunAt` and the top-level `missingData` describe the latest run; `news-capped` means more headlines came in than one run reads, so only the newest went in. Claims arrive in the operator's language; quote them, never translate. For each active theme it also lists the sectors the theme reaches (`linkage`, `effect`, ten criteria rated 1-5) and, under the sectors it helps, the names code shortlisted from the screened board: exposure (`estimatedRevenueSharePct` is the model's estimate, `blendedPct` blends it with the forward share by the theme's maturity), whether earnings really change, whether it is priced in, bull/base/bear scenarios (`epsGrowthPct` and `targetPe` per case), risks, catalysts, crowding signals and the latest quarter's earnings surprise. `crowding.excessReturn` (twelve months against VN-Index) and `earningsSurprise.growth` are fractions (0.25 is 25%); `pePercentile` is 0-100. Every theme, sector and name carries a code-computed `score` (0-100; absent when too little was read to score it) and `confidence` (low, medium, high); each name also carries its current `pe` and `expectedReturn`, the scenarios' odds-weighted return over `horizonMonths` (a fraction, absent without a P/E). `trackRecord` says, per `horizonMonths` and level, how reads in each score bucket (`high` 80 and up, `middle` 60 to 80, `low` below 60) did against VN-Index, one name or sector counted once per run and per window: `excessReturn` is a fraction and stays absent while a bucket holds too few reads to judge, and `separates` appears once every bucket can be judged. The model never picks the names and no price or position is stated: for a trade idea on one name use suggestion_run; for which sectors lead use market_sector_strength.",
    inputSchema: noInput,
    capability: 'read',
    presentation: { label: 'Investment themes', emoji: '🔭' },
    async execute(_args, ctx): Promise<string> {
      return toAgentJson(toAgentThemeReport(await themes.show(ctx.signal)))
    },
  })
}
