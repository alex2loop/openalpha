import { collapsed, openView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { PanelIcon } from '@/web/ui/kit/icons'
import { PANEL_TABS } from '@/web/ui/panel/tabs'

/** The 52 px strip the panel folds into: the way back open, then one icon per tab. */
export function Rail() {
  return (
    <div class="panel-rail">
      <button
        type="button"
        class="icon-button"
        title={tr('ui.office.panel.expand')}
        aria-label={tr('ui.office.panel.expand')}
        onClick={() => {
          collapsed.value = false
        }}
      >
        <PanelIcon />
      </button>
      {PANEL_TABS.map((spec) => (
        <button
          key={spec.tab}
          type="button"
          class="icon-button"
          title={spec.label()}
          aria-label={spec.label()}
          onClick={() => openView({ tab: spec.tab }, { fresh: true })}
        >
          {spec.icon}
        </button>
      ))}
    </div>
  )
}
