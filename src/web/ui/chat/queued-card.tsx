import { dropWaiting, type Turn, thread } from '@/web/state/chat'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

/** A dashed card for a line that waits: a command in the lane shows its place and can be dropped;
 *  a message behind the chat's own answer names what it waits for. */
export function QueuedCard({ turn }: { readonly turn: Turn }) {
  return (
    <div class="chat-card is-queued">
      <p class="chat-step">{describeWait(turn)}</p>
      {turn.laneId !== undefined && (
        <div class="chat-actions">
          <Button kind="destructive" size="small" onClick={() => dropWaiting(turn)}>
            {tr('ui.office.chat.drop')}
          </Button>
        </div>
      )}
    </div>
  )
}

function describeWait(turn: Turn): string {
  if (turn.laneId !== undefined && turn.position !== undefined) {
    const running = thread.value.filter(
      (held) => held.laneId !== undefined && held.status === 'running'
    ).length

    return tr('ui.office.chat.queuedPos', { position: turn.position, running })
  }

  const head = thread.value.find(
    (held) => held.laneId === undefined && held.status === 'running' && held !== turn
  )

  return head === undefined
    ? tr('ui.office.chat.waitTurn')
    : tr('ui.office.chat.waitAfter', { what: head.text })
}
