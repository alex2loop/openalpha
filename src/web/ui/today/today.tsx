import { isFirstRun } from '@/web/state/session'
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
import { SessionLine } from '@/web/ui/today/session-line'
import { SetupNotices } from '@/web/ui/today/setup-notices'

/** Hôm nay: the home market's day, what waits for the operator, then what is worth a look, in a
 *  fixed order; what the daemon started without closes the tab. */
export function Today() {
  return (
    <>
      {isFirstRun.value ? (
        <FirstRun />
      ) : (
        <>
          <SessionLine />
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
      <SetupNotices />
    </>
  )
}
