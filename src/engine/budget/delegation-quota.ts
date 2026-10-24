import type { DelegationQuota } from '@/core/tool'
import { ToolError } from '@/core/errors'

export function createDelegationQuota(maxDelegations: number): DelegationQuota {
  let remaining = Math.max(0, Math.floor(maxDelegations))
  let openChildren = 0

  return {
    remaining(): number {
      return remaining
    },
    reserve(count: number): void {
      const requested = Math.max(0, Math.floor(count))

      if (requested === 0) {
        return
      }

      if (requested > remaining) {
        throw new ToolError(
          'delegate_full',
          `delegation quota exhausted: requested ${requested}, remaining ${remaining}`
        )
      }

      remaining -= requested
    },
    openChildren(): number {
      return openChildren
    },
    trackChild(): () => void {
      let released = false

      openChildren += 1

      return () => {
        if (!released) {
          released = true
          openChildren -= 1
        }
      }
    },
  }
}
