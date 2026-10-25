import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import { Markdown } from '@/web/ui/markdown/markdown'

const USER_ROLE = 'user'
const PARAGRAPH_BREAK = /\n{2,}/

interface ReplyTextProps {
  readonly text: string
  /** An agent's prose: markdown, known tickers linked. Off for a command's answer, whose lines are
   *  data laid out by the daemon. */
  readonly isProse?: boolean
}

/** A reply as the daemon wrote it. */
export function ReplyText({ text, isProse = true }: ReplyTextProps) {
  if (isProse) {
    return <Markdown text={text} />
  }

  const paragraphs = text.split(PARAGRAPH_BREAK).filter((part) => part.trim() !== '')

  return (
    <>
      {paragraphs.map((part, index) => (
        <p key={index} class="chat-reply">
          {part}
        </p>
      ))}
    </>
  )
}

/** One stored message: what the operator typed, or an answer. */
export function HistoryMessage({ message }: { readonly message: ChatHistoryMessage }) {
  if (message.role === USER_ROLE) {
    return <div class="chat-user">{message.content}</div>
  }

  return (
    <div class="chat-card">
      <ReplyText text={message.content} />
    </div>
  )
}
