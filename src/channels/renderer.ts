import type { ChannelRenderer } from '@/channels/types'
import { chunkText } from '@/channels/delivery/format'

// Pre-compiled at module top: these run on every outbound message (perf rule, spec §12).
const FENCED_CODE_RE = /```[a-zA-Z0-9]*\n?([\s\S]*?)```/g
const INLINE_CODE_RE = /`([^`\n]+)`/g
const IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
const BOLD_RE = /\*\*([^*]+)\*\*/g
const BOLD_UNDERSCORE_RE = /__([^_]+)__/g
const ITALIC_RE = /\*([^*\n]+)\*/g
const ITALIC_UNDERSCORE_RE = /(?<![a-zA-Z0-9_])_([^_\n]+)_(?![a-zA-Z0-9_])/g
const STRIKE_RE = /~~([^~]+)~~/g
const HEADER_RE = /^#{1,6}[ \t]+/gm
const RULE_RE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm
const BLOCKQUOTE_RE = /^[ \t]*>[ \t]?/gm
const BULLET_RE = /^([ \t]*)[*+][ \t]+/gm
const EXCESS_NEWLINES_RE = /\n{3,}/g

export function stripMarkdown(text: string): string {
  return text
    .replace(FENCED_CODE_RE, '$1')
    .replace(INLINE_CODE_RE, '$1')
    .replace(IMAGE_RE, '$1')
    .replace(LINK_RE, '$1 ($2)')
    .replace(BOLD_RE, '$1')
    .replace(BOLD_UNDERSCORE_RE, '$1')
    .replace(ITALIC_RE, '$1')
    .replace(ITALIC_UNDERSCORE_RE, '$1')
    .replace(STRIKE_RE, '$1')
    .replace(HEADER_RE, '')
    .replace(RULE_RE, '')
    .replace(BLOCKQUOTE_RE, '')
    .replace(BULLET_RE, '$1- ')
    .replace(EXCESS_NEWLINES_RE, '\n\n')
    .trim()
}

export const plainRenderer: ChannelRenderer = {
  // Nothing to encode without markup. The adapter strips markdown at send, which covers every
  // outbound path, including the proactive and slash sends that never pass through `chunk`.
  escape: (text) => text,
  // Nothing to normalize: a plain channel shows the pipes as-is, which is the best it can do.
  normalizeTables: (text) => text,
  chunk: chunkText,
}
