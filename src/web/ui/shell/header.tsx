import { pluralKey } from '@/i18n'
import { runningCount } from '@/web/state/live'
import { brand } from '@/web/state/session'
import { tr } from '@/web/text/tr'

import './header.css'

export function Header() {
  return (
    <header class="header glass">
      <div class="header-brand">
        <span class="logo header-logo" aria-hidden="true" />
        {brand.value}
      </div>
      <RunningChip />
    </header>
  )
}

function RunningChip() {
  const count = runningCount.value

  if (count === 0) {
    return <span class="chip">{tr('ui.office.header.runningNone')}</span>
  }

  return (
    <span class="chip">
      <span class="spin" aria-hidden="true" />
      {tr(pluralKey(count, 'ui.office.header.runningOne', 'ui.office.header.running'), { count })}
    </span>
  )
}
