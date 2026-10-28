import { breakpoint } from '@/web/state/breakpoints'
import { isInfoOnly, showPane } from '@/web/state/pane'
import {
  backStack,
  collapsed,
  isFocused,
  PANEL_ELEMENT_ID,
  type PanelView,
  panelView,
} from '@/web/state/panel'
import { reducedMotion } from '@/web/state/prefs'
import { tr } from '@/web/text/tr'
import { AgentTab } from '@/web/ui/agent/agent-tab'
import { Book } from '@/web/ui/book/book'
import { Ideas } from '@/web/ui/ideas/ideas'
import { CollapseIcon } from '@/web/ui/kit/icons'
import { Market } from '@/web/ui/market/market'
import { BackRow } from '@/web/ui/panel/back-row'
import { Rail } from '@/web/ui/panel/rail'
import { Tabs } from '@/web/ui/panel/tabs'
import { focusPaneButton } from '@/web/ui/shell/pane-bar'
import { TickerCard } from '@/web/ui/ticker/card'
import { TickerNotice } from '@/web/ui/ticker/ticker-notice'
import { Today } from '@/web/ui/today/today'

import './panel.css'

/** The info panel: tabs, the way back, and the view. It folds into a rail on a wide screen, except
 *  in Full office, where it floats over the office as glass, and in Info only, where it fills the
 *  page at a reading width; on a narrow screen it is a glass bottom sheet over the office, its
 *  handle closing it. */
export function Panel() {
  const isFixed = isFocused.value || isInfoOnly.value

  if (collapsed.value && !isFixed && breakpoint.value === 'wide') {
    return <Rail />
  }

  const isSheet = breakpoint.value !== 'wide'

  return (
    <aside
      id={PANEL_ELEMENT_ID}
      class={panelClass(isSheet)}
      aria-label={tr('ui.office.panel.label')}
      tabIndex={-1}
    >
      {isSheet && <SheetHandle />}
      <div class="panel-head">
        <Tabs />
        {!isFixed && (
          <button
            type="button"
            class="panel-collapse"
            title={tr('ui.office.panel.collapse')}
            aria-label={tr('ui.office.panel.collapse')}
            onClick={() => {
              collapsed.value = true
            }}
          >
            <CollapseIcon />
          </button>
        )}
        {backStack.value.length > 0 && <BackRow />}
      </div>
      <div class="panel-body">
        <TickerNotice />
        <PanelPage />
      </div>
    </aside>
  )
}

function panelClass(isSheet: boolean): string {
  if (isSheet) {
    return 'panel glass is-sheet'
  }

  if (isFocused.value) {
    return 'panel glass is-float'
  }

  return isInfoOnly.value ? 'panel chrome-glass is-reading' : 'panel chrome-glass'
}

function SheetHandle() {
  return (
    <button
      type="button"
      class="sheet-handle"
      title={tr('ui.office.panel.sheetHide')}
      aria-label={tr('ui.office.panel.sheetHide')}
      onClick={() => {
        showPane('office')
        focusPaneButton('info')
      }}
    >
      <span class="sheet-grip" aria-hidden="true" />
    </button>
  )
}

/** The open view, which slides in when the tab, ticker or agent changes (not under reduced motion). */
function PanelPage() {
  const view = panelView.value

  return (
    <div key={viewKey(view)} class={reducedMotion.value ? 'panel-view' : 'panel-view is-entering'}>
      <PanelContent view={view} />
    </div>
  )
}

function viewKey(view: PanelView): string {
  if ('agent' in view) {
    return `agent:${view.agent}`
  }

  return 'ticker' in view ? `ticker:${view.market}:${view.ticker}` : view.tab
}

function PanelContent({ view }: { readonly view: PanelView }) {
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
    case 'market':
      return <Market />
    case 'today':
      return <Today />
  }
}
