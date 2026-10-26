import { useSignal } from '@preact/signals'
import { useEffect, useMemo } from 'preact/hooks'

import type { BrowserSessionWire } from '@/app/server/wire/sign-in'
import { ApiFailure, getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { authState } from '@/web/api/sign-in'
import { state } from '@/web/state/session'
import { formatWhen } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'

interface SessionLineProps {
  readonly session: BrowserSessionWire
  readonly timeZone: string
  readonly signal: AbortSignal
  readonly onEnded: () => void
}

/** Kết nối: the browsers signed in to this daemon, newest use first, each with its own sign-out. */
export function BrowserSessionsRow() {
  const sessions = useSignal<readonly BrowserSessionWire[] | undefined>(undefined)
  const failure = useSignal<ApiFailure | undefined>(undefined)
  // One controller for the list and every row's request: all stop when the section closes.
  const controller = useMemo(() => new AbortController(), [])
  const timeZone = state.value?.timeZone

  function reload(): void {
    getJson(ROUTES.sessions, { signal: controller.signal }).then(
      (list) => {
        sessions.value = list.sessions
        failure.value = undefined
      },
      (error: unknown) => {
        // Anything but an `ApiFailure` is this unmount's own abort.
        if (error instanceof ApiFailure) {
          failure.value = error
        }
      }
    )
  }

  useEffect(() => {
    reload()

    return () => controller.abort()
  }, [controller])

  return (
    <section class="setting-row">
      <h3 class="setting-title">{tr('ui.office.settings.connection')}</h3>
      <p class="meta">{tr('ui.office.settings.sessions')}</p>
      {failure.value !== undefined && <p class="failure-line">{toFailureText(failure.value)}</p>}
      {sessions.value === undefined || timeZone === undefined
        ? failure.value === undefined && <Skeleton lines={2} />
        : sessions.value.map((session) => (
            <SessionLine
              key={session.id}
              session={session}
              timeZone={timeZone}
              signal={controller.signal}
              onEnded={reload}
            />
          ))}
    </section>
  )
}

function SessionLine(props: SessionLineProps) {
  const { session, timeZone } = props
  const isBusy = useSignal(false)
  const failure = useSignal<string | undefined>(undefined)

  return (
    <div class="setting-job">
      <div class="setting-pair">
        <span class="setting-actions">
          <b>{session.label === '' ? tr('ui.office.settings.sessionUnnamed') : session.label}</b>
          {session.current && <span class="meta">{tr('ui.office.settings.sessionThis')}</span>}
        </span>
        <Button
          size="small"
          kind="destructive"
          disabled={isBusy.value}
          onClick={() => {
            isBusy.value = true
            failure.value = undefined
            endSession(props).then((text) => {
              failure.value = text
              isBusy.value = false
            })
          }}
        >
          {tr('ui.office.settings.signOut')}
        </Button>
      </div>
      <span class="meta">
        {tr('ui.office.settings.sessionSignedIn', {
          when: formatWhen(session.createdAt, timeZone),
        })}
      </span>
      <span class="meta">
        {tr('ui.office.settings.sessionLastSeen', {
          when: formatWhen(session.lastSeenAt, timeZone),
        })}
      </span>
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
    </div>
  )
}

// This browser's own row signs out; another row ends that browser, then the list reloads. Never
// rejects: it resolves to the line a failure leaves on the row.
async function endSession({
  session,
  signal,
  onEnded,
}: SessionLineProps): Promise<string | undefined> {
  try {
    if (session.current) {
      await sendJson('POST', ROUTES.sessionLogout, { signal })
      authState.value = 'signed-out'
      return undefined
    }

    await sendJson('DELETE', ROUTES.sessionEnd(session.id), { signal })
    onEnded()
    return undefined
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is this unmount's own abort.
    return error instanceof ApiFailure ? toFailureText(error) : undefined
  }
}
