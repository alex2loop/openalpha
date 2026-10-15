/**
 * Every skill compiled into this binary, named as its front matter names it. A market's playbook
 * and a role's playbook are both typed against this union, so a name no skill answers to is a
 * compile error rather than a prompt block that silently comes back empty.
 *
 * A union arm is a central edit by design: it is what makes the set of playbooks a reader can
 * check against the folders in `trading/skills/`, and `TRADING_SKILLS` is annotated with the whole
 * record, so a skill added here without a file — or a file added without an arm — does not compile.
 */
export type SkillName =
  | 'behavioral-finance'
  | 'capital-allocation'
  | 'correlation-analysis'
  | 'crowding-and-unwind'
  | 'crypto-analysis'
  | 'crypto-execution'
  | 'drawdown-response'
  | 'exit-management'
  | 'gold-analysis'
  | 'intrinsic-value'
  | 'inversion'
  | 'macro-liquidity-analysis'
  | 'moat-analysis'
  | 'portfolio-risk-analysis'
  | 'profit-taking'
  | 'quality-screen'
  | 'recover'
  | 'research-scoping'
  | 'technical-analysis'
  | 'track-record-reading'
  | 'vn-daily-buy'
  | 'vn-deep-dive'
  | 'vn-dividend-analysis'
  | 'vn-earnings-playbook'
  | 'vn-execution'
  | 'vn-market-rules'
  | 'vn-sector-rotation'
  | 'vn-valuation'

/**
 * The skills a market contributes to a debate, by what the reading role is doing. `analysis` goes
 * to the roles building or judging the case; `execution` to the one placing the order, and a market
 * whose orders carry no rules of their own omits it rather than declaring an empty list.
 */
export interface MarketPlaybook {
  readonly analysis: readonly SkillName[]
  readonly execution?: readonly SkillName[]
}
