// Public API of app/. The process-embedding package entry (the `./app` subpath), distinct from the
// type-heavy root. Other modules import nothing from here; embedders import `boot`/`main`/`passThroughBootGate` and the boot types through it.

export type { Booted, BootOptions, MainOptions } from '@/app/types'
export { boot, passThroughBootGate } from '@/app/boot'
export { main } from '@/app/main'
