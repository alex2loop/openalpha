// Bun/Node-only public API of trading/: plugin source modules are user files imported from disk, and
// the daemon loop probes the network.
// Only `app` and `cli` import it; the browser bundle never reaches this file.
export type { LoadedSourceModule } from '@/trading/sources/plugin-module'
export { loadPluginSourceModules } from '@/trading/sources/plugin-module'
export { isBoundaryFailure } from '@/trading/wiring/loop'
