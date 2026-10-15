import type { ScreenResponse } from '@/app/server/wire/market'

/** A board read refreshes a cold market and prices every candidate, which takes seconds, while the
 *  board moves on quotes, not on clicks. Within the fresh window the same board is served as is;
 *  past it and within the kept window it is still served at once while a re-read runs behind it. */
const SCREEN_FRESH_MS = 60_000
const SCREEN_KEPT_MS = 15 * 60_000

interface Board {
  readonly readAt: number
  readonly response: Promise<ScreenResponse>
  readonly answered: boolean
  readonly rereading: boolean
}

const boards = new Map<string, Board>()

/** One read per key at a time: concurrent and repeat asks share it. A failed read is dropped at
 *  once, so the next ask reads again instead of replaying the failure. */
export function cachedScreen(
  key: string,
  read: () => Promise<ScreenResponse>
): Promise<ScreenResponse> {
  const held = boards.get(key)
  const age = held === undefined ? Number.POSITIVE_INFINITY : Date.now() - held.readAt

  if (held !== undefined && (age < SCREEN_FRESH_MS || !held.answered)) {
    return held.response
  }

  if (held?.answered === true && age < SCREEN_KEPT_MS) {
    if (!held.rereading) {
      reread(key, held, read)
    }

    return held.response
  }

  return start(key, read)
}

function start(key: string, read: () => Promise<ScreenResponse>): Promise<ScreenResponse> {
  const response = read()

  boards.set(key, { readAt: Date.now(), response, answered: false, rereading: false })
  response.then(
    () => settle(key, response),
    () => drop(key, response)
  )

  return response
}

/** The held board stays served until the re-read answers; a failed re-read keeps it. */
function reread(key: string, held: Board, read: () => Promise<ScreenResponse>): void {
  const response = read()

  boards.set(key, { ...held, rereading: true })
  response.then(
    () => boards.set(key, { readAt: Date.now(), response, answered: true, rereading: false }),
    () => {
      const current = boards.get(key)

      if (current !== undefined) {
        boards.set(key, { ...current, rereading: false })
      }
    }
  )
}

function settle(key: string, response: Promise<ScreenResponse>): void {
  const current = boards.get(key)

  if (current?.response === response) {
    boards.set(key, { ...current, answered: true })
  }
}

function drop(key: string, response: Promise<ScreenResponse>): void {
  if (boards.get(key)?.response === response) {
    boards.delete(key)
  }
}
