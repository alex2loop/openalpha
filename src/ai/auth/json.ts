export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? { ...value } : undefined
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
