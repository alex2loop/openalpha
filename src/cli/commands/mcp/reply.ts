import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { Locale } from '@/core/types/locale'
import type { McpJobRefusal, McpJobReply } from '@/engine/api'
import type { MessageKey } from '@/i18n'
import {
  ANSWERED_REPLY_KIND,
  FINISHED_REPLY_KIND,
  REQUESTS_REPLY_KIND,
  WORKING_REPLY_KIND,
} from '@/engine/api'
import { t } from '@/i18n'

const REFUSAL_KEYS = {
  full: 'cli.mcpJobFull',
  unknown: 'cli.mcpJobUnknown',
  busy: 'cli.mcpJobBusy',
  expired: 'cli.mcpJobExpired',
  closing: 'cli.mcpJobClosing',
  not_pending: 'cli.mcpJobNotPending',
  too_large: 'cli.mcpJobTooLarge',
} as const satisfies Record<McpJobRefusal, MessageKey>

export function toCallToolResult(reply: McpJobReply, locale: Locale): CallToolResult {
  switch (reply.kind) {
    case 'result':
      return { content: [textContent(reply.result.content)], isError: reply.result.isError }
    case 'requests':
      return jsonResult({
        kind: REQUESTS_REPLY_KIND,
        continuation: reply.continuation,
        requests: reply.requests.map(({ id, ...request }) =>
          reply.inline ? { requestId: id, ...request } : { requestId: id, role: request.role }
        ),
      })
    case 'working':
      return jsonResult({ kind: WORKING_REPLY_KIND, continuation: reply.continuation })
    case 'finished':
      return jsonResult({ kind: FINISHED_REPLY_KIND, continuation: reply.continuation })
    case 'request':
      return jsonResult(reply.request)
    case 'answered':
      return jsonResult({ kind: ANSWERED_REPLY_KIND })
    case 'refused':
      return { content: [textContent(t(locale, REFUSAL_KEYS[reply.refusal]))], isError: true }
    default: {
      const exhaustive: never = reply
      return exhaustive
    }
  }
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [textContent(JSON.stringify(value))], isError: false }
}

function textContent(text: string): { readonly type: 'text'; readonly text: string } {
  return { type: 'text', text }
}
