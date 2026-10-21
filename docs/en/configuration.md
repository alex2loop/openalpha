# Configuration

Every TOML key, its default, and every environment variable. One file, read once at boot.

Two things to know first:

- **Config is read once, at boot.** Change something and restart the daemon. There is no live reload
  and no half-applied state.
- **An unknown key is an error.** A typo fails `config validate` instead of leaving a setting at its
  default for three months.

## Where the file lives

`~/.openalpha/config.toml` by default.

```bash
openalpha config path       # which file is actually read
openalpha config validate   # does it parse and resolve
openalpha config show       # the merged config, secrets redacted
openalpha config edit       # open it in $VISUAL or $EDITOR
```

`openalpha onboard` writes a starter file when none exists yet and the target is not a symlink. Run
on an existing config, it changes one part (model, Telegram bot, budget or language) and saves the
old file beside it first, because the rewrite drops comments.

Two templates to download: [config.minimal.en.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.en.toml)
works with just `OPENROUTER_API_KEY` and a 2 USD daily cap (its Vietnamese twin is
[config.minimal.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.toml)), and
[config.sample.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.sample.toml) lists every key with a comment.

## Precedence

Three separate questions, answered in this order.

**1. Which config file is read?**

```text
--config <path>  >  (--data-dir  >  OPENALPHA_DATA_DIR  >  ~/.openalpha) / config.toml
```

`--config` wins outright. Otherwise `--data-dir`, then `OPENALPHA_DATA_DIR`, picks the folder that
holds `config.toml`. `[paths].data_dir` cannot affect this: the file is not read yet. A missing
`--config` file is a hard error, never a silent fallback. There is no `./config.toml` in the current
folder.

**2. Where does state live?**

```text
--data-dir  >  OPENALPHA_DATA_DIR  >  [paths].data_dir in config.toml  >  ~/.openalpha
```

`[paths].data_dir` moves your data, just not the config file that contains it. `agent.toml` cannot
set it; agents inherit it from the process.

The two overrides differ: `OPENALPHA_DATA_DIR` moves the whole data folder, including where the
default config is looked up. `--config` moves only the config file.

**3. What wins inside the config?**

```text
the config file  >  built-in defaults
```

That is the whole stack. `agent.toml` is not an overlay: it can pick a `[[model_tiers.<name>]]`
chain and narrow what one agent may do, but it cannot touch global sections. See
[Agents](agents.md).

## Minimal config

```toml
[[models]]
provider = "anthropic"
model    = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"
```

## Full schema

### `[[models]]` (required, at least one)

The model chain. The first entry is the primary, the rest are fallbacks.

| Key | Type | Default | Notes |
|---|---|---|---|
| `provider` | string | - | Catalog provider id. Required here or in `[model_defaults]`. |
| `model` | string | - | The provider's own model id. Required on every entry. |
| `alias` | string, no spaces | - | Short selector used by `/model`. Unique across the chain. Without it the selector is `<provider>:<model>`. |
| `api_key_env` | string | - | Name of the environment variable holding the key. Unset or empty, `start` warns and runs without this model; other commands skip it. Required here or in `[model_defaults]`, except for subscription-login providers, providers signed in with a cloud account, and servers on this machine (loopback `base_url`, such as Ollama or LM Studio). |
| `base_url` | url | catalog endpoint | Endpoint override. Required for a provider with no default endpoint (such as `vllm`). |
| `reasoning` | `default \| off \| low \| medium \| high` | `default` | `default` leaves it to the provider; `off` asks it to disable reasoning; the others set the depth. |
| `max_tokens` | positive int | runtime limit | Output cap for this entry. |
| `provider_sort` | `price \| throughput \| latency` | router default | Routers only. Orders the endpoints serving the model. Every call is still seated afresh. |
| `provider_only` | string[] | - | Routers only. Endpoint slugs allowed to serve the model (OpenRouter `provider.only`). |
| `provider_order` | string[] | - | Routers only. Endpoint slugs to try, in order (OpenRouter `provider.order`). |
| `provider_allow_fallbacks` | bool | router default | Routers only. `false` fails the request rather than leave `provider_only` / `provider_order`. |
| `ttft_timeout_ms` | positive int | adapter default | How long to wait for the first stream event before failing over. At most 2147483647 (about 24 days). |
| `stream_idle_timeout_ms` | positive int | adapter default | Longest silence allowed between stream events. At most 2147483647 (about 24 days). |
| `reasoning_required` | bool | `false` | Set it when the endpoint rejects a "reasoning off" request (OpenRouter answers 400). A router cannot tell from the model name. |
| `cost_input_per_m` | number >= 0 | catalog price | Input USD per million tokens. Set together with `cost_output_per_m`. |
| `cost_output_per_m` | number >= 0 | catalog price | Output USD per million tokens. Set together with `cost_input_per_m`. |
| `cost_cache_read_per_m` | number >= 0 | - | Cache-read price, when you set explicit pricing. |
| `cost_cache_write_per_m` | number >= 0 | - | Cache-write price, when you set explicit pricing. |

Two entries with the same provider and model need different `alias` values.

Keys come only from the environment variable named by `api_key_env`. There is no plaintext key field
and no per-provider base-URL variable.

**Ollama.** A model served by Ollama gets the server's context window, a few thousand tokens unless
you raise it. A longer prompt is cut silently, so a debate can lose its evidence without an error.
Start the server with a bigger window: `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`.

**Subscription providers.** Their entries take no `api_key_env`; log in with `openalpha auth login <provider>` (for example `chatgpt`)
instead. They also reject explicit `cost_*` pricing (usage is free) and `max_tokens`, on the entry
or in `[model_defaults]` (the ChatGPT endpoint refuses an output cap). A missing login does not fail
boot; the error shows on the first call. See [Agents](agents.md).

**Cloud accounts.** Three providers can sign in with the cloud account you already use instead of an
API key. Set the variables each cloud's own tools read, and leave out `api_key_env`:

| Provider | Variables | `base_url` |
|---|---|---|
| `vertex` (Google Vertex AI) | `GOOGLE_APPLICATION_CREDENTIALS`, the path to a service-account key or to the file `gcloud auth application-default login` writes | required: `https://aiplatform.googleapis.com/v1/projects/<project>/locations/global/endpoints/openapi` |
| `azure-openai`, `azure-openai-responses` | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (a Microsoft Entra service principal) | required: your resource, such as `https://<resource>.openai.azure.com/openai/v1` |

An Azure entry that also has `api_key_env` uses the key. The token is minted on the first call and
renewed before it runs out; nothing is written to disk. A missing variable stops boot with the names
to set, and `openalpha doctor` shows the same line.

Amazon Bedrock needs no AWS signing: `bedrock` (Claude, Anthropic format) and `bedrock-openai` (the
OpenAI-format models) take a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK`. Both point at
`us-east-1`; for another region set `base_url` to `https://bedrock-mantle.<region>.api.aws/anthropic`
or `.../openai/v1`. Claude model ids carry Bedrock's `anthropic.` prefix, such as
`anthropic.claude-sonnet-5-5`.

### `[[model_tiers.<name>]]` (optional)

A named fallback chain that trusted agents can select. Each tier is an array of tables under
`model_tiers.<name>`. The first entry is the primary and the rest are tried in order. Entries follow
the `[[models]]` schema and inherit `[model_defaults]`. Every entry must support tool calls.

Every tier implicitly ends with the primary `[[models]]` model, so when all of a tier's entries fail
(provider gap, 404, timeout) the request falls back to the default model instead of aborting.

```toml
[[model_tiers.research]]
provider = "anthropic"
model = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"
```

A tier name starts with a lowercase letter, then lowercase letters, digits, `_` or `-`. An omitted
tier is an error only if a trusted agent selects it.

The debate roles prefer a tier named `debate`. With one configured, every role runs on that chain.
This is the place for an endpoint pin and tight stream timeouts, while chat keeps the primary chain:

```toml
[[model_tiers.debate]]
model = "deepseek/deepseek-v4.1-flash"
provider_only = ["deepseek"]
provider_allow_fallbacks = false
```

These names are looked up by name:

| Tier | Used by |
|---|---|
| `research-heavy` | `research-crawler` |
| `research` | `deep-researcher`, `research-planner`, `research-synthesizer`, `research-reviewer` |
| `delegate` | `reviewer` |
| `debate` | the trading debate roles |
| `themes` | the theme analyst behind `/themes`; every entry must support tool calls, since it may call `research` |
| `extraction` | the daemon's macro-extract task only, which reads VN macro figures from the statistics office's reports and the press |
| `decisions` | the headline read that runs before the debate |

Without its tier, an agent or task uses the global `[[models]]` chain. `decisions` is the exception:
without it the headline read is off and the debate groups headlines by the feed they came from. The
`deep-researcher` agent behind `/research` writes the report you read, so it runs on the `research`
tier rather than a cheaper chain that could garble the figures.

Under `openalpha mcp serve`, the connected client's model answers every agent, so `[[models]]` is not
read and needs no key. Only tiers looked up by name, such as `decisions`, still use config, and a
tier whose key is missing is skipped instead of failing boot.

#### Choosing a model per job

Every model must support tool calls and return JSON that matches the schema. A model that often breaks the schema
leaves suggestions inconclusive.

| Job | Tier | Pick |
|---|---|---|
| Chat, and anything without its own tier | `[[models]]` | A cheap, fast model such as `deepseek-v4-flash`. Add a fallback on another provider. |
| `/suggest`, the morning brief | `debate` | Start cheap. Through OpenRouter, pin the endpoint with `provider_only` as in the example above, since a random endpoint can be very slow. |
| `/research` | `research`, `research-heavy` | See below. The reviewer is the quality gate, so do not go too cheap. |
| `/themes` | `themes` | Like `research`: it needs tool calls. |
| Headline reads, macro figure extraction | `decisions`, `extraction` | A cheap model is enough: short jobs that only need exact figures and the right schema. |

A model change cannot be measured in advance, so change one tier at a time and watch the spend with
`openalpha cost --breakdown`.

#### Choosing models for the research tiers

Pick by workload, not by agent count:

- **`research-heavy` (crawler only).** One call per research question, with up to 8 retrieved
  sources cut to 4000 characters each - roughly 8-10k input tokens. Retrieval stores up to 64 KiB of
  raw text per source, but the model never sees that much. Output is capped at 12000 tokens. The
  crawler holds no tools and only extracts from supplied text, so it needs exact quote copying and
  strict JSON, not deep reasoning or a huge window. Its reasoning effort is fixed at `low`. Good
  fits: `claude-sonnet-4-6` (anthropic), `gpt-5.5` (openai); budget: `gemini-2.5-flash` (gemini).
- **`research` (planner, synthesizer, reviewer).** The synthesizer and reviewer each receive the
  whole evidence artifact, up to 128 KiB (about 32k tokens). Output is capped at 6000 tokens per
  stage. Planning and synthesis tolerate mid-tier models. The reviewer is the quality gate, so size
  the tier for it. Good fits: `claude-sonnet-4-6`, `gpt-5-mini` (openai); budget: `gemini-2.5-flash`,
  `deepseek-v4-flash` (deepseek).

Two rules of thumb:

- Put a tier's primary on a different vendor or route than the global primary, so one provider's
  outage does not take down chat and research together.
- Declare a cheaper or secondary route as the fallback entry.

### `[model_defaults]` (optional)

Fields every `[[models]]` and `[[model_tiers.<name>]]` entry inherits. The entry's own value wins.
It takes `provider`, `api_key_env`, `base_url`, `reasoning`, `max_tokens`, `provider_sort`,
`provider_only`, `provider_order`, `provider_allow_fallbacks`, `ttft_timeout_ms` and
`stream_idle_timeout_ms`, each meaning what it does in `[[models]]`. `model`, `alias`,
`reasoning_required` and the `cost_*` keys are per entry only.

An entry that names a different `provider` does not inherit `base_url` or the `provider_*` keys;
those belong to the defaults' provider. It still inherits `api_key_env`, but an unset variable is not
an error there. A server on this machine runs without a key, and a sibling endpoint of the same
vendor (`openrouter-decisions` beside `openrouter`) finds the router's key. Give any other hosted
provider its own `api_key_env`. `reasoning`, `max_tokens` and the two timeouts carry over.

### Agent `model_tier` (agent.toml only)

An agent profile picks one named chain with `model_tier`. This is the only way an agent chooses a
model chain; there is no per-agent `model` key. The tier must exist under `[[model_tiers.<name>]]`.

Only trusted profiles (built-in and bundled-plugin) may set `model_tier`. A user-written agent or an
untrusted plugin profile that declares it is rejected.

Without `model_tier`, the agent uses the `[[models]]` chain. A built-in role can carry its own
preference (the research workers prefer `research`), and an explicit `model_tier` cannot override it.

### `[llm]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `max_calls_per_minute` | int | `60` | Positive. Process-wide cap on model calls, with a fairness bucket per agent and user. |

Retry and cooldown timing is fixed. A call is retried up to 2 times with a 500 ms base backoff. An
entry (provider plus model) that exhausts transient retries cools for 1 minute. A whole provider that
refuses authentication or billing is paused for 15 minutes, then retried.

### `[budget]`

Spend caps: `max_daily_usd`, `max_monthly_usd`, `soft_warn_ratio` (0 to 1) and `max_per_run_usd`.
Every cap defaults to `0`, meaning uncapped. What each one bounds, the soft warning and the per-agent
cap are in [Cost and budgets](budgets.md).

### `[locale]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `language` | string | `vi` | `en` or `vi`. |
| `timezone` | string | host zone (`UTC` if none) | IANA name, for example `Asia/Ho_Chi_Minh`. New cron jobs snapshot this value unless `--tz` overrides it; interval schedules reject `--tz`. |
| `currency` | string | `VND` | ISO 4217 code (three capital letters). Trading's base currency; `onboard` asks it on first setup and writes it here. Fixed once your book has a profile: a later change is refused, and `doctor` names the mismatch on its `database` row. |
| `region` | string | `vn` | Home region; only `vn` today. A region needs a venue that trades its main market, so `global` (world gold, read for reference only) is refused. Its market is the default board, and a first profile seeds only its national segments plus crypto. |

All keys are optional. `[locale]` accepts no other keys. `currency` and `region` say where you are,
so trading reads them here rather than keeping copies under `[trading]`.

### `[paths]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `data_dir` | string | `~/.openalpha` | Root for state and runtime data, applied after the config loads. It does not select the config file. `--data-dir` and `OPENALPHA_DATA_DIR` override it. |
| `skills_dirs` | string[] | `[]` | Extra skill folders. `~` is expanded at boot. |

Layout under `data_dir`:

```text
{data_dir}/
  data/openalpha.sqlite             default SQLite database (data + memory)
  openalpha.pid                     daemon lockfile
  openalpha.ready                   written once the daemon is up; what it started without
  daemon.stdout.log                 a background daemon's stray output, truncated each start
  daemon.stderr.log                 a background daemon's warnings and errors, truncated each start
  logs/daemon.log                   default global log (`[log] file`)
  logs/agents/<agentId>/agent.log   per-agent run log, kept
  backups/                          `db backup` files, plus pre-migration/ and pre-rollback/ snapshots
    daily/                          the daemon's daily copies, newest `[retention] daily_backups` kept
  plugins/                          installed plugins
  workspaces/<agentId>/             private scratch folder per agent
    run/                            HOME of child processes; cleared only by a confirmed `workspace cleanup`
    tmp/                            temp dir of child processes; cleared by `workspace cleanup`, and once
                                    at startup for files older than `[retention].days`
```

Files in the workspace root are durable; routine cleanup never touches them. `workspace cleanup`
visits only `run/` and `tmp/`, never `logs/agents/`. File tools are confined to the agent's scratch
folder. `shell_exec` starts there, with `HOME` and temp dirs inside it, but that is a starting
directory, not OS confinement: an approved process can write elsewhere.

### `[storage]`

Two engines, picked by `engine`. Each takes its own keys; do not mix them. SQLite is the default
when the section is absent.

```toml
[storage]
engine = "sqlite"
# path = "data/openalpha.sqlite"
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `engine` | `sqlite` | `sqlite` | The embedded engine. |
| `path` | string | `data/openalpha.sqlite` under `data_dir` | `~/` expands to home, absolute stays absolute, relative joins `data_dir`. |

PostgreSQL needs both a variable name and a schema:

```toml
[storage]
engine = "postgres"
url_env = "OPENALPHA_DATABASE_URL"
schema = "openalpha"
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `engine` | `postgres` | - | Selects PostgreSQL. |
| `url_env` | string | - | Required. Environment variable holding the connection URL. |
| `schema` | string | - | Required. Lowercase PostgreSQL identifier, at most 63 characters. |

A missing or empty `url_env` fails config resolution. The URL is never written back into the config
you see.

### `[retention]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `days` | int | `90` | Positive. How long to keep inactive sessions and their routes, deleted memory entries, scheduler runs past the newest 200 per job, unclaimed inbox entries, pending pairings, fired or disabled alerts, and brief snapshots past the newest per language. |
| `inbox_days` | int | `7` | Positive. How long to keep completed and failed inbox entries, payloads included. |
| `daily_backups` | int | `3` | `0` or more. How many daily SQLite snapshots to keep in `backups/daily/`; `0` turns them off. PostgreSQL is skipped (use `pg_dump`). |

`days` also drives two file rules:

- At daemon startup, files in `workspaces/<agentId>/tmp/` older than `days` are removed once, before
  work starts.
- In the daemon's periodic sweep, a folder in `logs/agents/` whose agent is no longer configured is
  removed only when its newest log segment is older than `days`.

It does not apply to active global or per-agent logs (bounded by `[log].max_file_mb` and
`[log].max_files`), to workspace-root files, or to `workspaces/<agentId>/run/`. To delete per-agent
logs now, configured agents included, run `openalpha logs clear`. It does not touch the global log.

### `[log]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `level` | string | `info` | `debug`, `info`, `warn`, `error`, `fatal`. |
| `file` | string | `logs/daemon.log` | Relative paths join `data_dir`; absolute and `~/...` paths keep their meaning. Missing folders are created private; a folder that already exists is left as it is, but it must be yours and not writable by others. |
| `max_file_mb` | float | `50` | Size of the active file before it rotates. |
| `max_files` | int | `7` | Rotated files kept, besides the active one. |

Priority for the level: `--log-level`, then `OPENALPHA_LOG_LEVEL`, then `[log].level`.

### `[update]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `check` | bool | `true` | Ask GitHub twice a day whether a newer release is out. |
| `auto` | bool | `false` | Install patch releases (1.0.5 to 1.0.6, say) by itself between 00:00 and 06:00 on `[locale] timezone`, when the daemon runs in the background; never while a market you follow is in session, lunch break included (crypto trades around the clock, so it does not count). |

When one is out, the CLI prints a short notice after a command (at most once a day), chat shows it under the welcome, `version` and `doctor version` report it, the daemon logs it, the morning brief sent to a channel ends with it, and the bot mentions it in your private chat. Nothing installs until you run `openalpha upgrade` or `/upgrade confirm`, unless `auto` is on: then a background daemon installs a patch release by itself in that window, messages you when it is back (in the private chat you last wrote to it from), and goes back to the old release if the new one will not start. On a server, set `[locale] timezone` so the window falls at night. A source checkout never checks; under CI only `version` and `doctor --online` do.

### `[channels.telegram]`

The section enables Telegram unless `enabled = false`. A token is still required at start.

| Key | Type | Default | Notes |
|---|---|---|---|
| `enabled` | bool | `true` when the section exists | Channel switch. |
| `agent` | string | `chat` | Entry agent; `/agent <id>` can set a per-chat override. |
| `allowed_ids` | (string\|int)[] | `[]` | Starting allowlist of Telegram users and chats. |
| `operator_user_ids` | (string\|int)[] | `[]` | Users allowed to run operator-only commands. |
| `token_env` | string | - | Environment variable holding the token. |
| `token_file` | string | - | File whose trimmed contents are the token. |
| `typing_indicator` | bool | `true` | Show "typing" while generating. |
| `use_reactions` | bool | `true` | Use reactions as status cues where supported. |
| `markdown` | bool | `true` | Render Telegram MarkdownV2; `false` sends plain text, streamed replies included. |
| `require_mention` | bool | `true` | Require addressing the bot in groups. |
| `mid_stream_updates` | bool | `true` | Edit the reply while it streams. |
| `slash_commands` | bool | `true` | Enable slash commands and the command menu. |
| `notify_max_per_minute` | int | `3` | Rate cap on proactive messages. |
| `gap_note_ms` | int | `1800000` | Quiet milliseconds (30 minutes by default) after which the next answer is told to check prices again; `0` turns it off. |
| `fallback_chat_id` | string | the one allowed id, or the one paired chat | Fallback target for proactive messages. |
| `pairing` | bool | `true` with no allowlist | Let unknown chats pair. |

`token_env` beats `token_file`. There is no inline `token` key, and no token variable is read unless
`token_env` names it.

### `[channels.zalo]`

The section enables the Zalo bot unless `enabled = false` or `dm_policy = "disabled"`. It accepts the
delivery keys listed for Telegram, plus these. What a channel can do still depends on the transport;
see [Channels](channels.md).

| Key | Type | Default | Notes |
|---|---|---|---|
| `token_env` | string | - | Environment variable holding the token. |
| `token_file` | string | - | File whose trimmed contents are the token. |
| `allowed_ids` | (string\|int)[] | `[]` | Starting allowlist of chats and users. |
| `operator_user_ids` | (string\|int)[] | `[]` | Users allowed to run operator commands. |
| `dm_policy` | `pairing \| allowlist \| disabled` | `pairing`, or `allowlist` once `allowed_ids` is set | How chats are admitted, and the off switch. There is no open mode. |

Tokens resolve as for Telegram. The adapter polls, so at startup it clears any webhook set on the
bot: Zalo delivers to one or the other, never both.

### `[channels.zalo_personal]`

This adapter uses an unofficial personal-account API. It accepts the Telegram delivery keys except
the token keys and `pairing`. It is always allowlist-only and starts only when `i_accept_ban_risk`
is `true` and `allowed_ids` is non-empty. The risk is described in [Channels](channels.md).

| Key | Type | Default | Notes |
|---|---|---|---|
| `allowed_ids` | (string\|int)[] | `[]` | Required, non-empty allowlist. |
| `operator_user_ids` | (string\|int)[] | `[]` | Users allowed to run operator commands. |
| `i_accept_ban_risk` | bool | - | Must be exactly `true` to enable the adapter. |
| `profile` | string | `default` | Which saved QR login this channel uses. |

The key is `zalo_personal`, matching the channel id. Link the login with `openalpha zalo login`; it
is saved under `profile`.

### `[schedule]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `approval_timeout_ms` | int | `900000` | 15 minutes. How long a scheduled job waits for its channel approver. The answer is never saved. At most 2147483647 (about 24 days). |
| `failure_target` | string | - | `<channel>:<chatId>` that gets the notice when a job is disabled after failures. |

The scheduler checks for due jobs every 30 seconds, starts at most 5 per check, and runs at most 50
at once. Cron is minute-granular and `schedule run-now` skips the check, so a shorter interval would
buy nothing.

### `[loop]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `max_turns` | int | `40` | Hard cap per run. |
| `max_tool_calls` | int | `120` | Hard cap on tool calls per run. |
| `max_duration_ms` | int | `900000` | 15 minutes. Under `mcp serve`, 90% of it (at most 10 minutes) is how long one client answer may take. At most 2147483647 (about 24 days). |
| `approval_timeout_ms` | int | `120000` | 2 minutes; auto-deny on expiry. The duration cap pauses while a prompt is open. At most 2147483647 (about 24 days). |
| `delegation_depth` | int | `3` | Deepest sub-agent nesting. |
| `max_delegations` | int | `32` | Children a whole run may start, in total. |
| `max_parallel_delegations` | int | `5` | Most child items one `delegate_parallel` call accepts. |
| `max_unasked_fetches` | int | `10` | `web_fetch` calls in one run, asked or not, before every further one asks you first. `0` asks every time. |

Compaction is fixed: a session compacts past 500 messages or at 75% of the context window, at most 3
times per run.

### `[memory]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `ttl_days` | int | `90` | Default lifetime of expiring observations. |

A stored memory value is capped at 16 KiB.

### `[web_search]`

Configures the `web_search` tool. Omit the section to use DuckDuckGo. Under `openalpha mcp serve`
the section is ignored and no web tools are offered; the client brings its own.

| Key | Type | Default | Notes |
|---|---|---|---|
| `provider` | string | `duckduckgo` | `duckduckgo`, `anysearch`, `tavily`, `brave`, `deepseek`, `exa`, `serper` or `searxng`. |
| `api_key_env` | string | - | Environment variable holding the API key. Required for tavily, brave, deepseek, exa and serper; optional `ANYSEARCH_API_KEY` for anysearch. |
| `base_url` | string | - | SearXNG instance URL. Required for `searxng`, rejected for every other provider. The instance must enable the `json` format in `settings.yml` (`search.formats`). |
| `cost_per_search_usd` | float | - | Cost charged per query for `brave`, `deepseek`, `serper` and `tavily`, which bill but report no cost. DeepSeek is charged only when a search returns results, the way DeepSeek bills. Rejected for `duckduckgo`, `searxng` (free), `exa` (reports its own cost) and `anysearch` (reports zero). Set your plan's rate; `0` disables the charge. |
| `fallback_provider` | string | - | Second provider, tried after an error or empty result. Must differ from `provider`. The `fallback_*` keys need it. |
| `fallback_api_key_env` | string | - | Same as `api_key_env`, for the fallback. |
| `fallback_base_url` | string | - | Same as `base_url`, for a `searxng` fallback only. |
| `fallback_cost_per_search_usd` | float | - | Same as `cost_per_search_usd`, for the fallback. |
| `cache_ttl_ms` | int | `300000` | Result cache lifetime per query, in milliseconds; `0` disables caching. |
| `exa_search_type` | string | `auto` | Exa only: `auto`, `fast`, `instant`, `deep-lite`, `deep`, `deep-reasoning`. |
| `safe_search` | int | instance default | SearXNG only: `0`, `1` or `2`. Omitted keeps the instance setting. |

If `api_key_env` names a variable that is empty or unset, everything else keeps working and only
web search stops: the `web_search` tool and `/research` refuse and tell you which variable to set,
and they never fall back to DuckDuckGo on their own. `doctor`, `config validate` and `start` report
it too. If only `fallback_api_key_env` is empty, the fallback is dropped, the primary keeps working,
and `doctor` says the fallback is off. A key-requiring provider with no `api_key_env` at all is still
a config error.

SearXNG is keyless and self-hosted, and requests results in your `[locale] language`. A loopback
instance may use HTTP or HTTPS; a remote one must use HTTPS and is limited to its configured host.

`anysearch` uses the fixed endpoint `https://api.anysearch.com/v1/search` and can be the primary or
the fallback. `ANYSEARCH_API_KEY` is optional; without it you get anonymous access at a lower quota.
It returns at most 20 results, sends your `[locale] language`, and does not support recency, so a
requested recency is reported as unverified.

`deepseek` is the budget pick: about $0.75 per 1,000 searches, and an empty search costs nothing. It reads Vietnamese and English sources well, dates its results and honors recency, so "last week" really means last week. It shares `DEEPSEEK_API_KEY` with DeepSeek models; set `cost_per_search_usd = 0.00075` so the spend shows in your totals. DeepSeek takes short queries (128 characters). A long one is trimmed from the end but keeps the sites you chose; only a site list long enough to crowd out the question moves to filtering the results. Excluded sites are always filtered from the results, so you still get only the sites you asked for. DeepSeek takes no language, so a page's machine-translated copies (paths like `/nl/`, `/de/`) are dropped and only pages in your language are kept. Searches are paced to DeepSeek's limit of 5 a second.

Keys come only from the environment variables named by `api_key_env` and `fallback_api_key_env`.
A provider call times out after 15 seconds and retries transient failures up to 3 times from an
800 ms base backoff. A provider that fails 3 times in a row is skipped for 1 minute. The cache holds
100 entries per TTL, and each result snippet is capped at 400 characters.

| Provider | Env var | Sign up |
|---|---|---|
| `tavily` | `TAVILY_API_KEY` | https://app.tavily.com/ |
| `brave` | `BRAVE_API_KEY` | https://api-dashboard.search.brave.com/ |
| `deepseek` | `DEEPSEEK_API_KEY` | https://platform.deepseek.com/api_keys |
| `exa` | `EXA_API_KEY` | https://dashboard.exa.ai/ |
| `serper` | `SERPER_API_KEY` | https://serper.dev/ |

### `[api]`

The HTTP/WS API (`/v1`) that client apps talk to. `openalpha start` serves it when `enabled = true`;
a one-off command never opens the port. It binds `127.0.0.1` only and refuses every other peer, so a
client on another machine connects through an SSH tunnel or a reverse proxy on the same host (see
[Operations](operations.md)).

The token is the `token_env` variable if set, otherwise the file `auth/api/token.json` (created on
first start, mode 0600). If `token_env` is set but the variable is empty or shorter than 32
characters, the API stays closed (the saved token never stands in) and `start` warns while the rest of
the daemon runs; a port already in use still stops the start. `openalpha api token` prints the token; `openalpha api rotate`
replaces it.

| Key | Type | Default | Notes |
|---|---|---|---|
| `enabled` | bool | `false` | Master switch. |
| `port` | int | `8765` | TCP port, 1024-65535. |
| `token_env` | string | - | Environment variable holding the bearer token. When set, the file token is ignored. |

### `[[mcp.servers]]`

External MCP tool servers. At boot, all are connected and discovered in parallel, each with a
deadline; a server that fails is logged and skipped. Its tools are named `mcp__<name>__<tool>`.

A server that drops mid-session is redialed by the next call to it, never by a timer, and at most
once every 30 seconds. Until then the call fails with "The tool server isn't responding right now".
If it returns with a different tool list, calls keep failing until the list matches again or you
restart, because an agent's tools are fixed at boot.

`transport = "stdio"` takes `command`, `args` and `env`; `transport = "http"` takes `url`. Do not
mix them in one entry.

```toml
[[mcp.servers]]
name = "everything"           # unique; used as the tool-name prefix
transport = "stdio"           # spawn a local process
command = "npx"
args = ["-y", "@modelcontextprotocol/server-everything"]
# env = { API_KEY = "${MY_SERVER_KEY}" }   # ${NAME} is filled in at boot
enabled = true

[[mcp.servers]]
name = "remote"
transport = "http"            # Streamable HTTP
url = "https://host/mcp"      # must be http: or https:
enabled = true
```

Placeholders use `${NAME}`, where `NAME` matches `[A-Za-z_][A-Za-z0-9_]*`. When the variable is unset
or empty, `start` skips that server with a warning and `config validate` lists the missing key. A
placeholder that is not a valid name stops boot.

| Key | Type | Default | Notes |
|---|---|---|---|
| `name` | string | - | Unique server id; becomes the tool-name prefix (`mcp__<name>__*`). |
| `transport` | string | - | `stdio` (spawn a local process) or `http` (Streamable HTTP). |
| `command` | string | - | `stdio` only: the executable. |
| `args` | string[] | `[]` | `stdio` only: arguments. |
| `env` | map | `{}` | `stdio` only: extra environment variables; `${NAME}` is filled in at boot. |
| `url` | string | - | `http` only: server URL, `http:` or `https:`. |
| `enabled` | bool | `true` | `false` disables the entry without removing it. |

MCP tools are external, so every call needs approval (see [Safety](safety.md)). To limit which MCP
tools an agent may call, use `[capabilities] tools` in `agent.toml`.

### `[plugins]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `dirs` | string[] | `[]` | Folders scanned for installed plugins. |
| `allow_untrusted` | bool | `false` | Allow loading installed plugins from `dirs`. Bundled plugins are loaded separately. |
| `allow_code` | bool | `false` | Allow an installed plugin's data-source code to run. Separate from `allow_untrusted` because running plugin code grants it everything the process can do. Tools and hooks stay forbidden either way. |

### `[social]`

Agent social networks your own agents may join; see [Social networks](social.md). Every key is
optional. An unknown key or a refused tool name fails boot.

| Key | Default | Meaning |
|---|---|---|
| `allowed_tools` | `[]` | Exact tool names added to what a networked agent may hold. Tools that write, run commands, schedule or delegate, external tools, and the book, order and file tools are refused. |
| `heartbeat_interval_ms` | `7200000` | Time between one agent's visits to one network; at least one minute. `social join --every` sets it for one agent. |
| `active_hours` | `""` | `"07:00-23:00"` in your `[locale] timezone`; empty means all day. A window that ends before it starts crosses midnight. |
| `max_posts_per_day` | `8` | Posts per agent and network. |
| `max_comments_per_day` | `40` | Comments per agent and network. |

Every other bound is a fixed rule; [Social networks](social.md) lists them.

### `[capabilities]` (agent.toml only)

The per-agent ceiling (`tools`, `delegates`, `hosts`, `skills`) lives in `agent.toml`, not
`config.toml`, and only ever narrows access. See [Agents](agents.md).

## Environment variables

### Config resolution

| Variable | Effect |
|---|---|
| `OPENALPHA_DATA_DIR` | Overrides `data_dir` unless `--data-dir` is given. The default config path follows it. |
| `OPENALPHA_LOG_LEVEL` | Sets the log level unless `--log-level` is given (see [`[log]`](#log)). One of `debug`, `info`, `warn`, `error`, `fatal`. |
| Any variable named in config | Read through `api_key_env`, a channel `token_env`, the API `token_env`, or the web-search `api_key_env`. |
| Variable named by `storage.url_env` | Supplies the PostgreSQL connection URL at boot. |

Each model reads exactly the variable its `api_key_env` names, with no fallback list. Common choices:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`.

### CLI

| Variable | Effect |
|---|---|
| `NO_COLOR` | Disable ANSI color. |
| `FORCE_COLOR` | Force ANSI color even when stdout is not a terminal. |
| `HOME` | Your home folder (used when printing paths). |
| `VISUAL` | Preferred editor for config and agent edit commands. |
| `EDITOR` | Fallback when `VISUAL` is unset. `config edit` falls back to `nano` when neither is set. |
| `LC_ALL`, `LC_CTYPE`, `LANG` | A value naming UTF-8 lets the CLI draw Unicode progress glyphs; otherwise it uses ASCII. The language comes from `[locale] language`, never from these. |

`--quiet` and `--verbose` control output detail; no variable is involved.

## Provider catalog

OpenAlpha ships a catalog of providers and models. `openalpha provider list` shows the providers and
`openalpha provider models` shows models and pricing. Your config still states each model's
`provider`, the provider's own `model` id and `api_key_env`.

Catalog shortcuts, for example:

| Shortcut | Resolves to |
|---|---|
| `claude-opus` | `anthropic / claude-opus-4-7` |
| `claude-haiku` | `anthropic / claude-haiku-4-5` |
| `claude` | `anthropic / claude-sonnet-4-6` |
| `opus` | `anthropic / claude-opus-4-7` |
| `gpt` | `openai / gpt-5.5` |
| `gpt-mini` | `openai / gpt-5-mini` |
| `o1` | `openai / o1` |
| `o3` | `openai / o3` |
| `grok` | `xai / grok-4.3` |
| `auto` | `openrouter / openrouter/auto` |
| `claude-via-openrouter` | `openrouter / anthropic/claude-sonnet-4-6` |
| `gemini-flash` | `gemini / gemini-2.5-flash` |
| `deepseek-flash` | `deepseek / deepseek-v4-flash` |
| `deepseek-pro` | `deepseek / deepseek-v4-pro` |
| `ernie` | `baidu / ernie-4.5-turbo-128k` |
| `moonshot` | `kimi / kimi-k2-turbo-preview` |
| `glm` | `zai / glm-4.6` |
| `llama` | `ollama / llama3.3:70b` |

`openalpha provider models` prints the full list.

## Approval modes

The approval mode (`manual`, `bypass` or `unavailable`) is set per run, not in `config.toml`. What
each mode does, what `remember` covers, and how the prompt reads on each surface are in
[Safety](safety.md). The timeouts that bound a prompt are `[loop] approval_timeout_ms` and
`[schedule] approval_timeout_ms`.

## `[trading]`

Optional subsections: `suggestions`, `markets`, `briefs`, `intraday`, `alerts`, `orders`, `venues`,
`refresh`, `sources`, `themes` and `typed_prices`. Every key has a default. An unknown key is a boot error.

```toml
[trading.suggestions]
cooldown_sessions = 0          # sessions before the same name may be suggested again; 0 = every one
debate_mode = "full"           # full: bull, bear, manager and trader; lean: one analyst, cheaper

[trading.markets.equity-vn]
holidays = ["2027-01-01"]      # exchange closures announced after your build shipped
maximum_stop_loss = 0.08       # the stop never sits more than 8% below entry (0.02-0.30)
stop_loss_atr = 3              # stop distance in average daily ranges (1-5)
reward_risk = 3                # target as a multiple of the risk (1-5)

[trading.briefs]
send_time = "08:15"            # default for a delivery that has not set its own in chat

[trading.intraday]
send_times = []                # HH:MM pushes in the market's timezone; empty = off (the default)

[trading.alerts]
breakout_range = 1.5           # average daily ranges a move must span before a watchlist alert
breakout_sessions = 14         # settled sessions the average daily range is measured over

[trading.typed_prices]
confirm_multiple = 10          # ask before saving a typed price this many times from the market

[trading.orders]
maximum_stake_quote = 0        # 0 = uncapped; estimated notional in USDT on okx and binance
maximum_open_trades = 0        # 0 = uncapped; open positions plus orders not yet in the book
maximum_price_drift = 0.005    # a fraction, not a percent: 0.005 is half a percent
allow_unattended = false       # permit an order when approval mode is "bypass"
require_stop_loss = true       # refuse a buy that names no stop-loss

[trading.venues.binance]       # everything about one venue lives in its own table
default_for = ["crypto"]       # markets this venue books when a row names no venue
fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }
credentials = { apiKey = "BINANCE_API_KEY", secret = "BINANCE_API_SECRET" }  # variable names only
simulated = false              # demo-api.binance.com when true

[trading.venues.okx]           # built in, no default market; default_for = ["crypto"] would take it
fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }
credentials = { apiKey = "OKX_API_KEY", secret = "OKX_API_SECRET", passphrase = "OKX_API_PASSPHRASE" }
simulated = false              # place against the exchange's demo environment

[trading.venues.vps]
fees = { buy = 0.0015, sell = 0.0015, sell_tax = 0.001 }

[trading.venues.gold-shop]
fees = { buy = 0, sell = 0 }

[trading.venues.ssi]           # not built in: a broker you trade by hand
default_for = ["equity-vn"]    # replaces vps as the default for VN stocks
fees = { buy = 0.0015, sell = 0.0015, sell_tax = 0.001 }

[trading.refresh]
interval_ms = 43_200_000       # ceiling only; refresh follows the trading calendar

[trading.themes]
maximum_cost_usd = 1.0             # most one /themes run may spend, research included
```

A venue table takes `default_for`, `markets` (hand-traded venues only), `fees` and, for OKX and
Binance, `credentials` and `simulated`. `okx`, `binance`, `vps` and `gold-shop` are built in with
their markets and the published fee rates above, so a table for one of them states only what you
change. `openalpha config validate` checks all of this.

### A broker you trade by hand

Any venue id that is not built in is a hand-traded venue: a custodian your ledger records against and
that order routing never picks. Once `[trading.venues.ssi]` exists, `/record deposit ssi ...` and
`/record buy ssi equity-vn:FPT ...` work, and the venue prints as `SSI`. It must hold at least one
market and must declare `fees`:

- Its markets are `markets` if given, else `default_for`. Set `markets` only for a venue that holds a
  market it is not the default for, such as a second VN broker beside `vps`:
  `[trading.venues.tcbs] markets = ["equity-vn"]`.
- `fees` is required. Without it every fee would book as zero and understate each cost basis, so a
  missing `fees` is a boot error naming the venue.
- `credentials` and `simulated` are refused: with no adapter there is nothing for them to configure.
- A built-in venue may not set `markets`; the build fixes them.

### Default venue per market

Built-in defaults: `equity-vn` at `vps`, `gold-vn` at `gold-shop`, `crypto` at `binance`. World gold
(`gold`) has no venue. It is read for reference (its price, and the premium `gold-vn` is quoted
against), so its segment stays off and `/profile enable gold` is refused.

A venue's `default_for` overrides the built-in default for that market, and decides whose fees a
suggestion is weighed and graded on. Two venues claiming one market is a boot error naming both, and
so is a venue claiming a market it does not hold.

Changing the default venue moves nothing already recorded. Set `[trading.venues.sjc] default_for =
["gold-vn"]`, for example: new gold lines that name no venue book at `sjc`, while the gold and cash already
recorded at `gold-shop` stay there, since assets cannot move between venues. Sell those by naming the venue
(`/record sell gold-shop SJC 1 145000000`), or move them for good by changing each old row to `sjc` with
`/update`. `gold-shop` stays available; with nothing recorded there it can simply be left alone.

### Fees

`fees` is where every fee figure in the product comes from.

- Each rate is a **fraction of notional, never a percent**: `0.0015` is fifteen basis points. Each
  is capped at `0.05`, because a rate that high is a misplaced decimal.
- `sell_tax` is the statutory share of a sale, absent in a market that levies none. Wherever one
  number is shown it is folded into the sell rate, since a ledger row carries one fee netted from
  proceeds.
- Fees are set **per venue, not per market**. The same coin on two exchanges pays two schedules, and
  `/record` reads the rate off the venue named on the row.
- `fee_asset` says which side of a **buy** the venue charges its fee on. `quote` (the default)
  bills the money spent and delivers the whole ordered quantity. `base` takes the fee out of the
  coins, so fewer arrive than were ordered - the default on most crypto exchanges. A sell is always
  billed in the proceeds, so the setting never applies to one.
- A `base` venue's shortfall is never derived from these rates, because only the exchange knows
  whether an order filled as maker or taker. The rates price an omitted fee, never a quantity.
  How the quantity is read from the exchange is in [Trading](trading.md).
- A venue's `fees` is **replaced as a whole**, not merged. An override that omits a key the built-in
  entry sets (`sell_tax` for `vps`, `fee_asset` for `okx` and `binance`) is refused at boot, naming
  the missing keys. Otherwise a `vps` override with only `buy` and `sell` would book every sale
  untaxed.
- The shipped rates are published retail figures: VPS brokerage plus the statutory sell tax, and the
  OKX and Binance taker rates. A resting limit order is billed at the maker rate, and either figure
  is wrong on a different fee tier. That is why every confirmation states the rate it used.
- A gold shop (SJC, PNJ, DOJI) charges no commission, since its spread is the gap between its two
  prices, so its default is zero.
- `/suggest` names an instrument, not a place to trade it, so its cost line appears only where
  exactly one venue can fill in that market. The mean of two fee schedules is a number no venue
  charges.

### Orders and venue credentials

`[trading.orders]` alone decides whether an order may be placed at all. A cap of `0` means uncapped.
`maximum_price_drift` is a **fraction**: `0.5` means fifty percent, not half of one.

`allow_unattended` exists because approval mode `bypass` lets a call through before the approval
gate is consulted. Placing an order unattended therefore takes two decisions from you, not one; see
[Safety](safety.md).

`credentials` holds **variable names**, never values. The key names are the venue's own: `okx` takes `apiKey`, `secret` and `passphrase`, `binance` takes `apiKey` and `secret`, and any other field stops boot with the ones the venue takes named. Each is read
as the named variable or, failing that, the same name prefixed with `OPENALPHA_`. A missing one is
not a boot error: the venue gets no adapter, no order can be placed, `/trade` only names the keys to
set, and the daemon starts anyway. The venue stays registered as a custodian you record trades
against; it is just never picked for routing.

`simulated` is not a dry run. The adapter still signs, submits and polls a real API in the
exchange's demo environment (`demo-api.binance.com` for Binance), so it needs demo keys, and no fill
is ever made up locally. A venue with no demo environment ignores the flag. What Binance lists is
always read from the live board, so the screen sees the real market either way. The walkthrough is
in [Trading](trading.md).

### Schedules and defaults

Only the refresh loop has a cadence you can set: `[trading.refresh] interval_ms` (at most
2147483647). It is a
**ceiling, not a period**. Refresh follows each market's session close and open; the interval applies
only to continuous markets and to an empty registry. Everything else is paced by what it costs or
guards, so there is nothing to set:

- the alert loop (delivery, exit arming and breakout arming): every 60 seconds;
- order reconciliation: resting exits every 60 seconds, missed fills every 5 minutes;
- briefs, outcomes, the factor log, macro extract and theme outcomes.

`intraday` fires at the times in `[trading.intraday] send_times`, not on an interval.

`send_time` is a **default**. `/brief enable 07:30` stores its own time on the delivery row, and only
a row with no time of its own follows this key. A brief is always scheduled in the **market's**
timezone, taken from the calendar that owns `[locale] region`, never from `[locale] timezone`
(where you are). An operator in London does not get a brief at 15:15 Hanoi time.

The profile watchlist is the only configured instrument list. Quotes and the brief's suggestion
sections derive from it and from what the book holds.

All trading loops start automatically and do nothing when there is no eligible work. The exception
is exit reconciliation: with no exchange credentials no venue has an adapter, so nothing rests to
reconcile and that loop is never created. Refresh always covers every registered market that can
refresh. Naming a subset would silently starve a market you still trade.

### What config does not control

**No scoring parameter is configurable.** Lookbacks, thresholds and factor weights live in code with
the market that owns them, so two installs on the same version score the same input the same way.
Config decides what runs and when, plus three things that are yours to judge:

- **When an alert interrupts you.** `[trading.alerts] breakout_range` and `breakout_sessions` set how
  far a watchlist name must move before you hear about it. A higher range makes alerts rarer and
  changes no score.
- **When a price you type is questioned.** `[trading.typed_prices] confirm_multiple` sets how many
  times above or below the name's latest price a price in `/record`, `/update` or `/alert` must sit before
  you are asked to confirm it (default 10). It changes no score.
- **How far your stops and targets sit.** Under `[trading.markets.<id>]`, `maximum_stop_loss` (a hard
  ceiling, as a fraction of entry), `stop_loss_atr` and `reward_risk` replace the market's own stop
  width and reward multiple. Setting any of them starts a separate track record for that market.
  What the ceiling does to the target, the size and a stop you already hold is in
  [Trading](trading.md). Crypto also rests a buy that ran 25% or more in a week half an ATR under the
  live price; that is market policy, not a key.

**The calendar is fixed per market, with one setting.** Session hours and the weekend are in code,
and each market ships its own table of exchange closures. `[trading.markets.<id>] holidays` adds
closures announced after your build shipped. It adds to the built-in dates and never replaces them. A
date on the market's own weekend is a typo and fails boot. Boot warns (`trading.holidays_outdated`)
when a market's table ends before the current year.

Sessions are counted after the fact: a session is a day that produced a bar. So outcome resolution
and T+2 settlement read observed history, not a projected calendar. Settlement falls back to weekday
arithmetic only past the last observed session. Only the brief scheduler looks ahead, and it needs
just one answer: did the previous session trade?

## Source credentials

Endpoints, rate limits, RSS feed URLs, timeouts, byte caps, breaker cooldowns, retry policy and the
market-data retention window are not your choice. They are provider facts or internal tuning, and
they live in code. No config can point a source at another host.

The one thing you can change is the name of the environment variable a source reads its key from.
Of the built-in sources only `fred` and `coingecko` take a credential, and `[trading.sources]`
renames the variable for one of them:

```toml
[trading.sources]
coingecko = "OPENALPHA_COINGECKO_API_KEY"
```

The key is a source id and the value is a variable name, never a secret. Renaming a source that takes
no credential is a boot error naming it. A source whose variable is unset is simply not registered,
so running without keys is a supported reduced mode. The default names, the `OPENALPHA_` fallback
and the failover are in [Data sources](data-sources.md).

Market-data retention is derived, not configured: the longest evidence window any registered market
declares, converted to calendar days through that market's weekend rule, plus a margin.

A top-level `[sources]` block is a **boot error**. So is any section no module claims, the same way
an unknown key inside a claimed section is.

## Validation errors

`config validate` runs the same checks as boot: parse, resolve, then `[trading]`, `[channels.*]`
and any section nobody owns. A config it accepts is a config that boots. The API's config validate and save use the
same checks. A config value that names an unregistered market, venue or default region fails here
too, not on first use. An unset key for a model whose chain still has another model to answer is a
warning, and the run does not fail on it.

Every error is reported in your `[locale]` language and names the setting to fix. One run lists every
problem in the file (up to 8, the rest as a count), so you fix them in one pass before running again.
A misspelt key gets the nearest known name, for example `max_daly_usd` suggests `max_daily_usd`.
`config validate` also checks each `[[models]]` provider name against the catalog, and reports an
unset key variable as one item in the same list instead of stopping there. `--verbose` adds the full
list of schema issues. A missing key variable comes with the command that stores it:
`openalpha key set NAME`, the same on every platform. It keeps the key in `<data dir>/env`, which every
command reads at start. A variable set in your environment wins over the file. The file holds service
keys only, brand-prefixed ones such as `OPENALPHA_OPENROUTER_API_KEY` included: names that steer
OpenAlpha itself (`OPENALPHA_DATA_DIR`, `OPENALPHA_LOG_LEVEL`) or how programs start (`PATH`,
`NODE_OPTIONS`, `LD_*` and the like) are skipped, and `#` after a space starts a comment. The key file follows
`--data-dir` or `OPENALPHA_DATA_DIR`, never `[paths] data_dir`, since it is read before the config is. A missing model key stops only what needs the model:
`status`, `stop`, `/price`, `/portfolio`, `/record` and the other free commands still run, and
`openalpha start` starts with a warning, running everything that needs no model until you save the key
with `openalpha key set <NAME>` and run `openalpha restart --background`.

```text
config.toml has things to fix:
- `loop.max_turns`: it should be greater than 0
- `budget.max_daly_usd`: that is not a setting I know. Did you mean `max_daily_usd`?
Correct them, then run again.

ANTHROPIC_API_KEY is not set, so model anthropic/claude-sonnet-4-6 cannot start yet. Save it with `openalpha key set ANTHROPIC_API_KEY`, then try again.
```
