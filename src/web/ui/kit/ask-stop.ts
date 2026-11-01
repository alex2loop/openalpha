import type { Run } from '@/web/state/live'
import { stopRun } from '@/web/state/approvals'
import { formatRunName } from '@/web/text/run-name'
import { tr } from '@/web/text/tr'
import { askConfirm } from '@/web/ui/kit/confirm'

/** Asks before stopping the run; "Chạy tiếp" is the safe, main button, so Enter keeps it going. */
export function askStop(run: Run, hasChildren: boolean): void {
  const who = run.agentId ?? formatRunName(run)

  askConfirm({
    title: tr('ui.office.jobs.stopAsk', { what: formatRunName(run) }),
    lines: [
      tr('ui.office.jobs.stopBody', { who }),
      ...(hasChildren ? [tr('ui.office.common.stopChildren')] : []),
    ],
    confirmLabel: tr('ui.office.common.stop'),
    isDestructive: true,
    keepLabel: tr('ui.office.common.keepGoing'),
    confirm: () => stopRun(run.runId),
  })
}
