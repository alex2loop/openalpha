import { type ReadonlySignal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { MemoryResponse } from '@/app/server/wire/memory'
import type { LoadState } from '@/web/ui/kit/use-load'
import type { SectionProps } from '@/web/ui/settings/row'
import { formatDay } from '@/i18n'
import { ApiFailure } from '@/web/api/client'
import { onWireEvent } from '@/web/state/events'
import {
  hiddenRows,
  holdForget,
  type MemoryScope,
  memoryChanges,
  readMemory,
  toAttributeName,
  toRowId,
} from '@/web/state/memory'
import { locale, state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { openRememberDialog } from '@/web/ui/dialogs/remember-dialog'
import { Button } from '@/web/ui/kit/button'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { showUndo } from '@/web/ui/kit/undo-bar'

import './memory.css'

/** One row as Bộ nhớ lists it: a told preference or a note. */
interface MemoryRowView {
  readonly key: string
  readonly name: string
  readonly value: string
  readonly expiresAt?: number | null
}

/** Bộ nhớ: what every agent remembers, one group per scope, read again when a chat saves a
 *  preference. Quên hides the row at once and forgets it when the undo bar ends. */
export function MemorySection({ reopen }: SectionProps) {
  const read = useMemoryRead().value
  const query = useSignal('')

  if (read.status === 'loading') {
    return <Skeleton lines={3} />
  }

  if (read.status === 'failed') {
    return <p class="failure-line">{toFailureText(read.failure)}</p>
  }

  const typed = query.value.trim().toLowerCase()
  const groups = read.value.scopes.map((scope) => ({ scope, rows: toVisibleRows(scope, typed) }))
  const shown = groups.filter((group) => group.rows.told.length + group.rows.notes.length > 0)

  return (
    <>
      <p class="meta">{tr('ui.office.memory.intro')}</p>
      <div class="memory-tools">
        <input
          type="search"
          placeholder={tr('ui.office.memory.search')}
          aria-label={tr('ui.office.memory.search')}
          value={query.value}
          onInput={(event) => (query.value = event.currentTarget.value)}
        />
        <Button onClick={() => openRememberDialog({ onBack: reopen })}>
          {tr('ui.office.memory.add')}
        </Button>
      </div>
      {shown.length === 0 && <EmptyLines query={query.value.trim()} />}
      {shown.map(({ scope, rows }) => (
        <ScopeGroup key={scope.scope} scope={scope} rows={rows} ttlDays={read.value.ttlDays} />
      ))}
      {read.value.truncated && <p class="meta">{tr('ui.office.memory.truncated')}</p>}
    </>
  )
}

// A read on mount (the subscribe calls it at once), on each saved preference and on each forget or
// save answered; a later read that fails keeps the rows on screen.
function useMemoryRead(): ReadonlySignal<LoadState<MemoryResponse>> {
  const result = useSignal<LoadState<MemoryResponse>>({ status: 'loading' })

  useEffect(() => {
    let reading = new AbortController()
    const load = (): void => {
      reading.abort()
      reading = new AbortController()
      readMemory(reading.signal).then(
        (value) => {
          result.value = { status: 'ready', value }
        },
        (error: unknown) => {
          // Anything but an `ApiFailure` is this read's own abort.
          if (error instanceof ApiFailure && result.peek().status !== 'ready') {
            result.value = { status: 'failed', failure: error }
          }
        }
      )
    }
    const offs = [onWireEvent('preference_saved', load), memoryChanges.subscribe(load)]

    return () => {
      for (const off of offs) {
        off()
      }

      reading.abort()
    }
  }, [])

  return result
}

interface ScopeRows {
  readonly told: readonly MemoryRowView[]
  readonly notes: readonly MemoryRowView[]
}

function toVisibleRows(scope: MemoryScope, typed: string): ScopeRows {
  const isShown = (row: MemoryRowView): boolean =>
    !hiddenRows.value.has(toRowId(scope.scope, row.key)) &&
    (typed === '' || [row.name, row.value].some((text) => text.toLowerCase().includes(typed)))

  return {
    told: scope.told
      .map((row) => ({ key: row.key, name: toAttributeName(row.attribute), value: row.value }))
      .filter(isShown),
    notes: scope.notes.map((row) => ({ ...row, name: row.key })).filter(isShown),
  }
}

function EmptyLines({ query }: { readonly query: string }) {
  if (query !== '') {
    return <p class="empty-note">{tr('ui.office.memory.noMatch', { query })}</p>
  }

  return (
    <>
      <p>{tr('slash.memoryNone')}</p>
      <p class="meta">{tr('ui.office.memory.howTo')}</p>
    </>
  )
}

interface ScopeGroupProps {
  readonly scope: MemoryScope
  readonly rows: ScopeRows
  readonly ttlDays: number
}

function ScopeGroup({ scope, rows, ttlDays }: ScopeGroupProps) {
  const user = scope.isLocal ? tr('ui.office.memory.scopeLocal') : scope.userLabel
  const head = tr('ui.office.memory.scopeHead', { agent: scope.agentName, user })
  const forget = (row: MemoryRowView): void => forgetRow({ scope, head, row })

  return (
    <section class="setting-row">
      <h3 class="setting-title">{head}</h3>
      {rows.told.length > 0 && (
        <div class="memory-part">
          <h4 class="sub-head">{tr('ui.office.memory.told')}</h4>
          <p class="meta">{tr('ui.office.memory.toldNote')}</p>
          {rows.told.map((row) => (
            <MemoryRow key={row.key} row={row} forget={forget} />
          ))}
        </div>
      )}
      {rows.notes.length > 0 && (
        <div class="memory-part">
          <h4 class="sub-head">{tr('ui.office.memory.notes')}</h4>
          <p class="meta">{tr('ui.office.memory.notesNote', { days: ttlDays })}</p>
          {rows.notes.map((row) => (
            <MemoryRow key={row.key} row={row} forget={forget} />
          ))}
        </div>
      )}
    </section>
  )
}

interface MemoryRowProps {
  readonly row: MemoryRowView
  readonly forget: (row: MemoryRowView) => void
}

function MemoryRow({ row, forget }: MemoryRowProps) {
  const timeZone = state.value?.timeZone
  const expiresAt = row.expiresAt ?? undefined

  return (
    <div class="memory-row">
      <div class="memory-text">
        <b>{row.name}</b>
        <span>{row.value}</span>
        {expiresAt !== undefined && timeZone !== undefined && (
          <span class="meta">
            {tr('ui.office.memory.forgetsOn', {
              day: formatDay(locale.value, buildDayKey(expiresAt, timeZone)),
            })}
          </span>
        )}
      </div>
      <Button kind="tertiary" size="small" onClick={() => forget(row)}>
        {tr('ui.office.memory.forget')}
      </Button>
    </div>
  )
}

// The row goes at once; the delete is sent when the bar ends, and Undo before that sends nothing.
function forgetRow(target: {
  readonly scope: MemoryScope
  readonly head: string
  readonly row: MemoryRowView
}): void {
  const { scope, head, row } = target
  const { commit, restore } = holdForget(scope.scope, row.key)

  showUndo(tr('ui.office.memory.forgotScope', { key: row.name, scope: head }), {
    commit,
    restore,
    onRefused: restore,
  })
}
