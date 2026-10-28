import { pluralKey } from '@/i18n'
import { openBook } from '@/web/state/book'
import { watchedNames } from '@/web/state/market'
import { useAlerts } from '@/web/state/watch'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { openWatchAddDialog } from '@/web/ui/dialogs/watch-add-dialog'
import { Button } from '@/web/ui/kit/button'
import { closeModal } from '@/web/ui/kit/modal'
import { BriefTimeRow } from '@/web/ui/settings/brief-time'
import { ActionRow, type SectionProps } from '@/web/ui/settings/row'
import { SchedulesList } from '@/web/ui/settings/schedules-list'

/** Lịch và theo dõi: the brief's time, the alerts and the watchlist, and the scheduled jobs. */
export function ScheduleSection({ reopen }: SectionProps) {
  return (
    <>
      <BriefTimeRow />
      <AlertsRow />
      <WatchRow reopen={reopen} />
      <SchedulesList />
    </>
  )
}

// Alerts are set on a ticker card and listed in Theo dõi; this row counts them and leads there.
function AlertsRow() {
  const count = useAlerts().data?.activeCount

  return (
    <ActionRow
      title={tr('ui.office.common.priceAlerts')}
      summary={
        count === undefined
          ? ABSENT_CELL
          : tr(
              pluralKey(
                count,
                'ui.office.settings.alertsCountOne',
                'ui.office.settings.alertsCount'
              ),
              {
                count,
              }
            )
      }
    >
      <OpenWatchButton />
    </ActionRow>
  )
}

function WatchRow({ reopen }: SectionProps) {
  const count = watchedNames.value.length

  return (
    <ActionRow
      title={tr('ui.office.book.watchTitle')}
      summary={tr(
        pluralKey(count, 'ui.office.settings.watchCountOne', 'ui.office.settings.watchCount'),
        {
          count,
        }
      )}
    >
      <Button size="small" onClick={() => openWatchAddDialog({ onBack: reopen })}>
        {tr('ui.office.book.addName')}
      </Button>
      <OpenWatchButton />
    </ActionRow>
  )
}

function OpenWatchButton() {
  return (
    <Button
      size="small"
      onClick={() => {
        closeModal()
        openBook('watch')
      }}
    >
      {tr('ui.office.agent.watchOpen')}
    </Button>
  )
}
