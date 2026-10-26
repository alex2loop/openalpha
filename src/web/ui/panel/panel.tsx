import { breakpoint } from '@/web/state/breakpoints'
import { backStack, collapsed, isFocus, PANEL_ELEMENT_ID, panelView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { AgentTab } from '@/web/ui/agent/agent-tab'
import { Book } from '@/web/ui/book/book'
import { Ideas } from '@/web/ui/ideas/ideas'
import { PanelIcon } from '@/web/ui/kit/icons'
import { BackRow } from '@/web/ui/panel/back-row'
import { Rail } from '@/web/ui/panel/rail'
import { Tabs } from '@/web/ui/panel/tabs'
import { TickerCard } from '@/web/ui/ticker/card'
import { TickerNotice } from '@/web/ui/ticker/ticker-notice'
import { Today } from '@/web/ui/today/today'

import './panel.css'

/** The info panel: tabs, the way back, and the view. It folds into a rail on a wide screen, except
 *  in focus mode. */
export function Panel() {
  if (collapsed.value && !isFocus.value && breakpoint.value === 'wide') {
    return <Rail />
  }

  return (
    <aside
      id={PANEL_ELEMENT_ID}
      class="panel"
      aria-label={tr('ui.office.panel.label')}
      tabIndex={-1}
    >
      <div class="panel-head glass">
        <Tabs isCompact={!('tab' in panelView.value)} />
        {!isFocus.value && (
          <button
            type="button"
            class="icon-button panel-collapse"
            title={tr('ui.office.panel.collapse')}
            aria-label={tr('ui.office.panel.collapse')}
            onClick={() => {
              collapsed.value = true
            }}
          >
            <PanelIcon />
          </button>
        )}
      </div>
      {backStack.value.length > 0 && <BackRow />}
      <div class="panel-body">
        <TickerNotice />
        <PanelContent />
      </div>
    </aside>
  )
}

function PanelContent() {
  const view = panelView.value

  if ('agent' in view) {
    return (
      <AgentTab
        key={`${view.agent}:${view.section ?? ''}`}
        agentId={view.agent}
        {...(view.section === undefined ? {} : { section: view.section })}
      />
    )
  }

  if ('ticker' in view) {
    return (
      <TickerCard key={`${view.market}:${view.ticker}`} ticker={view.ticker} market={view.market} />
    )
  }

  switch (view.tab) {
    case 'book':
      return <Book />
    case 'ideas':
      return <Ideas />
    case 'today':
      return <Today />
  }
}
