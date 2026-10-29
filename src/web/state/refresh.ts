import { computed, type ReadonlySignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { MarketWire } from '@/app/server/wire/market'
import { COMMAND_PREFIX, isFinished, thread } from '@/web/state/chat'
import { onCommandFinished } from '@/web/state/events'
import { runs } from '@/web/state/live'
import { knownMarkets } from '@/web/state/market'
import { quietCommands, sendQuiet } from '@/web/state/quiet-command'

const WORD_BREAK = /\s+/
// A command's run is named without the slash.
const REFRESH_NAME = 'refresh'
const REFRESH_COMMAND = `${COMMAND_PREFIX}${REFRESH_NAME}`

/** A `/refresh` is running or waiting, wherever it came from: this page, a channel or the schedule. */
export const isRefreshing: ReadonlySignal<boolean> = computed(
  () =>
    runs.value.some((run) => run.kind === 'command' && run.name === REFRESH_NAME) ||
    quietCommands.value.some(isRefreshLine) ||
    thread.value.some((turn) => !isFinished(turn) && isRefreshLine(turn.text))
)

/** The markets of `region` the operator still reads: `/refresh` takes one market a line. */
export function refreshableMarkets(region: string): readonly MarketWire[] {
  return knownMarkets.value.filter((market) => market.region === region && market.enabled)
}

/** Sends `/refresh <market>` quiet for each of `markets`, never `force`: the blocks that asked read
 *  again when it ends, and `onRefused` hears a refusal. False when the socket is down. */
export function refreshMarkets(
  markets: readonly MarketWire[],
  onRefused: (message: string) => void
): boolean {
  return markets
    .map((market) => sendQuiet({ text: `${REFRESH_COMMAND} ${market.market}`, onRefused }))
    .every((isSent) => isSent)
}

/** Reads again each time a `/refresh` run ends. */
export function useRereadAfterRefresh(reread: () => void): void {
  useEffect(() => onCommandFinished(REFRESH_NAME, reread), [])
}

function isRefreshLine(text: string): boolean {
  return text.trim().split(WORD_BREAK)[0] === REFRESH_COMMAND
}
