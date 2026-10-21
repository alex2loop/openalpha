import type { CalendarPolicy } from '@/trading/kernel/config'
import type { FactorPolicy, LevelPolicy, VnGoldFactorId } from '@/trading/kernel/factor'
import type { BoardLotPolicy, TickSizePolicy, VnGoldForm } from '@/trading/kernel/instrument'
import { VN_GOLD_FACTOR_IDS } from '@/trading/kernel/factor'
import { currencyCode, marketRef, VN_GOLD_FORMS } from '@/trading/kernel/instrument'
import {
  DEFAULT_HIGH_CONVICTION_AT,
  DEFAULT_MEDIUM_CONVICTION_AT,
  DEFAULT_MINIMUM_AGREEMENT,
  DEFAULT_MINIMUM_COVERAGE_FRACTION,
  equalWeights,
} from '@/trading/markets/factor-scoring'
import { FACTOR_POLICY } from '@/trading/markets/gold/api'

export const GOLD_VN_MARKET_REF = marketRef('gold-vn')

/** Naming a form asks for that form, so these bypass `PREFERRED_FORMS`. Suffixed rather than bare
 *  vendor names because `PNJ` is a listed HOSE equity — claiming it would make the stock ambiguous. */
export const GOLD_VN_FORM_TICKERS: ReadonlyMap<string, VnGoldForm> = new Map(
  VN_GOLD_FORMS.map((form) => [form.toUpperCase(), form])
)

/** The form tickers, plus the aliases that carry no form and leave the pick to policy. */
export const GOLD_VN_TICKERS: ReadonlySet<string> = new Set([
  ...GOLD_VN_FORM_TICKERS.keys(),
  'SJC',
  'XAUVND',
  'GOLD-VN',
])

export const USD_VND = Object.freeze({
  fromCurrency: currencyCode('USD'),
  toCurrency: currencyCode('VND'),
})

/** SJC and DOJI boards run the VN counter calendar, so every `asOf` and cooldown
 *  computation for this market resolves in Hanoi time — never world gold's UTC day.
 *
 *  The close is when the boards stop being revised, not when the counters shut. There is no auction
 *  here to strike a price, so this instant is an estimate rather than a fact, and the measured one
 *  runs later than the counter hours suggest: SJC carried revisions at 17:06 and 17:15 on a sampled
 *  afternoon. Declared at 17:30 so the tape-settle lag is cushion against a late revision rather
 *  than the only thing standing between a forming board and a stored one.
 *
 *  Saturday is a session. The counters quote and revise it — a sampled board opened at 09:10 and
 *  moved 600.000 đồng a lượng on both sides — and calling it a weekend dropped every Saturday
 *  premium from the stored series, because nothing settles on a day the calendar says never
 *  traded. */
export const VN_GOLD_CALENDAR: CalendarPolicy = Object.freeze({
  timezone: 'Asia/Ho_Chi_Minh',
  sessionOpenLocalTime: '08:00',
  sessionCloseLocalTime: '17:30',
  weekendDays: Object.freeze([0]),
  continuous: false,
})

/** The counters quote seven days a week, so a stored plan is read against a board that has moved
 *  since it was written. Parity is where its levels stop paying for their own risk. */
export const GOLD_VN_MINIMUM_RISK_REWARD = 1

/** Its own rather than world gold's: the stop is a dealer's buy-back price in đồng while the bars
 *  it reads are the world metal in dollars, so no trail can be hung from them, and the whole
 *  position leaves at the target. */
export const GOLD_VN_LEVEL_POLICY: LevelPolicy = Object.freeze({
  atrSessions: 14,
  stopVolatilityMultiplier: { short: 1.5, long: 2 },
  targetRiskMultiplier: { short: 1.5, long: 1.5 },
})

/** Vendor boards quote to the nearest 10,000 VND per lượng. */
export const VN_GOLD_TICK: TickSizePolicy = Object.freeze({
  bands: Object.freeze([Object.freeze({ tickSize: 10_000 })]),
})

/** One chi, a tenth of a luong: the smallest bar or ring a counter sells, so a sized step is
 *  always something the operator can buy. A whole-luong lot exceeded every segment cap a retail
 *  book carries and left the segment permanently unfunded. */
export const VN_GOLD_BOARD_LOT: BoardLotPolicy = Object.freeze({ size: 0.1 })

/** Preference order, most preferred first. A ring displaces the bar only on a material discount. */
export const PREFERRED_FORMS: readonly VnGoldForm[] = Object.freeze([
  'sjc-bar',
  'pnj-ring',
  'doji-ring',
])

/** The form the stored premium series holds. The history feed is pinned to it, so the series is one
 *  population only if every write and every rank reads this form's premium. */
export const GOLD_VN_PREMIUM_FORM: VnGoldForm = 'sjc-bar'

/** One percentage point of premium: below it, a ring's advantage is noise that would flip the
 *  selected form day to day. */
export const MINIMUM_RING_PREMIUM_ADVANTAGE_FRACTION = 0.01

/** How long one fetch of the vendor boards serves a running process before it asks again. Bounds
 *  refetching only: whether a board is still a price anyone quotes is `isBoardStale`, which reads
 *  the counter calendar rather than a duration. */
export const BOARD_CACHE_TTL_MS = 21_600_000

/** Three because the counter trades a day the world does not, and tolerating one COMEX holiday the
 *  VN shops trade through is the whole job: with COMEX shut on the Friday, Monday's board sits
 *  Thursday→Friday→Saturday→Monday from the newest completed world close. */
export const WORLD_CLOSE_LAG_SESSIONS = 3

/** Two because FX keeps the world's weekend rather than the counter's: a Saturday board already
 *  reads Friday's rate, and Monday's sits two counter sessions from it. At one, every Monday would
 *  call a current rate a stale operand. */
export const FX_LAG_SESSIONS = 2

/** Window the premium percentile ranks today's premium against, in trading days — `market.ts` steps
 *  it with `addTradingDays`, so this spans roughly 126 calendar days (about four months) across
 *  the counter calendar's Sundays, not a literal quarter. Long enough to surface a regime shift in
 *  premiums without diluting it across a year of mostly-similar days. */
export const GOLD_VN_PREMIUM_WINDOW_DAYS = 108

/** Below this many stored days a percentile ranks against noise, so the factor abstains until the
 *  history fills. */
export const GOLD_VN_PREMIUM_MINIMUM_HISTORY = 30

/** Share of the window that must actually hold a point. A count alone cannot tell a filling series
 *  from a stalled one: when the vendor stops publishing, the stored points keep answering while the
 *  window slides past them, and the count stays over its floor for months. Half, because the vendor
 *  covers roughly four sessions in five on a good year and a floor near that would abstain on an
 *  ordinary sparse month. */
export const GOLD_VN_PREMIUM_MINIMUM_COVERAGE = 0.5

// Eight weights over the seven world inputs plus the local premium. Scoring these factors
// against global gold's seven-weight policy would throw on the eighth id, not hold — which is why
// the two policies are separate objects rather than one shared record.
export const VN_GOLD_FACTOR_POLICY: FactorPolicy<VnGoldFactorId> = Object.freeze({
  weights: equalWeights(VN_GOLD_FACTOR_IDS),
  normalization: Object.freeze({
    ...FACTOR_POLICY.normalization,
    // Inverted on a [0, 1] percentile: a premium low in its own history is the bullish entry.
    'local-premium': Object.freeze({ kind: 'linear', bearishAt: 0.85, bullishAt: 0.15 } as const),
  }),
  minimumCoverageFraction: DEFAULT_MINIMUM_COVERAGE_FRACTION,
  minimumAgreement: DEFAULT_MINIMUM_AGREEMENT,
  // Unmeasurable for the same reason as world gold: one metal is its own population, so there is no
  // board whose spread these could be fitted to.
  mediumConvictionAt: DEFAULT_MEDIUM_CONVICTION_AT,
  highConvictionAt: DEFAULT_HIGH_CONVICTION_AT,
})
