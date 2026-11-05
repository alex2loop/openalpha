import { type Signal, signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { TradingProfileResponse } from '@/app/server/wire/trading'
import { getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { editionKey } from '@/web/state/edition'
import { findMarket } from '@/web/state/market'
import { saveProfilePatch } from '@/web/state/profile'
import { formatPercent } from '@/web/text/figures'
import { segmentName } from '@/web/text/segment'
import { toErrorText, tr } from '@/web/text/tr'
import {
  buildTargetsPatch,
  CASH_SEGMENT,
  type CapSet,
  createTargetRows,
  fillTargets,
  isWhole,
  lockUnheld,
  roundShare,
  snapshotTargets,
  sumTargets,
  switchedOnSegments,
  type TargetRow,
  toPercent,
} from '@/web/ui/dialogs/targets-state'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

import './dialogs.css'

// `/v1/profile/default-targets?on=` lists the segments comma-separated.
const SEGMENT_SEPARATOR = ','

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
      <p class="meta">
        {tr(editionKey('ui.office.targets.note', 'ui.office.edition.targets.note'))}
      </p>
    </div>
  )
}

function TargetRowView({ row }: { readonly row: TargetRow }) {
  const isCash = row.segment === CASH_SEGMENT
  const isFixed = isCash || row.isLocked

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
        onBlur={() => roundShare(row)}
      />
    </div>
  )
}

function TotalLine({ total }: { readonly total: number | undefined }) {
  if (total === undefined || isWhole(total)) {
    return (
      <p class="target-total">
        {tr('ui.office.targets.total', {
          total: total === undefined ? '' : formatPercent(toPercent(total)),
        })}
      </p>
    )
  }

  return (
    <p class="failure-line" role="alert">
      {tr('ui.office.targets.mustBe100', { total: formatPercent(toPercent(total)) })}
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
        <Button disabled={open.isBusy.value} onClick={() => fillDefaults(open)}>
          {tr('ui.office.targets.defaults')}
        </Button>
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
  return row.isLocked ? tr('ui.office.targets.locked') : ''
}

// The split a re-seed would give the segments ticked now; it is saved only with Lưu.
function fillDefaults(open: OpenTargets): void {
  const on = open.rows.value
    .filter((row) => row.on.value && row.segment !== CASH_SEGMENT)
    .map((row) => row.segment)

  open.isBusy.value = true
  open.failure.value = undefined
  getJson(ROUTES.defaultTargets, { query: { on: on.join(SEGMENT_SEPARATOR) } })
    .then((answer) => fillTargets(open.rows.value, answer.segmentTargets))
    .catch((error: unknown) => {
      open.failure.value = toErrorText(error)
    })
    .finally(() => {
      open.isBusy.value = false
    })
}

function save(open: OpenTargets): void {
  open.isBusy.value = true
  open.failure.value = undefined
  saveTargets(open)
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

// A segment switched on is enabled first, which re-seeds every cap; the patch then keeps the caps
// the other segments had and the one the enable gave the new segment.
async function saveTargets(open: OpenTargets): Promise<void> {
  const enabledCaps: Record<string, CapSet> = {}

  for (const segment of switchedOnSegments(open.rows.value)) {
    const enabled = await sendJson('POST', ROUTES.profileSegment, {
      body: { action: 'enable', segment },
    })
    const cap = enabled.caps[segment]

    if (cap !== undefined) {
      enabledCaps[segment] = cap
    }
  }

  await saveProfilePatch(buildTargetsPatch(open.profile, open.rows.value, enabledCaps))
}
