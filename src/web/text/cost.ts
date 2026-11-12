import { formatUsdCents } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

/** A money figure as the cost breakdown prints it, so the parts add up to the total. */
export function formatCost(usd: number): string {
  return tr('ui.office.cost.amount', { usd: formatUsdCents(usd) })
}
