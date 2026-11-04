import { isAnalysisOnly, offers } from '@/web/state/edition'
import { isGuideShown } from '@/web/state/first-run'
import { AgentDay } from '@/web/ui/today/blocks/agent-day'
import { Book } from '@/web/ui/today/blocks/book'
import { Events } from '@/web/ui/today/blocks/events'
import { HomeMarket } from '@/web/ui/today/blocks/home-market'
import { Macro } from '@/web/ui/today/blocks/macro'
import { News } from '@/web/ui/today/blocks/news'
import { OtherMarkets } from '@/web/ui/today/blocks/other-markets'
import { WorthWatching } from '@/web/ui/today/blocks/worth-watching'
import { FirstRun } from '@/web/ui/today/first-run'
import { NeedsYou } from '@/web/ui/today/needs-you'
import { SessionLine } from '@/web/ui/today/session-line'
import { SetupNotices } from '@/web/ui/today/setup-notices'

/** Hôm nay: the first-run guide while it shows, then the home market's day, what waits for the
 *  operator and what is worth a look, in a fixed order; what the daemon started without closes the
 *  tab. */
export function Today() {
  return (
    <>
      {isGuideShown.value && <FirstRun />}
      <SessionLine />
      {!isAnalysisOnly.value && <NeedsYou />}
      {!isAnalysisOnly.value && <WorthWatching />}
      <Book />
      <HomeMarket />
      <Macro />
      <OtherMarkets />
      <Events />
      {!isAnalysisOnly.value && <News />}
      {offers('agents') && <AgentDay />}
      <SetupNotices />
    </>
  )
}
