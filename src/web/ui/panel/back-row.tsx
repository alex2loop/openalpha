import { backStack, goBack, type PanelView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { ChevronLeftIcon } from '@/web/ui/kit/icons'

/** "Quay lại {place}": the view the operator came from; absent at the start of a trail. */
export function BackRow() {
  const previous = backStack.value.at(-1)

  if (previous === undefined) {
    return null
  }

  return (
    <div class="back-row">
      <button type="button" onClick={goBack}>
        <ChevronLeftIcon />
        {tr('ui.office.common.back', { place: placeOf(previous) })}
      </button>
    </div>
  )
}

function placeOf(view: PanelView): string {
  if ('agent' in view) {
    return view.agent
  }

  if ('ticker' in view) {
    return view.ticker
  }

  if (view.tab === 'book') {
    return tr('trading.render.affordance.portfolio')
  }

  return view.tab === 'ideas' ? tr('ui.office.panel.ideas') : tr('ui.office.common.today')
}
