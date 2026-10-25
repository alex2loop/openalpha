import type { ChatHistoryMessage } from '@/app/server/wire/chat'

const USER_ROLE = 'user'
const PARAGRAPH_BREAK = /\n{2,}/

/** A reply as the daemon wrote it, one paragraph per blank-line block. */
export function ReplyText({ text }: { readonly text: string }) {
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
