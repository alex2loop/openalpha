/** Every US detector number. Deliberately outside `check-strategy-version`'s `POLICY_SOURCES`: a
 *  story threshold never reaches a suggestion, so changing one is not a strategy change. Units
 *  follow the field each is compared with: every `*Pct` is a fraction. Measured on the board's own
 *  breadth and the stored SPY and QQQ bars, so each number states the rate it gives there. */
export const US_STORY_POLICY = Object.freeze({
  /** Sessions the share above the 50-session mean is compared across. */
  breadthShiftSessions: 5,
  /** Smallest change in that share, as a fraction, that counts as a shift: a story onset about
   *  3 times in 60 sessions on the board, 6 on the S&P 500's own breadth over ten years. */
  breadthShift: 0.12,
  /** Further change in that share, as a fraction, that a watch asks for: reached either way within
   *  the horizon in about a quarter of the board's windows. */
  breadthFollowThrough: 0.06,
  /** Distribution days in the window at which one index fund counts as under distribution: an
   *  onset about 3 times in 60 sessions, the condition holding on 14 of every 60. */
  distributionClusterAt: 8,
  horizonSessions: 5,
} as const)
