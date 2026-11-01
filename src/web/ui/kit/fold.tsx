import type { ComponentChildren } from 'preact'
import { useSignal } from '@preact/signals'

import './fold.css'

interface FoldProps {
  readonly title: string
  readonly children: ComponentChildren
}

/** A closed section that mounts its body only once opened, so whatever the body loads waits for it. */
export function Fold({ title, children }: FoldProps) {
  const isOpen = useSignal(false)

  return (
    <details
      class="fold"
      onToggle={(event) => {
        isOpen.value = event.currentTarget.open
      }}
    >
      <summary>{title}</summary>
      {isOpen.value && <div class="fold-body">{children}</div>}
    </details>
  )
}
