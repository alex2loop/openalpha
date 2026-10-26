import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { AgentDetailWire } from '@/app/server/wire/agents'
import type { MessageKey } from '@/i18n'
import type { BlockReading } from '@/web/state/block'
import type { AgentSection } from '@/web/state/panel'
import { loadTodayActivity } from '@/web/state/activity'
import { loadDetail } from '@/web/state/agents'
import { useBlockRead } from '@/web/state/block'
import { onWireEvent } from '@/web/state/events'
import { toFailureText, tr } from '@/web/text/tr'
import { AgentHead } from '@/web/ui/agent/agent-head'
import { type AgentView, buildAgentView } from '@/web/ui/agent/agent-view'
import { Profile } from '@/web/ui/agent/profile'
import { Progress } from '@/web/ui/agent/progress'
import { AgentResult } from '@/web/ui/agent/result'
import { Watching } from '@/web/ui/agent/watching'
import { Work } from '@/web/ui/agent/work'
import { Segmented } from '@/web/ui/kit/segmented'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { AGENT_DAY_POLL_MS } from '@/web/ui/today/blocks/agent-day'

import './agent.css'

/** The office's alert-desk keeper: it runs no AI, so its tab is the alert desk alone. */
const ALERT_DESK_ID = 'clerk'

const SECTION_LABELS = Object.freeze({
  progress: 'ui.office.agent.progress',
  result: 'ui.office.agent.result',
  profile: 'ui.office.agent.profile',
  work: 'ui.office.agent.work',
} as const satisfies Record<AgentSection, MessageKey>)

const SECTIONS: readonly AgentSection[] = ['progress', 'result', 'profile', 'work']

interface AgentTabProps {
  readonly agentId: string
  /** The part it opens on; its steps when none is asked for. */
  readonly section?: AgentSection
}

/** One person's panel: who they are and what they do now, then their steps, result, profile and
 *  work. The alert desk shows what it watches. Every read stops when the tab closes. */
export function AgentTab({ agentId, section }: AgentTabProps) {
  if (agentId === ALERT_DESK_ID) {
    return (
      <div class="agent-tab">
        <h2 class="agent-name">{tr('ui.office.agent.watching')}</h2>
        <Watching />
      </div>
    )
  }

  return <PersonTab agentId={agentId} section={section ?? 'progress'} />
}

function PersonTab({ agentId, section: opening }: Required<AgentTabProps>) {
  const section = useSignal<AgentSection>(opening)
  const detail = useBlockRead((abort) => loadDetail(agentId, abort))
  const day = useBlockRead(loadTodayActivity, { everyMs: AGENT_DAY_POLL_MS })
  const view = buildAgentView(agentId, detail.data, day.data?.rows ?? [])

  // A run that ends is news at once; the poll is the backstop for an event the socket missed.
  useEffect(() => onWireEvent('run_finished', day.retry), [])

  return (
    <div class="agent-tab">
      <AgentHead view={view} />
      <Segmented
        className="is-tabs"
        label={view.name}
        value={section.value}
        options={SECTIONS.map((value) => ({ value, label: tr(SECTION_LABELS[value]) }))}
        onChange={(value) => {
          section.value = value
        }}
      />
      <SectionBody section={section.value} view={view} detail={detail} />
    </div>
  )
}

interface SectionBodyProps {
  readonly section: AgentSection
  readonly view: AgentView
  readonly detail: BlockReading<AgentDetailWire>
}

function SectionBody({ section, view, detail }: SectionBodyProps) {
  switch (section) {
    case 'progress':
      return <Progress run={view.run} maxSpawn={detail.data?.maxSpawn} />
    case 'result':
      return <AgentResult view={view} />
    case 'profile':
      return <ProfileSection view={view} detail={detail} />
    case 'work':
      return <Work view={view} />
  }
}

function ProfileSection({ view, detail }: Omit<SectionBodyProps, 'section'>) {
  if (detail.data === undefined) {
    return detail.error === undefined ? (
      <Skeleton />
    ) : (
      <p class="failure-line">{toFailureText(detail.error)}</p>
    )
  }

  return <Profile view={view} detail={detail.data} onSaved={detail.retry} />
}
