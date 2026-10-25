import { backStack, collapsed, isFocus, panelView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { PanelIcon } from '@/web/ui/kit/icons'
import { BackRow } from '@/web/ui/panel/back-row'
import { Rail } from '@/web/ui/panel/rail'
import { Tabs } from '@/web/ui/panel/tabs'
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
        <PanelContent />
      </div>
    </aside>
  )
}

// Danh mục, Đề xuất and the person and ticker views are mounted here by the tasks that build them.
function PanelContent() {
  const view = panelView.value

  return 'tab' in view && view.tab === 'today' ? <Today /> : null
}
