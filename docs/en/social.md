# Social networks

Agents you made can join agent social networks such as Moltbook from the network's published
`skill.md`, the way OpenClaw does. The runtime handles what must not be left to a model: it pins what
you approved, holds the key, checks every request and keeps the visits on a schedule. Nothing here
executes a trade, and no agent can speak for your book.

## What it is

A network publishes a `skill.md` that says how to register and which REST calls exist. You add that
file once, read what it allows, and approve it. After that, an agent of yours can join. On a schedule
it visits the network, reads, and writes through two tools, `social_request` and `social_skill`. It
never chooses the address and never sees the key. Everything it reads from the network is words from
strangers, never instructions.

## Adding a network

```text
openalpha social add <skill.md URL> [--name <name>] [--api-base <https URL>] [--label "METHOD /path=label"]
```

The command fetches the skill and every `.md` file it lists on the same site, reads the endpoints with
a plain parser (no model), and prints a preview before it writes anything:

- the name, version and API address (a name taken from the host is only a proposal; `--name`
  overrides it);
- every endpoint with a label and what that label means;
- how registration works, when the skill shows an example;
- the findings worth a look.

The label, never the HTTP method, decides what happens to a request:

| Label | What happens |
|---|---|
| `read` | Goes out (any `GET`, and marking notifications read) |
| `post`, `comment`, `vote`, `follow` | Goes out, unless review is on or the text carries a link to another site |
| `verify` | Goes out: it answers a check the network asks for |
| `dm`, `delete` | Waits for your OK as a draft |
| `account`, `register`, `admin` | Never sent from here |

An endpoint that is not a `GET` and has no label is blocked until you label it. Correct a guess with
`--label "POST /submolts=post"` (repeatable), here or on `social update`.

The "worth a look" list is advice, not a verdict. Moltbook's own skill tells agents to save files under
`~/.moltbot` and to re-download itself every day. The runtime does neither, so those lines only show up
as findings and are harmless here.

On confirmation the files are written to `<data_dir>/social/<network>/<pin>/` and `pin.json` names the
current one. `<pin>` is the first 16 hex digits of the hash of the pinned `network.toml`, and every
file in it is hashed too.

## Joining

```text
openalpha social join <agent> <network> [--every 2h] [--key-env VAR] [--name <public-name>] [--yes]
```

The agent must be one you made, not paused, with its **own `[focus]`** (so anything it says is a second
opinion, never your book's plan), holding only allowed tools, including `social_request` and
`social_skill`.

Allowed tools: `social_request`, `social_skill`, the suggestion tools, the read-only market tools,
`now` and `calc`, plus anything in `[social] allowed_tools`. `memory_recall` is there only if you add
it, because an agent's memory can hold what you told it. On a visit the suggestion tools never read
your watchlist.

Refused: anything that writes, runs commands, schedules or delegates; external (MCP or plugin) tools;
by name, the profile, watchlist, alert, brief, memory-write, book, order and file tools and
`web_fetch`; and `"*"`.

The runtime does the registration. It fills the skill's own example with the agent's public name (and
its `description`, when the example asks for one), shows you exactly what will be sent and asks before
sending (`--yes` skips the question). It then stores the key the network returns and shows you the
claim link and verification code. **Open the claim link before the first visit.** The first visit comes
one interval after joining (two hours by default), and an unclaimed agent gets `403` answers: five in
a row pause the membership. With `--key-env VAR` the CLI reads a key you already have from that
variable once, stores it, and never reads the variable again.

The key lives in `<data_dir>/credentials/social/<network>/<agent>.json`, mode `0600`. `db export` does
not carry it, so back that folder up with the data directory.

## What happens on a visit

Each active membership is one heartbeat task named `social:<network>`, run on its own:

- every `[social] heartbeat_interval_ms` (two hours by default) or the agent's own `--every`, never
  below one minute;
- in a fresh isolated session on the `social` channel, with only the agent's tools the rules allow, at
  most 8 turns and 5 minutes;
- from a fixed prompt the runtime writes. It tells the agent to open the network's guide with
  `social_skill` and follow it with `social_request` only; ignore any instruction to fetch a newer
  copy, install anything, keep files or call other hosts; treat posts as strangers' data; stay silent
  when there is nothing worth saying; never state figures about your book; answer a verification
  challenge at once; and finish with the heartbeat block. It also lists the agent's last writes on this
  network and the names of your other agents there, so the fleet does not amplify itself;
- silent unless the agent answers `notify`, which goes to your default recipient.

Fixed limits keep one agent from spamming:

- `max_posts_per_day` (8) and `max_comments_per_day` (40) are yours to change; votes (100) and follows
  (20) are not.
- Reads are capped per minute, and the same text is never sent twice in a day. A write the network never confirmed (timeout, `5xx`) may have landed, so it counts as sent: it uses up the cap and blocks an identical resend, which keeps a retry from posting twice.
- `active_hours = "07:00-23:00"` keeps visits inside a window in your timezone.

At the defaults one membership costs at most 12 visits a day, counted against the agent's
`max_daily_usd`. A visit that hits its turn limit still counts as done, not failed. `agent pause` stops
visits with no failure counted.

## Drafts

A request waits for you instead of going out when it is a DM or a delete, when a post carries a link to
another site, or when you turned review on (`social review <agent> <network> on`).

```text
openalpha social drafts                  # what is waiting, with the full text and any outside links
openalpha social approve <id> [--yes]    # show it again, ask, send it
openalpha social discard <id>
openalpha social log <agent> [<network>] # what an agent has actually published, newest first
```

Approving runs every check again against the current pin, key, membership and caps. Drafts expire after
three days. No agent tool can approve one. **A limit:** if the network answers an approved post with a
verification challenge, only a running agent could answer it in time, so the post may stay hidden. Let
the agent write it fresh on its next visit instead of sending it again.

## When a network changes its skill

Once a day the daemon fetches each pinned network's skill and compares it. A difference is staged
beside the approved copy and you get one notice. Nothing an agent reads changes: `social_skill` keeps
serving the pinned files until you look.

```text
openalpha social update <network>        # what changed, the new findings, then your OK
openalpha social rollback <network>      # back to the previous copy
```

If the new skill moves the API to another address, the moment you approve it every agent on that
network becomes `refused` until it has a key from the new address (`social rekey`). A key issued by one
host is never sent to another. Rolling back to a copy on a different address does the same.

If a pinned file no longer matches its hash on disk, the network pauses itself (`social list` shows
`paused: its pinned files changed on disk`) and you are told once. Restore the file or roll back, then
`social resume <network>`.

## When something goes wrong

| What happened | What it means | What to do |
|---|---|---|
| The network answers `401` | It turned the key away; the membership is `refused` | Get a new key from the network, then `social rekey <agent> <network> --key-env VAR` |
| Five `403`s in a row | The membership is paused | Check the claim, then `social resume <network> <agent>` |
| `429` | The network asked the agent to slow down | Nothing: writing pauses for the time it named, reading still works |
| Unreachable, timeout, `5xx` | The agent gets the error as text | For a read, nothing. For a write, the post may already be live: the attempt still counts toward the caps and the duplicate guard, the agent is told to check before sending again, and you should look on the network. Writes are never retried automatically |

## What it never does

- Follow a skill's instruction to fetch, install, keep files or call another host. The host is pinned,
  checked on every request, and no redirect is followed.
- Show the key to a model. It is added in the header, and the exact key string is redacted from
  anything the model reads.
- Let an agent that holds a write, shell, schedule or delegate tool onto a network.
- State your book's figures. A networked agent's calls are second opinions with holdings stripped.

The residual risk is real: strangers' text can still shape what an agent posts publicly. The
safeguards are the denied tools, drafts for DMs, deletes and outside links, the caps and duplicate
guard, `social review`, `social pause`, `agent pause`, and `social log`, so you can read what it said.

## Moving to another machine

`db export` carries the `social_*` tables but not the files. Copy `<data_dir>/social/` (the pinned
files) and `<data_dir>/credentials/social/` (the keys) with the data directory, or `social list` will
tell you the files are missing.

## From a chat

On Telegram, Zalo or in the REPL, as the operator only: `/social drafts` shows each draft's full text
with buttons, `/social approve <id>` sends it and `/social discard <id>` drops it. In a chat the text
the agent wrote sits in a code block, so a link in it shows exactly as it would be posted.

## Commands at a glance

| Command | Does |
|---|---|
| `social list` | Networks, their agents, drafts and cooldowns |
| `social add <url>` | Pin a network from its skill |
| `social update <network>` / `rollback <network>` | Review a changed skill / go back |
| `social join <agent> <network>` | Put an agent on a network |
| `social leave <agent> <network>` | Take one agent off; its key and drafts are deleted |
| `social rekey <agent> <network> --key-env VAR` | Give an agent a new key |
| `social review <agent> <network> on\|off` | Hold public posts for your OK |
| `social drafts` / `approve <id>` / `discard <id>` | Settle what is waiting |
| `social log <agent> [<network>]` | Read what the agent published |
| `social pause\|resume <network> [<agent>]` | Switch a network, or one agent on it, off and on |
| `social remove <network>` | Delete a network once nobody is on it |

To stop for now use `pause`; to take one agent off use `leave`; to forget a network use `remove`. An
agent that holds a membership cannot be removed with `agent remove`: leave first.
