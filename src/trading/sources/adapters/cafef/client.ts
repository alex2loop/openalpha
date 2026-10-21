// Source class: scraping-risky. `cafef.vn` is a consumer finance site's own AJAX handler with no
// SLA -- like `vndirect/` and `vietcap`, it can change or refuse traffic without notice. The
// endpoint is code-owned because it is a provider fact, not an operator judgment.
import { sourceId } from '@/trading/kernel/source/source-id'

export const CAFEF_DEFAULT_ENDPOINT = 'https://cafef.vn'
export const CAFEF_ID = sourceId('cafef')

/** The statement tables register apart from the proprietary desk, so a refusal on one page cannot
 *  open the breaker on the other. Same host, separate blast radius. */
export const CAFEF_STATEMENTS_ID = sourceId('cafef-statements')
