import { formatUsd } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

/** "{spent} / {cap} USD", or "{spent} USD" with no cap. Shared by the header chip, the popover and
 *  the full report. */
export function formatSpent(spentUsd: number | undefined, capUsd: number | undefined): string {
  const spent = formatUsd(spentUsd)

  return capUsd === undefined || capUsd === 0
    ? tr('ui.office.cost.spentUncapped', { spent })
    : tr('ui.office.cost.spent', { spent, cap: formatUsd(capUsd) })
}
