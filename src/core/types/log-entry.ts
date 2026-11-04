/** One kept log line: when, how bad, the dotted key and the fields, scrubbed like any log line. */
export interface LogEntry {
  readonly time: number
  readonly level: 'warn' | 'error' | 'fatal'
  readonly key: string
  readonly fields: Readonly<Record<string, unknown>>
}
