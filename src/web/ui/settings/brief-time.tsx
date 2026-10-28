import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { loadSession, state } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { SettingRow, useDraft } from '@/web/ui/settings/row'

/** Giờ gửi bản tin sáng: the time of day, on the market's clock, that the brief is sent. */
export function BriefTimeRow() {
  const brief = state.value?.brief
  const { draft, isChanged, markSaved } = useDraft(brief?.sendTime ?? '')
  const title = tr('ui.office.settings.briefTime')

  if (brief === undefined || brief.state === 'disabled') {
    return <p class="meta">{tr('ui.office.today.absent', { what: title })}</p>
  }

  return (
    <SettingRow
      title={title}
      note={tr('ui.office.settings.briefTimeNote')}
      timing="now"
      isChanged={isChanged && draft.value !== ''}
      current={tr('ui.office.settings.current', {
        value: brief.sendTime ?? tr('ui.office.settings.currentNone'),
      })}
      onSave={async () => {
        await sendJson('PATCH', ROUTES.briefSchedule, { body: { sendTime: draft.value } })
        markSaved()
        await loadSession(new AbortController().signal)
      }}
    >
      <input
        type="time"
        aria-label={title}
        value={draft.value}
        onInput={(event) => {
          draft.value = event.currentTarget.value
        }}
      />
    </SettingRow>
  )
}
