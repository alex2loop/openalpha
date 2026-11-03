import type { AgentTemplate, DayRange, MinuteRange, ShopSign } from '@/web/scene/world/regions'
import { HOURS_PER_DAY, MINUTES_PER_HOUR, shiftDay } from '@/web/text/time-units'

const FESTIVE_FIRST_YEAR = 2026
const FESTIVE_LAST_YEAR = 2035
/** `getUTCDay()` of the weekdays a pack's rules name. */
export const THURSDAY = 4
export const FRIDAY = 5

/** The years every pack's holiday dates run over; before `FESTIVE_LAST_YEAR` ends, extend it and
 *  every pack's own day lists (the lunar ones in `vn.ts`). */
export const FESTIVE_YEARS = Array.from(
  { length: FESTIVE_LAST_YEAR - FESTIVE_FIRST_YEAR + 1 },
  (_, index) => FESTIVE_FIRST_YEAR + index
)

/** Minutes of the page day at `hours`:`minutes`. */
export const hm = (hours: number, minutes = 0): number => hours * MINUTES_PER_HOUR + minutes

/** The days from `daysBefore` before `day` to `daysAfter` after it. */
export const around = (day: string, daysBefore: number, daysAfter: number): DayRange => [
  shiftDay(day, -daysBefore),
  shiftDay(day, daysAfter),
]

/** A shop sign: band and ink, and the awning's stripes when it has one. */
export const sign = (band: string, ink: string, awning?: readonly [string, string]): ShopSign =>
  awning === undefined ? { band, ink } : { band, ink, awning }

/** Open day and night. */
export const ALL_DAY: MinuteRange = [0, hm(HOURS_PER_DAY)]

/** Never open. */
export const SHUT: MinuteRange = [0, 0]

/** The crypto starter agent, the same in every region. */
export const CRYPTO_TEMPLATE = {
  name: 'ui.office.team.tplCrypto',
  prompt: 'ui.office.team.tplCryptoPrompt',
  hint: 'ui.office.team.tplCryptoHint',
  focus: { markets: ['crypto'], horizon: 'short' },
} as const satisfies AgentTemplate
