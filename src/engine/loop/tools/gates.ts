import type { ToolCall, ToolResult } from '@/core/tool'
import type { RunView, ToolGate, ToolGateResult } from '@/engine/types/run'
import { RunHalted, ToolError } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'

type BlockedToolGateResult = Extract<ToolGateResult, { readonly action: 'block' }>

export async function blockFromGates<Call extends ToolCall>(
  run: RunView,
  call: Call,
  gates: readonly ToolGate<Call>[]
): Promise<ToolResult | undefined> {
  try {
    const blocked = await runGates(run, call, gates)

    if (blocked === undefined) {
      return undefined
    }

    return {
      content: blocked.error?.message ?? blocked.message,
      isError: true,
      ...(blocked.error === undefined ? {} : { errorCode: blocked.error.code }),
    }
  } catch (err: unknown) {
    if (err instanceof ToolError) {
      return { content: err.message, isError: true, errorCode: err.code }
    }

    throw err
  }
}

async function runGates<Call extends ToolCall>(
  run: RunView,
  call: Call,
  gates: readonly ToolGate<Call>[]
): Promise<BlockedToolGateResult | undefined> {
  const warnings: string[] = []

  for (const gate of gates) {
    try {
      const verdict = await gate(run, call)

      if (verdict.action === 'block') {
        return verdict
      }

      if (verdict.action === 'warn') {
        warnings.push(verdict.message)
      }
    } catch (err: unknown) {
      // A typed throw is the gate stating a verdict, so it passes through. Anything else is a defect
      // in the gate: the run halts, and only the gate's name survives — an arbitrary throw's message
      // is not known to be safe to show.
      if (err instanceof RunHalted || err instanceof ToolError) {
        throw err
      }

      const hookName = scrubCredentials(gate.name ?? 'unknown')

      throw new RunHalted('hook_failed', `tool gate '${hookName}' failed`)
    }
  }

  if (warnings.length > 0) {
    run.services.logger.warn('engine.before_tool_warn', {
      tool: call.name,
      warning: warnings.join('; '),
    })
  }

  return undefined
}
