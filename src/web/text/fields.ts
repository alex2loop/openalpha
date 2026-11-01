/** A field of an open daemon row, read only when it holds text. */
export function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
