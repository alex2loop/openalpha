import { type Signal, useSignal } from '@preact/signals'

import type { PairingDecisionBody, PairingList } from '@/app/server/wire/sign-in'
import { pluralKey } from '@/i18n'
import { getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { decisionLabel } from '@/web/state/approvals'
import { sourceLabel } from '@/web/text/source'
import { toErrorText, toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'

type Pending = PairingList['pending'][number]
type Paired = PairingList['paired'][number]

/** The chats and requests as the last action left them, and the line it left. */
interface Pairing {
  readonly list: PairingList | undefined
  readonly failure: Signal<string | undefined>
  readonly notice: Signal<string | undefined>
  unpair(chat: Paired): void
  decide(request: Pending, decision: PairingDecisionBody['decision']): void
}

/** Kênh nhắn tin: the chats paired with the daemon, the pairing requests waiting, and how to pair
 *  one. An access token is never set here. */
export function ChannelsSection() {
  const read = useLoad(loadPairing).value
  const pairing = usePairing(read.status === 'ready' ? read.value : undefined)

  if (pairing.list === undefined) {
    return read.status === 'failed' ? (
      <p class="failure-line">{toFailureText(read.failure)}</p>
    ) : (
      <Skeleton lines={2} />
    )
  }

  const count = pairing.list.paired.length

  return (
    <section class="setting-row">
      <p>
        {count === 0
          ? tr('ui.office.settings.notPaired')
          : tr(
              pluralKey(
                count,
                'ui.office.settings.pairedCountOne',
                'ui.office.settings.pairedCount'
              ),
              { count }
            )}
      </p>
      {pairing.list.paired.map((chat) => (
        <PairedRow key={`${chat.channel}:${chat.chatId}`} chat={chat} pairing={pairing} />
      ))}
      {pairing.list.pending.map((request) => (
        <PendingRow
          key={`${request.channel}:${request.code}`}
          request={request}
          pairing={pairing}
        />
      ))}
      {pairing.notice.value !== undefined && <p class="meta">{pairing.notice.value}</p>}
      {pairing.failure.value !== undefined && <p class="failure-line">{pairing.failure.value}</p>}
      <p class="meta">{tr('ui.office.settings.pairHow')}</p>
    </section>
  )
}

function loadPairing(signal: AbortSignal): Promise<PairingList> {
  return getJson(ROUTES.pairing, { signal })
}

// The first read, then whatever the last action read back.
function usePairing(first: PairingList | undefined): Pairing {
  const latest = useSignal<PairingList | undefined>(undefined)
  const failure = useSignal<string | undefined>(undefined)
  const notice = useSignal<string | undefined>(undefined)

  function run(action: Promise<unknown>): void {
    failure.value = undefined
    notice.value = undefined
    action
      .then(() => getJson(ROUTES.pairing))
      .then((next) => {
        latest.value = next
      })
      .catch((error: unknown) => {
        failure.value = toErrorText(error)
      })
  }

  return {
    list: latest.value ?? first,
    failure,
    notice,
    unpair: (chat) => run(unpairChat(chat, notice)),
    decide: (request, decision) => run(decideRequest({ request, decision }, notice)),
  }
}

async function unpairChat(chat: Paired, notice: Signal<string | undefined>): Promise<void> {
  await sendJson('DELETE', ROUTES.pairingDelete(chat.channel, chat.chatId))
  notice.value = tr('ui.office.settings.unpaired')
}

interface Decision {
  readonly request: Pending
  readonly decision: PairingDecisionBody['decision']
}

// A code that lapsed or was answered elsewhere comes back as a refusal, told in the daemon's words.
async function decideRequest(
  { request, decision }: Decision,
  notice: Signal<string | undefined>
): Promise<void> {
  const answer = await sendJson('POST', ROUTES.pairingDecision, {
    body: { channel: request.channel, code: request.code, decision },
  })

  if (!answer.ok) {
    notice.value = tr(answer.reason === 'expired' ? 'pairing.expired' : 'pairing.noPendingCode', {
      arg: request.code,
    })
  }
}

// "Bỏ ghép nối" asks first, in the row: the chat stops getting briefs until it is paired again.
function PairedRow({ chat, pairing }: { readonly chat: Paired; readonly pairing: Pairing }) {
  const isAsking = useSignal(false)

  return (
    <div class="setting-job">
      <div class="setting-actions">
        <span>{`${sourceLabel(chat.channel)} ${chat.chatId}`}</span>
        <Button
          size="small"
          kind="destructive"
          onClick={() => {
            isAsking.value = true
          }}
        >
          {tr('ui.office.settings.unpair')}
        </Button>
      </div>
      {isAsking.value && (
        <div class="dialog-question" role="alert">
          <b>{tr('ui.office.settings.unpairAsk')}</b>
          <p>{tr('ui.office.settings.unpairBody')}</p>
          <div class="dialog-choices">
            <Button size="small" kind="destructive" onClick={() => pairing.unpair(chat)}>
              {tr('ui.office.settings.unpair')}
            </Button>
            <Button
              size="small"
              kind="commit"
              onClick={() => {
                isAsking.value = false
              }}
            >
              {tr('ui.office.common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function PendingRow({
  request,
  pairing,
}: {
  readonly request: Pending
  readonly pairing: Pairing
}) {
  return (
    <div class="setting-actions">
      <span>
        {tr('ui.office.bell.pairing', {
          channel: sourceLabel(request.channel),
          code: request.code,
        })}
      </span>
      <Button size="small" kind="commit" onClick={() => pairing.decide(request, 'approve')}>
        {tr('ui.office.settings.pairApprove')}
      </Button>
      <Button size="small" onClick={() => pairing.decide(request, 'deny')}>
        {decisionLabel('deny')}
      </Button>
    </div>
  )
}
