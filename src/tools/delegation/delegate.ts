import type { ToolInvocationContext, ToolResult } from '@/core/tool'
import { createTool } from '@/core/tool'
import {
  type DelegationInput,
  delegationInput,
  resolveDelegation,
  runSingleChild,
} from '@/tools/delegation/child-run'

export const delegateTool = createTool({
  name: 'delegate',
  description:
    'Run one self-contained, non-evidence specialist task with a rostered agent. Use research when claims need current external evidence. Code enforces roster, permissions, quota, depth, budget, and approval.',
  inputSchema: delegationInput,
  capability: 'delegate',
  presentation: { label: 'Delegate', emoji: '🤖', detailKeys: ['agent_id', 'prompt'] },
  async execute(args: DelegationInput, ctx: ToolInvocationContext): Promise<ToolResult> {
    const delegation = resolveDelegation(args, ctx)

    return runSingleChild(delegation, ctx)
  },
})
