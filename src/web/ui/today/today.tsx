import { isFirstRun, state } from '@/web/state/session'
import { AgentDay } from '@/web/ui/today/blocks/agent-day'
import { Book } from '@/web/ui/today/blocks/book'
import { Events } from '@/web/ui/today/blocks/events'
import { Macro } from '@/web/ui/today/blocks/macro'
import { News } from '@/web/ui/today/blocks/news'
import { OtherMarkets } from '@/web/ui/today/blocks/other-markets'
import { VnMarket } from '@/web/ui/today/blocks/vn-market'
import { WorthWatching } from '@/web/ui/today/blocks/worth-watching'
import { FirstRun } from '@/web/ui/today/first-run'
import { NeedsYou } from '@/web/ui/today/needs-you'

/** Hôm nay: what waits for the operator, then what is worth a look, in a fixed order. */
export function Today() {
  return (
    <>
      <DegradedStrip />
      {isFirstRun.value ? (
        <FirstRun />
      ) : (
        <>
          <NeedsYou />
          <WorthWatching />
          <Book />
          <VnMarket />
          <Macro />
          <OtherMarkets />
          <Events />
          <News />
          <AgentDay />
        </>
      )}
    </>
  )
}

// What the daemon started without, in its own words, in one grey strip.
function DegradedStrip() {
  const degraded = state.value?.degraded ?? []

  if (degraded.length === 0) {
    return null
  }

  return (
    <div class="strip is-grey">
      {degraded.map((item) => (
        <span key={`${item.kind}:${item.subject}`}>{item.message}</span>
      ))}
    </div>
  )
}
