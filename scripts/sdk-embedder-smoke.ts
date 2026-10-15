// Compile-only embedder smoke fixture. Proves the public SDK surface is sufficient for the design's
// success case: import only `@openalpha/runtime`, `@openalpha/runtime/app`, and `zod`; build every
// component kind through the `create*` family; exercise input-schema inference and channel-config
// inference; and type-check flat `boot` options. Never starts the app. Included by scripts/tsconfig.
import type { BootOptions } from '@openalpha/runtime'
import type { ChannelDefinition } from '@openalpha/runtime'
import { createAgent, createChannel, createSlashCommand, createTool } from '@openalpha/runtime'
import { boot } from '@openalpha/runtime/app'
import { z } from 'zod'

// Tool: input-schema inference flows from `inputSchema` into `execute`'s first parameter.
const weather = createTool({
  name: 'get_weather',
  description: 'Get the weather for a city.',
  inputSchema: z.object({ city: z.string() }),
  capability: 'net',
  async execute({ city }) {
    return `${city}: Sunny`
  },
})

// Agent: untrusted, code-defined; capabilities reference tools that resolve at boot.
const researcher = createAgent({
  id: 'web-researcher',
  systemPrompt: 'You are a focused research assistant.',
  capabilities: { tools: ['web_search', 'get_weather'] },
})

// Slash command: embedder-authored text result, scrubbed/capped by the dispatcher at run time.
const echo = createSlashCommand({
  name: 'echo',
  description: { kind: 'plugin', text: 'Echo the argument back.' },
  messageKeys: ['slash.commandUnexpected'],
  policy: { surfaces: ['repl', 'channel'], role: 'member', action: 'read' },
  async run() {
    return { kind: 'text' as const, text: 'pong' }
  },
})

// Channel: adapter-specific config inference is retained through the generic helper.
const demoChannel = createChannel({
  id: 'demo',
  resolveConfig: (raw) => {
    const cfg = (raw ?? {}) as { enabled?: boolean }
    return { enabled: cfg.enabled ?? false }
  },
  isEnabled: (cfg) => cfg.enabled,
  admission: () => ({ mode: 'allowlist', allowedIds: [], operatorUserIds: [] }),
  create: () => {
    throw new Error('demo channel is a compile-only fixture')
  },
})

// Flat boot options type-check against the public entry without starting the app.
const options: BootOptions = {
  mode: 'daemon',
  env: {},
  shutdownSignal: AbortSignal.timeout(1),
  tools: [weather],
  agents: [researcher],
  slashCommands: [echo],
  channels: [demoChannel as ChannelDefinition],
}

// Reference `boot` so the import is value-used; the fixture never awaits it.
void boot

export { options }

// Compile-time unknown-key rejection: one `@ts-expect-error` per helper proves `Exact` blocks
// extra properties. Each comment explains the contract; these are the only expected-error directives.
const rejectedTool = createTool({
  name: 'rejected',
  description: 'never built',
  inputSchema: z.object({}),
  capability: 'read',
  async execute() {
    return ''
  },
  // @ts-expect-error unknown key 'bogus' is rejected by Exact at compile time
  bogus: true,
})

const rejectedAgent = createAgent({
  id: 'rejected',
  systemPrompt: '',
  // @ts-expect-error unknown key 'modelTier' (a trust-gated field) is rejected by Exact at compile time
  modelTier: 'fast',
})

const rejectedCommand = createSlashCommand({
  name: 'rejected',
  description: { kind: 'plugin', text: '' },
  messageKeys: ['slash.commandUnexpected'],
  policy: { surfaces: ['repl'], role: 'member', action: 'read' },
  async run() {
    return { kind: 'handled' as const }
  },
  // @ts-expect-error unknown key 'bogus' is rejected by Exact at compile time
  bogus: true,
})

const rejectedChannel = createChannel({
  id: 'rejected',
  resolveConfig: () => ({ enabled: false }),
  isEnabled: () => false,
  admission: () => ({ mode: 'allowlist', allowedIds: [], operatorUserIds: [] }),
  create: () => {
    throw new Error('rejected')
  },
  // @ts-expect-error unknown key 'bogus' is rejected by Exact at compile time
  bogus: true,
})

// Mark the compile-only rejections as intentionally unused so noUnusedLocals stays satisfied.
void rejectedTool
void rejectedAgent
void rejectedCommand
void rejectedChannel
