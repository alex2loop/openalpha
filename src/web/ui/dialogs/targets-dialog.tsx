import { type Signal, signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { TradingProfileResponse } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { findMarket } from '@/web/state/market'
import { saveProfilePatch } from '@/web/state/profile'
import { formatPercent } from '@/web/text/figures'
import { segmentName } from '@/web/text/segment'
import { toErrorText, tr } from '@/web/text/tr'
import {
  buildTargetsPatch,
  CASH_SEGMENT,
  createTargetRows,
  isWhole,
  lockUnheld,
  snapshotTargets,
  sumTargets,
  type TargetRow,
} from '@/web/ui/dialogs/targets-state'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

import './dialogs.css'

const ENABLE_COMMAND = '/profile enable'

interface TargetsRequest {
  /** Leads back to where the dialog was opened from. */
  readonly onBack?: () => void
}

interface OpenTargets {
  readonly request: TargetsRequest
  readonly profile: TradingProfileResponse
  readonly rows: Signal<readonly TargetRow[]>
  readonly initial: string
  readonly failure: Signal<string | undefined>
  readonly isBusy: Signal<boolean>
  handle?: ModalHandle
}

/** "Tỷ trọng mục tiêu": which segments are on and the share of the book each is steered toward.
 *  Nothing is bought or sold; the next /rebalance steps toward the targets. */
export function openTargetsDialog(profile: TradingProfileResponse, request: TargetsRequest): void {
  const rows = createTargetRows(profile)
  const open: OpenTargets = {
    request,
    profile,
    rows: signal(rows),
    initial: snapshotTargets(rows),
    failure: signal(undefined),
    isBusy: signal(false),
  }

  open.handle = openModal({
    title: tr('ui.office.targets.title'),
    body: <TargetsBody open={open} />,
    footer: <TargetsFooter open={open} />,
    dirty: () => snapshotTargets(open.rows.value) !== open.initial,
  })
}

function TargetsBody({ open }: { readonly open: OpenTargets }) {
  useHeldSegments(open)

  const total = sumTargets(open.rows.value)

  return (
    <div class="dialog-form">
      {open.failure.value !== undefined && (
        <p class="failure-line" role="alert">
          {open.failure.value}
        </p>
      )}
      <div>
        {open.rows.value.map((row) => (
          <TargetRowView key={row.segment} row={row} />
        ))}
      </div>
      <TotalLine total={total} />
      <p class="meta">{tr('ui.office.targets.note')}</p>
    </div>
  )
}

function TargetRowView({ row }: { readonly row: TargetRow }) {
  const isCash = row.segment === CASH_SEGMENT
  const isFixed = isCash || row.isLocked || !row.wasOn

  return (
    <div class="target-row">
      <label class="form-check">
        <input
          type="checkbox"
          checked={row.on.value}
          disabled={isFixed}
          onChange={(event) => switchRow(row, event.currentTarget.checked)}
        />
        {segmentName(row.segment)}
      </label>
      <span class="meta">{describeRow(row)}</span>
      <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        aria-label={segmentName(row.segment)}
        disabled={!row.on.value}
        value={row.pct.value}
        onInput={(event) => {
          row.pct.value = event.currentTarget.value
        }}
      />
    </div>
  )
}

function TotalLine({ total }: { readonly total: number | undefined }) {
  if (total === undefined || isWhole(total)) {
    return (
      <p class="target-total">
        {tr('ui.office.targets.total', { total: total === undefined ? '' : formatPercent(total) })}
      </p>
    )
  }

  return (
    <p class="failure-line" role="alert">
      {tr('ui.office.targets.mustBe100', { total: formatPercent(total) })}
    </p>
  )
}

function TargetsFooter({ open }: { readonly open: OpenTargets }) {
  const { onBack } = open.request

  return (
    <>
      <div class="dialog-foot-left">
        {onBack !== undefined && (
          <Button onClick={onBack}>{tr('ui.office.settings.toSettings')}</Button>
        )}
      </div>
      <Button onClick={() => open.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
      <Button
        kind="commit"
        disabled={open.isBusy.value || !isWhole(sumTargets(open.rows.value))}
        onClick={() => save(open)}
      >
        {tr('ui.office.common.save')}
      </Button>
    </>
  )
}

// Switching a segment off puts its share at nothing; the daemon refuses a target on a segment
// with no room.
function switchRow(row: TargetRow, isOn: boolean): void {
  row.on.value = isOn

  if (!isOn) {
    row.pct.value = '0'
  }
}

function describeRow(row: TargetRow): string {
  if (row.isLocked) {
    return tr('ui.office.targets.locked')
  }

  return row.wasOn || row.segment === CASH_SEGMENT
    ? ''
    : tr('ui.office.targets.offHint', { command: `${ENABLE_COMMAND} ${row.segment}` })
}

function save(open: OpenTargets): void {
  open.isBusy.value = true
  open.failure.value = undefined
  saveProfilePatch(buildTargetsPatch(open.profile, open.rows.value))
    .then(() => {
      open.handle?.close()
      open.request.onBack?.()
    })
    .catch((error: unknown) => {
      open.failure.value = toErrorText(error)
    })
    .finally(() => {
      open.isBusy.value = false
    })
}

// Which segments some exchange holds is read once when the dialog mounts.
function useHeldSegments(open: OpenTargets): void {
  useEffect(() => {
    const controller = new AbortController()

    getJson(ROUTES.venues, { signal: controller.signal }).then(
      (answer) => {
        const held = new Set(
          answer.venues
            .flatMap((venue) => venue.markets)
            .flatMap((market) => findMarket(market)?.segment ?? [])
        )

        open.rows.value = lockUnheld(open.rows.value, held)
      },
      // Without the venues no row is locked; the daemon still refuses what cannot be held.
      () => undefined
    )

    return () => controller.abort()
  }, [])
}
