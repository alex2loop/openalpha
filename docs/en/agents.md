# Agents, teams and models

An agent is a TOML file, not code: a prompt, the tools it may use, and optionally a model. Every field in its
ceiling only narrows access. Nothing in the schema widens it, so a typo can never grant more than you meant.

This page covers writing an agent, building a team, giving agents skills, and choosing models.

---

## Writing an agent

Start from the annotated template, [agent.sample.toml](../../agent.sample.toml).

Built-in agents and bundled-plugin agents are trusted. Agents you write, in `<data_dir>/agents/<id>/agent.toml`,
are not. An untrusted agent cannot set `model_tier` or `reasoning`, and its `system_prompt` is scanned and
refused when it matches a blocked instruction pattern.

### Scaffold one

```bash
openalpha agent add web-researcher   # writes <data_dir>/agents/web-researcher/agent.toml
openalpha agent edit web-researcher  # opens it in $EDITOR
```

A missing `agents/` directory is normal, not an error.

`openalpha agent list` and `show <id>` inspect agents. `remove <id>` deletes one of yours and cannot touch a
built-in. `agent bind`, `unbind` and `bindings` map a channel chat to an agent - see [Commands](commands.md).

### The file

A working agent is this short:

```toml
id = "web-researcher"
name = "Web Researcher"
description = "Read-only web research assistant"

system_prompt = """
You are a focused research assistant. Use web tools to gather sources, store
findings in memory, and produce a concise summary. Do not write to disk.
"""

[capabilities]
tools = ["web_search", "web_fetch", "memory_store", "memory_recall"]
```

### Fields

The schema is strict: one unknown key invalidates the whole file. A typo'd capability key that was silently
ignored would read as a permission you granted.

| Field | Type | Default | Notes |
|---|---|---|---|
| `system_prompt` | string | - | **Required**, non-empty. |
| `id` | string | directory name | When declared, must equal the directory name. |
| `name` | string | `id` | Display name. |
| `description` | string | none | Shown when choosing delegation targets. |
| `max_turns` | positive int | `[loop].max_turns` from config | Per-run turn cap. Can lower the `[loop]` value, never raise it. |
| `max_tokens` | positive int | run ceiling: 8,192 plus headroom for `reasoning` | Per-call output-token cap. Can only lower that ceiling. |
| `max_duration_ms` | positive int | `[loop].max_duration_ms` from config | Per-run wall-clock cap. Can lower the `[loop]` value, never raise it. |
| `max_daily_usd` | number | none | This agent's share of the day, under `[budget] max_daily_usd`. See [Focus, spend and pause](#focus-spend-and-pause). |
| `[focus]` | table | none | What the agent looks at. See [Focus, spend and pause](#focus-spend-and-pause). |
| `model_tier` | string | none | **Trusted agents only.** Selects a `[model_tiers]` chain. |
| `reasoning` | enum | `'default'` | **Trusted agents only.** |
| `[capabilities]` | table | see below | Security ceiling; every field only narrows access. |

An id starts with a lowercase letter or digit and holds only lowercase letters, digits, underscores, hyphens or
dots, up to 64 characters. `default` is reserved. You cannot reuse a built-in or trusted-plugin id: the file is
skipped with an `agents.user_id_reserved` warning.

### Capabilities

An agent gets only what it names. Omit `[capabilities]` and it can call nothing. Set `tools = "*"` to grant
every registered tool.

| Field | Omitted | Empty | Present |
|---|---|---|---|
| `tools` | Deny all | Deny all | Allowlist, or `"*"` for every registered tool. An unknown tool name rejects the file. |
| `delegates` | No delegation | No delegation | Agent ids callable through `delegate`. Also list `delegate` in `tools`. |
| `hosts` | Any host the SSRF policy allows | - | Hostnames `web_fetch` may reach. `*.` matches the apex and its subdomains. |
| `skills` | All skills | - | SKILL.md names this agent may list and read. |

Omitted `tools` denies everything, while omitted `hosts` allows anything the SSRF policy permits. That is on
purpose: tools are the dangerous axis, so silence means no. A host list only narrows a policy that is already
enforced.

### Choosing the model

A user agent always runs the primary `[[models]]` chain. There is no per-agent model override for an untrusted
agent, because a dropped-in file could otherwise reroute your spend.

A trusted agent may set `model_tier` to a chain under `[model_tiers]`. The tier must exist and be non-empty,
and every entry must support tool calls when the agent has tools. A `model_tier` that contradicts the tier the
composition prefers is rejected, not ignored.

`/model` in a channel is session-scoped: it swaps the model for that one session from the global `[[models]]`
chain, keeps the other entries as fallbacks, cannot pick a tier, and does not persist. `openalpha provider list`
and `openalpha provider models` show what is available.

### When loading fails

One bad agent never stops the daemon from booting. Each file fails on its own and is skipped:

- malformed TOML, a schema violation, an `id` that differs from the directory, an unknown tool in `tools`,
  `model_tier` or `reasoning` on a user agent, a `max_daily_usd` above your `[budget]` cap, or a `system_prompt`
  the injection scan blocks - logged as `agents.user_load_failed`;
- a reserved-id collision - logged as `agents.user_id_reserved`.

### Runtime boundary

Each agent runs with file tools rooted at `<data_dir>/workspaces/<id>/` and its own memory scope. An approved
shell starts in that folder, but it is a working directory, not an operating-system sandbox.

### Focus, spend and pause

Three optional parts say how an agent sits beside your own book. `[focus]` and `max_daily_usd` are TOML keys
and go **above** `[capabilities]`. Written after it, TOML puts them inside it and the file is rejected.

**`[focus]` - what it looks at.** Leave it out and the agent shares your own focus: its calls drive your book,
exactly as `/suggest` does. Set it and the agent becomes a *second opinion*:

```toml
[focus]
markets = ["equity-vn"]   # markets your book trades
sectors = ["banks"]       # the market's sector slugs: banks, oil-gas, ...
horizon = "long"          # short | long: the window its calls are scored over
```

Focus only narrows:

- `markets` must be markets your book trades.
- `sectors` need a market that keeps sector data (today `equity-vn`). Names are the market's own slugs, listed by
  `market_sector_strength`. They are checked when a call runs, because sector lists are refreshed data: a name
  outside the focus is refused with the focus named.
- An empty `[focus]` narrows nothing and is refused.
- A table that is rejected skips that agent at boot (`agents.focus_invalid`).

A focused agent's calls are stored under their own `focus_key` and scored and reported apart. They never move
a held stop, raise one or fire an alert, and never reach the morning brief. They print as "a second opinion
from <focus>" with no size, quantity or order block - one book, one plan. `/suggest <name>` is always the call
that drives the book. A helper the agent delegates to keeps the agent's focus, so a helper's call never becomes a
book call by accident. Details: [trading](trading.md).

An agent whose `[focus]` sets only `horizon` gets its own key and runs on every market you have. Two agents with
the identical focus share one key, and so one record.

**Agreement.** `agent list` and `agent show` print, under each agent of yours: its focus, today's spend against
its cap when it has one, what its calls have earned across every focus it has used, and how often it takes the
action the *other* agents take on the same name and day. The rules, and the sample sizes below which only a
count is shown, are in [trading](trading.md).

**`max_daily_usd` - its share of the day.** Under `[budget] max_daily_usd`, an agent may carry its own ceiling.
See [per-agent cap](budgets.md#per-agent-cap).

**Pausing.** `openalpha agent pause <id>` switches one of your own agents off and `agent resume` turns it back
on ([Commands](commands.md)). Debate personas cannot be paused: it would break every suggestion.

- A pause is read on every run, so it reaches a running daemon at once, with no restart.
- A run in progress finishes. After that, the agent's next chat message, heartbeat and scheduled job are
  refused with "this agent is paused", and the CLI exits `16`.
- A scheduled job is skipped without counting a failure. A one-shot job waits for `resume`.
- If the pause state cannot be read, the agent counts as paused: a safety switch errs toward not running.
- `/agent <id>` on a paused agent still selects it and says it will not answer until resumed.

An agent with its own `[focus]` and only the allowed tools can join a social network such as Moltbook; see
[social networks](social.md).

---

## Teams and delegation

A **team** is one orchestrator agent plus the role agents it may call. There is nothing to create: the
orchestrator's `[capabilities] delegates` roster and the delegation tools are the whole contract. Teams are not
tied to a domain - code review, content, runbooks, anything that reads better as a few focused specialists than
one general chat.

### The pieces

| Piece | What it does |
|---|---|
| `delegate` tool | Calls one rostered sub-agent for a self-contained task and waits for the result. |
| `delegate_parallel` tool | One call for two or more independent tasks; waits for all results. |
| `[capabilities] delegates` | The roster of sub-agent ids this agent may call. Empty means no delegation. |
| `[loop] delegation_depth` | Max child levels from the top-level run. Default `3` allows depths 1, 2 and 3. |
| `[loop] max_delegations` | Total children one run may ever start, across both tools. |
| `[loop] max_parallel_delegations` | Max items in one `delegate_parallel` call. |

A rostered child uses its own tool allowlist: it may use a tool its parent cannot call directly, and a tool
missing from the child is blocked before approval.

Children share the parent's cancel signal and budget. Child sessions are fresh, private, temporary and never
written to the durable transcript. Children do not see the parent's transcript, do not talk to each other and
share no debate state. Only the orchestrator combines their results. For the money, see
[budget across a run tree](budgets.md#budget-across-a-run-tree).

### Reach for the smallest thing that works

More children is not more thorough. The model picks the smallest sufficient option:

| Need | What it does |
|---|---|
| Stable, simple or sequential reasoning | Answer directly. |
| A missing constraint would change the answer | Ask one clarification. |
| Current or external claims need multi-source evidence | Call `research`. Generic child output does not count as evidence. |
| One self-contained non-evidence specialist task | Call `delegate`. |
| Two or more independent specialist tasks | One `delegate_parallel` call. |
| Dependent specialist tasks | Keep them sequential; put the earlier result in the later brief. |

The parent writes one answer and labels any child work that failed, was rejected or was unavailable. It does not
retry by growing the team or repeating an unchanged call. Code, not the model, keeps authority over the roster,
tool permissions, approval, quota, depth, cycles, fan-out, budget, duration and cancellation. A persuasive
prompt cannot widen any of them.

Everything runs in the foreground. There is **no background task, research id, async control command or durable
resume**. Cancel the run (Ctrl+C, `/stop`, or a channel cancel) and every in-flight child stops. A research run
never saves its plan, working state or evidence, and cannot be resumed.

### `delegate` - one rostered role

The agent must be in the caller's roster. The result carries the child's `agent_id`, the stop `reason` and the
final `text`. Call it again when a later task depends on an earlier result; for independent work use one
`delegate_parallel` call.

Errors:

- unknown agent id - `invalid_input`;
- agent not in the caller's roster - `unauthorized`;
- self-delegation, an ancestor cycle or the nesting limit - `depth_limit`;
- fan-out quota used up (`[loop] max_delegations`) - `delegate_full`.

### `delegate_parallel` - several at once

Pass two or more independent items, each an `agent_id` plus a `prompt`, every target in the caller's roster.
More items than `[loop] max_parallel_delegations` is rejected with `delegate_full`, and the whole run is capped by
`[loop] max_delegations` across every delegation call.

The result has one entry per item, each with `agent_id`, stop `reason` and final `text`. Budget, approval and
runner failures stay visible, and an unexpected failure is isolated to its own entry instead of failing the batch.

### Approval never inherits

Nothing carries over to a child: not the parent's bypass mode, not a remembered approval in the parent's session,
not a direct MCP client's approval. One approved child call does not authorize the next. Rules:
[safety](safety.md).

How a dangerous child call gets approved depends on how you started the run:

- An interactive REPL turn always reaches a deny/once prompt, per dangerous call.
- An interactive `chat --message` (a terminal on stdin) does too, once approvals are open for that turn.
- A one-shot with piped or empty stdin has nobody to ask, so a delegated dangerous call fails as
  approval-unavailable **even when the parent runs `--mode bypass`**.

Do not put `delegate` or `delegate_parallel` in a sub-agent's tools unless you mean it to orchestrate in turn.
The `[loop]` limits bound recursion, but a roster you did not intend is still a roster.

### Authoring a team

1. **Role agents.** Each gets a focused `system_prompt` and a narrow `[capabilities] tools` allowlist. A role
   agent needs `delegate` only if it orchestrates.
2. **Orchestrator.** Add the delegation tools to `[capabilities] tools` and list the sub-agent ids in
   `[capabilities] delegates`.
3. **Bounds.** Set `[loop] delegation_depth`, `max_delegations` and `max_parallel_delegations` in `config.toml`.
4. **Models.** User agents use the global `[[models]]` chain. Only built-in and bundled-plugin agents may pick a
   `model_tier`.

End every sub-agent's `system_prompt` with this, so it stops writing for a human who is not reading:

```text
You are a sub-agent: the parent agent (not the end user) reads your output. Return only the result -- no preamble, no restating the task.
```

The orchestrator's prompt does not need to list its roles. The runtime adds a `<delegates>` block built from each
rostered agent's `description`, so write that field carefully: it is the only thing the orchestrator reads before
choosing. Each description is cut at 200 characters and the block at 4,096, with the first role always kept. An
agent with an empty or unresolved roster gets no block.

### Built-in agents

| Agent | Role |
|---|---|
| `chat` | Default general-purpose agent, with `reviewer` on its roster. |
| `deep-researcher` | Entry agent for deep research. Its only tool is `research`. |
| `reviewer` | Text-only, domain-agnostic critic. Returns `APPROVE` or a numbered revision list. |
| `research-planner` | Internal, tool-free. Produces distinct research questions. |
| `research-crawler` | Internal, tool-free. Extracts evidence from material the coordinator supplies. |
| `research-synthesizer` | Internal, tool-free. Writes the bounded cited report. |
| `research-reviewer` | Internal, tool-free. Scores a report against its evidence. |

The `research-*` workers are run by the research coordinator, with fixed profiles, only the tools their role
needs and empty rosters.

Trading adds trusted personas: the debate roles `bull-researcher`, `bear-researcher`, `portfolio-manager`,
`trader`, `risk-analyst`, `claim-verifier` and `market-analyst`, plus `theme-analyst` behind `/themes`, whose only
tool is `research`.

They are not a team: no agent rosters them and you cannot select them with `/agent`. The suggestion pipeline
schedules the debate roles directly, each with its own budget slice. `full` mode runs every debate role except
`market-analyst`; `lean` runs `market-analyst` plus `claim-verifier`. See [trading](trading.md).

### Research as a capability

`research` is read-only and does not trigger dangerous-tool approval. Whether an agent sees it is still decided by
its tool allowlist.

```text
/research Compare two approaches with current sources
/research thorough Compare two approaches with current sources
openalpha chat --agent deep-researcher
```

`/research` leaves your `/agent` binding alone ([Commands](commands.md)). `openalpha chat --agent
deep-researcher` is the explicit foreground entry.

Call `research` directly whenever current or external claims need multi-source evidence. A generic delegate may
critique or reshape the draft, but its output is untrusted tool content and is never admitted as research
evidence. For a quality pass, hand the finished draft to `reviewer` on the next turn.

### Recipes

**Parallel critique.** One `delegate_parallel` call with two items: one role builds the case *for* a proposition,
the other the case *against*. The orchestrator reads both and writes one balanced answer. It is the judge; there
is no shared debate state to referee.

**Multi-lens analysis.** One call, N items, each role looking at the same target through a different lens.
Results come back labeled by agent and the parent merges them.

**Multi-round refinement.** Each round is a fresh `delegate` or `delegate_parallel` call, with the previous
round's findings written into the new prompt. Turn, duration, budget and `max_delegations` limits bound the whole
thing.

**Self-review.** Delegate a draft to `reviewer`, then accept or revise:

```toml
[capabilities]
tools     = ["delegate"]
delegates = ["reviewer"]
```

```text
After producing your draft answer, ALWAYS delegate to `reviewer` with:
  "Original task: <restate>. Draft: <paste full draft>."
If reviewer returns "APPROVE", return the draft.
If reviewer returns a numbered list, address each item and revise.
On round 2+: "Revision round 2. Original task: <restate>. Prior revisions addressed: <one-line list>. Draft: <paste>."
```

Naming the prior revisions stops the loop grinding on nits for three rounds. Self-review is a role, not an
automatic hook, because it is worth paying for per task, not per turn: a fact-heavy brief benefits, "what time
does the market open" does not. Leaving the choice to the orchestrator means small talk costs one call, not two.

**A generic orchestrator**, as a starting point:

```toml
id   = "lead"
name = "Lead"
system_prompt = """
Coordinate a team. Direct-first:
- Answer directly if you can -- no delegation for small talk or facts you already hold.
- Use research, not a generic delegate, when current or external claims need evidence.
- Delegate ONLY non-evidence specialized work, to the narrowest role that fits.
- Pass each sub-agent a self-contained task slice -- never the whole conversation.
- Run two or more independent sub-tasks in ONE delegate_parallel call; keep dependent work sequential.
- Scale the roster to the work: one child for a self-contained task, two to four for genuinely independent parts. More children is not more thorough.
- Synthesize ONE answer and label unavailable child work. Never retry by adding agents or repeating an unchanged call.

You are a sub-agent: the parent agent (not the end user) reads your output. Return only the result -- no preamble, no restating the task.
"""

[capabilities]
tools     = ["research", "delegate", "delegate_parallel", "web_search", "memory_recall", "memory_store"]
delegates = ["role_a", "role_b"]
```

### Pointing a chat at a team

A channel uses its configured entry agent, falling back to `chat`. `/agent` is read-only for members; an operator
changes the per-chat binding, which survives restarts:

```text
/agent                 # show the current entry agent
/agent lead            # bind this chat to the `lead` orchestrator
/agent default         # return to the channel's configured default
```

Changing a binding cancels the old session's queued and active work and opens a fresh session for the new agent,
so a mid-conversation switch never leaves an orphaned run billing your budget.

### Where plugin agents fit

At boot, valid agents from `<data_dir>/agents/` are added after the built-in and plugin agents. Existing ids are
reserved and cannot be shadowed. A plugin's `agents/<id>/agent.toml` extends the same registry under the same
rule, and an untrusted agent that sets `model_tier` or `reasoning` is rejected.

Built-in tools register first, plugin tools extend them, and connected MCP tools are added last without
replacing a name that already exists. See [Plugins](dev/extending.md).

---

## Skills

A skill is an instruction package: content, not code. Skills are found in folders, offered to an agent as a short
index, and loaded in full only when the agent asks for one through `skill_view`.

### Layout

```text
<skills-dir>/
  <skill-name>/
    SKILL.md
```

`SKILL.md` is YAML-style frontmatter followed by Markdown:

```markdown
---
name: market-brief
description: Builds a source-backed market brief for one region. Use when the operator asks for a morning brief or a session recap.
metadata:
  version: "1.0.0"
  requires_tools: web_fetch
  platforms:
    - macos
    - linux
---

Instructions for the agent.
```

Names are lowercase kebab-case, up to 64 characters, and must equal the folder name: a skill filed under another
name is skipped. Descriptions are capped at 1,024 characters. Optional metadata: `version`, `author`, `license`,
`category`, `tags`, plus visibility keys `requires_tools`, `fallback_for_tools` and `platforms`, each as a comma
list, a bracketed list or a YAML block list.

### Write the description for the index

The description is the *only* thing the model sees before it decides to load the skill. Write it in the third
person: what the skill does, then "Use when" and the asks that should trigger it, in the words an operator would
type.

The index shows the first 200 characters, so the "Use when" clause must finish inside them. A description whose
trigger lands at character 240 is, to the model, a skill with no trigger.

### Where skills come from

**Embedded skills** ship inside the binary. Trading provides these: `behavioral-finance`, `capital-allocation`,
`correlation-analysis`, `crowding-and-unwind`, `crypto-analysis`, `crypto-execution`, `drawdown-response`,
`exit-management`, `gold-analysis`, `intrinsic-value`, `inversion`, `macro-liquidity-analysis`, `moat-analysis`,
`portfolio-risk-analysis`, `profit-taking`, `quality-screen`, `recover`, `research-scoping`,
`technical-analysis`, `track-record-reading`, `vn-daily-buy`, `vn-deep-dive`, `vn-dividend-analysis`,
`vn-earnings-playbook`, `vn-execution`, `vn-market-rules`, `vn-sector-rotation`, `vn-valuation`.

Those names are **reserved**. A folder skill that reuses one is rejected, not silently shadowed, so nobody can
replace `vn-execution` by dropping a folder in.

**Folder skills** come from one ordered list:

1. the managed skills folder under your data directory;
2. `[paths].skills_dirs` from your config;
3. skill folders contributed by loaded plugins.

Folders are de-duplicated without reordering. On a name collision the first wins, so your own skills beat plugin
skills. A missing folder contributes nothing and is not an error.

### Skill text is untrusted

A skill is instructions from somewhere else, and it is treated that way. Before indexing or loading, the runtime
rejects path traversal and symlink escape, validates the name, replaces a description flagged for prompt injection
with neutral text, strips fake chat-role lines from loaded bodies, and applies platform and tool-availability
rules. Only skills the active agent's profile allows are included.

None of that makes the text trusted. A skill cannot bypass tool authorization, approval, path, network, cost or
output-scrubbing policy. It is advice the model may read, not permission it has been granted.

### The index and `skill_view`

Bodies are never injected automatically. The agent sees a compact index and pulls what it needs. An agent's
`skills` allowlist narrows the set; with no allowlist there is no extra name filter, and visibility rules still
apply. The index appears only when the agent's tools include `skill_view`. It is capped at 8 KiB: a skill that no
longer fits is listed by name alone, and past that it is left out.

`skill_view` takes only a `name` and does not follow links to subfiles. A name the agent may not see, and a
missing or unsafe skill, both return `file_not_found`. An exhausted per-run view budget returns
`payload_too_large`; a delegated child starts with its own. A `SKILL.md` over 1 MiB is never loaded.

### Installing skills

Installation belongs to the CLI, not to any agent tool:

```bash
openalpha skill list
openalpha skill install <source> [--force]
```

`<source>` is a local path (a `SKILL.md` or its folder), an `https://` URL, or `gh:owner/repo/path` (no `.`, `..`,
empty or backslash segments). Content is scanned before anything is written, and the result counts for more or
less depending on where it came from:

- a local source always installs;
- a `gh:` source from a trusted owner installs unless the scan says `dangerous`;
- any other remote source installs only when the scan says `safe`.

`--force` overrides the scan and replaces an installed skill of the same name. A name reserved by an embedded
skill is refused before anything is written. Installs are tracked in a skills lockfile under your data directory.

Agents have no skill-management tool: they read what they may read and cannot install, update or delete anything.
A plugin's `skills/` folder goes through exactly the same discovery, safety, visibility and budget rules - plugin
origin grants no extra authority.

---

## Models and providers

OpenAlpha builds one ordered model chain at boot. The first entry is primary. The rest are infrastructure
fallbacks, not quality fallbacks.

### Configure a model chain

```toml
[model_defaults]
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY"
reasoning = "default"
provider_sort = "throughput"

[[models]]
alias = "primary"
model = "claude-sonnet-4-6"

[[models]]
alias = "fallback"
provider = "openrouter"
model = "anthropic/claude-sonnet-4.6"
api_key_env = "OPENROUTER_API_KEY"
```

`[model_defaults]` holds the keys every entry shares, and an entry's own value wins. Each `[[models]]` entry must
supply a model. [Configuration](configuration.md) lists every key, including the retry,
cooldown and rate keys under [`[llm]`](configuration.md).

An entry's selector is its `alias`, or `<provider>:<model>` when it has none. Selectors must be unique. The
environment variable named by `api_key_env` holds the key (unset, that entry steps aside: the daemon still starts and
warns, and anything that needs the model says which variable to set; see [Configuration](configuration.md));
plaintext keys are not accepted in model configuration. A server on this machine (a loopback `base_url`, such as Ollama or LM Studio) needs no
`api_key_env`.

Reasoning accepts `default`, `off`, `low`, `medium` or `high`. It is hidden, so you pay for it in latency and
tokens and never read it. At `high` a model that uses its whole budget spends roughly 20k thinking tokens and
two minutes per call; `medium` caps a call's output at 12,288 tokens. On Opus 5.5 and Fable 5, which cannot stop
thinking, `off` runs at `low` (logged as `ai.reasoning_downgraded`).

#### `provider_sort`

`provider_sort` is read only by routers that serve one model from several endpoints, which today means
OpenRouter. Every other provider ignores it.

Put it on `[model_defaults]` whenever the whole chain runs through one router. The endpoint an entry lands on can
differ from its neighbour by an order of magnitude in tokens per second - a bigger swing than any other key
produces. Choices are `price`, `throughput` and `latency`; absent leaves the pick to the router.

A sort *orders* endpoints, it does not pin one, and every call is seated afresh: six calls in one debate can land
on six endpoints. To constrain it:

- `provider_only` names the endpoint slugs a model may be served from;
- `provider_order` names the slugs to try in order;
- `provider_allow_fallbacks = false` fails the request instead of letting the router go outside that list.

Slugs are the router's own lowercase tags (`"deepseek"`, `"fireworks"`), not display names.

#### Under `mcp serve`

None of this applies to `[[models]]` when you run `openalpha mcp serve`: the connected client's model answers every
agent, so no key is read or required. Only tiers looked up by name, such as `decisions`, still consult config, and
a tier whose key is missing is skipped instead of failing boot.

### Subscription login (web auth)

Some providers authenticate with a consumer subscription instead of an API key. Those entries have no
`api_key_env`; credentials come from a browser login stored under your data directory.

```toml
[[models]]
provider = "openai-chatgpt"
model    = "gpt-5.6-terra"
```

```bash
openalpha auth login chatgpt      # opens the browser, listens on 127.0.0.1:1455 (or :1457)
openalpha auth status             # per-provider login state and expiry
openalpha auth logout chatgpt     # delete the stored tokens
```

The login saves `<data_dir>/auth/<provider-id>.json`, readable only by you: the access and refresh tokens, the
expiry, and the account id and plan read from the token. Tokens refresh silently five minutes before expiry. A
failed refresh counts as an authentication failure: that provider pauses for 15 minutes and the chain moves to the
next entry.

`auth` commands do not boot the runtime and need no config file. Without one, tokens land in the default data
directory; pass `--data-dir` to put them elsewhere.

Subscription turns are priced at `$0`, with `pricing_subscription` as the cost source. Tokens are still counted and
turn and duration limits still apply, but the spend never counts against daily, monthly or per-run caps.

Two limits come from the ChatGPT endpoint, not OpenAlpha:

- It rejects an output cap, so setting `max_tokens` on such an entry (or in `[model_defaults]`) is a configuration
  error, and a reply can run long.
- The signed-in plan decides which models you can use, so a model the catalog lists may still be refused for your
  account.

`openalpha doctor --online` reports the login state and runs a live probe of the configured model.

### Model tiers (optional)

A trusted agent selects a named fallback chain with `model_tier`. When the tier is absent, the agent or task that
wanted it falls back to the global `[[models]]` chain, and every entry in a tier must support tool calls. The tier
names, which role prefers each, and how a tier chain ends on the primary `[[models]]` entry are in
[Configuration](configuration.md). The trading debate roles prefer the `debate` tier when
`[[model_tiers.debate]]` is configured and otherwise run on the primary chain.

### When a model fails

For each call the preferred model goes first, then the other entries in the order you declared them.

- A temporary failure (5xx, timeout, dropped connection, empty reply) is retried on the same entry up to 2 times,
  starting at 500 ms backoff, then the next entry is tried.
- A rate limit, an exhausted output cap or a model-not-found skips straight to the next entry.
- A bad key or a billing failure pauses that provider and every model behind it for 15 minutes.
- A failing entry rests for 1 minute before it is tried again (longer if the provider says so).
- **Retry and fallback happen only before any content is shown or any cost is incurred.** After that, the call is
  not replayed: the alternative is paying twice for two answers to one question.
- A Claude safety refusal is a normal stop (`content_filter`), not an error, and the chain does not fall back.

Every surface reports a switch: channels post a notice, deep research raises a warning, and the CLI prints one
line per distinct switch above the run footer.

The full table is in [dev/agents.md](dev/agents.md#retry-fallback-and-cooldown).

### Prompt caching

Nothing to configure. Providers that cache on their own (OpenAI, DeepSeek, Gemini, Grok) reuse the shared start of a
prompt automatically, and OpenAlpha marks a reuse point for Claude on the direct Anthropic route and on OpenRouter.

- **What gets reused.** In chat, the tool list and instructions - about 15k tokens a turn. In the analyst debate,
  each role's playbook and fixed rules, identical for every ticker on one market.
- **When it pays.** A cache lives about five minutes and is read only by the endpoint that wrote it. A chat turn a
  few minutes later reads it. A morning brief's later tickers read what earlier ones wrote, while names debated at
  the same moment each pay for their own. OpenRouter keeps a debate role on one endpoint for up to ten quiet
  minutes. When a model's endpoints differ a lot in speed, pin the one you want with `provider_only` or
  `provider_order`.
- **What it costs.** Claude and the newer OpenAI models bill a cache write above the input price and a read at about
  a tenth of it, so a prompt nobody reuses costs slightly more than uncached. A prompt under the model's minimum is
  never cached: 1,024 tokens on Sonnet and OpenAI, 4,096 on Opus 4.5+ and Haiku 4.5. `anthropic/claude-3-haiku` is
  served only through Amazon Bedrock on OpenRouter and does not cache there at all.
- **How to see it.** `openalpha cost --breakdown` prints, per assistant and model, how many tokens came from cache.

### Pricing and limits

Cost uses the provider's own figure when it reports one, then pricing you set on the model, then the catalog price,
then a conservative fallback. A new model missing from the catalog bills at that fallback with a
`pricing.unknown_model` warning until you set `cost_input_per_m` and `cost_output_per_m` on its entry.

Before its first turn, a run waits up to 5 seconds for OpenRouter's price feed, so a one-shot `chat --message` is
not priced at the fallback and refused by a small daily cap. A model the feed publishes no price for, such as
`openrouter/auto`, still uses the fallback.

A per-minute rate limit applies across the process, with a fair share per agent and user pair. When it is full, the
run stops with the `rate` reason before any provider call.

### Failure behavior

| Condition | Result |
| --- | --- |
| Model chain is empty or ambiguous | Boot fails with a configuration error. |
| A model's key variable is unset | The daemon and every CLI command still run, and `start` prints one warning. The chain skips that model, and with none left a model call (chat, `/suggest`, the brief, a scheduled job that needs the model) says which variable to set; work that needs no model keeps running. |
| Preferred selector is not configured | Agent validation fails; no silent substitute. |
| Rate limit is full | Run halts with the `rate` reason before a provider call. |
| Retryable failure before output | Same entry retries, then eligible fallbacks are tried. |
| Authentication or billing failure | Provider is skipped for 15 minutes; later entries may run. |
| Failure after content or usage | No replay; incurred cost is kept. |
| All eligible entries fail | The final normalized error is returned. |
| Research tier entry or global fallback lacks tool support | Research reports `model_incompatible`; configure a tool-capable `model_tiers.research` entry. |
| Research gets repeated malformed web-tool arguments | Research reports `invalid_tool_arguments`, without claiming the provider lacks tool support. |

---

Internals: [dev/agents.md](dev/agents.md).
