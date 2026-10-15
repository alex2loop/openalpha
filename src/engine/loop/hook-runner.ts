import type { LLMResponse } from '@/core/llm'
import type { AfterLLMHook, HookFn, RunView } from '@/engine/types/run'
import { RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { isCriticalHook } from '@/engine/types/run'

export async function runHooks(hooks: readonly HookFn[], run: RunView): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(run)
    } catch (err: unknown) {
      rethrowOrLog(err, run, hook)
    }
  }
}

export async function runAfterLLM(
  hooks: readonly AfterLLMHook[],
  run: RunView,
  response: LLMResponse
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(run, response)
    } catch (err: unknown) {
      rethrowOrLog(err, run, hook)
    }
  }
}

function rethrowOrLog(err: unknown, run: RunView, hook: unknown): void {
  if (err instanceof RunHalted) {
    throw err
  }

  if (isCriticalHook(hook)) {
    throw new RunHalted('hook_failed', `critical hook failed: ${messageOf(err)}`)
  }

  run.services.logger.warn('engine.hook_threw', { err: formatErrForLog(err) })
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
