import type { ComponentChildren } from 'preact'
import { useSignal } from '@preact/signals'

import './fold.css'

interface FoldProps {
  readonly title: string
  readonly children: ComponentChildren
  /** Opens on first show, for a body that already holds something the reader set. */
  readonly isOpenInitially?: boolean
}

/** A closed section that mounts its body only once opened, so whatever the body loads waits for it. */
export function Fold({ title, children, isOpenInitially }: FoldProps) {
  const isOpen = useSignal(isOpenInitially === true)

  return (
    <details
      class="fold"
      open={isOpen.value}
      onToggle={(event) => {
        isOpen.value = event.currentTarget.open
      }}
    >
      <summary>{title}</summary>
      {isOpen.value && <div class="fold-body">{children}</div>}
    </details>
  )
}
