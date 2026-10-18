// Public API of plugins/. Other modules import from here — never from plugins/ internals.

export type { PluginManifest } from '@/plugins/policy/manifest'
export type { PluginAssets } from '@/plugins/services'
export { mcpToolName, mcpToolSourceKey } from '@/plugins/contributions/external-tools'
export { discoverInstalledPlugins } from '@/plugins/lifecycle/discover'
export { installPlugin, uninstallPlugin, updatePlugin } from '@/plugins/lifecycle/install'
export { createPluginsProvider, loadInstalledPlugins } from '@/plugins/services'
