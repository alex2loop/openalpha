import type { ComponentChildren } from 'preact'

import { unseenCalls } from '@/web/state/ideas'
import { backStack, openView, type PanelTab, type PanelView, panelView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { BulbIcon, GlobeIcon, PieIcon, SunIcon } from '@/web/ui/kit/icons'
import { Segmented } from '@/web/ui/kit/segmented'

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
 *  from. Only "Đề xuất" carries a count: the calls the operator has not looked at yet. */
export function Tabs() {
  const view = panelView.value
  const origin = 'tab' in view ? view : backStack.value.findLast(isTabView)

  return (
    <Segmented
      isTabs
      className="panel-tabs"
      label={tr('ui.office.panel.label')}
      value={origin?.tab}
      options={PANEL_TABS.map((spec) => ({
        value: spec.tab,
        label: spec.label(),
        icon: spec.icon,
        badge: spec.tab === 'ideas' ? unseenCalls.value.length : 0,
      }))}
      onChange={(tab) => openView({ tab }, { fresh: true })}
    />
  )
}

function isTabView(view: PanelView): view is { readonly tab: PanelTab } {
  return 'tab' in view
}
