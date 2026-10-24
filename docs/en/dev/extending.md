# Extending the runtime

For developers embedding OpenAlpha or adding to it. Using it as an operator? Start at the [docs index](../README.md).

Three ways in, from least to most work:

- **Embed it.** Call `boot()` inside your own process and register your own tools, agents, channels
  and commands. Nothing is forked.
- **Write a plugin.** Ship declarative content without touching this repo. Code runs only if the
  operator allows it.
- **Learn the container.** The composition root is one file with a fixed order. Read it before you add
  a provider, not after.

---

## The SDK surface

`@openalpha/runtime` is private to this workspace. Its exports mark the supported boundary between
packages and embedders; anything not exported from an entry point is internal to its module. The full
contract is [src/index.ts](../../../src/index.ts).

Defining a tool, command or agent does not register it. The composition root does, through the flat
`boot` options (the easy path) or a `ServiceProvider` (the escape hatch). Most extensions look the same:
import a helper, export the definition, hand it to `boot`.

```ts
import { createTool } from '@openalpha/runtime'
import { boot } from '@openalpha/runtime/app'
import { z } from 'zod'

const echoTool = createTool({
  name: 'echo',
  description: 'Return the supplied text',
  inputSchema: z.object({ text: z.string() }),
  capability: 'read',
  async execute(input) {
    return input.text
  },
})

const { app, dispose } = await boot({
  mode: 'daemon',
  env: process.env,
  shutdownSignal: AbortSignal.timeout(60_000),
  tools: [echoTool],
})
```

```ts
import { createCommand } from '@openalpha/runtime/cli'

export const helloCommand = createCommand({
  name: 'hello',
  summary: { key: 'cliHelp.commandStatusSummary' }, // an i18n catalog key, not free text
  run(_args, app) {
    app.write('hello\n')
    return 0
  },
})
```

### Entry points

| Import | Holds |
|---|---|
| `@openalpha/runtime` | The `create*` helpers, `channelId`, `bindLocale`, `renderMessages`, `BRAND`, id converters, `scrubCredentials`, and every public contract type. Type-heavy on purpose; import types with `import type`. It does not boot anything. |
| `@openalpha/runtime/app` | Process embedding: `boot`, `main`, `passThroughBootGate`, and the `BootOptions`, `Booted`, `MainOptions` types |
| `@openalpha/runtime/cli` | Command factories, admission and execution, parsing and output helpers, `BUILT_IN_COMMANDS` |
| `@openalpha/runtime/package.json` | Package metadata |

### Helpers

| Helper | Import from | Purpose |
|---|---|---|
| `createTool` | root | Define a typed tool. Validates name and description, infers `execute` input from `inputSchema` |
| `createAgent` | root | Define an untrusted, code-defined agent (no model-tier or reasoning fields) |
| `createSlashCommand` | root | Define a slash command. Validates name and shape |
| `createChannel` | root | Define a channel. Brands the id, validates the adapter functions |
| `channelId` | root | Validate and brand a channel id |
| `bindLocale`, `renderMessages` | root | Bind the `en`/`vi` catalog into a `translate`/`has` pair; render localized command output from it |
| `BRAND` | root | Product identity, derived once from `productName` |
| `agentId`, `runId`, `sessionId` | root | Brand raw strings as typed ids |
| `scrubCredentials` | root | Strip secrets from text before display |
| `boot`, `passThroughBootGate` | `/app` | Boot the container. Returns `{ app, delivery, dispose }` |
| `main` | `/app` | Full entry: boot, then run the CLI with extra providers, commands and a boot gate |
| `createCommand`, `createGroup`, `createRoot` | `/cli` | Define a terminal command, group subcommands, build the executable root tree (it adds `help` and the `--version` alias) |
| `lazyCommand` | `/cli` | Defer a command's module load until it runs |
| `admitCommand`, `preflightCommand` | `/cli` | Admission and preflight gates around dispatch |
| `preBootApp`, `runCli` | `/cli` | Config-only app for no-boot commands; run the tree against argv |
| `parseGlobalFlags` | `/cli` | Parse global flags before dispatch |
| `formatTerminalError`, `printError`, `usage`, `fail` | `/cli` | Terminal error and usage output |
| `getEnv`, `isVerbose`, `stopDaemonIfRunning` | `/cli` | CLI environment helpers, daemon shutdown support |
| `BUILT_IN_COMMANDS` | `/cli` | The canonical built-in command registry |

### What a tool receives

Every tool's `execute` gets a `ToolInvocationContext` as its second argument, scoped to the run that
called it.

| Member | Use |
|---|---|
| `ctx.signal` | The run's `AbortSignal`. Pass it to anything that can outlive the call |
| `ctx.logger` | Run-scoped logger; scrubs credentials |
| `ctx.locale` | `'en'` or `'vi'` for tool-facing messages |
| `ctx.config` | The frozen resolved config |
| `ctx.workspaceDir` | Canonical cwd for shell and file work. Not OS-level confinement |
| `ctx.childEnv` | Frozen env for shell and delegated children |
| `ctx.memory` | Secret-scrubbing memory handle |
| `ctx.bus` | The run's event bus |
| `ctx.budget` | Shared run budget; delegated children charge the same object |
| `ctx.callId` | The provider's id for this call. With `ctx.runId` it is the only durable idempotency identity a tool may use |
| `ctx.services` | Tool-contributed service handles (declaration-merged per tool surface) |
| `ctx.deadline` | The run's duration clock. Pause it while you wait on a human |
| `ctx.reportProgress` | Report a sparse progress milestone to the parent surface |
| `ctx.addExternalCost`, `ctx.recordExternalCost` | Bill a non-LLM provider response to the live totals |

### Creating an agent

An agent is data (a validated `agent.toml`) or code (`createAgent`). A code-defined agent mirrors the
`agent.toml` schema in camelCase, minus `modelTier` and `reasoning` (a user `agent.toml` may set `model_tier`, a code-defined agent never; `reasoning` is for trusted agents only) and minus
`focus` and `max_daily_usd` (only `agent.toml` carries them). It is always untrusted, like a user
`agent.toml`.

```ts
import { createAgent } from '@openalpha/runtime'
import { boot } from '@openalpha/runtime/app'

const researcher = createAgent({
  id: 'web-researcher',
  name: 'Web Researcher',
  description: 'Read-only web research assistant',
  systemPrompt: 'You are a focused research assistant.',
  maxTurns: 12,
  capabilities: { tools: ['web_search', 'web_fetch'] },
})

await boot({
  mode: 'daemon',
  env: process.env,
  shutdownSignal: AbortSignal.timeout(60_000),
  agents: [researcher],
})
```

`createAgent` checks the id and a non-empty system prompt immediately and returns a frozen definition.
Tool and delegate references resolve at boot against the full registries, so an agent can allowlist
tools from the same `tools` option and delegate to agents from the same `agents` option. A bad reference
lands in the single aggregated boot error, never silently dropped.

The data form is [agent.sample.toml](../../../agent.sample.toml). A user agent lives at
`<data_dir>/agents/<id>/agent.toml`; a plugin ships one as an `AgentProfileSource` (`{ id, tomlPath }`).
Invalid files are logged and skipped at boot. Omit `[capabilities]` and the agent gets **nothing**: set
`tools = "*"` for the whole registry or list names. Authoring guide: [Agents](../agents.md).

### Booting the app

The root entry does not boot anything, and `createApp` is internal. The root exports only the container
types (`App`, `Bind`, `Extend`, `ServiceProvider`, `Services`, `DaemonTask`). Embedders use `boot` and
`main` from `@openalpha/runtime/app`.

`boot` takes flat extension options and lowers them into the canonical provider assembly. The app keeps
sole ownership of registration order.

```ts
const { app, dispose } = await boot({
  mode: 'daemon',
  env: process.env,
  shutdownSignal: AbortSignal.timeout(60_000),
  tools: [myTool],
  agents: [myAgent],
  slashCommands: [myCommand],
  channels: [myChannelDefinition],
})
```

| Option | Lowers into | On a duplicate |
|---|---|---|
| `tools` | tool registry | duplicate tool name reported |
| `agents` | agent registry (built untrusted via `buildAgentDefinition`) | duplicate agent id reported |
| `slashCommands` | slash dispatcher | duplicate command name reported |
| `channels` | channel-definition registry | duplicate channel id reported |

All options are validated together. Every problem is collected and thrown as **one** credential-scrubbed
`ConfigError`, not the first one only. New tools pass the same capability and approval gates as
built-ins. A `channels` entry registers the *definition*; the channel still starts only when operator
config (credentials) exists, like the built-in telegram and zalo definitions.

`features` (`readonly ServiceProvider[]`) is the escape hatch for what flat options cannot express: raw
providers layered after the canonical order. Workflows are file and config owned
(`<data_dir>/workflows/`) because a `Workflow` carries executable behavior, so there is no `workflows`
option.

### Extension contracts

| Extension | Contract |
|---|---|
| Tool | `ToolDefinition`, from `createTool(...)` |
| Channel | `ChannelDefinition`, from `createChannel(...)`, producing a `ChannelAdapter` |
| Agent | `AgentDefinition`, from `createAgent(...)`, or a validated `agent.toml` |
| Slash command | `SlashCommand`, from `createSlashCommand(...)` (an optional `usage()` is what `/help <name>` prints), or `DeclarativeSlashCommandSource` |
| Workflow | `WorkflowSource` (file and config discovery only) |
| Plugin | `Plugin` with `PluginContributions` |
| Trading service | `PortfolioService`, `MarketDataService`, `SuggestionService`, `AlertService`, `BriefService`. Resolved from the container, never constructed by an embedder |

### Stability and safety rules

- Named exports only. No default export.
- Cross-module code imports module APIs, not internal files.
- Untrusted plugins cannot contribute executable tools or hooks.
- A dangerous tool defined through the SDK still passes the engine approval gate.
- The SDK exports trading **contracts and results**, never registries, stores, adapters, markets,
  sources, stages or operation factories. Composition owns what is active.
- `Locale` comes from `@/core/types/locale`, so typing against it does not pull in the catalogs.

---

## The app container

An app is a service container assembled from providers, plus a boot sequence that wires config,
logging, assets and persistence around it. The container is
[src/core/container.ts](../../../src/core/container.ts). The only place the full provider list exists is
[src/app/providers.ts](../../../src/app/providers.ts). Embedders never build the container themselves.

### The container

Everything shared at runtime is a keyed service. Each module declaration-merges its keys into the
`Services` interface, so `app.resolve('tools')` type-checks against the owning module. A
`ServiceProvider` registers bindings:

```ts
export const apiServiceProvider: ServiceProvider = {
  name: 'api',
  register(bind): void {
    bind('apiRoutes', () => ROUTES)
  },
}
```

- `bind(key, factory)` installs a lazy singleton: the factory runs on first `resolve` and the value is
  cached. Binding a bound key throws.
- `extend(key, fn)` layers onto an existing binding (plugins extend `tools` this way). Extending an
  unbound key throws.
- `resolve` detects circular dependencies and names the key. Call it **only** in `app/providers.ts` and
  per-module `services.ts`; everywhere else dependencies arrive as factory arguments.
- `has(key)` probes an optional binding without throwing.

### The canonical provider order

`buildProviders` registers providers in a fixed order, because every `extend` target must already exist
through an earlier `bind`:

```text
logger, bus, sessionQueue (core, inline)
storage -> tradingStores -> baseCurrencyGuard, memory -> ai -> engine -> tools
-> channels, commands -> cliCommands -> social -> trading registration
-> plugins -> mcp -> userAgents -> app -> scheduler -> bootExtensions -> api
```

- `baseCurrencyGuard` (step 2b) extends the trading profile and ledger bindings, so it follows
  `tradingStores`.
- `cliCommands` (8b) is the empty base that trading and plugins extend.
- `social` (8c) binds the social service and extends the tool and command registries.
- `scheduler` (13b) binds the job commands and the daemon task after the `app` bindings exist.
- `api` (last) binds the HTTP/WS API; the daemon starts it only when `[api]` is enabled.

The hard constraints, as `providers.ts` states them:

- logger, bus and sessionQueue before everything;
- storage before the trading stores, memory and the engine's cost tracker;
- ai before the engine's compactor;
- engine before tools and plugins;
- tools before plugins and mcp;
- commands before plugins;
- trading registration before plugins;
- plugins before mcp and userAgents;
- `cliCommands` before trading and plugins, which both extend it.

Never reorder without walking that list. The boot-extension provider (which lowers the flat options)
registers after the `app` and `scheduler` providers. Providers in `BootOptions.features` register
**after** the canonical order, so their `extend` calls see the finished table.

### Boot

`boot(opts)` is the embedder's path. In order, it:

1. Loads raw config (`loadConfig`), freezes the resolved config (`resolveConfig`), and refuses a
   top-level config section nobody owns.
2. Runs the boot gate. A `stop` verdict throws `ConfigError`; `warn` prints to `err`. The default gate
   passes. This runs before the logger, database or data directory exist.
3. Creates the data directory, then the logging resource.
4. Computes the frozen child env from an **allowlist only**: `PATH`, `HOME`, `LANG`, `LC_ALL`, `TZ`,
   `TERM`, `TMPDIR`, `TEMP`, `TMP`. There is no blocklist on purpose. Interpreter-hijack variables
   (`NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `PYTHONSTARTUP`, ...) and every provider API
   key are out because they are not listed.
5. Loads runtime assets (MCP servers, installed plugins, user agents, user workflows) and opens
   persistence.
6. Calls `createApp(config, [...assembly.providers, ...features], { configPath, signal })`.
7. Runs `assembly.assertExtensionsRegistered(app)`: forces the affected services to resolve and throws
   **one** credential-scrubbed `ConfigError` listing every problem across the flat options.
8. Resolves the trading services eagerly (a bad install fails at boot, not at the first tool call),
   checks the `[social]` tool rules against the final tool registry, points the logger at the agent
   registry, and runs the startup step.

It resolves to `{ app, delivery, dispose }`. A boot failure, including extension validation, logs
`boot.failed`, disposes what it acquired and rethrows. `dispose()` is idempotent (every call returns the
same promise): it closes MCP assets and storage with `Promise.allSettled`, logs failures as
`boot.dispose_failed`, and closes the logger last.

| `BootOptions` field | Purpose |
|---|---|
| `mode` | `'cli'` or `'daemon'`. Drives startup-state hydration |
| `bootScope` | `'full'` (default) or `'persistence'`, which opens storage only, for commands that never run the engine |
| `startup` | `'hydrate'` (default), `'migrate'` or `'none'`. What to do with startup state once the app is built |
| `env` | Source environment for the child-env filter |
| `configFile` | `'required'` (default), `'optional'` or `'probe'` |
| `configPath`, `dataDir`, `logLevel`, `modelSource` | Config overrides |
| `shutdownSignal` | The app's `AbortSignal`; tools and daemons propagate it |
| `tools`, `agents`, `slashCommands`, `channels` | Flat extension options. All problems aggregate into one `ConfigError` |
| `features` | Extra `ServiceProvider`s layered after the boot-extension provider |
| `bootGate` | Defaults to the pass-through gate |
| `err`, `onLoggerResource` | Warning sink; logger-resource handoff for crash handling |

### The full entry

`main(argv, opts)` is the whole binary: parse global flags, boot, run the command tree. This binary
passes no options. A host that embeds the runtime may pass:

```ts
process.exitCode = await main(process.argv.slice(2), {
  features: [myServiceProvider], // providers layered after the canonical ones
  extraCommands: [myCommand], // commands grafted onto the root
  bootGate: myBootGate, // defaults to passThroughBootGate
})
```

That is the whole extension seam. A host adds its surface through `features` and `extraCommands`, never
by editing the canonical list. The runtime never imports its host.

### Notice surfaces

A host that is not a chat channel can still receive what the daemon pushes: price alerts, stop hits, the
brief, movers and scheduled results. From one of its `features`, attach a surface under a channel id and
keep the detach function for shutdown:

```ts
const detach = app.resolve('noticeSurfaces').attach(channelId('api'), {
  deliver: ({ text, notice }) => (push(text, notice) ? 'accepted' : 'unavailable'),
})
```

- `text` is the sentence a chat would get. `notice` is the typed trading notice behind it, absent on a
  scheduled result.
- Answer `unavailable` while nobody is listening; the sender retries as it would for an offline chat.
- `accepted` means the surface took the message, not that a person saw it.
- A notice addressed to the surface's channel reaches it whatever chat id it names. With no chat
  channel attached, an unaddressed notice goes to the first attached surface, with chat id `app`.

---

## Plugins

Plugins contribute validated content to the canonical registries. Discovery is generic: it knows nothing
about trading or any other product bundle. Boundary: [src/plugins/api.ts](../../../src/plugins/api.ts).

### Runtime contract

```ts
interface Plugin {
  readonly id: string
  readonly contributions: PluginContributions
}

interface PluginContributions {
  readonly tools?: readonly ToolDefinition[]
  readonly agents?: readonly AgentProfileSource[]
  readonly slashCommands?: readonly SlashCommand[]
  readonly cliCommands?: readonly CliCommandDef[]
  readonly channels?: readonly ChannelDefinitionRef[]
  readonly workflows?: readonly WorkflowSource[]
  readonly declarativeChannels?: readonly DeclarativeChannelSource[]
  readonly declarativeSlashCommands?: readonly DeclarativeSlashCommandSource[]
  readonly externalMcpTools?: readonly McpToolSource[]
  readonly daemonTasks?: readonly DaemonTask[]
  readonly apiRoutes?: readonly ApiRouteSource[]
  readonly skillsDirs?: readonly string[]
  readonly sourceModules?: readonly PluginSourceModule[]
}
```

The composition root supplies trusted bundled `Plugin` objects. This binary passes an empty bundled list
(`createPluginsProvider([], ...)` in `app/providers.ts`), so a host that embeds the runtime is what
supplies them. Installed filesystem plugins are discovered as untrusted data.

A `DaemonTask` runs `start(signal, options?)`. `options` is a `DaemonStartOptions`: `onReady` fires once every
subsystem is up, `onHealth` reports what a channel has left down as it changes, and `previousRun` is set when
this start reclaimed the pid file of a daemon that never stopped cleanly.

Trading is **not** a plugin. It registers directly at provider step 9, before plugins, so a plugin can
never shadow a trading tool, command or debate persona. See
[AD-5](internals.md#ad-5-trading-is-one-bounded-context).

### Installed plugin layout

```text
<plugin-dir>/<plugin-id>/
  plugin.toml
  sources.ts
  agents/
    <agent-id>/agent.toml
  workflows/
    <workflow-id>/workflow.toml
  skills/
    <skill-name>/SKILL.md
```

Presence is the declaration: a folder or file being there is what contributes. Directory and manifest
ids use the validated path-id character set. Discovery rejects symlinks, unreadable paths and paths that
resolve outside the plugin root.

`plugin.toml` holds optional metadata plus declarative commands, channel config and external MCP tool
references:

```toml
id = "research-pack"
name = "Research Pack"
version = "1.0.0"

[[commands]]
name = "brief"
description = "Run the daily brief workflow"
target = "workflow"
workflow = "daily-brief"

[[channels]]
adapter = "telegram"

[channels.config]
markdown = true

[[tools]]
server = "research"
tool = "lookup"
```

A command with `target = "agent"` takes `agent` and `prompt` instead of `workflow`. Unknown manifest
fields fail strict validation. A missing manifest is valid: the plugin then contributes its
folder-discovered agents, workflows and skills, plus `sources.ts` when present.

### Trust model

| Contribution | Bundled (trusted) | Installed (untrusted) |
|---|---|---|
| Executable tools | allowed | structurally unavailable |
| Executable slash commands | allowed | structurally unavailable |
| Executable channel definitions | allowed | structurally unavailable |
| Agent TOML | allowed | allowed with untrusted restrictions |
| Workflow TOML | allowed | allowed; a workflow with a `schedule` is skipped |
| Skills directories | allowed | allowed and safety-scanned |
| Declarative commands and channels | allowed | allowed through runtime-owned handlers |
| External MCP tool references | allowed | allowed through the MCP trust boundary |
| Market-data `sources.ts` | allowed | only with `[plugins].allow_code = true` |

Installed discovery never creates executable tools or hooks from disk. Trust comes from object identity
in the bundled set, not from a manifest flag a plugin could claim.

An untrusted plugin agent's `tools = "*"` expands only to tools that can **never** require approval. A
tool with a call-level `requiresApproval` is left out too, since a listing has no input to test against.
A trusted agent expands to the whole registry. Untrusted plugins load only when
`[plugins].allow_untrusted = true`.

#### Market-data sources (`sources.ts`)

A plugin adds a market-data provider with `sources.ts` at its root. It is the one contribution that
runs plugin code from disk, so it needs `[plugins].allow_code = true`, a **separate** flag from
`allow_untrusted`. Running a plugin's code grants it everything the process can do. The declared
endpoint constrains an honest plugin, not a hostile one, so `allow_code` is the consent boundary and the
manifest is only for correctness. With the flag off, `sourceModules` is dropped from every discovered
plugin.

Module shape, pinned transport, route rules and failure handling (`trading.plugin_source_skipped`):
[Data sources](./data-sources.md).

### Collision policy

One registry owns each rule:

- executable tool, slash-command, CLI-command and channel ids are unique; duplicates throw `ConfigError`;
- an installed plugin whose id matches a bundled plugin is excluded;
- an untrusted agent cannot shadow an existing agent; it is skipped with a warning;
- a workflow whose id is taken is skipped with a warning;
- declarative command and channel collisions keep the first and skip the later one with a warning;
- invalid entries are skipped with scrubbed diagnostics where the boundary allows partial loading.

Plugins never silently override built-ins.

### Configuration

```toml
[plugins]
allow_untrusted = false
allow_code = false
dirs = ["~/.local/share/openalpha/plugins"]
```

`allow_untrusted` admits declarative content from installed plugins. `allow_code` is the narrower,
separate consent that lets one ship an executable `sources.ts`. Tools and hooks stay forbidden to
installed plugins whatever either flag says.

`dirs` defaults to empty, so nothing is discovered until you set one. `plugin install` and
`plugin update` write to the first entry. Paths resolve during boot and defaults apply once in the
resolved config. There is no per-plugin `enabled` list: installation, presence, trust, validation and
collision rules decide availability.

### CLI management

```text
openalpha plugin list
openalpha plugin install <source>
openalpha plugin update <id>
openalpha plugin uninstall <id>
```

Install and update validate ids and source transport (a manifest-less plugin's fallback id is the
repository name of its canonical URL, never the temporary clone directory's name), copy into the managed plugin root, and refuse to
uninstall bundled ids. `openalpha plugin --help` lists the exact flags.

### Boot sequence

1. Resolve plugin directories and trust config.
2. Discover installed plugin trees without running plugin code.
3. Parse manifests, agents, workflows, external MCP tools and skills as data.
4. Create the plugins provider from the bundled and installed sets.
5. Extend the tool, agent, workflow, command and CLI-command registries, and bind channel
   contributions, through their canonical merge functions.
6. Build run services only after the registries are complete.

Provider order in `app/providers.ts` is fixed. Plugin merging must not move after consumers have
captured a registry.

### Adding a bundled plugin

1. Create a frozen `Plugin` object with a stable id.
2. Keep executable code in its owning module; expose only public contracts.
3. Register the object in application composition.
4. Let the canonical registry merges enforce collisions and trust.
5. Add no plugin-specific switch to the generic loader.

A contribution that needs a new trust policy must first extend `PluginContributions` and its single
merge and enforcement path.

---

## Source map

- [src/index.ts](../../../src/index.ts): the SDK barrel
- [src/app/api.ts](../../../src/app/api.ts), [src/app/boot.ts](../../../src/app/boot.ts), [src/app/types.ts](../../../src/app/types.ts): `boot`, `main`, `BootOptions`
- [src/app/providers.ts](../../../src/app/providers.ts): the provider order and its constraints
- [src/app/extensions.ts](../../../src/app/extensions.ts): flat boot options lowered and validated
- [src/core/container.ts](../../../src/core/container.ts): `bind`, `extend`, `resolve`, `has`
- [src/plugins/api.ts](../../../src/plugins/api.ts): plugin discovery, install, merge, trust
- [src/cli/api.ts](../../../src/cli/api.ts): the `@openalpha/runtime/cli` entry
- [Agents](../agents.md), [Channels](./channels.md), [Data sources](./data-sources.md), [Internals](./internals.md)
- [AGENTS.md](../../../AGENTS.md): the module DAG, boundary rules and coding rules
