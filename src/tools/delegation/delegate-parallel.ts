import type { ToolInvocationContext, ToolResult } from '@/core/tool'
import { ToolError } from '@/core/errors'
import { createTool } from '@/core/tool'
import {
  type DelegationInput,
  delegateParallelInput,
  resolveDelegation,
  runParallelChildren,
} from '@/tools/delegation/child-run'

export const delegateParallelTool = createTool({
  name: 'delegate_parallel',
  description:
    'Run one bounded parallel call for two or more independent, self-contained, non-evidence specialist tasks and await every result. Match the item count to the genuinely independent parts, typically two to four; more children is not more thorough. Keep dependent work sequential. Code enforces roster, permissions, quota, depth, parallel fan-out, budget, and approval.',
  inputSchema: delegateParallelInput,
  capability: 'delegate',
  presentation: { label: 'Delegate (parallel)', emoji: '🤖' },
  async execute(args, ctx: ToolInvocationContext): Promise<ToolResult> {
    if (args.items.length > ctx.config.loop.maxParallelDelegations) {
      throw new ToolError(
        'delegate_full',
        `delegate_parallel accepts at most ${ctx.config.loop.maxParallelDelegations} child agents`
      )
    }

    const delegations = args.items.map((item: DelegationInput) => resolveDelegation(item, ctx))

    return runParallelChildren(delegations, ctx)
  },
})
