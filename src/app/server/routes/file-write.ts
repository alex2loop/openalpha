// One config-file read-modify-write at a time, whichever route runs it: two writes at once would
// each rewrite the file from the same read and lose one change. A failed write settles the chain
// like a successful one, so the next write still runs.
let writeTail: Promise<unknown> = Promise.resolve()

export function serializeFileWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = writeTail.then(op, op)

  writeTail = run

  return run
}
