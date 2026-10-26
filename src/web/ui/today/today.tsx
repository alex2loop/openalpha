import { selectOverview } from '@/web/state/market'
import { isFirstRun, state } from '@/web/state/session'
import { AgentDay } from '@/web/ui/today/blocks/agent-day'
import { Book } from '@/web/ui/today/blocks/book'
import { Events } from '@/web/ui/today/blocks/events'
import { Macro } from '@/web/ui/today/blocks/macro'
import { closeNoteOf, selectBoard } from '@/web/ui/today/blocks/market-section'
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
      <CloseNote />
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

// Once the home market has closed, by the daemon's own phase (a preview hour never changes it),
// the prices shown are its closing prices.
function CloseNote() {
  const note = closeNoteOf(selectBoard(selectOverview('home')))

  return note === undefined ? null : <p class="meta">{note}</p>
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
