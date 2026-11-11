import type { MessageKey } from '@/i18n'
import { Analyses } from '@/web/edition/analyses'
import { ideasTabKey, isAnalysisOnly } from '@/web/state/edition'
import { type IdeasTab, ideasTab } from '@/web/state/ideas'
import { tr } from '@/web/text/tr'
import { OpenIdeas } from '@/web/ui/ideas/open'
import { TrackRecord } from '@/web/ui/ideas/record'
import { Opportunities } from '@/web/ui/ideas/screen'
import { Segmented } from '@/web/ui/kit/segmented'

import './ideas.css'

const IDEAS_TABS: readonly { readonly value: IdeasTab; readonly label: MessageKey }[] =
  Object.freeze([
    { value: 'open', label: 'ui.office.ideas.open' },
    { value: 'screen', label: 'ui.office.ideas.screen' },
    { value: 'record', label: 'ui.office.ideas.record' },
    { value: 'analyses', label: 'ui.office.edition.analysis.tab' },
  ])

// What each edition shows: the daemon its stored calls and track record, the web its screen and the
// analyses stored on this device.
const DAEMON_TABS: ReadonlySet<IdeasTab> = new Set(['open', 'screen', 'record'])
const WEB_TABS: ReadonlySet<IdeasTab> = new Set(['screen', 'analyses'])
const WEB_FIRST_TAB: IdeasTab = 'analyses'

/** Đề xuất: three sub-tabs over what the daemon has called. The one open is remembered. */
export function Ideas() {
  const shown = isAnalysisOnly.value ? WEB_TABS : DAEMON_TABS
  const tab = shown.has(ideasTab.value) ? ideasTab.value : WEB_FIRST_TAB

  return (
    <>
      <Segmented
        isTabs
        label={tr(ideasTabKey())}
        value={tab}
        options={IDEAS_TABS.filter((spec) => shown.has(spec.value)).map((spec) => ({
          value: spec.value,
          label: tr(spec.label),
        }))}
        onChange={(value) => {
          ideasTab.value = value
        }}
      />
      <IdeasView tab={tab} />
    </>
  )
}

function IdeasView({ tab }: { readonly tab: IdeasTab }) {
  switch (tab) {
    case 'open':
      return <OpenIdeas />
    case 'screen':
      return <Opportunities />
    case 'record':
      return <TrackRecord />
    case 'analyses':
      return <Analyses />
  }
}
