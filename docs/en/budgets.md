# Cost and budgets

Every model call costs money. OpenAlpha estimates the cost before it spends, records what actually happened, and
stops when a limit is reached, not after it.

Caps are opt-in. With none set, spend is not capped. It is only tracked, so you can always find out what it cost.

`openalpha onboard` and the minimal starter configs set `max_daily_usd = 2`, so your first week cannot surprise you.
Once you know your usage, raise it or set it to `0`.

Search providers share the same ledger (the running record of every charge). Exa's reported charge lands in the same
totals as model spend. So does the `[web_search] cost_per_search_usd` you set for Brave, DeepSeek, Serper or Tavily.

## Setting a limit

Put the caps in `config.toml` and restart. Configuration is read once at boot.

```toml
[budget]
max_daily_usd   = 5
max_monthly_usd = 50
soft_warn_ratio = 0.8
max_per_run_usd = 0
```

| Setting | Default | Meaning |
| --- | ---: | --- |
| `max_daily_usd` | `0` | Most you can spend in one day. `0` means uncapped. |
| `max_monthly_usd` | `0` | Most you can spend in one calendar month. `0` means uncapped. |
| `soft_warn_ratio` | `0.8` | One warning per process and period, when projected spend reaches this fraction of the cap. |
| `max_per_run_usd` | `0` | Most one top-level run may spend, together with all the work it delegates. `0` means uncapped. |

A workflow run counts as one run. All its steps and retries share one `max_per_run_usd` cap.

A day and a month follow `[locale] timezone`. That is the host's zone, or `UTC` when the host reports none. It is the
same calendar `openalpha cost` reads.

A run's ceiling is the lower of `max_per_run_usd` and `max_daily_usd`. With both at `0` there is no ceiling.

- `chat --max-cost-usd <amount>` replaces that ceiling for one run. The daily and monthly checks still apply on top.
- A `/themes` run also stops at `[trading.themes] maximum_cost_usd` (default `1.0`) when that is lower.

### Per-agent cap

Each of your own agents may carry `max_daily_usd` in its `agent.toml`. It is that agent's share of the day, and it sits
under `[budget] max_daily_usd`.

- A value above the overall cap is refused when the agent loads.
- `0` or absent means only the overall cap applies.

The cap is soft by design:

- It reads what the agent has spent today (your calendar day) once, when a run **starts**. It reserves nothing.
- Two runs admitted at the same moment both pass, so an admitted run may finish past the cap. The per-run cap still
  bounds each one.
- A debate started by the agent's tool, a child it delegates to and a research child all count toward the cap. None of
  them is refused halfway.
- If the spend read fails, the run goes ahead (logged as `agents.cap_read_failed`).

When an agent is at its cap, you see this:

- On the CLI, on Telegram and over the socket, it answers "this agent has spent its share of today's budget"
  (`haltDetail: agent_daily_cap`).
- A suggestion it was asked for reads "Stopped: this agent's daily budget ran
  out".
- Its scheduled jobs are skipped without counting as a failure, so a job never climbs the three-strikes ladder.

Some paths bill a persona, not an agent, so no agent cap applies. These are your own `/suggest` and `/themes`, the
brief's batches and the macro extractor.

## Finding out what cost

```bash
openalpha cost                                   # today
openalpha cost --period week
openalpha cost --period month
openalpha cost --from 2026-07-01 --to 2026-07-22 # inclusive, up to 366 days
openalpha cost --period week --breakdown         # split by assistant and model
```

`week` is this week so far, counted from Monday. `month` is the month so far. Day and month output names the cap when
one is enabled. Week and custom ranges report the total only.

`--breakdown` splits that same total by assistant and model, so the lines always add up. It is the quickest answer to
"was switching model worth it?": run it before and after, then compare money and latency.

It also prints a **By agent** block before the per-model rows, with one line for each billing agent and what it spent.
On the default `--period day`, each line also shows the agent's cap ("openalpha: $0.02 of $0.50 today"). Week and month leave the
cap out, because a daily cap beside a week's spend would mislead.

`status` shows today's spend too. A run stopped by budget halts through the normal `budget` path. The cost already
incurred stays recorded.

Every surface closes a run that spent money with the same footer: cost, tokens, model calls, elapsed time.

- In a session that has called no model yet (a price lookup, say), the footer is only the elapsed time.
- After any chat turn, the session's running spend comes back.
- The model is named only when one model served every billed call.
- If the fallback chain switched mid-run, there is no single name. The footer shows only the count, and the switch is
  printed on the line above.

With the API on, the app shows cost before a run and after it.

- **Before.** Beside each command, the app shows what that command usually costs. The figure is the middle half of
  what its last few finished runs cost, taken over the runs that cost something, so one outlier moves it little.
  - It waits until the command has run a few times.
  - It shows nothing for a command that hands the turn to an agent, because that spend belongs to the agent's own run.
  - It shows zero to zero when none of the recent runs used AI.
  - A command whose cost depends on what you type, such as `/suggest` on different names, pools every use under one
    name. Read it as a rough guide.
- **After.** Each finished run in the activity list carries what it cost together with every run beneath it. A command
  that started children, or an agent that spawned them, shows the whole bill in one number, not only the part it ran
  itself.
- **Models page.** Each model shows its own usual cost per run over the last month, once it has run in that window.

### In the office page

The [office page](operations.md#the-office-page) keeps cost in view without a command:

- **The chip.** The AI cost chip in the header shows today's spend against the daily cap, for example "0.42 / 2.00 USD". With no cap set, it shows the spend alone. It turns to caution in two cases: spend passes the warning share (`soft_warn_ratio`) of the daily or monthly cap, or a budget warning or stop has fired today.
- **The popover.** Click the chip to see today and the month against their caps, and "By job today": each job of today with what it cost, a parent including its child agents' share. It repeats the rule that matters. The bell tells you at the warning share, and at the cap new runs stop. "Change budget" goes straight to the budget row.
- **The full report.** "See the full report" opens today, the last 7 days, the last 30 days or this month, counted by the daemon's own days. It shows the total for the period, the highest day, a bar per day on a USD scale with its dates, and three folds: by job, by agent and by model, with each model's calls and failed calls.
  - A line above the bars names the day under the pointer or focus, the latest day otherwise. Click a bar for that day's runs, each with its AI calls.
  - The jobs add up to the total. A row under half a cent reads "<0.01 USD" rather than zero.
  - Spend not tied to a run in that period sits on an "Other" line.
  - A period with no spend says so.
  - If a read fails, the last report stays on screen under a line saying so.
  - "Change budget" is in its footer too.
- **The budget row.** Settings > Agents and AI has the daily and monthly caps in USD (`0` means no limit). It writes `[budget]` in `config.toml` and, like the file, takes effect after a restart. The page offers the restart.
- **Before a run.** The command bar shows each command's usual cost beside it, and what is left of today's cap. See [Commands](commands.md#the-command-bar-in-the-office-page). A button on the page that sends a command shows no estimate; type the command instead when you want to see its cost first.
- **Per agent.** On the team floor, an agent's card shows what it has spent today against its own daily budget. That is the one you set in the agent form (or `max_daily_usd` in its file).
- **Per run.** Every run on the page has a closed "AI calls" fold: in an agent's *Result*, on a job's row and under a finished chat answer. Open it and you see the run's head line (how many calls, what they cost, the slowest). Below it, call by call, you see the model, the tokens, the cost, how long it took and how it ended, with a plain reason when an attempt failed.
  - A run that handed work to child agents lists their calls too.
  - Every retried attempt counts, since each one is billed.
  - The head total is the cost the activity list shows for the run.
  - Only the latest 200 calls are listed. The head still counts them all.
  - A command that cost more than its usual estimate says so.
  - The fold reads stored figures and costs nothing, and none of it is ever shown to a model.

## How a call gets admitted

Before each call, the runtime estimates its worst-case cost. It checks that the run, the day and the month all have
room. If they do, the call waits for the rate limiter, the global caps are checked once more, and only then does the
call go out. Reservations count during admission, so two concurrent runs cannot both be approved against the same
remaining dollar.

- **Required work** (a normal turn, compaction) halts when admission fails.
- **Optional work** (such as preference extraction) is skipped and logged.
- Channel queues also stop accepting new runs once the day or month is at its cap.
- An app connected to the API is told once per period when settled spend reaches the daily or monthly cap. That way it
  can say paid work is paused until the cap resets. A call whose own estimate would cross the cap is refused without
  that notice.

When actual cost crosses a cap, the attempt is charged and kept. Then the run halts. Paid usage is never discarded to
make a total fit. A ledger that lies to stay under the limit is worse than none.

## Where the numbers live

Every attempt is written to the cost ledger in your database. That includes failures, retries and fallbacks. Day,
month and range totals are summed from those rows, so there is no separate total that can drift. At startup, the
current day and month are rebuilt from the ledger before any work is admitted.

An attempt that never reached the provider is written at zero cost. That covers a refused connection, a host name that
did not resolve, or a login that could not be read. Nothing was sent, so nothing was billed.

If a write still fails after three retries, the spend is appended to `unrecorded-spend.jsonl` in your data directory.
At startup, that file is folded back into the day and month totals until the month ends. So a restart cannot hand
money back to your caps.

If the append also fails, or the file is unreadable or damaged at startup, no further paid work is admitted while a
daily or monthly cap is set (`ledger_unavailable`). With no cap set, it is only a gap in reporting.

Retention can delete old sessions and messages. It detaches attempt rows instead of deleting them, so cost history
survives.

---

## Budget across a run tree

When a run delegates, the money is divided so no child can escape the ceiling its parent is under.

- A child never creates its own budget. It receives a slice of its parent's.
- The daily and monthly caps are checked on every call at every depth. A child cannot spend past the daily cap even
  when its own slice has room.
- Each attempt records a **billing agent**: the agent whose cap the spend counts against. It is not always the one that
  ran. A delegated child, a research child and a debate persona started by a tool all bill the agent that asked. A row
  with no billing agent bills the agent that ran it.

### What children get

A parent reserves **85% of its remaining budget up front**. That is one pool its children draw from, first come first
served. The other 15% stays with the parent, to read the results and write the answer. A child that finishes cheaply
leaves the rest for a sibling that needs it, so nothing is stranded.

The trade-off: a runaway child can drain the pool before a slower sibling's first call. That sibling then reports
`budget`, exactly as it would on exhausting a private slice. This is deliberate. Stranded budget is certain waste. A
runaway child is only occasional.

Here is an example: $1.00 remaining on the parent and three parallel children.

| | USD |
| --- | ---: |
| Reserved from the parent | 0.850 |
| Shared pool the three draw from | 0.850 |
| Parent keeps, to write the answer | 0.150 |
| Cohort refused below (3 children x $0.001) | 0.003 |

The whole cohort is refused when the pool divided by the number of children falls under $0.001 per child. It is
better to say no than to start three children that cannot afford a single call.

On an uncapped run, none of this arithmetic bites until you set a cap.

### Research gets a phase pool

`research` runs its own worker tree. It reserves the same 85% once and splits it by phase:

| Depth | plan | crawl | synthesize | review |
| --- | ---: | ---: | ---: | ---: |
| `light` | 0 | 0.70 | 0.30 | 0 |
| `medium` | 0.10 | 0.45 | 0.25 | 0.20 |
| `deep` | 0.10 | 0.50 | 0.20 | 0.20 |

Search fees arrive two ways:

- Exa reports its real charge, and that number is used as-is.
- Brave, DeepSeek, Serper and Tavily bill per query but return nothing. Each is charged the `cost_per_search_usd` you
  set. Unset means uncharged.
- DeepSeek is charged only when a search returns results.
- AnySearch, DuckDuckGo and a self-hosted SearXNG are genuinely free.
- A cache hit and a failed call are never charged.

### When a slice runs out

The spend is recorded first. Then the halt is raised. In a child it shows up as:

| Where | What you see |
| --- | --- |
| Child result | reason `budget` |
| Tool result | an error with `budget_exhausted: true` |
| Parent | Carries on with the partial text and a notice, and must not retry the same call |

A parent halted by its own budget stops on its next charge. Results you already paid for are never thrown away.

### Limits that are not money

Budget alone does not bound a run tree. Three `[loop]` counters do:

| Limit | Meaning | Refunded? |
| --- | --- | --- |
| `delegation_depth` | Max child levels from the top-level run; self-delegation and ancestor cycles are rejected | n/a |
| `max_delegations` | One quota shared by the whole tree, reserved before children start | No - a finished child does not return quota |
| `max_parallel_delegations` | Max items in one `delegate_parallel` call | n/a |
| `max_spawn` (agent file) | Spawned children one agent may start at once in one call; they spend the parent's slice and quota | n/a |

Quota and budget are independent. A tree can exhaust its fan-out while holding plenty of money, and the reverse.

## What happens when something goes wrong

| Condition | Result |
| --- | --- |
| Estimate exceeds the remaining run budget | Required work halts before the provider call |
| Estimate would cross an enabled daily or monthly cap | Required work halts before the provider call; a scheduled job waits for the cap to reopen, uncounted |
| An agent has spent its own `max_daily_usd` | A root run it owns halts before it starts (`agent_daily_cap`); its jobs are skipped, uncounted |
| Optional work cannot get budget | Skipped; the run continues |
| Actual cost crosses a cap | The attempt is charged and kept, then the run halts |
| Writing the attempt fails | Retried, then the spend goes to the unrecorded-spend file and the error propagates; if that fails too, paid work stops while a cap is set (`ledger_unavailable`) |
| Process restarts | Day and month totals rebuild from the ledger and the unrecorded-spend file |

See also the [`config.toml` reference](configuration.md), the [CLI reference](commands.md), and
[agent teams](agents.md#teams-and-delegation) for the delegation contract.

Internals: [dev/budgets.md](dev/budgets.md).
