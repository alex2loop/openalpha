import type { Logger } from '@/core/logging/logger'
import type { DisplayText, OnStreamEvent, ToolLifecycleOwner } from '@/core/stream-events'
import type { ToolCall } from '@/core/tool'
import type { ToolExecutionObserver } from '@/engine/types/run'
import { formatErrForLog } from '@/core/security/credentials'

interface TrackedTool {
  readonly observer: ToolExecutionObserver
  readonly display: DisplayText | undefined
  readonly lifecycleOwner: ToolLifecycleOwner
}

// `display` and `lifecycleOwner` are getters, not values: the tool sets them while it runs, and the
// caller reads them after. Copying them into plain fields here would freeze the pre-run defaults.
export function createToolObserver(
  logger: Logger,
  onEvent: OnStreamEvent,
  call: ToolCall
): TrackedTool {
  // A sink that throws throws on every event, so one record per tool call is the whole signal.
  let reported = false
  const emit = (event: Parameters<OnStreamEvent>[0]): void => {
    try {
      onEvent(event)
    } catch (err: unknown) {
      if (!reported) {
        reported = true
        logger.warn('engine.tool_observer_failed', { err: formatErrForLog(err) })
      }
    }
  }

  let display: DisplayText | undefined
  let lifecycleOwner: ToolLifecycleOwner = 'tool'

  const observer: ToolExecutionObserver = {
    start(presentation) {
      lifecycleOwner = presentation.lifecycleOwner
      emit({
        type: 'tool_execution_start',
        id: call.id,
        name: call.name,
        label: presentation.label,
        lifecycleOwner,
        ...(presentation.emoji === undefined ? {} : { emoji: presentation.emoji }),
        ...(presentation.detail === undefined ? {} : { detail: presentation.detail }),
      })
    },
    progress(message) {
      emit({
        type: 'tool_progress',
        id: call.id,
        message,
      })
    },
    finish(value) {
      display = value
    },
  }

  return {
    observer,
    get display() {
      return display
    },
    get lifecycleOwner() {
      return lifecycleOwner
    },
  }
}
