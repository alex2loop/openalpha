const DATA_FIELD = 'data:'
const TRAILING_CR_RE = /\r$/

// Memory is bounded by the caller's total byte cap, so one large frame is never rejected on its
// own. Each returned string is one event's joined `data:` payload; events with no `data:` line are
// dropped. The scanner is a factory, not a pure (chunk, carry) function, because it must hold a
// streaming TextDecoder across reads: a multi-byte UTF-8 character split across a chunk boundary
// would otherwise decode to replacement characters mid-token.
interface SseScanner {
  // Feed one network chunk; returns every event completed by it.
  push(chunk: Uint8Array): readonly string[]
  // Flush the decoder and any event the stream ended without terminating by a blank line.
  flush(): readonly string[]
}

export function sseScanner(): SseScanner {
  const decoder = new TextDecoder()
  // Bytes after the last '\n' — a line the network split mid-way.
  let partialLine = ''
  // Lines of the event currently being accumulated, terminated by a blank line.
  let pending: string[] = []

  const takeEvent = (): string | undefined => {
    const event = eventData(pending)
    pending = []

    return event
  }

  const consumeLines = (text: string): readonly string[] => {
    const events: string[] = []
    partialLine += text

    let newline = partialLine.indexOf('\n')

    while (newline !== -1) {
      const line = partialLine.slice(0, newline).replace(TRAILING_CR_RE, '')
      partialLine = partialLine.slice(newline + 1)
      newline = partialLine.indexOf('\n')

      if (line !== '') {
        pending.push(line)
        continue
      }

      const event = takeEvent()

      if (event !== undefined) {
        events.push(event)
      }
    }

    return events
  }

  return {
    push(chunk) {
      return consumeLines(decoder.decode(chunk, { stream: true }))
    },
    flush() {
      const events = [...consumeLines(decoder.decode())]

      if (partialLine !== '') {
        pending.push(partialLine.replace(TRAILING_CR_RE, ''))
        partialLine = ''
      }

      const last = takeEvent()

      if (last !== undefined) {
        events.push(last)
      }

      return events
    },
  }
}

// Per the SSE spec: only `data:` lines carry the payload, multiple ones join with '\n', and exactly
// one leading space after the colon is stripped (not all whitespace — a payload may start with one).
function eventData(lines: readonly string[]): string | undefined {
  const parts: string[] = []

  for (const line of lines) {
    if (!line.startsWith(DATA_FIELD)) {
      continue
    }

    const value = line.slice(DATA_FIELD.length)
    parts.push(value.startsWith(' ') ? value.slice(1) : value)
  }

  return parts.length > 0 ? parts.join('\n') : undefined
}
