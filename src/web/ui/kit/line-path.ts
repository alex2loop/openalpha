const COORD_DIGITS = 1

interface Point {
  readonly x: number
  readonly y: number
}

/** The `points` attribute of an SVG polyline. */
export function toPolylinePoints(points: readonly Point[]): string {
  return points.map(({ x, y }) => `${x.toFixed(COORD_DIGITS)},${y.toFixed(COORD_DIGITS)}`).join(' ')
}

/** Maps a value in `[min, max]` onto `[from, to]`; a flat range lands in the middle. */
export function scaleLinear(
  value: number,
  domain: readonly [number, number],
  range: readonly [number, number]
): number {
  const [min, max] = domain
  const [from, to] = range

  return max === min ? (from + to) / 2 : from + ((value - min) / (max - min)) * (to - from)
}
