/** Display and request bounds shared by tools, slash commands, and server — one frozen object, so
 *  the surfaces cannot drift to different maxima. Exported through the public API and host barrel. */
export const SURFACE_LIMITS = Object.freeze({
  maximumNewsItems: 50,
  maximumQuoteBoardItems: 12,
  maximumScreenCandidates: 50,
  /** Rows a ticker or company-name search answers with: a picker list, not a browse. */
  maximumSearchItems: 20,
  maximumHistoryItems: 100,
  maximumAlertItems: 100,
  maximumTrackRecordItems: 100,
  /** How many resolved board rows `/reflect` reads. Two markets, ~135 rows a session, so a
   *  fortnight of resolved boards. */
  maximumFactorLogItems: 2000,
  /** How many screened names one factor-log capture reads per market. The VN board clears ~110
   *  names a session and the crypto screen caps itself at 25; 500 is a ceiling, not a target. */
  maximumFactorLogRows: 500,
  maximumSuggestionBatchItems: 50,
  maximumDiscoveryBatchItems: 3,
  defaultScreenCandidates: 10,
  /** Names whose corporate calendar a surface may read for, and how many reads are in flight. One
   *  provider read per name is what makes an ex-date on a held position visible; both bounds keep a
   *  large book from turning `/portfolio` or the brief's events section into an unbounded fan-out. */
  maximumCalendarNames: 40,
  calendarConcurrency: 5,
  /** Sector rows a book report lists before it counts the rest. The question
   *  is where the operator is concentrated, not an inventory of every segment they touch. */
  maximumConcentrationRows: 6,
} as const)
