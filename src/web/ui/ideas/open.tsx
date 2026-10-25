import { useEffect } from 'preact/hooks'

import type { SuggestionWire } from '@/app/server/wire/trading'
import { readBlock } from '@/web/state/block'
import { markSeen, unseenCalls } from '@/web/state/ideas'
import { callsBlock, freshCalls } from '@/web/state/market'
import { tr } from '@/web/text/tr'
import { ResearchList } from '@/web/ui/ideas/research-list'
import { SuggestionCard } from '@/web/ui/ideas/suggestion-card'
import { ListIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** Đang mở: the plans standing now, then the research the daemon finished. */
export function OpenIdeas() {
  // Leaving the view, or the page, is when the calls on it count as looked at.
  useEffect(() => {
    const listeners = new AbortController()
    const saveSeen = (): void => markSeen(freshCalls.peek().map((call) => call.id))

    addEventListener('pagehide', saveSeen, { signal: listeners.signal })

    return () => {
      listeners.abort()
      saveSeen()
    }
  }, [])

  return (
    <>
      <OpenPlans />
      <ResearchList />
    </>
  )
}

function OpenPlans() {
  const reading = readBlock(callsBlock)
  const unseen = new Set(unseenCalls.value.map((call) => call.id))

  return (
    <BlockFrame
      title={tr('ui.office.ideas.plans')}
      colour="yellow"
      icon={<ListIcon />}
      reading={reading}
    >
      {({ suggestions }) => <PlanList calls={suggestions.filter(isDecision)} unseen={unseen} />}
    </BlockFrame>
  )
}

// A hold that records a failed run is not a decision.
function isDecision(call: SuggestionWire): boolean {
  return call.action !== 'hold' || call.undecided !== true
}

interface PlanListProps {
  readonly calls: readonly SuggestionWire[]
  readonly unseen: ReadonlySet<string>
}

function PlanList({ calls, unseen }: PlanListProps) {
  if (calls.length === 0) {
    return <p class="meta">{tr('ui.office.ideas.empty')}</p>
  }

  return (
    <div class="ideas-list">
      {calls.map((call) => (
        <SuggestionCard key={call.id} call={call} isFresh={unseen.has(call.id)} />
      ))}
    </div>
  )
}
