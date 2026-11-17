import type { Needs } from '@/cli/command'

// An absent implicit config.toml resolves defaults, so an assistant can start the server before
// `onboard` has run; an explicit --config that is missing still fails.
export const MCP_COMMAND_NEEDS: Needs = { modelSource: 'client', configFile: 'optional' }
