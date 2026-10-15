import { z } from 'zod'

import type { ToolInvocationContext } from '@/core/tool'
import type { MemoryScope } from '@/core/types/memory'
import { ToolError } from '@/core/errors'
import { isMemoryKey, MEMORY_KEY_MAX_LEN } from '@/core/memory-key'

export const MEMORY_KEY_SCHEMA = z
  .string()
  .max(MEMORY_KEY_MAX_LEN)
  .refine(isMemoryKey, 'slug only: letters, digits, _, -, ., :, @, / (no spaces)')
  .describe(
    'Short slug key, e.g. project-notes-2026. Allowed characters: A-Z a-z 0-9 _ - . : @ / (no spaces).'
  )

export function toMemoryScope(ctx: ToolInvocationContext): MemoryScope {
  return { agentId: ctx.agentId, userId: ctx.userId }
}

// A delegated child is confined to its own session prefix, which the advertised key cap excludes.
export function scopedKey(ctx: ToolInvocationContext, key: string): string {
  if (ctx.callDepth === 0) {
    return key
  }

  const scoped = `${ctx.sessionId}:${key}`

  if (!isMemoryKey(scoped)) {
    throw new ToolError(
      'invalid_input',
      `key must be at most ${MEMORY_KEY_MAX_LEN - ctx.sessionId.length - 1} characters in a delegated call`
    )
  }

  return scoped
}

export function isMemoryMutationApprovalRequired(): boolean {
  return true
}
