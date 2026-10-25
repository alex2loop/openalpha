import { brand } from '@/web/state/session'

import './header.css'

export function Header() {
  return (
    <header class="header glass">
      <div class="header-brand">
        <span class="logo header-logo" aria-hidden="true" />
        {brand.value}
      </div>
    </header>
  )
}
