/** Every detector number. Deliberately outside `check-strategy-version`'s `POLICY_SOURCES`: a story
 *  threshold never reaches a suggestion, so changing one is not a strategy change. Units follow the
 *  field each is compared with: `changePct` is a percent, every other `*Pct` is a fraction. */
export const VN_STORY_POLICY = Object.freeze({
  /** Smallest index move, in percent, that can split from the breadth. */
  splitIndexMovePct: 0.3,
  /** Smallest net advancers, as a fraction of names measured, that counts as against the index. */
  splitNetShare: 0.05,
  /** Window foreign net as a fraction of the window's turnover. */
  foreignWindowShare: 0.05,
  /** Smallest index move, in percent, that a turnover reading can qualify. */
  turnoverMovePct: 1,
  /** Turnover multiple below which a move had few takers. */
  turnoverThinBelow: 0.8,
  /** Turnover multiple from which a move had many takers. */
  turnoverHeavyFrom: 1.5,
  /** Distance to support or resistance, as a fraction, that counts as testing it. */
  levelNear: 0.02,
  /** Distance, as a fraction, that counts as having moved clear of a level. */
  levelClear: 0.04,
  /** Sessions the share above the 50-session mean is compared across. */
  breadthShiftSessions: 5,
  /** Smallest change in that share, as a fraction, that counts as a shift. */
  breadthShift: 0.08,
  /** Further change in that share, as a fraction, that a watch asks for. */
  breadthFollowThrough: 0.04,
  /** The share above the 50-session mean at which breadth is neither narrow nor wide. */
  breadthMidline: 0.5,
  /** Smallest absolute sector strength score that leads or lags. */
  sectorStrength: 0.125,
  /** Sector strength score a watch asks for to confirm a lead or a lag. */
  sectorStrong: 0.2,
  /** Smallest absolute futures basis, as a fraction of spot. */
  basisDislocation: 0.003,
  /** Index distance from its 50-session mean, as a fraction, that a watch asks for. */
  indexFollowThrough: 0.01,
  horizonSessions: 5,
  basisHorizonSessions: 3,
} as const)
