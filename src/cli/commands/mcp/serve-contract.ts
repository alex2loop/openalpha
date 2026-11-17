import type { Needs } from '@/cli/command'

// An absent implicit config.toml resolves defaults, so an assistant can start the server before
// `onboard` has run; an explicit --config that is missing still fails.
export const MCP_COMMAND_NEEDS: Needs = { modelSource: 'client', configFile: 'optional' }

// What every launcher appends to the binary to start the server: `mcp install` entries and the
// release's MCP bundle.
export const MCP_SERVE_ARGV = Object.freeze(['mcp', 'serve'] as const)
