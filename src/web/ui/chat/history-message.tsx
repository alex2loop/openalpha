import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import { COMMAND_PREFIX, USER_ROLE } from '@/web/state/chat'
import { canRemember } from '@/web/state/memory'
import { tr } from '@/web/text/tr'
import { commandWordOf } from '@/web/ui/chat/command-link'
import { RESEARCH_COMMAND } from '@/web/ui/chat/research-steps'
import { openRememberDialog } from '@/web/ui/dialogs/remember-dialog'
import { Button } from '@/web/ui/kit/button'
import { InlineMarkdown, Markdown } from '@/web/ui/markdown/markdown'
import { RunCalls } from '@/web/ui/run/calls/run-calls'

const PARAGRAPH_BREAK = /\n{2,}/
// A channel that folds detail away quotes each of its lines; here they read as indented rows.
const FOLD_QUOTE = /^> ?/
const ROW_INDENT = '  '

/** One stored message and what it reads from its neighbours. */
interface HistoryEntry {
  readonly message: ChatHistoryMessage
  /** On an answer: the slash command of the line it replies to, when that line was one. */
  readonly command?: string
  /** The last answer its run wrote, under which the run's model calls fold. */
  readonly isRunEnd: boolean
}

interface ReplyTextProps {
  readonly text: string
  /** An agent's prose: markdown, known tickers linked. Off for a command's answer, whose lines are
   *  data laid out by the daemon: only its bold and links are drawn, and its folds unquoted. */
  readonly isProse?: boolean
  /** A research answer: its footnotes jump to its own sources list. */
  readonly scope?: string | undefined
}

/** A reply as the daemon wrote it. */
export function ReplyText({ text, isProse = true, scope }: ReplyTextProps) {
  if (isProse) {
    return <Markdown text={text} scope={scope} />
  }

  const paragraphs = text.split(PARAGRAPH_BREAK).filter((part) => part.trim() !== '')

  return (
    <>
      {paragraphs.map((part, index) => (
        <p key={index} class="chat-reply">
          <InlineMarkdown text={part.split('\n').map(unquoteFold).join('\n')} />
        </p>
      ))}
    </>
  )
}

function unquoteFold(line: string): string {
  if (!FOLD_QUOTE.test(line)) {
    return line
  }

  const row = line.replace(FOLD_QUOTE, '')

  return row.startsWith(ROW_INDENT) ? row : `${ROW_INDENT}${row}`
}

/** Stored messages, oldest first, each laid out as the chat showed it. */
export function HistoryMessages({
  messages,
}: {
  readonly messages: readonly ChatHistoryMessage[]
}) {
  return (
    <>
      {toHistoryEntries(messages).map((entry, index) => (
        // Counted from the newest, so an older page prepended never shifts a key.
        <HistoryMessage key={messages.length - index} entry={entry} />
      ))}
    </>
  )
}

/** Oldest first, as the history holds them: the answer right after a line starting with `/` is
 *  that command's (a command writes exactly one, and an agent turn still running may land its own
 *  answer after it), and each answer learns whether its run wrote anything after it. */
function toHistoryEntries(messages: readonly ChatHistoryMessage[]): readonly HistoryEntry[] {
  const runEnds = toRunEnds(messages)

  return messages.map((message, index) => {
    const before = messages[index - 1]
    const command =
      message.role !== USER_ROLE &&
      before?.role === USER_ROLE &&
      before.content.startsWith(COMMAND_PREFIX)
        ? commandWordOf(before.content)
        : undefined

    return {
      message,
      ...(command === undefined ? {} : { command }),
      isRunEnd: runEnds[index] === true,
    }
  })
}

// Read newest first, so the last answer each run wrote is the one marked.
function toRunEnds(messages: readonly ChatHistoryMessage[]): readonly boolean[] {
  const seen = new Set<string>()

  return [...messages]
    .reverse()
    .map(({ runId }) => {
      if (runId === undefined || seen.has(runId)) {
        return false
      }

      seen.add(runId)

      return true
    })
    .reverse()
}

/** One stored message: what the operator typed, or an answer laid out as the chat showed it. */
function HistoryMessage({ entry }: { readonly entry: HistoryEntry }) {
  const { message, command } = entry

  if (message.role === USER_ROLE) {
    return (
      <>
        <div class="chat-user">{message.content}</div>
        {canRemember(message) && <RememberThis text={message.content} />}
      </>
    )
  }

  return (
    <div class="chat-card">
      <ReplyText
        text={message.content}
        isProse={command === undefined || command === RESEARCH_COMMAND}
      />
      {entry.isRunEnd && message.runId !== undefined && (
        <RunCalls key={message.runId} runId={message.runId} isRunning={false} command={command} />
      )}
    </div>
  )
}

/** Opens + Ghi nhớ with the operator's own words; only offered where `canRemember` says so. */
export function RememberThis({ text }: { readonly text: string }) {
  return (
    <div class="chat-actions">
      <Button kind="tertiary" size="small" onClick={() => openRememberDialog({ value: text })}>
        {tr('ui.office.memory.rememberThis')}
      </Button>
    </div>
  )
}
