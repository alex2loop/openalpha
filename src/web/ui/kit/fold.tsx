import type { ComponentChildren } from 'preact'
import { useSignal } from '@preact/signals'

import './fold.css'

interface FoldProps {
  readonly title: string
  /** Called each time the fold opens, so a read can start then. */
  readonly onOpen?: () => void
  readonly children: ComponentChildren
}

/** A closed section that mounts its body only once opened, so whatever the body loads waits for it. */
export function Fold({ title, onOpen, children }: FoldProps) {
  const isOpen = useSignal(false)

  return (
    <details
      class="fold"
      onToggle={(event) => {
        isOpen.value = event.currentTarget.open

        if (event.currentTarget.open) {
          onOpen?.()
        }
      }}
    >
      <summary>{title}</summary>
      {isOpen.value && <div class="fold-body">{children}</div>}
    </details>
  )
}
