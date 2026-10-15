// Source class: scraping-risky. `trading.vietcap.com.vn` is an internal broker endpoint with no
// SLA — like `vndirect/` and `entrade`, it can change or refuse traffic without notice. The
// endpoint is code-owned because it is a provider fact, not an operator judgment.
import { sourceId } from '@/trading/kernel/source/source-id'

export const VIETCAP_DEFAULT_ENDPOINT = 'https://trading.vietcap.com.vn'
export const VIETCAP_ID = sourceId('vietcap')

/** The board reads register apart from the per-name ones so a whole-market failure cannot open the
 *  breaker on `indexMembership`, which has no second provider. Same host, separate blast radius. */
export const VIETCAP_BOARD_ID = sourceId('vietcap-board')

/** The chart endpoint registers apart from both: it is the only provider for the ETF benchmark
 *  indices, and a board sweep's failure must not open the breaker on the series they score from. */
export const VIETCAP_CHART_ID = sourceId('vietcap-chart')

/** The statements live on the broker's research host. A separate id, so a refusal there cannot open
 *  the breaker on the board or the chart. */
export const VIETCAP_STATEMENTS_ENDPOINT = 'https://iq.vietcap.com.vn'
export const VIETCAP_STATEMENTS_ID = sourceId('vietcap-statements')
