import type { Run } from '@/web/state/live'
import { stopRun } from '@/web/state/approvals'
import { useNow } from '@/web/state/clock'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatElapsed } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'

const ELAPSED_TICK_MS = 1_000

interface JobRowProps {
  readonly run: Run
  readonly childRuns: readonly Run[]
}

/** A running run: what, who, its step, how long, where from, and "Dừng", which asks first. A
 *  parent lists its children under it. */
export function JobRow({ run, childRuns }: JobRowProps) {
  const now = useNow(ELAPSED_TICK_MS).value

  return (
    <div class="job-row">
      <span class="spin" aria-hidden="true" />
      <div class="job-main">
        <b>
          {joinInline([formatRunName(run), ...(run.agentId === undefined ? [] : [run.agentId])])}
        </b>
        <p class="meta">
          {joinInline([
            ...(run.progress === undefined ? [] : [run.progress.text]),
            formatElapsed(now - run.startedAt),
            sourceLabel(run.channelId),
          ])}
        </p>
        {childRuns.map((child) => (
          <p key={child.runId} class="meta job-child">
            {joinInline([
              formatRunName(child),
              ...(child.progress === undefined ? [] : [child.progress.text]),
            ])}
          </p>
        ))}
      </div>
      <Button kind="destructive" size="small" onClick={() => askStop(run, childRuns.length > 0)}>
        {tr('ui.office.common.stop')}
      </Button>
    </div>
  )
}

// "Chạy tiếp" is the safe, main button, so Enter keeps the run going.
function askStop(run: Run, hasChildren: boolean): void {
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
