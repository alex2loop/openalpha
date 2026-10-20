import type { ToolDefinition } from '@/core/tool'
import type { SlashCommand } from '@/core/types/command'
import type { PortfolioSegment, Region, VenueRef } from '@/trading/kernel/instrument'
import type { MarketManifest } from '@/trading/markets/types'
import { ALERT_STATES, DISABLE_ALERT_RESULTS, EXIT_LEVELS } from '@/trading/features/alerts/types'
import {
  BRIEF_DELIVERY_STATES,
  BRIEF_SUPPRESSED_REASONS,
  DISABLE_BRIEF_RESULTS,
} from '@/trading/features/brief/types'
import { SYNC_SKIP_REASONS } from '@/trading/features/ledger/sync'
import { LEDGER_TXN_KINDS } from '@/trading/features/ledger/types'
import { INTRADAY_FIELDS } from '@/trading/features/market-data/intraday/types'
import { BENCHMARK_GAPS, NAV_WINDOWS } from '@/trading/features/portfolio/nav/types'
import { CAP_REASONS, REBALANCE_UNAVAILABLE_REASONS } from '@/trading/features/portfolio/types'
import {
  MANAGER_VERDICTS,
  RESEARCH_STANCES,
  RISK_VERDICTS,
  SIZING_INTENTS,
  TRADE_STANCES,
} from '@/trading/features/suggestion/debate/types'
import {
  OUTCOME_PENDING_REASONS,
  SUGGESTION_UNSUPPORTED_REASONS,
} from '@/trading/features/suggestion/types'
import { SCORECARD_LEVELS } from '@/trading/features/themes/outcomes/scorecard-types'
import {
  EARNINGS_VERDICTS,
  EXPOSURE_LABELS,
  SCORE_CONFIDENCES,
  SCORE_PARTS,
  SECTOR_EFFECTS,
  SECTOR_LINKAGES,
  THEME_GAPS,
  THEME_MATURITIES,
  THEME_STATUSES,
  THEME_STEP_FAILURES,
} from '@/trading/features/themes/types'
import {
  CAVEAT_CODE_STRINGS,
  DELIVERY_ERROR_CODES,
  HOLD_REASON_CODES,
  INSTRUMENT_STATUSES,
  PORTFOLIO_EVIDENCE_KINDS,
  PORTFOLIO_FINDING_KINDS,
} from '@/trading/kernel/caveat'
import { DEBATE_WAVES, LEAN_DEBATE_REASONS } from '@/trading/kernel/config'
import { CONVICTION_BANDS, OUTCOME_STATUSES, SUGGESTION_ACTIONS } from '@/trading/kernel/conviction'
import { FACTOR_IDS } from '@/trading/kernel/factor'
import { FACTOR_METRIC_IDS } from '@/trading/kernel/factor-metric'
import {
  INSTRUMENT_KINDS,
  SEGMENT_CATEGORIES,
  SESSION_PHASES,
  TRADING_SESSION_STATES,
  VN_GOLD_FORMS,
  VN_INDEX_TIERS,
} from '@/trading/kernel/instrument'
import {
  ACCOUNTS_QUARTER_FIELDS,
  ACCOUNTS_TREND_FIELDS,
  ACCOUNTS_WARNING_SIGNS,
  ACCOUNTS_YEAR_FIELDS,
} from '@/trading/kernel/market/annual-accounts'
import { MACRO_SERIES_IDS } from '@/trading/kernel/market/macro-series'
import {
  ICB_SUPERSECTORS,
  INDEX_REVIEW_KINDS,
  MARKET_EVENT_KINDS,
  MARKET_REGIMES,
} from '@/trading/kernel/market/market-data'
import {
  REFRESH_ANCHOR_KINDS,
  REFRESH_DATA_KINDS,
  REFRESH_KIND_STATUSES,
} from '@/trading/kernel/market/refresh'
import { ALERT_CONDITIONS } from '@/trading/kernel/operator/alert'
import { CASH_POSTURES } from '@/trading/kernel/operator/book'
import {
  BRIEF_ACTION_CODES,
  BRIEF_DIRECTIONS,
  BRIEF_FIELDS,
  BRIEF_SECTION_ORDER,
  BRIEF_SECTION_STATUSES,
} from '@/trading/kernel/operator/brief-section'
import {
  STORY_CODES,
  THESIS_STATUSES,
  WATCH_EFFECTS,
  WATCH_SHAPES,
} from '@/trading/kernel/operator/brief-story'
import { NOTICE_KINDS } from '@/trading/kernel/operator/notice'
import {
  INVESTMENT_GOALS,
  INVESTMENT_HORIZONS,
  RISK_LEVELS,
} from '@/trading/kernel/operator/profile'
import { SCREEN_CAUTION_CODES, WATCHLIST_DROP_REASONS } from '@/trading/kernel/screen-codes'
import {
  SOURCE_FRESHNESS,
  SOURCE_KINDS,
  SOURCE_UNAVAILABLE_REASONS,
} from '@/trading/kernel/source/source-result'
import { SCORE_BANDS } from '@/trading/markets/factor-scoring'
import { SCREEN_RATINGS } from '@/trading/markets/screen-rating'
import { TRADING_SKILLS } from '@/trading/wiring/catalog/skills'

interface CodeGroup {
  readonly prefix: string
  readonly members: readonly string[]
}

/** Each entry imports its tuple rather than restating members, so a new arm cannot exist without
 *  this manifest growing, and a grown manifest without a translation fails boot. */
export const TRADING_CODE_GROUPS: readonly CodeGroup[] = Object.freeze([
  { prefix: 'trading.caveat', members: CAVEAT_CODE_STRINGS },
  { prefix: 'trading.hold', members: HOLD_REASON_CODES },
  { prefix: 'trading.delivery.error', members: DELIVERY_ERROR_CODES },
  { prefix: 'trading.notice', members: NOTICE_KINDS },
  { prefix: 'trading.exit.level', members: EXIT_LEVELS },
  { prefix: 'trading.instrument.status', members: INSTRUMENT_STATUSES },
  { prefix: 'trading.finding', members: PORTFOLIO_FINDING_KINDS },
  { prefix: 'trading.evidence', members: PORTFOLIO_EVIDENCE_KINDS },
  { prefix: 'trading.brief.field', members: BRIEF_FIELDS },
  { prefix: 'trading.brief.section', members: BRIEF_SECTION_ORDER },
  { prefix: 'trading.brief.section-status', members: BRIEF_SECTION_STATUSES },
  { prefix: 'trading.brief.suppressed', members: BRIEF_SUPPRESSED_REASONS },
  { prefix: 'trading.brief.direction', members: BRIEF_DIRECTIONS },
  { prefix: 'trading.brief.action', members: BRIEF_ACTION_CODES },
  { prefix: 'trading.brief.story.title', members: STORY_CODES },
  { prefix: 'trading.brief.story.hook', members: STORY_CODES },
  { prefix: 'trading.brief.story.insight', members: STORY_CODES },
  { prefix: 'trading.brief.story.counterpoint', members: STORY_CODES },
  { prefix: 'trading.brief.story.watch', members: WATCH_SHAPES },
  { prefix: 'trading.brief.story.effect', members: WATCH_EFFECTS },
  { prefix: 'trading.brief.thesis.status', members: THESIS_STATUSES },
  { prefix: 'trading.conviction', members: CONVICTION_BANDS },
  { prefix: 'trading.render.nav.window', members: NAV_WINDOWS },
  { prefix: 'trading.render.nav.benchmarkGap', members: BENCHMARK_GAPS },
  { prefix: 'trading.rating', members: SCREEN_RATINGS },
  { prefix: 'trading.metric', members: FACTOR_METRIC_IDS },
  { prefix: 'trading.metric-short', members: FACTOR_METRIC_IDS },
  { prefix: 'trading.action', members: SUGGESTION_ACTIONS },
  { prefix: 'trading.outcome', members: OUTCOME_STATUSES },
  { prefix: 'trading.outcome.pending', members: OUTCOME_PENDING_REASONS },
  { prefix: 'trading.suggestion.unsupported', members: SUGGESTION_UNSUPPORTED_REASONS },
  { prefix: 'trading.advice.unavailable', members: REBALANCE_UNAVAILABLE_REASONS },
  { prefix: 'trading.risk', members: RISK_LEVELS },
  { prefix: 'trading.horizon', members: INVESTMENT_HORIZONS },
  { prefix: 'trading.goal', members: INVESTMENT_GOALS },
  { prefix: 'trading.category', members: SEGMENT_CATEGORIES },
  { prefix: 'trading.regime', members: MARKET_REGIMES },
  { prefix: 'trading.session', members: TRADING_SESSION_STATES },
  { prefix: 'trading.event', members: MARKET_EVENT_KINDS },
  { prefix: 'trading.index-review', members: INDEX_REVIEW_KINDS },
  { prefix: 'trading.macro.series', members: MACRO_SERIES_IDS },
  { prefix: 'trading.accounts.sign', members: ACCOUNTS_WARNING_SIGNS },
  { prefix: 'trading.accounts-field', members: ACCOUNTS_YEAR_FIELDS },
  { prefix: 'trading.accounts-field', members: ACCOUNTS_QUARTER_FIELDS },
  { prefix: 'trading.accounts-trend', members: ACCOUNTS_TREND_FIELDS },
  { prefix: 'trading.instrument-kind', members: INSTRUMENT_KINDS },
  { prefix: 'trading.sector', members: ICB_SUPERSECTORS },
  { prefix: 'trading.ledger.kind', members: LEDGER_TXN_KINDS },
  { prefix: 'trading.render.ledger.syncSkipReason', members: SYNC_SKIP_REASONS },
  { prefix: 'trading.gold.form', members: VN_GOLD_FORMS },
  { prefix: 'trading.index-tier', members: VN_INDEX_TIERS },
  { prefix: 'trading.alert.condition', members: ALERT_CONDITIONS },
  { prefix: 'trading.alert.state', members: ALERT_STATES },
  { prefix: 'trading.brief.delivery-state', members: BRIEF_DELIVERY_STATES },
  { prefix: 'trading.brief.schedule', members: BRIEF_DELIVERY_STATES },
  { prefix: 'trading.posture', members: CASH_POSTURES },
  { prefix: 'trading.cap', members: CAP_REASONS },
  { prefix: 'trading.refresh.kind', members: REFRESH_DATA_KINDS },
  { prefix: 'trading.refresh.record-unit', members: REFRESH_DATA_KINDS },
  { prefix: 'trading.source.unavailable', members: SOURCE_UNAVAILABLE_REASONS },
  { prefix: 'trading.source.freshness', members: SOURCE_FRESHNESS },
  { prefix: 'trading.source.kind', members: SOURCE_KINDS },
  { prefix: 'trading.refresh.status', members: REFRESH_KIND_STATUSES },
  { prefix: 'trading.refresh.anchor', members: REFRESH_ANCHOR_KINDS },
  { prefix: 'trading.progress.debate', members: DEBATE_WAVES },
  { prefix: 'trading.progress.refresh', members: REFRESH_DATA_KINDS },
  { prefix: 'trading.disable.alert', members: DISABLE_ALERT_RESULTS },
  { prefix: 'trading.disable.brief', members: DISABLE_BRIEF_RESULTS },
  { prefix: 'trading.screen.gate', members: WATCHLIST_DROP_REASONS },
  { prefix: 'trading.screen.caution', members: SCREEN_CAUTION_CODES },
  { prefix: 'trading.debate.lean', members: LEAN_DEBATE_REASONS },
  { prefix: 'trading.debate.stance', members: RESEARCH_STANCES },
  { prefix: 'trading.debate.manager', members: MANAGER_VERDICTS },
  { prefix: 'trading.debate.risk', members: RISK_VERDICTS },
  { prefix: 'trading.debate.trader', members: TRADE_STANCES },
  { prefix: 'trading.debate.sizing', members: SIZING_INTENTS },
  { prefix: 'trading.factor', members: FACTOR_IDS },
  { prefix: 'trading.skill', members: Object.keys(TRADING_SKILLS) },
  { prefix: 'trading.factor.band', members: SCORE_BANDS },
  { prefix: 'trading.intraday.phase', members: SESSION_PHASES },
  { prefix: 'trading.intraday.field', members: INTRADAY_FIELDS },
  { prefix: 'trading.themes.status', members: THEME_STATUSES },
  { prefix: 'trading.themes.maturity', members: THEME_MATURITIES },
  { prefix: 'trading.themes.failure', members: THEME_STEP_FAILURES },
  { prefix: 'trading.themes.gap', members: THEME_GAPS },
  { prefix: 'trading.themes.linkage', members: SECTOR_LINKAGES },
  { prefix: 'trading.themes.effect', members: SECTOR_EFFECTS },
  { prefix: 'trading.themes.exposure', members: EXPOSURE_LABELS },
  { prefix: 'trading.themes.verdict', members: EARNINGS_VERDICTS },
  { prefix: 'trading.themes.confidence', members: SCORE_CONFIDENCES },
  { prefix: 'trading.themes.level', members: SCORECARD_LEVELS },
  { prefix: 'trading.themes.part', members: SCORE_PARTS },
])

interface TradingPresentationKeyInput {
  readonly tools: readonly ToolDefinition[]
  readonly commands: readonly SlashCommand[]
}

interface TradingLocaleKeyInput extends TradingPresentationKeyInput {
  readonly markets: readonly MarketManifest[]
  readonly venues: readonly VenueRef[]
  readonly regions: readonly Region[]
  readonly segments: readonly PortfolioSegment[]
}

/** The one derived key set: every code union, every manifest-declared value the registry supplies,
 *  and every built surface definition. Sorted and deduped so registration reports a stable list. */
export function tradingLocaleKeys(input: TradingLocaleKeyInput): readonly string[] {
  const keys = [
    ...TRADING_CODE_GROUPS.flatMap((group) =>
      group.members.map((member) => `${group.prefix}.${member}`)
    ),
    // Manifest-declared values have no tuple to derive from — the registry IS their source.
    ...input.markets.map((market) => `trading.market.${market.id}`),
    ...input.markets.map((market) => `trading.quote-unit.${market.quoteUnit}`),
    ...input.venues.map((venue) => `trading.venue.${venue}`),
    ...input.regions.map((region) => `trading.region.${region}`),
    ...input.segments.map((segment) => `trading.segment.${segment}`),
    ...tradingPresentationKeys(input),
  ]

  return [...new Set(keys)].sort()
}

/** Tool and slash-command keys derive from the *built* definitions. A key list written by hand is
 *  a second source that can only drift from the definitions it claims to describe. */
function tradingPresentationKeys(input: TradingPresentationKeyInput): readonly string[] {
  return [
    ...input.tools.map((tool) => `tools.${tool.name}`),
    ...input.commands.flatMap((command) => [
      ...(command.description.kind === 'localized' ? [command.description.key] : []),
      ...command.messageKeys,
    ]),
  ]
}
