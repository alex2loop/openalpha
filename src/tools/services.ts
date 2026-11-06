import type { ToolDefinition } from '@/core/tool'
import type { FileRevisionGuard } from '@/tools/fs/file-revision-guard'
import { NetworkPolicy } from '@/core/ssrf/network-policy'
import { createToolsProvider } from '@/tools/portable-services'
import { BUILT_IN_TOOLS } from '@/tools/registry'
import { createWebRetrievalService } from '@/tools/web/retrieval-service'

declare module '@/core/container' {
  interface Services {
    tools: ReadonlyMap<string, ToolDefinition>
    fileRevisionGuard: FileRevisionGuard
  }
}

export const toolsProvider = createToolsProvider({
  tools: BUILT_IN_TOOLS,
  webRetrieval: (app) =>
    createWebRetrievalService(app.config, app.resolve('logger'), NetworkPolicy),
})
