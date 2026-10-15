import type { HudPlan, LiveRunHudTool } from '@/channels/delivery/format'
import type { ProgressMessage, StreamEvent } from '@/core/stream-events'
import type { Locale } from '@/core/types/locale'
import type { LruMap } from '@/core/utils/collections'
import { toPlanSteps } from '@/engine/api'
import { translateDisplayText, translateToolLabel } from '@/i18n'

export const MAX_TRACKED_TOOLS = 8
const MAX_TOOL_ID_LENGTH = 128
const MAX_TOOL_LABEL_LENGTH = 64
const MAX_PERSISTENT_PROGRESS_LINES = 12
const GENERIC_TOOL_LABEL = 'tool'

interface StartLiveRunToolInput {
  readonly tools: LruMap<string, LiveRunHudTool>
  readonly event: Extract<StreamEvent, { readonly type: 'tool_execution_start' }>
  readonly locale: Locale
}

interface UpdateLiveRunToolInput {
  readonly tools: LruMap<string, LiveRunHudTool>
  readonly id: string
  readonly message: ProgressMessage
  readonly locale: Locale
}

interface FinishLiveRunToolInput {
  readonly tools: LruMap<string, LiveRunHudTool>
  readonly event: Extract<StreamEvent, { readonly type: 'tool_result' }>
  readonly locale: Locale
}

export function startLiveRunTool(input: StartLiveRunToolInput): void {
  input.tools.set(boundedToolId(input.event.id), {
    label: boundedLabel(translateToolLabel(input.locale, input.event.name, input.event.label)),
    ...(input.event.emoji === undefined ? {} : { emoji: input.event.emoji }),
    ...(input.event.detail === undefined ? {} : { detail: input.event.detail }),
    status: 'running',
  })
}

export function updateLiveRunTool(input: UpdateLiveRunToolInput): void {
  const key = boundedToolId(input.id)
  const tool = input.tools.get(key)

  if (tool === undefined) {
    return
  }

  const text = translateDisplayText(input.locale, input.message)
  const updated =
    input.message.mode === 'persistent'
      ? { ...tool, persistentProgress: appendPersistentProgress(tool, text) }
      : { ...tool, progress: text }

  input.tools.set(boundedToolId(input.id), updated)
}

/** Reports the plan when the finished tool carried one: the preview is edited away by the answer,
 *  so the block has to be handed to whoever delivers that answer. */
export function finishLiveRunTool(input: FinishLiveRunToolInput): HudPlan | undefined {
  const key = boundedToolId(input.event.id)
  const previous = input.tools.get(key)
  const status: LiveRunHudTool['status'] = input.event.ok ? 'success' : 'failure'
  const progress =
    input.event.display === undefined
      ? previous?.progress
      : translateDisplayText(input.locale, input.event.display)
  const tool: LiveRunHudTool = {
    ...(previous ?? { label: GENERIC_TOOL_LABEL }),
    ...(progress === undefined ? {} : { progress }),
    status,
  }

  input.tools.set(key, tool)

  const steps = progress === undefined ? undefined : toPlanSteps(progress)

  if (steps === undefined) {
    return undefined
  }

  return {
    display: {
      label: tool.label,
      ...(tool.emoji === undefined ? {} : { emoji: tool.emoji }),
    },
    steps,
  }
}

function boundedToolId(id: string): string {
  return id.slice(0, MAX_TOOL_ID_LENGTH)
}

function boundedLabel(label: string): string {
  return label.slice(0, MAX_TOOL_LABEL_LENGTH)
}

function appendPersistentProgress(tool: LiveRunHudTool, text: string): readonly string[] {
  const progress = tool.persistentProgress ?? []

  if (progress.includes(text) || progress.length >= MAX_PERSISTENT_PROGRESS_LINES) {
    return progress
  }

  return [...progress, text]
}
