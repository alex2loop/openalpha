import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import { canRemember } from '@/web/state/memory'
import { tr } from '@/web/text/tr'
import { openRememberDialog } from '@/web/ui/dialogs/remember-dialog'
import { Button } from '@/web/ui/kit/button'
import { Markdown } from '@/web/ui/markdown/markdown'

const USER_ROLE = 'user'
const PARAGRAPH_BREAK = /\n{2,}/

interface ReplyTextProps {
  readonly text: string
  /** An agent's prose: markdown, known tickers linked. Off for a command's answer, whose lines are
   *  data laid out by the daemon. */
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
          {part}
        </p>
      ))}
    </>
  )
}

/** One stored message: what the operator typed, or an answer. */
export function HistoryMessage({ message }: { readonly message: ChatHistoryMessage }) {
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
      <ReplyText text={message.content} />
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
