# OpenAlpha docs

> **Vietnamese is the product's default language.** These English pages are the originals; each one
> has a Vietnamese twin in [`../`](../README.md).
>
> **One word you will see a lot:** *operator* means you - the person who keeps the book, approves
> orders and answers for every decision. It is also a name in the database, so the pages keep it.

## Start here

New? Read the [README](../../README.en.md) first: what OpenAlpha does, what it refuses to do, and one
suggestion from start to finish.

Already running it? [commands.md](commands.md) lists every command, and [trading.md](trading.md)
explains the numbers behind a suggestion. Setting it up? [configuration.md](configuration.md) covers
every key in `config.toml`.

## Guides

No code needed for any of these.

| Page | What is in it |
|---|---|
| [configuration.md](configuration.md) | Every key in `config.toml` |
| [commands.md](commands.md) | Every CLI command and slash command |
| [trading.md](trading.md) | Market data, suggestions, the ledger, the portfolio, placing orders |
| [data-sources.md](data-sources.md) | Which provider answers what, the keys you need, what happens when one is down |
| [agents.md](agents.md) | Writing an agent, teams, skills, choosing a model |
| [safety.md](safety.md) | Approvals, what protects you, the errors you can see |
| [budgets.md](budgets.md) | Spending limits and finding what a run cost |
| [operations.md](operations.md) | Background loops, schedules, heartbeats, running the API on a server |
| [storage.md](storage.md) | SQLite or Postgres, backups, export and import, sessions and history |
| [channels.md](channels.md) | Telegram and Zalo |
| [research.md](research.md) | Bounded web research with cited sources |
| [social.md](social.md) | Joining Moltbook-style social networks |

## For developers

Contracts, internals and source maps live in [dev/](dev/README.md): embedding the runtime, writing a
plugin, adding a data source or a channel, and why the code is shaped the way it is.

## Contributing to the docs

Fixes and new pages are welcome. Keep one subject per page; a paragraph that fits two pages wants a
link instead. Write the English page first, add its Vietnamese twin under a Vietnamese name, and add a
row to both indexes. Anything an operator does goes in a guide; anything only a developer needs goes
in `dev/`.
