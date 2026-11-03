import type { MessageKey } from '@/i18n'

type WebStatus = 'yes' | 'needs-ai-key' | 'needs-search-key' | 'partial' | 'installed-only'

interface WebFeature {
  readonly id: string
  readonly web: WebStatus
  /** Why the web edition stops short: the one plain line the comparison page and the install lines show. */
  readonly reason?: MessageKey
}

/** What the web edition does against the installed version, one row per job. Documentation: what
 *  runs comes from `Capabilities` and the routes the browser serves. The guide, the comparison page
 *  and every install line read this table, and each row's strings sit under
 *  `ui.office.edition.compare.<id>`. */
export const WEB_FEATURES = [
  { id: 'market-prices', web: 'partial', reason: 'ui.office.edition.compare.market-prices.reason' },
  {
    id: 'screen-factors',
    web: 'partial',
    reason: 'ui.office.edition.compare.screen-factors.reason',
  },
  { id: 'watchlist', web: 'yes' },
  { id: 'ledger', web: 'partial', reason: 'ui.office.edition.compare.ledger.reason' },
  { id: 'portfolio-nav', web: 'yes' },
  { id: 'rebalance', web: 'partial', reason: 'ui.office.edition.compare.rebalance.reason' },
  { id: 'analysis', web: 'needs-ai-key', reason: 'ui.office.edition.compare.analysis.reason' },
  {
    id: 'verdict-levels',
    web: 'partial',
    reason: 'ui.office.edition.compare.verdict-levels.reason',
  },
  { id: 'brief-open', web: 'yes' },
  {
    id: 'brief-schedule',
    web: 'installed-only',
    reason: 'ui.office.edition.compare.brief-schedule.reason',
  },
  { id: 'alerts', web: 'installed-only', reason: 'ui.office.edition.compare.alerts.reason' },
  { id: 'research', web: 'needs-search-key', reason: 'ui.office.edition.compare.research.reason' },
  { id: 'themes', web: 'installed-only', reason: 'ui.office.edition.compare.themes.reason' },
  {
    id: 'track-record',
    web: 'installed-only',
    reason: 'ui.office.edition.compare.track-record.reason',
  },
  {
    id: 'venue-orders',
    web: 'installed-only',
    reason: 'ui.office.edition.compare.venue-orders.reason',
  },
  {
    id: 'chatgpt-plan',
    web: 'installed-only',
    reason: 'ui.office.edition.compare.chatgpt-plan.reason',
  },
  {
    id: 'chat-tools',
    web: 'installed-only',
    reason: 'ui.office.edition.compare.chat-tools.reason',
  },
  { id: 'mcp', web: 'installed-only', reason: 'ui.office.edition.compare.mcp.reason' },
  { id: 'model-tiers', web: 'partial', reason: 'ui.office.edition.compare.model-tiers.reason' },
  { id: 'data-sources', web: 'partial', reason: 'ui.office.edition.compare.data-sources.reason' },
  {
    id: 'where-data-lives',
    web: 'partial',
    reason: 'ui.office.edition.compare.where-data-lives.reason',
  },
  { id: 'cost', web: 'partial', reason: 'ui.office.edition.compare.cost.reason' },
] as const satisfies readonly WebFeature[]

export type FeatureId = (typeof WEB_FEATURES)[number]['id']
