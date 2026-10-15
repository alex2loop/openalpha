import { Buffer } from 'node:buffer'

import { USER_MESSAGE_MAX_BYTES } from '@/engine/constants'

const UTF8_CONTINUATION_MASK = 0xc0
const UTF8_CONTINUATION_BYTE = 0x80

// Byte-clamped, not char-clamped: aligns back off a UTF-8 continuation byte so the slice never
// ends mid-codepoint.
export function clampUserMessage(msg: string): string {
  if (Buffer.byteLength(msg, 'utf8') <= USER_MESSAGE_MAX_BYTES) {
    return msg
  }

  const buf = Buffer.from(msg, 'utf8')
  let end = USER_MESSAGE_MAX_BYTES

  while (end > 0 && isContinuationByte(buf[end])) {
    end -= 1
  }

  return buf.subarray(0, end).toString('utf8')
}

function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_BYTE
}
