/** What may start an event job: the one list the scheduler, its store, the schedule tool, the wire
 *  and the trading alert notice all name. */
export const EVENT_JOB_KINDS = ['stop', 'target', 'price', 'mover'] as const

export type EventJobKind = (typeof EVENT_JOB_KINDS)[number]
