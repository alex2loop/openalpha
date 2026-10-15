import type { JobSchedule } from '@/scheduler/api'

interface ScheduleResolved {
  readonly kind: 'value'
  readonly schedule: JobSchedule
  readonly nextRunAt: number
}

interface ScheduleError {
  readonly kind: 'error'
  readonly error: string
}

export type ScheduleResult = ScheduleResolved | ScheduleError
