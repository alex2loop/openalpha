import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js'

import type { Locale } from '@/core/types/locale'
import type {
  ApprovalAnswer,
  ApprovalDecision,
  ApprovalRequestInput,
  ApprovalScope,
  ToolApproval,
} from '@/engine/api'
import { formatToolCall } from '@/cli/commands/chat/render'
import { decisionsFor } from '@/engine/api'
import { approvalDetail, t, translateToolLabel } from '@/i18n'

const MCP_SCOPE = { kind: 'mcp' } as const satisfies ApprovalScope

// URL-only elicitation cannot render a form; a bare `elicitation: {}` predates the mode split.
export function hasFormElicitation(server: McpServer): boolean {
  const elicitation = server.server.getClientCapabilities()?.elicitation

  if (elicitation === undefined) {
    return false
  }

  return 'form' in elicitation || Object.keys(elicitation).length === 0
}

// Connection-scoped: a stdio server is one process per client, so these sets die with the
// transport and Remember never outlives the connection that granted it.
export function createMcpApproval(server: McpServer, locale: Locale): ToolApproval {
  const remembered = new Set<string>()
  const denied = new Set<string>()

  return {
    scope: MCP_SCOPE,

    status(toolName): 'remembered' | 'denied' | 'prompt' {
      if (remembered.has(toolName)) {
        return 'remembered'
      }

      return denied.has(toolName) ? 'denied' : 'prompt'
    },

    async request(input): Promise<ApprovalAnswer> {
      return { decision: await elicitDecision(server, locale, input) }
    },

    remember(toolName): void {
      remembered.add(toolName)
    },

    deny(toolName): void {
      denied.add(toolName)
    },
  }
}

// Fails closed on decline, cancel, malformed content, transport close, abort, and timeout.
async function elicitDecision(
  server: McpServer,
  locale: Locale,
  input: ApprovalRequestInput
): Promise<ApprovalDecision> {
  try {
    const result = await server.server.elicitInput(
      {
        mode: 'form',
        message: promptMessage(locale, input),
        requestedSchema: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: [...decisionsFor(MCP_SCOPE, input.oneTime)] },
          },
          required: ['decision'],
        },
      },
      { signal: input.signal, timeout: input.timeoutMs }
    )

    return decisionOf(result, input.oneTime)
  } catch {
    return 'deny'
  }
}

function promptMessage(locale: Locale, input: ApprovalRequestInput): string {
  const call = formatToolCall({
    label: translateToolLabel(locale, input.toolName, input.label),
    emoji: input.emoji,
    detail: approvalDetail(locale, input.detail, input.truncated),
  })

  return `${t(locale, 'channel.approvalRequired')}: ${call}`
}

function decisionOf(result: ElicitResult, oneTime: true | undefined): ApprovalDecision {
  if (result.action !== 'accept') {
    return 'deny'
  }

  const answer = result.content?.decision

  return decisionsFor(MCP_SCOPE, oneTime).find((decision) => decision === answer) ?? 'deny'
}
