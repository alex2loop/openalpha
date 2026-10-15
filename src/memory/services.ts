import type { Bind, ServiceProvider } from '@/core/container'
import type { Memory } from '@/core/types/memory'
import { createMemory } from '@/memory/store'

declare module '@/core/container' {
  interface Services {
    memory: Memory
  }
}

export const memoryProvider: ServiceProvider = {
  name: 'memory',
  register(bind: Bind): void {
    bind('memory', (app) =>
      createMemory(app.resolve('storage'), app.resolve('dialect'), {
        limits: app.config.memory,
        fts: app.resolve('fts'),
      })
    )
  },
}
