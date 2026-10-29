import { type ReadonlySignal, signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { type MessageKey, pluralKey } from '@/i18n'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import {
  APP_CHANNEL,
  type ChatSession,
  sessionId,
  sessionTitleOf,
  setChatOpen,
  viewedSession,
} from '@/web/state/chat'
import { resumeAppSession, startNewSession } from '@/web/state/chat-history'
import { CHAT_TAB_PARAM } from '@/web/state/pane'
import { state } from '@/web/state/session'
import { ABSENT_CELL, joinInline, TRUNCATION_MARK } from '@/web/text/glyphs'
import { sourceLabel } from '@/web/text/source'
import { buildDayKey, formatWhen } from '@/web/text/time'
import { shiftDay } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { ExternalIcon, MoreIcon, TrashIcon } from '@/web/ui/kit/icons'
import { closeModal } from '@/web/ui/kit/modal'
import { closePopover, openPopoverId, Popover, togglePopover } from '@/web/ui/kit/popover'
import { showUndo } from '@/web/ui/kit/undo-bar'

// Today and the six days before it.
const WEEK_DAYS = 7
const MENU_ID_PREFIX = 'session-menu:'
// Enough of a long first message to name the chat on the undo bar's one line.
const BAR_TITLE_MAX = 60
const GROUP_KEYS = Object.freeze({
  today: 'ui.office.sessions.groupToday',
  week: 'ui.office.sessions.groupWeek',
  older: 'ui.office.sessions.groupOlder',
} as const satisfies Record<string, MessageKey>)
const GROUP_ORDER: readonly GroupId[] = Object.freeze(['today', 'week', 'older'])

type GroupId = keyof typeof GROUP_KEYS

/** The days a row's last activity is placed against, on the daemon's calendar. */
interface GroupDays {
  readonly timeZone: string
  readonly today: string
  readonly weekStart: string
}

// Page-wide, not per list: a row deleted, closed and reopened inside the undo window stays gone.
// Undo or a refusal takes its id out; a delete that went through keeps it, as the daemon does.
const deletedIds = signal<ReadonlySet<string>>(new Set())

/** The sessions deleted on this page, whose rows no list shows. */
export const deletedSessionIds: ReadonlySignal<ReadonlySet<string>> = deletedIds

interface GroupsProps {
  readonly sessions: readonly ChatSession[]
}

/** Today, the last seven days and older, by the last activity on the daemon's calendar; a group
 *  with no row is not drawn. */
export function SessionGroups({ sessions }: GroupsProps) {
  const timeZone = state.value?.timeZone
  const groups = toGroups(sessions, timeZone)

  return (
    <>
      {groups.map(({ id, rows }) =>
        rows.length === 0 ? null : (
          <section key={id} class="sessions-group">
            <h3 class="sub-head">{tr(GROUP_KEYS[id])}</h3>
            <ul class="sessions-list">
              {rows.map((session) => (
                <SessionRow key={session.sessionId} session={session} timeZone={timeZone} />
              ))}
            </ul>
          </section>
        )
      )}
    </>
  )
}

function toGroups(
  sessions: readonly ChatSession[],
  timeZone: string | undefined
): readonly { readonly id: GroupId; readonly rows: readonly ChatSession[] }[] {
  const days = timeZone === undefined ? undefined : toGroupDays(timeZone)
  const placed = sessions.map((session) => ({ session, id: groupOf(session.lastActivityAt, days) }))

  return GROUP_ORDER.map((id) => ({
    id,
    rows: placed.filter((row) => row.id === id).map((row) => row.session),
  }))
}

function toGroupDays(timeZone: string): GroupDays {
  const today = buildDayKey(Date.now(), timeZone)

  return { timeZone, today, weekStart: shiftDay(today, 1 - WEEK_DAYS) }
}

// Without the daemon's zone no day can be placed, so every row is older.
function groupOf(atMs: number, days: GroupDays | undefined): GroupId {
  if (days === undefined) {
    return 'older'
  }

  const day = buildDayKey(atMs, days.timeZone)

  if (day >= days.today) {
    return 'today'
  }

  return day >= days.weekStart ? 'week' : 'older'
}

interface RowProps {
  readonly session: ChatSession
  readonly timeZone: string | undefined
}

function SessionRow({ session, timeZone }: RowProps) {
  const count = session.messageCount

  return (
    <li class="sessions-item">
      <button type="button" class="sessions-row" onClick={() => openSession(session)}>
        <b>{sessionTitleOf(session)}</b>
        <span class="meta">
          {joinInline([
            timeZone === undefined ? ABSENT_CELL : formatWhen(session.lastActivityAt, timeZone),
            sourceLabel(session.channel),
            tr(pluralKey(count, 'ui.office.sessions.countOne', 'ui.office.sessions.count'), {
              count,
            }),
          ])}
        </span>
      </button>
      <RowMenu session={session} />
    </li>
  )
}

// Delete is offered on this app's sessions only; the daemon refuses any other channel's anyway.
function RowMenu({ session }: { readonly session: ChatSession }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const menuId = `${MENU_ID_PREFIX}${session.sessionId}`
  const label = tr('ui.office.sessions.menu')

  // A menu left open when the dialog closes must not stay the page's open popover.
  useEffect(() => () => closeMenu(menuId), [menuId])

  return (
    <>
      <button
        ref={anchor}
        type="button"
        class="icon-button sessions-more"
        title={label}
        aria-label={label}
        aria-expanded={openPopoverId.value === menuId}
        onClick={() => togglePopover(menuId)}
      >
        <MoreIcon />
      </button>
      <Popover id={menuId} anchor={anchor} label={label} class="sessions-menu">
        <a
          href={`?${CHAT_TAB_PARAM}=${encodeURIComponent(session.sessionId)}`}
          target="_blank"
          rel="noopener"
          onClick={closePopover}
        >
          <ExternalIcon />
          {tr('ui.office.sessions.openTab')}
        </a>
        {session.channel === APP_CHANNEL && (
          <button type="button" class="is-danger" onClick={() => deleteSession(session)}>
            <TrashIcon />
            {tr('ui.office.sessions.delete')}
          </button>
        )}
      </Popover>
    </>
  )
}

function closeMenu(menuId: string): void {
  if (openPopoverId.peek() === menuId) {
    closePopover()
  }
}

// A session this page can write to becomes the current one; any other channel's is read beside it.
function openSession(session: ChatSession): void {
  closeModal()

  if (session.channel !== APP_CHANNEL) {
    viewedSession.value = session
  } else if (session.sessionId !== sessionId.value) {
    startNewSession()
    resumeAppSession(session)
  } else {
    viewedSession.value = undefined
  }

  setChatOpen(true)
}

// The row goes at once; the delete is sent when the bar ends, and Undo before that sends nothing.
function deleteSession(session: ChatSession): void {
  const id = session.sessionId
  const bringBack = (): void => {
    deletedIds.value = new Set([...deletedIds.peek()].filter((held) => held !== id))
  }

  closePopover()
  deletedIds.value = new Set([...deletedIds.peek(), id])
  showUndo(tr('ui.office.sessions.deleted', { title: toBarTitle(sessionTitleOf(session)) }), {
    commit: () => commitDelete(id),
    restore: bringBack,
    onRefused: bringBack,
  })
}

// A session already gone answers `deleted: false`, which needs no word. Either way the column
// leaves it: a new session where it was the current one, the current one where it was being read.
async function commitDelete(id: string): Promise<undefined> {
  await sendJson('DELETE', ROUTES.chatSessionDelete(id))

  if (sessionId.value === id) {
    startNewSession()
  } else if (viewedSession.value?.sessionId === id) {
    viewedSession.value = undefined
  }

  return undefined
}

function toBarTitle(title: string): string {
  return title.length <= BAR_TITLE_MAX
    ? title
    : `${title.slice(0, BAR_TITLE_MAX - TRUNCATION_MARK.length).trimEnd()}${TRUNCATION_MARK}`
}
