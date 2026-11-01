# Channels

A channel is a chat app you talk to OpenAlpha from. Telegram and Zalo ship in the box.

The assistant behind them is the same whichever one you use. A channel only decides who gets in, saves
your message safely, tells commands from ordinary questions, and formats the answer so the chat app can
show it.

## Built-in channels

| Channel id | Connects through | Formatting | Buttons | Typing | Reactions | Live edits |
|---|---|---|---:|---:|---:|---:|
| `telegram` | Telegram Bot API | MarkdownV2 | yes | yes | yes | yes |
| `zalo` | Zalo bot | plain text | no | yes | no | no |
| `zalo_personal` | Your own Zalo account (unofficial) | plain text | no | yes | yes | no |

A channel starts only once its config and credentials are in place, and it runs inside the daemon.

### Zalo Personal

`zalo_personal` is opt-in because it drives an unofficial personal-account API, and Zalo can ban the
account for it. It refuses to start unless you set `i_accept_ban_risk = true` and list at least one
allowed id.

Link the account once:

```bash
openalpha zalo login
```

It saves a QR image for you to scan in the Zalo app, then stores the login under the channel's
`profile`. From then on the channel logs in from that saved login each time it connects.

- If the connection drops, the channel reconnects on its own, waiting a little longer after each
  failure, up to five minutes.
- Opening Zalo Web or Zalo PC on the same account takes the session over. `openalpha logs` records it
  as `zalo_personal.session_ended` with reason `duplicate_connection`.
- A login made while the daemon runs is picked up on the next try. No restart.
- `openalpha doctor channels` tells you which of the three things is still missing: the opt-in, an
  allowed id, or a saved login.

In a group, the Zalo bot answers whatever reaches it. Zalo only delivers a group message to a bot that
was @mentioned, and admission still decides which groups may use it.

## Configure a channel

One `[channels.<id>]` table per channel in `config.toml`. The annotated version is in
`config.sample.toml`.

For Telegram you can skip the editing: `openalpha onboard` asks for the variable that holds the bot
token and writes the table, with pairing on. Start the daemon, send the bot any message, then approve
the code it replies with (`openalpha pair approve <code>`). The `/start` Telegram sends when you first
open the bot shows the command list.

```toml
[channels.telegram]
token_env = "TELEGRAM_BOT_TOKEN"
allowed_ids = [123456789]
operator_user_ids = [123456789]
```

| Key | Applies to | Meaning |
|---|---|---|
| `enabled` | all | Set `false` to switch a configured channel off |
| `token_env`, `token_file` | `telegram`, `zalo` | Bot token, read in that order. `zalo_personal` has no token; it uses the stored `profile` |
| `allowed_ids` | all | Chats or users let in. On `telegram`, setting it turns pairing off unless `pairing = true` |
| `operator_user_ids` | all | Who counts as the operator: who may run every command that reads or changes your book (`/trade`, `/record`, `/portfolio`, `/suggest`, `/alert`, `/brief`, `/themes` and the rest of the trading commands), plus `/config`, `/new`, `/social`, `/upgrade` and the in-chat pairing controls (`/pair`, `/approve`, `/deny`). Anyone else the bot admits gets the public commands only, such as `/price`. Pairing controls work only from a chat listed in `allowed_ids`; in a group, list the group's own id there too. Without it, everyone the bot admits counts as the operator in their own private chat, so set it when you share the bot |
| `pairing` | `telegram` | Force pairing on or off |
| `dm_policy` | `zalo` | `pairing`, `allowlist` or `disabled`. Defaults to `pairing`, or `allowlist` once `allowed_ids` is set, the same as Telegram |
| `i_accept_ban_risk`, `profile` | `zalo_personal` | The required opt-in, and which saved QR login to use |
| `agent` | all | Bind the channel to one agent instead of the default |
| `require_mention`, `slash_commands` | all | Group mention rule, and whether slash commands are intercepted |
| `fallback_chat_id` | all | Where a scheduled job without `--to` delivers. With exactly one allowed id, or exactly one paired chat, that chat is used |

The rest tune delivery: `markdown`, `mid_stream_updates`, `typing_indicator`, `use_reactions`,
`notify_max_per_minute` and `gap_note_ms`. Message batching, live-edit pacing and the outgoing queue are fixed. An unknown
key fails validation, so a typo shows up at startup and not at 09:00.

A channel with no token (the `token_env` variable unset, or an empty `token_file`) or with a token the
provider itself rejects (HTTP 401 or 403 from Telegram, 401 from Zalo) is not opened. The daemon still
starts: `start` prints one warning for that channel, the other channels and everything else run, and a
channel without a valid token accepts no messages from anyone. Fix the token and `restart --background` to open it.
A Telegram token revoked while the daemon runs is handled the same way: after three refusals in a row the channel stops,
`/health` shows it down, and the down notice on another open channel says the token was refused.
A bad configuration value (wrong type, misspelt key) still stops `start` with an error. Any other
failure to check the token is a connection problem: the check is made once at start-up and never holds
the daemon back. If the network is down or slow the channel stays up, shows as degraded, and keeps
retrying in the background with a capped pause until it connects or the daemon stops. Telegram's
command menu is also set up in the background once the bot is reachable. Zalo Personal has no token to
reject; it keeps retrying its login in the background the same way. If no channel is up, running from
the CLI alone still works.

## Who gets in

There are two modes and no open one. A channel either admits from a list or pairs.

| Mode | What happens |
|---|---|
| `allowlist` | Only the chats or users in `allowed_ids` get in |
| `pairing` | Listed ids get in. An unknown chat gets a one-time code to hand to an operator |

- **Telegram** pairs when `pairing = true`. If you leave `pairing` out, it defaults to on only when you
  set no `allowed_ids`. Pairing with no allowed ids lets any Telegram user ask for a code, and the daemon
  logs a warning (`telegram.pairing_open`).
- **Zalo** follows `dm_policy`, which defaults to `pairing`, or `allowlist` once `allowed_ids` is set, the same as Telegram.
- **Zalo Personal** is always allowlist only.

### Pairing

An unknown user on a pairing channel gets a one-time code and a note to contact an operator. More
messages from them do nothing until the request is approved, denied or expires. You handle requests
from the terminal:

```bash
openalpha pair list --channel telegram
openalpha pair approve <code>
openalpha pair deny <code>
openalpha pair revoke <chat-id> --channel telegram
```

Details: [Commands](commands.md). Pairing fails closed in every direction:

- only a configured operator can list, approve, deny or revoke pairings;
- a paired chat cannot pair other chats, and a paired user is not automatically an operator;
- repeated messages from a stranger do not create unlimited codes;
- if storage fails, the message is rejected, not waved through;
- pending codes expire.

## Updating from chat

In a private chat with the operator, the bot mentions a new release at most once a week (once a day while an important one is waiting), never in a group, and says once that it is now on the new version.

`/upgrade` shows what is new, and `/upgrade confirm` (or the "Update now" button) installs it. The bot goes quiet for about a minute while it restarts, then messages you that it is back on the new version. If the new release will not start, it goes back to the old one by itself and tells you.

This works only for a daemon started with `start --background`, and only when nothing is in progress: no answer, research run, approval, brief or data refresh. Otherwise the bot asks you to try again later.

Only the operator may use it, as with `/trade`. Without `operator_user_ids`, everyone the bot lets in counts as the operator in their own private chat, so if you share the bot with others, set it.

## Approvals and plan reviews on Zalo

Zalo has no buttons, so an approval prompt or a `/research thorough` plan arrives with short codes such
as `/4821` for each choice. Type one back in the same chat to answer. A code works once, only for the
operator, and only until the prompt times out; typing it again, or after the time is up, answers that it
was already answered or has expired. Two prompts open at once get different codes, and answering one
leaves the other's codes live. A button tapped after its prompt was answered or timed out gets the same reply.

`fallback_chat_id` also decides where an alert or the morning brief armed from the terminal goes: the
first configured channel (Telegram, Zalo, Zalo Personal) with a fallback chat, a lone allowed id, or a
lone paired chat.

- **Pairing** needs nothing more. The daemon picks the chat up from the first message you send after
  pairing.
- **Revoking** with `pair revoke` makes the daemon stop sending to that chat, from the next message on
  and across restarts. Alerts and the morning brief armed there switch off at their next send, so
  pairing again does not bring them back: run `/brief enable` again and set the alerts again.
- **A group** admitted through your account has no pairing of its own, so `pair revoke` does not reach
  it. To stop it, turn off the alerts and brief armed there, or remove the bot from the group.
- **The app** lists the chats paired on each channel and can unpair one, which does the same as
  `pair revoke`.

A channel that drops and stays down is reported on another one, and `status` lists it; see [Operations](operations.md#when-the-daemon-stops-or-misses-a-brief).

## What happens to a message

1. **It is saved first.** The message is written to a durable inbox before the chat app is told it was
   received. A crash in between replays the message; the other order would lose it. Under `allowlist`, a
   message from someone who could never get in is not saved at all, so a stranger cannot fill the
   inbox. Under `pairing` everything is saved, since an unknown chat is offered a code.
2. **It is checked.** Stop and pairing commands are handled first. Slash commands go to the normal
   command dispatcher. Ordinary text is batched for a moment, then sent to the chat's agent and session.
3. **It waits its turn.** Each chat session runs one task at a time, and the daily and monthly budget
   checks run before anything new starts. Commands that run on their own (`/suggest`, `/screen`, `/refresh` and
   the like) are the exception: they run beside the session's turn, up to three at once per chat. One that has to
   wait answers "Queued" with its place in line, and `/stop` or `/new` drops it. Either one also stops the commands already running.
4. **You see it progress.** With `mid_stream_updates = true` on a channel that can edit messages
   (Telegram), one message updates live with the tool being used and the time elapsed. Elsewhere you get
   the final answer. Typing indicators and reactions show only where the channel and your config allow.
5. **The answer arrives**, split and escaped to fit the chat app, with a cost footer and a localized
   note if the run stopped early.

If the daemon dies mid-run, the message is retried later, up to 3 attempts, then given up and logged. If sending fails (a network blip, say), each retry waits longer than the last: about 10 seconds, then 20.
If a run finished but sending the answer failed, only the final message is sent again; the agent is not
run a second time. This holds for every part of a long answer: if one part is lost, the answer is sent
again from the start, so parts that already arrived can appear twice. Two cases still re-run: the
daemon died while the final write was in flight, and the
answer was over 256 KiB, so it was not kept. Messages folded into one reply get that reply once.

A few things to know:

- **Forwarded messages are data.** Their text is wrapped as pasted content and never starts with `/`, so
  a forwarded command does not run and the agent will not act on it unless your own words ask it to.
- **A chat keeps its conversation until you type /new.** After a quiet spell, OpenAlpha checks prices
  again instead of trusting the ones quoted earlier in the chat.
- **Replying keeps the thread.** In a private Telegram or Zalo Personal chat, reply to any answer from OpenAlpha and it
  knows which one you mean. For alerts and briefs it only sees which kind of message it was, never your amounts. The Zalo Bot API sends no quote, so it is not covered.
- **Buttons are commands.** Tapping one does exactly what typing that command would, with the same
  admission, role and rate checks, and it runs on today's data.
- **Chats stay separate.** Each channel and chat has its own conversation; two chat apps never share one.
- **The assistant never shows raw tool arguments.** A channel only sees what the engine marks safe to show.

Internals: [dev/channels.md](dev/channels.md).
