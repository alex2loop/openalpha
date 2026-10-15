import type { ServiceProvider } from '@/core/container'
import type { ToolDefinition } from '@/core/tool'
import type { FileRevisionGuard } from '@/tools/fs/file-revision-guard'
import { createFileRevisionGuard } from '@/tools/fs/file-revision-guard'
import { BUILT_IN_TOOLS } from '@/tools/registry'
import { createWebRetrievalService } from '@/tools/web/retrieval-service'

declare module '@/core/container' {
  interface Services {
    tools: ReadonlyMap<string, ToolDefinition>
    fileRevisionGuard: FileRevisionGuard
  }
}

export const toolsProvider: ServiceProvider = {
  name: 'tools',
  register(bind): void {
    bind('fileRevisionGuard', createFileRevisionGuard)
    bind('webRetrieval', (app) => createWebRetrievalService(app.config, app.resolve('logger')))
    bind('tools', () => new Map(BUILT_IN_TOOLS.map((tool) => [tool.name, tool])))
  },
}
