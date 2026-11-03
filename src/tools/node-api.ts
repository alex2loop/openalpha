// Bun/Node-only public API of tools/: the built-in tool set reads files, spawns processes and
// dials hosts. Only `app` and `cli` import it; the browser bundle never reaches this file.
export { toolsProvider } from '@/tools/services'
