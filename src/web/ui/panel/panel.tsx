import { backStack, collapsed, isFocus, panelView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { Book } from '@/web/ui/book/book'
import { PanelIcon } from '@/web/ui/kit/icons'
import { UndoBar } from '@/web/ui/kit/undo-bar'
import { BackRow } from '@/web/ui/panel/back-row'
import { Rail } from '@/web/ui/panel/rail'
import { Tabs } from '@/web/ui/panel/tabs'
import { TickerCard } from '@/web/ui/ticker/card'
import { Today } from '@/web/ui/today/today'

import './panel.css'

/** The info panel: tabs, the way back, and the view. It folds into a rail, except in focus mode. */
export function Panel() {
  if (collapsed.value && !isFocus.value) {
    return <Rail />
  }

  return (
    <aside class="panel" aria-label={tr('ui.office.panel.label')}>
      <div class="panel-head glass">
        <Tabs isCompact={!('tab' in panelView.value)} />
        {!isFocus.value && (
          <button
            type="button"
            class="icon-button"
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
        <UndoBar />
        <PanelContent />
      </div>
    </aside>
  )
}

// Đề xuất and the person view are mounted here by the tasks that build them.
function PanelContent() {
  const view = panelView.value

  if ('ticker' in view) {
    return (
      <TickerCard key={`${view.market}:${view.ticker}`} ticker={view.ticker} market={view.market} />
    )
  }

  if (!('tab' in view)) {
    return null
  }

  if (view.tab === 'book') {
    return <Book />
  }

  return view.tab === 'today' ? <Today /> : null
}
