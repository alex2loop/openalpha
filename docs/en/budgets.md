# Cost and budgets

Every model call costs money. OpenAlpha estimates before it spends, records what actually happened, and stops at a
limit instead of after it.

Caps are opt-in. With none set, spend is uncapped and simply tracked, so you can always find out what it cost.
Search providers share the same ledger: Exa's reported charge and the `[web_search] cost_per_search_usd` you set
for Brave, Serper or Tavily land in the same totals as model spend.

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
| `soft_warn_ratio` | `0.8` | Warns once per process and period when projected spend reaches this fraction of the cap. |
| `max_per_run_usd` | `0` | Most one top-level run and all the work it delegates may spend. `0` means uncapped. |

A day and a month follow `[locale] timezone` (the host zone, `UTC` when the host reports none) - the same calendar
`openalpha cost` reads.

A run's ceiling is the lower of `max_per_run_usd` and `max_daily_usd`. With both at `0` there is no ceiling.
`chat --max-cost-usd <amount>` replaces that ceiling for one run; the daily and monthly checks still apply on top.
A `/themes` run also stops at `[trading.themes] max_cost_usd` (default `1.0`) when that is lower.

### Per-agent cap

Each of your own agents may carry `max_daily_usd` in its `agent.toml`: its share of the day, under
`[budget] max_daily_usd`. A value above the overall cap is refused when the agent loads. `0` or absent means only
the overall cap applies.

The cap is soft by design:

- It reads what the agent has spent today (your calendar day) once, when a run **starts**, and reserves nothing.
- Two runs admitted at the same moment both pass, and an admitted run may finish past the cap. The per-run cap still
  bounds each one.
- A debate started by the agent's tool, a child it delegates to and a research child all count toward the cap and
  are never refused halfway.
- If the spend read fails, the run goes ahead (logged as `agents.cap_read_failed`).

An agent at its cap answers "this agent has spent its share of today's budget" on the CLI, on Telegram and over
the socket (`haltDetail: agent_daily_cap`). A suggestion it asked for reads "Stopped: this agent's daily budget ran
out". Its scheduled jobs are skipped without counting a failure, so a job never climbs the three-strikes ladder.

Paths that bill a persona rather than an agent have no agent cap: your own `/suggest` and `/themes`, the brief's
batches and the macro extractor.

## Finding out what cost

```bash
openalpha cost                                   # today
openalpha cost --period week
openalpha cost --period month
openalpha cost --from 2026-07-01 --to 2026-07-22 # inclusive, up to 366 days
openalpha cost --period week --breakdown         # split by assistant and model
```

`week` is the last seven days including today. `month` is the month so far. Day and month output names the cap when
one is enabled; week and custom ranges report the total only.

`--breakdown` splits that same total by assistant and model, so the lines always add up. It is the quickest answer
to "was switching model worth it?": run it before and after, and compare money and latency. It also prints a **By
agent** block before the per-model rows, one line per billing agent with what it spent. On the default
`--period day` each line also shows the agent's cap ("$0.02 / $0.50 today"). Week and month omit the cap, since a
daily cap beside a week's spend would mislead.

`status` shows today's spend too. A run stopped by budget halts through the normal `budget` path, and the cost
already incurred stays recorded.

Every surface closes a run that spent money with the same footer: cost, tokens, model calls, elapsed. The model is
named only when one model served every billed call. If the fallback chain switched mid-run there is no single
name, so the footer shows only the count and the switch is printed on the line above.

## How a call gets admitted

Before each call the runtime estimates its worst-case cost and checks that the run, the day and the month all have
room. If they do, the call waits for the rate limiter, the global caps are checked once more, and only then does
the call go out. Reservations count during admission, so two concurrent runs cannot both be approved against the
same remaining dollar.

- **Required work** (a normal turn, compaction) halts when admission fails.
- **Optional work** (such as preference extraction) is skipped and logged.
- Channel queues also stop accepting new runs once the day or month is at its cap.

When actual cost crosses a cap, the attempt is charged and kept, and then the run halts. Paid usage is never
discarded to make a total fit - a ledger that lies to stay under the limit is worse than none.

## Where the numbers live

Every attempt, including failures, retries and fallbacks, is written to the cost ledger in your database. Day,
month and range totals are summed from those rows, so there is no separate total that can drift. At startup the
current day and month are rebuilt from the ledger before any work is admitted.

If a write still fails after three retries, the spend is appended to `unrecorded-spend.jsonl` in your data
directory. At startup that file is folded back into the day and month totals until the month ends, so a restart
cannot hand money back to your caps. If the append also fails, or the file is unreadable or damaged at startup, no
further paid work is admitted while a daily or monthly cap is set (`ledger_unavailable`). With no cap set, it is
only a gap in reporting.

Retention can delete old sessions and messages, but it detaches attempt rows instead of deleting them, so cost
history survives.

---

## Budget across a run tree

When a run delegates, the money is divided so no child can escape the ceiling its parent is under.

- A child never creates its own budget. It receives a slice of its parent's.
- The daily and monthly caps are checked on every call at every depth, so a child cannot spend past the daily cap
  even when its own slice has room.
- Each attempt records a **billing agent**: the agent whose cap the spend counts against, which is not always the
  one that ran. A delegated child, a research child and a debate persona started by a tool all bill the agent that
  asked. A row with no billing agent bills the agent that ran it.

### What children get

A parent reserves **85% of its remaining budget up front** as one pool its children draw from, first come first
served. The other 15% stays with the parent to read the results and write the answer. A child that finishes cheaply
leaves the rest for a sibling that needs it, so nothing is stranded.

The trade-off: a runaway child can drain the pool before a slower sibling's first call. That sibling then reports
`budget`, exactly as it would on exhausting a private slice. This is deliberate - stranded budget is certain waste,
a runaway child only occasional.

With $1.00 remaining on the parent and three parallel children:

| | USD |
| --- | ---: |
| Reserved from the parent | 0.850 |
| Shared pool the three draw from | 0.850 |
| Parent keeps, to write the answer | 0.150 |
| Cohort refused below (3 children x $0.001) | 0.003 |

The whole cohort is refused when the pool divided by the number of children falls under $0.001 per child. It is
better to say no than start three children that cannot afford a single call. On an uncapped run none of this
arithmetic bites until you set a cap.

### Research gets a phase pool

`research` runs its own worker tree, so it reserves the same 85% once and splits it by phase:

| Depth | plan | crawl | synthesize | review |
| --- | ---: | ---: | ---: | ---: |
| `light` | 0 | 0.70 | 0.30 | 0 |
| `medium` | 0.10 | 0.45 | 0.25 | 0.20 |
| `deep` | 0.10 | 0.50 | 0.20 | 0.20 |

Search fees arrive two ways. Exa reports its real charge and that number is used as-is. Brave, Serper and Tavily
bill per query but return nothing, so each is charged the `cost_per_search_usd` you set; unset means uncharged.
DuckDuckGo and a self-hosted SearXNG are genuinely free. A cache hit and a failed call are never charged.

### When a slice runs out

Spend is recorded, then the halt is raised. In a child it shows up as:

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

Quota and budget are independent: a tree can exhaust its fan-out while holding plenty of money, and the reverse.

## What happens when something goes wrong

| Condition | Result |
| --- | --- |
| Estimate exceeds the remaining run budget | Required work halts before the provider call |
| Estimate would cross an enabled daily or monthly cap | Required work halts before the provider call |
| An agent has spent its own `max_daily_usd` | A root run it owns halts before it starts (`agent_daily_cap`); its jobs are skipped, uncounted |
| Optional work cannot get budget | Skipped; the run continues |
| Actual cost crosses a cap | The attempt is charged and kept, then the run halts |
| Writing the attempt fails | Retried, then the spend goes to the unrecorded-spend file and the error propagates; if that fails too, paid work stops while a cap is set (`ledger_unavailable`) |
| Process restarts | Day and month totals rebuild from the ledger and the unrecorded-spend file |

See also the [`config.toml` reference](configuration.md), the [CLI reference](commands.md), and
[agent teams](agents.md#teams-and-delegation) for the delegation contract.

Internals: [dev/budgets.md](dev/budgets.md).
