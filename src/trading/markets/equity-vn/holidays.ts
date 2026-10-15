import type { TradingDay } from '@/trading/kernel/instrument'
import { tradingDay } from '@/trading/kernel/instrument'

/** The weekdays HOSE and HNX announced no trading, as the exchanges published them - Tết, Giỗ Tổ,
 *  30/4-1/5, Quốc khánh and, from 2026, Ngày Văn hóa Việt Nam. A swapped working Saturday never
 *  trades, so only the weekdays are listed. Extend it when the exchanges publish the next year's
 *  calendar: boot warns once the newest entry is in a past year. */
export const VN_EXCHANGE_HOLIDAYS: readonly TradingDay[] = Object.freeze(
  [
    '2025-01-01',
    '2025-01-27',
    '2025-01-28',
    '2025-01-29',
    '2025-01-30',
    '2025-01-31',
    '2025-04-07',
    '2025-04-30',
    '2025-05-01',
    '2025-05-02',
    '2025-09-01',
    '2025-09-02',
    '2026-01-01',
    '2026-01-02',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-02-19',
    '2026-02-20',
    '2026-04-27',
    '2026-04-30',
    '2026-05-01',
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
    '2026-11-24',
  ].map(tradingDay)
)
