import type { ChatFrame } from '@/app/server/wire/chat'
import type { StreamScrubber } from '@/core/security/credentials'
import type { StreamEvent } from '@/core/stream-events'
import { createStreamScrubber } from '@/core/security/credentials'

const TOOL_EMOJI = '🔧'

const DELTA_KINDS = ['text', 'reasoning'] as const

type DeltaKind = (typeof DELTA_KINDS)[number]
type Scrubbers = Readonly<Record<DeltaKind, StreamScrubber>>

// Held text of every kind but `except` goes out first, so a frame never overtakes text the model
// wrote before it.
function flushFrames(scrubbers: Scrubbers, except?: DeltaKind): ChatFrame[] {
  const frames: ChatFrame[] = []

  for (const kind of DELTA_KINDS) {
    const delta = kind === except ? '' : scrubbers[kind].flush()

    if (delta !== '') {
      frames.push({ kind, delta })
    }
  }

  return frames
}

function deltaFrames(scrubbers: Scrubbers, kind: DeltaKind, text: string): ChatFrame[] {
  const frames = flushFrames(scrubbers, kind)
  const delta = scrubbers[kind].push(text)

  if (delta !== '') {
    frames.push({ kind, delta })
  }

  return frames
}

function mapEvent(scrubbers: Scrubbers, event: StreamEvent): readonly ChatFrame[] {
  if (event.type === 'text_delta') {
    return deltaFrames(scrubbers, 'text', event.delta)
  }

  if (event.type === 'reasoning_delta') {
    return deltaFrames(scrubbers, 'reasoning', event.delta)
  }

  if (event.type === 'tool_call_start') {
    return [
      ...flushFrames(scrubbers),
      { kind: 'tool', status: 'run', id: event.id, emoji: TOOL_EMOJI, name: event.name },
    ]
  }

  if (event.type === 'tool_result') {
    return [
      ...flushFrames(scrubbers),
      { kind: 'tool', status: event.ok ? 'ok' : 'error', id: event.id },
    ]
  }

  return []
}

interface ChatFrameMapper {
  map(event: StreamEvent): readonly ChatFrame[]
  /** The text each scrubber still holds; call when the stream ends. */
  flush(): readonly ChatFrame[]
}

// One mapper per run: a secret split across deltas is only caught by a scrubber that spans them,
// and the wire contract promises the client a stream it can render as-is. Kinds with no client
// rendering map to no frame.
export function createChatFrameMapper(): ChatFrameMapper {
  const scrubbers: Scrubbers = {
    text: createStreamScrubber(),
    reasoning: createStreamScrubber(),
  }

  return {
    map: (event) => mapEvent(scrubbers, event),
    flush: () => flushFrames(scrubbers),
  }
}
