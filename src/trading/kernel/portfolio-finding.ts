export const PORTFOLIO_FINDING_KINDS = Object.freeze([
  'position-cap-breach',
  'segment-cap-breach',
  'etf-cap-breach',
  'sector-cap-breach',
  'reserve-below-target',
  'segment-drift',
  'concentration',
  'illiquid-position',
  'excluded-holding',
] as const)
export type PortfolioFindingKind = (typeof PORTFOLIO_FINDING_KINDS)[number]

export const PORTFOLIO_EVIDENCE_KINDS = Object.freeze([
  'segment-weight',
  'position-weight',
  'sector-weight',
  'cash-weight',
  'days-to-liquidate',
] as const)
export type PortfolioEvidenceKind = (typeof PORTFOLIO_EVIDENCE_KINDS)[number]
