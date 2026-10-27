import type { ComponentChildren } from 'preact'

import { unseenCalls } from '@/web/state/ideas'
import { backStack, openView, type PanelTab, type PanelView, panelView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { BulbIcon, GlobeIcon, PieIcon, SunIcon } from '@/web/ui/kit/icons'

interface TabSpec {
  readonly tab: PanelTab
  readonly icon: ComponentChildren
  readonly label: () => string
}

const PANEL_TABS: readonly TabSpec[] = Object.freeze([
  { tab: 'today', icon: <SunIcon />, label: () => tr('ui.office.common.today') },
  { tab: 'book', icon: <PieIcon />, label: () => tr('trading.render.affordance.portfolio') },
  { tab: 'ideas', icon: <BulbIcon />, label: () => tr('ui.office.panel.ideas') },
  { tab: 'market', icon: <GlobeIcon />, label: () => tr('ui.office.panel.market') },
])

/** Hôm nay, Danh mục, Đề xuất and Thị trường; a person or ticker open keeps lit the tab it came
 *  from. */
export function Tabs() {
  const view = panelView.value
  const origin = 'tab' in view ? view : backStack.value.findLast(isTabView)
  const active = origin?.tab

  return (
    <nav class="panel-tabs">
      {PANEL_TABS.map((spec) => (
        <button
          key={spec.tab}
          type="button"
          class={spec.tab === active ? 'panel-tab is-active' : 'panel-tab'}
          title={spec.label()}
          aria-label={spec.label()}
          aria-current={spec.tab === active ? 'page' : undefined}
          onClick={() => openView({ tab: spec.tab }, { fresh: true })}
        >
          {spec.icon}
          <span class="panel-tab-label">{spec.label()}</span>
          <TabCount tab={spec.tab} />
        </button>
      ))}
    </nav>
  )
}

function isTabView(view: PanelView): view is { readonly tab: PanelTab } {
  return 'tab' in view
}

// Only "Đề xuất" carries a count: the calls the operator has not looked at yet.
function TabCount({ tab }: { readonly tab: PanelTab }) {
  const count = tab === 'ideas' ? unseenCalls.value.length : 0

  return count > 0 ? <span class="panel-tab-count">{count}</span> : null
}
