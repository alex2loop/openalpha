/** The checks `doctor` runs, in the order it prints them: the argument `doctor <check>` takes, and
 *  the id each `/v1/doctor` row carries. */
export const CHECK_NAMES = [
  'config',
  'models',
  'data-dir',
  'logging',
  'database',
  'daemon',
  'channels',
  'delivery',
  'sources',
  'trading',
  'safety',
  'venues',
  'web-search',
  'providers',
  'telegram',
  'zalo',
  'version',
] as const

export type CheckName = (typeof CHECK_NAMES)[number]

/** `info` is a state that needs no action yet (a fresh install, a daemon not started), so it never
 *  counts against the report. */
export type DoctorStatus = 'ok' | 'info' | 'warn' | 'fail'
