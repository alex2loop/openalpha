import type { Run } from '@/web/state/live'
import { useNow } from '@/web/state/clock'
import { focusRun } from '@/web/state/focus'
import { joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { sourceLabel } from '@/web/text/source'
import { formatElapsed } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { askStop } from '@/web/ui/kit/ask-stop'
import { Button } from '@/web/ui/kit/button'

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
      <Button kind="tertiary" size="small" onClick={() => focusRun(run.runId)}>
        {tr('ui.office.common.view')}
      </Button>
      <Button kind="destructive" size="small" onClick={() => askStop(run, childRuns.length > 0)}>
        {tr('ui.office.common.stop')}
      </Button>
    </div>
  )
}
