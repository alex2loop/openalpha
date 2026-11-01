import type { StatePayload } from '@/app/server/wire/system'
import { state } from '@/web/state/session'
import { joinList } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { toVenueName } from '@/web/text/venue'
import { CopyButton } from '@/web/ui/kit/copy-button'
import { SetupNotice, SetupNoticeRow, type SetupNoticeTone } from '@/web/ui/kit/setup-notice'
import {
  buildServerCommand,
  KEY_SET_COMMAND,
  RESTART_COMMAND,
} from '@/web/ui/settings/credentials/credential-row'

type DegradedRow = StatePayload['degraded'][number]

/** What the daemon started without: exchanges with no keys in one notice, anything else left down
 *  in a second, and optional keys a keyless source already covers in a quiet third. */
export function SetupNotices() {
  const degraded = state.value?.degraded ?? []
  const venues = degraded.filter((item) => item.variables !== undefined)
  const needed = degraded.filter((item) => item.kind !== 'optional-key')
  const optional = degraded.filter(
    (item) => item.kind === 'optional-key' && item.variables === undefined
  )

  return (
    <>
      {venues.length > 0 && <VenueNotice venues={venues} />}
      {needed.length > 0 && <MessageNotice tone="caution" items={needed} />}
      {optional.length > 0 && <MessageNotice tone="info" items={optional} />}
    </>
  )
}

function VenueNotice({ venues }: { readonly venues: readonly DegradedRow[] }) {
  return (
    <SetupNotice tone="caution" title={tr('ui.office.setup.venuesTitle')}>
      {venues.map((item) => (
        <SetupNoticeRow key={item.subject} name={toVenueName(item.subject)}>
          <span>{tr('ui.office.setup.venueWaits')}</span>
          <span class="setup-notice-keys">{joinList(item.variables ?? [])}</span>
        </SetupNoticeRow>
      ))}
      <FixLine />
    </SetupNotice>
  )
}

/** Each key saved once, then one restart: both commands copy on click. */
function FixLine() {
  const keySet = buildServerCommand(`${KEY_SET_COMMAND} ${tr('ui.office.setup.keyName')}`)
  const restart = buildServerCommand(RESTART_COMMAND)

  return (
    <p class="setup-notice-fix">
      <span>{tr('ui.office.setup.venueFix')}</span>
      <span class="setup-notice-cmds">
        <CopyButton text={keySet} label={keySet} />
        <CopyButton text={restart} label={restart} />
      </span>
    </p>
  )
}

function MessageNotice({
  tone,
  items,
}: {
  readonly tone: SetupNoticeTone
  readonly items: readonly DegradedRow[]
}) {
  const title = tr(
    tone === 'caution' ? 'ui.office.setup.neededTitle' : 'ui.office.setup.optionalTitle'
  )

  return (
    <SetupNotice tone={tone} title={title}>
      {items.map((item) => (
        <p key={`${item.kind}:${item.subject}`} class="setup-notice-row">
          {item.message}
        </p>
      ))}
    </SetupNotice>
  )
}
