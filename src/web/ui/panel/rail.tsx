import { collapsed, PANEL_ELEMENT_ID } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { CollapseIcon } from '@/web/ui/kit/icons'
import { Tabs } from '@/web/ui/panel/tabs'

/** The 52 px strip the panel folds into: one icon per tab, then the arrow that opens it again. */
export function Rail() {
  return (
    <div id={PANEL_ELEMENT_ID} class="panel-rail" tabIndex={-1}>
      <Tabs isCompact={true} />
      <button
        type="button"
        class="panel-collapse"
        title={tr('ui.office.panel.expand')}
        aria-label={tr('ui.office.panel.expand')}
        onClick={() => {
          collapsed.value = false
        }}
      >
        <CollapseIcon />
      </button>
    </div>
  )
}
