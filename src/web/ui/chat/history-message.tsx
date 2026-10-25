import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import { LinkedText } from '@/web/ui/ticker/linked-text'

const USER_ROLE = 'user'
const PARAGRAPH_BREAK = /\n{2,}/

interface ReplyTextProps {
  readonly text: string
  /** Off for a command's answer: its lines are data, and a ticker in them is not a link. */
  readonly isLinked?: boolean
}

/** A reply as the daemon wrote it, one paragraph per blank-line block; known tickers link. */
export function ReplyText({ text, isLinked = true }: ReplyTextProps) {
  const paragraphs = text.split(PARAGRAPH_BREAK).filter((part) => part.trim() !== '')

  return (
    <>
      {paragraphs.map((part, index) => (
        <p key={index} class="chat-reply">
          {isLinked ? <LinkedText text={part} /> : part}
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
