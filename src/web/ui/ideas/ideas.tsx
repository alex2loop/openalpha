import type { MessageKey } from '@/i18n'
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
  ])

/** Đề xuất: three sub-tabs over what the daemon has called. The one open is remembered. */
export function Ideas() {
  return (
    <>
      <Segmented
        label={tr('ui.office.panel.ideas')}
        value={ideasTab.value}
        options={IDEAS_TABS.map((tab) => ({ value: tab.value, label: tr(tab.label) }))}
        onChange={(value) => {
          ideasTab.value = value
        }}
      />
      <IdeasView tab={ideasTab.value} />
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
  }
}
