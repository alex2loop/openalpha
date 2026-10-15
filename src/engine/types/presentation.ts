import type { ToolLifecycleOwner } from '@/core/stream-events'

export interface ResolvedToolPresentation {
  readonly label: string
  readonly lifecycleOwner: ToolLifecycleOwner
  readonly emoji?: string
  readonly detail?: string
  /** An external tool's detail was cut: the operator never saw the whole call. */
  readonly truncated?: true
}
