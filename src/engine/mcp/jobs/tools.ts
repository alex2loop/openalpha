import { z } from 'zod'

import type { AdvertisedTool } from '@/engine/mcp/serve-core'
import { BRAND } from '@/core/brand'
import { MAX_PENDING_REQUESTS } from '@/engine/mcp/jobs/broker'

const MAX_MODEL_NAME_CHARS = 64
/** Input bound only; the stored name is cut to `MAX_MODEL_NAME_CHARS` after cleaning. */
const MAX_MODEL_NAME_INPUT_CHARS = 256
const MODEL_NAME_DISALLOWED_RE = /[^\w.:/-]+/g
const MODEL_NAME_EDGE_DASHES_RE = /^-+|-+$/g
const UNNAMED_MODEL = 'unnamed'

export const MODEL_REQUEST_VIEW_TOOL_NAME = 'model_request_view'
export const MODEL_ANSWER_TOOL_NAME = 'model_answer'
export const MODEL_RESUME_TOOL_NAME = 'model_resume'
export const REQUESTS_REPLY_KIND = 'model_requests'
export const WORKING_REPLY_KIND = 'working'
export const ANSWERED_REPLY_KIND = 'answered'
export const FINISHED_REPLY_KIND = 'finished'
/** The subagent `mcp install` writes for a host that runs one per request. */
export const ANALYST_AGENT_NAME = `${BRAND.name}-analyst`

const INLINE_INPUT = z
  .boolean()
  .optional()
  .describe(
    'true when you answer the requests in your own context rather than through subagents: each request comes back whole, and the finished result comes back directly.'
  )

export const MODEL_REQUEST_VIEW_INPUT = z.strictObject({
  continuation: z.uuid(),
  requestId: z.uuid(),
})

export const MODEL_REQUEST_VIEW_TOOL: AdvertisedTool = Object.freeze({
  name: MODEL_REQUEST_VIEW_TOOL_NAME,
  description: `Read one request a ${REQUESTS_REPLY_KIND} reply lists: its system text, messages and output schema. Takes the continuation and requestId, so a subagent can read its own request without the text being copied to it.`,
  inputSchema: { ...z.toJSONSchema(MODEL_REQUEST_VIEW_INPUT), type: 'object' as const },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
})

const MODEL_ANSWER_ITEM = z.strictObject({
  requestId: z.uuid(),
  // Hosts often pass a schema answer as the parsed JSON rather than its text.
  output: z
    .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .transform((output) => (typeof output === 'string' ? output : JSON.stringify(output)))
    .describe('Your answer: text, or the JSON the request schema asks for.'),
})

export const MODEL_ANSWER_INPUT = z.strictObject({
  continuation: z.uuid(),
  answers: z
    .array(MODEL_ANSWER_ITEM)
    .min(1)
    .max(MAX_PENDING_REQUESTS)
    .describe('One answer per request: just your own as a subagent, every open one when inline.'),
  inline: INLINE_INPUT,
  model: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MODEL_NAME_INPUT_CHARS)
    .describe('The id of the model that wrote this answer, such as claude-opus-4-5.'),
})

export const MODEL_ANSWER_TOOL: AdvertisedTool = Object.freeze({
  name: MODEL_ANSWER_TOOL_NAME,
  description: `Send answers to requests a ${REQUESTS_REPLY_KIND} reply lists: the continuation, each requestId with its output - only JSON that matches the request's output schema when it has one - and the id of the model that wrote them. Returns kind "${ANSWERED_REPLY_KIND}" while other requests of the round are still open. The call that answers the last open request waits for the next step instead and returns it: the next ${REQUESTS_REPLY_KIND} reply, kind "${WORKING_REPLY_KIND}", or kind "${FINISHED_REPLY_KIND}" (the result waits for ${MODEL_RESUME_TOOL_NAME}) - or, when inline, the finished result itself.`,
  inputSchema: { ...z.toJSONSchema(MODEL_ANSWER_INPUT, { io: 'input' }), type: 'object' as const },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
})

export const MODEL_RESUME_INPUT = z.strictObject({
  continuation: z.uuid(),
  inline: INLINE_INPUT,
})

export const MODEL_RESUME_TOOL: AdvertisedTool = Object.freeze({
  name: MODEL_RESUME_TOOL_NAME,
  description: `Wait for the next step of an analysis. Returns the open ${REQUESTS_REPLY_KIND} reply, the finished result, or kind "${WORKING_REPLY_KIND}" while the analysis runs - call again to keep waiting. Call it after kind "${WORKING_REPLY_KIND}" or "${FINISHED_REPLY_KIND}", after a lost reply or a cancelled call, and inline to receive a round's requests whole.`,
  inputSchema: { ...z.toJSONSchema(MODEL_RESUME_INPUT), type: 'object' as const },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
})

/** Served beside the surface, never through it: a call on a job must not queue behind that job. */
export const MODEL_TOOLS: readonly AdvertisedTool[] = Object.freeze([
  MODEL_REQUEST_VIEW_TOOL,
  MODEL_ANSWER_TOOL,
  MODEL_RESUME_TOOL,
])

/** Cleaned, never refused: an odd id is no reason to lose the answer. */
export function normalizeModelName(raw: string): string {
  const name = raw
    .replace(MODEL_NAME_DISALLOWED_RE, '-')
    .slice(0, MAX_MODEL_NAME_CHARS)
    .replace(MODEL_NAME_EDGE_DASHES_RE, '')

  return name === '' ? UNNAMED_MODEL : name
}
