import { isAnalysisOnly, offers } from '@/web/state/edition'
import { isGuideShown } from '@/web/state/first-run'
import { isModelReady } from '@/web/state/session'
import { SetupNotice } from '@/web/ui/kit/setup-notice'
import { AgentDay } from '@/web/ui/today/blocks/agent-day'
import { Book } from '@/web/ui/today/blocks/book'
import { Events } from '@/web/ui/today/blocks/events'
import { HomeMarket } from '@/web/ui/today/blocks/home-market'
import { Macro } from '@/web/ui/today/blocks/macro'
import { News } from '@/web/ui/today/blocks/news'
import { OtherMarkets } from '@/web/ui/today/blocks/other-markets'
import { WorthWatching } from '@/web/ui/today/blocks/worth-watching'
import { FirstRun, ModelSetup, modelTitle } from '@/web/ui/today/first-run'
import { NeedsYou } from '@/web/ui/today/needs-you'
import { SessionLine } from '@/web/ui/today/session-line'
import { SetupNotices } from '@/web/ui/today/setup-notices'

/** Hôm nay: the first-run guide while it shows, else a missing model, then the home market's day, what waits for the
 *  operator and what is worth a look, in a fixed order; what the daemon started without closes the
 *  tab. */
export function Today() {
  return (
    <>
      {isGuideShown.value && <FirstRun />}
      {!(isGuideShown.value || isModelReady.value) && <ModelNotice />}
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

// Past the guide, a missing model still says so at the top: a choice on the web edition, which runs
// without one, and a setup the installed version needs.
function ModelNotice() {
  return (
    <SetupNotice tone={isAnalysisOnly.value ? 'info' : 'caution'} title={modelTitle()}>
      <ModelSetup />
    </SetupNotice>
  )
}
