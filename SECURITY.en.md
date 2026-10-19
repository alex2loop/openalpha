# Security Policy

[🇻🇳 Tiếng Việt](SECURITY.md) &bull; 🇬🇧 English

OpenAlpha handles exchange credentials, model provider keys, and a ledger of real
positions. Please report anything that could compromise those privately, before it is
public.

## Reporting a vulnerability

Use **[GitHub private vulnerability reporting](https://github.com/alex2loop/openalpha/security/advisories/new)**
— the Security tab on this repository. That channel is private between you and the
maintainer, and it keeps the disclosure timeline in one place.

**Please do not open a public issue for a vulnerability.** The README points at issues for
ordinary bugs; a vulnerability is the one thing that should not go there first.

Include, as far as you can:

- what an attacker gains, not only what goes wrong
- the smallest reproduction you can manage, and the commit you saw it on
- whether it needs a hostile provider, a hostile channel peer, a hostile plugin, or only
  a normal run

You will get an acknowledgement within a week. If a report is confirmed, the fix and the
advisory land together, and you are credited unless you ask otherwise.

## Supported versions

Only `main` is supported — fixes land there and nothing older is backported. Pin
a tag or a commit if you need stability, and read [the stability notice](README.en.md#stability-license-and-disclaimer)
before relying on any of it.

## What is in scope

Anything that breaks one of these:

**Secrets stay out of reach.** Credentials come from the environment or from the key file
(`~/.openalpha/env`, mode `0600`, written only by `onboard` and `openalpha key set`, refused when
other users can read it); no config file holds a value, and no command prints one back. A path that writes a key to disk unscrubbed, leaks one into a log, an
error, a stored memory row or a model prompt is in scope.

**The order path is the only way to an exchange.** Order placement lives behind one
service, requires approval, and is capped. Anything that reaches a venue without passing
that path, or that bypasses a cap or an approval, is in scope — including a way to make
the whole-book caps read stale state inside the write window.

**Risk limits hold.** This is financial software, so *a bug that mis-sizes an order, lets
a cap be exceeded, or turns a refusal into a pass is a security issue here*, not merely a
correctness one. `maximumOpenRiskPctNav` and the segment caps are load-bearing.

**The model never sees your book in money.** Positions, cash, NAV and cost basis are
projected before anything reaches a persona or a tool. What a model can see is the *shape*
of a holding - weight as a fraction of NAV, unrealised return as a percentage, share of
quantity settled, lot count, first acquisition day - never a quantity, a price paid, a cash
balance or an amount. Two mechanisms enforce it:

- `AgentPortfolio` is a compile-time `Pick` of the portfolio service that simply omits the
  absolute reads. `viewRelative` and `historyRelative` are exposed; `view` and `history`
  are not. Money and quantities are **not representable to a tool at all** - there is no
  runtime filter to bypass, because the method does not exist on the type.
- `OperatorOnlyField` (`held`, `units`, `policyUnits`) is stripped from every suggestion
  payload handed to a model, and `HeldWeight` replaces a position with its weight.

A way to get an absolute figure into a prompt, a tool result, or a persona's context is in
scope - including one added by a new field on `Suggestion` that was not added to
`OperatorOnlyField` on the same commit. That list is maintained by hand and is the softer
half of this guarantee.

**Untrusted input stays untrusted.** Channel messages, source payloads, MCP tool output
and plugin content all arrive from outside. Prompt injection that redirects a run, escapes
the approval gate, or reaches memory is in scope.

**The network boundary holds.** Endpoints are code-owned and fetches are pinned. A way to
make the process reach an address the code did not choose — SSRF, DNS rebinding, a
redirect into a private range or a cloud metadata endpoint — is in scope.

**The local API stays local.** The daemon binds loopback only and authenticates with a
bearer token stored `0600`. Anything that exposes it further, or accepts a request without
that token, is in scope.

**Plugins cannot execute without consent.** Plugin code runs only when
`plugins.allow_code` is set, and plugins can never contribute tools or hooks. A way around
either is in scope.

**Path handling is safe.** The agent writes into private directories with symlink-race
defence. Traversal or a race that escapes them is in scope.

## What is not in scope

- **Your own configuration.** Pointing `data_dir` somewhere world-readable, committing your
  `config.toml`, or exporting a key into a shared shell is operator error, not a
  vulnerability. The `.gitignore` guards the common cases; it cannot guard all of them.
- **A model behaving badly.** A suggestion that is wrong, a persona that argues poorly, or
  a provider that returns nonsense is a quality problem. It becomes a security problem only
  if it crosses one of the boundaries above.
- **Third-party services.** A vulnerability in a data provider, an exchange, or a model
  provider belongs to them. Tell us if this project handles their failure unsafely.
- **Denial of service by your own spend.** Cost caps exist to bound it; a run that costs
  more than you expected is a budget setting, not an attack.
- Anything requiring an attacker who already has your machine, your shell, or your keys.

## What this project already does

For context when you assess a finding — these are enforced, not aspirational:

| | |
|---|---|
| Credentials | environment or the `0600` key file; endpoints code-owned so no setting can redirect a request |
| Local API | loopback bind, bearer token at `0600`, origin allowlist, peer check |
| Untrusted text | prompt-injection scanning before it can steer a run or reach memory |
| Logs and errors | scrubbed at the boundary |
| Network | pinned fetch over an IPv4/IPv6/DNS network policy |
| Filesystem | canonicalisation with symlink-race defence on private files |
| Plugins | no code without `plugins.allow_code`; tools and hooks structurally forbidden |
| The book | a model sees weights and percentages, never money, quantities or cost basis - omitted at the type level |
| Execution | one order path, human approval, session-scoped and never remembered |
| Spend | daily, monthly and per-run caps, soft-warned at 80% |
