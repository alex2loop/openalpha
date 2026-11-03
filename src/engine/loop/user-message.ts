import { decodeUtf8, encodeUtf8, isContinuationByte, utf8ByteLength } from '@/core/utils/text'
import { USER_MESSAGE_MAX_BYTES } from '@/engine/constants'

// Byte-clamped, not char-clamped: aligns back off a UTF-8 continuation byte so the slice never
// ends mid-codepoint.
export function clampUserMessage(msg: string): string {
  if (utf8ByteLength(msg) <= USER_MESSAGE_MAX_BYTES) {
    return msg
  }

  const buf = encodeUtf8(msg)
  let end = USER_MESSAGE_MAX_BYTES

  while (end > 0 && isContinuationByte(buf[end])) {
    end -= 1
  }

  return decodeUtf8(buf.subarray(0, end))
}
