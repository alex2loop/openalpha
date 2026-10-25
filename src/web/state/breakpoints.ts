import { type ReadonlySignal, signal } from '@preact/signals'

export type Breakpoint = 'wide' | 'narrow' | 'phone'

/** The page's layout band. Fixed at `wide` until the layout reads the viewport. */
export const breakpoint: ReadonlySignal<Breakpoint> = signal<Breakpoint>('wide')
