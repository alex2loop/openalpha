/** The index `step` lands on in a list of `count`, wrapping at either end; from none (`-1`) it
 *  enters at the near end: the first going forward, the last going back. */
export function stepWrapped(index: number, step: 1 | -1, count: number): number {
  const entry = step > 0 ? -1 : 0
  const from = index === -1 ? entry : index

  return (from + step + count) % count
}
