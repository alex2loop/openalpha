import type { AssistantMessage, ContentBlock, LLMMessage } from '@/core/llm'
import type { HookFn } from '@/engine/types/run'
import { unwrapToolResult } from '@/core/security/sanitize'
import { textOf } from '@/core/utils/message'
import { COMPACT_SUMMARY_PREAMBLE } from '@/engine/constants'

const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi
const URL_RE = /https?:\/\/[^\s)\]]+(?:\([^)\s]*\))*/gi
const URL_KEY_NAME_RE = /url$/i

export const citeCheckHook: HookFn = async (run) => {
  const history = run.state.messages.history
  const last = history.at(-1)

  if (!isAssistantMessage(last)) {
    return
  }

  const lastText = textOf(last.content, '\n')

  if (!lastText.toLowerCase().includes('](http')) {
    return
  }

  const trusted = trustedUrls(history)
  let stripped = 0
  const cleaned = replaceLinks(last.content, trusted, (count) => {
    stripped += count
  })

  if (stripped === 0) {
    return
  }

  run.state.messages.replaceLastAssistant(last, { ...last, content: cleaned })
  run.services.logger.warn('cite.unverified_links_stripped', { count: stripped })
}

function isAssistantMessage(message: LLMMessage | undefined): message is AssistantMessage {
  return message?.role === 'assistant'
}

function replaceLinks(
  content: string | readonly ContentBlock[],
  trusted: ReadonlySet<string>,
  onStripped: (count: number) => void
): string | readonly ContentBlock[] {
  if (typeof content === 'string') {
    return replaceMarkdownLinks(content, trusted, onStripped)
  }

  return content.map((block) => {
    if (block.type !== 'text') {
      return block
    }

    return { ...block, text: replaceMarkdownLinks(block.text, trusted, onStripped) }
  })
}

function replaceMarkdownLinks(
  text: string,
  trusted: ReadonlySet<string>,
  onStripped: (count: number) => void
): string {
  return text.replace(MD_LINK_RE, (whole, label: string, url: string) => {
    if (trusted.has(urlKey(url))) {
      return whole
    }

    onStripped(1)

    return label
  })
}

function trustedUrls(history: readonly LLMMessage[]): ReadonlySet<string> {
  const urls = new Set<string>()

  for (const msg of history) {
    if (msg.role === 'user' && !isCompactionSummary(msg)) {
      addTextUrls(textOf(msg.content, '\n'), urls)
    } else if (msg.role === 'tool') {
      addStructuredUrls(textOf(msg.content, '\n'), urls)
    }
  }

  return urls
}

// A summary is model prose, and its URLs may have come from a fetched page.
function isCompactionSummary(msg: LLMMessage): boolean {
  return textOf(msg.content, '\n').startsWith(COMPACT_SUMMARY_PREAMBLE)
}

function addTextUrls(text: string, urls: Set<string>): void {
  for (const match of text.matchAll(URL_RE)) {
    urls.add(urlKey(match[0]))
  }
}

// A fetched page's body is attacker-controlled text — a link merely quoted inside it must not
// earn citation trust. Only the structural `...url` fields our own tools attach (the page that was
// actually fetched, a search result's own link, a research source's canonical URL) do. Content that
// failed to parse as JSON (including a result already flagged by the prompt-injection scan, which
// wraps it with a notice line the parse then rejects) contributes no trust — safe by default.
function addStructuredUrls(content: string, urls: Set<string>): void {
  let parsed: unknown

  try {
    parsed = JSON.parse(unwrapToolResult(content))
  } catch {
    return
  }

  collectUrlFields(parsed, urls)
}

function collectUrlFields(value: unknown, urls: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUrlFields(entry, urls)
    }

    return
  }

  if (typeof value !== 'object' || value === null) {
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && URL_KEY_NAME_RE.test(key)) {
      urls.add(urlKey(entry))
    } else {
      collectUrlFields(entry, urls)
    }
  }
}

function urlKey(raw: string): string {
  try {
    const url = new URL(raw)

    url.hash = ''
    return url.href
  } catch {
    return raw
  }
}
