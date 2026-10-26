import type { ComponentChildren } from 'preact'

import { unseenCalls } from '@/web/state/ideas'
import { openView, type PanelTab, panelView } from '@/web/state/panel'
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

/** Hôm nay, Danh mục, Đề xuất and Thị trường; with a person or ticker open they drop to icon and
 *  count. */
export function Tabs({ isCompact }: { readonly isCompact: boolean }) {
  const view = panelView.value
  const active = 'tab' in view ? view.tab : undefined

  return (
    <nav class={isCompact ? 'panel-tabs is-compact' : 'panel-tabs'}>
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

// Only "Đề xuất" carries a count: the calls the operator has not looked at yet.
function TabCount({ tab }: { readonly tab: PanelTab }) {
  const count = tab === 'ideas' ? unseenCalls.value.length : 0

  return count > 0 ? <span class="panel-tab-count">{count}</span> : null
}
