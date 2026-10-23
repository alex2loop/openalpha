# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each release opens with a short English summary; from 1.0.6 on, one `> ` line in Vietnamese follows
it. OpenAlpha shows both in its update notice. A release you should install soon carries
` [IMPORTANT]` after its date.

## [Unreleased]

`/themes run <id>` reports on its theme alone, an ended theme says why and what to do, and the
track record, news window and macro lookbacks are measured more carefully. Exit alerts no longer
stall on a kept take-profit, and the chat agent no longer sees your own loss figures.
> `/themes run <id>` giờ chỉ báo cáo đúng chủ đề đó, chủ đề đã kết thúc nói rõ lý do và việc cần làm, còn bảng thành tích, tin tức và số liệu vĩ mô được đo cẩn thận hơn. Cảnh báo thoát lệnh không còn bị kẹt khi giữ nguyên mức chốt lời, và trợ lý chat không còn thấy số lỗ của riêng bạn.

### Themes

- `/themes run <id>` now reports on that theme alone, its sectors and companies included.
- A theme whose end condition was met is now labelled "Ended", says why right under its name, and
  suggests `/themes retire <id>`.
- New themes come with end conditions that name a figure, a threshold and a period, and a theme
  whose own condition already holds is no longer proposed.
- A theme's summary now says plainly when one of its end conditions has been met.
- The track record counts only reads scored the current way, so a change to the score weights
  starts a fresh record instead of mixing two scales.
- A name listed for under a year is now measured against VN-Index like any other.
- Macro readings that lag by a month or more keep their year-ago comparison.
- A target P/E set exactly at the five-year high the analyst was shown is no longer refused.
- Notes under a theme read from an earlier check no longer say "this time".
- Each run reads the headlines archived since the previous one, so a story that reached the
  archive late is no longer skipped.
- A company read now starts from the theme's own horizon.
- Vietnamese wording in the theme report uses one word per idea, and a theme's claims sit under
  "For it" and "Against it".
- An ended theme no longer shows its odds, a theme whose sector check found no gaining sector
  scores no reach instead of skipping that part, and "was" compares only scores made the same way.
- A proposed theme lists every condition that would end it, so you see the exit before approving.
- A check that cannot reach a theme's sectors keeps the previous sectors and companies, dated,
  and stock opportunities leave out low-confidence names, which stay marked under their sector.
- Daily commodities keep their year-over-year change when the feed starts a day after the
  year-ago date, and a sector's profit growth leaves out names more than two quarters behind.

### Suggestions and alerts

- The report the chat agent relays no longer carries your realized loss or how far a holding sits
  under its cost; it states the caveat without the figure.
- An exit alert armed at the same level as a live one no longer fails the arming pass every
  minute, so stale alerts are retired again.
- `/reflect` counts what you acted on over the same folded calls as the rest of the record, and
  its win rate reads "ended in profit", which is what it counts.
- `/update` keeps a row's note and which exit leg filled.
- A recorded trade's fee line now says the fee matches the configured rate, instead of reading as
  if a fee you typed had been replaced by it.
- The price band and a trailed stop reach the chat agent written as board prices.
- A busy run and an unreadable spend record each get their own hint, and the hint for a run
  that could not start names the terminal `doctor` command.
- `/watchlist` and `/alert` show a progress line while they fetch prices.
- `/profile set preferred-locale` is gone: it was stored but never chose the reply language.
  Replies, briefs and alerts follow `[locale] language`, and the API's `preferredLocale` reports it.
- `/reflect` no longer fails on one factor-log row a rename left unreadable.
- `key set` with the brand prefix on a name the config reads without it now suggests the name
  the config actually reads.
- The unsettled-shares hold no longer hardcodes T+2, and `/agent` with extra words names what
  was typed instead of an empty id.
- The track-record tool counts coverage for the version it was asked about, the "calls like this
  one" line reads the call's own focus, and the debate's "your last calls" are that focus's own,
  repeats folded.
- A trailed stop whose price series is unavailable is retried every 15 minutes instead of every
  minute, and a macro document the model cannot read is not paid for again.
- Adding to a held name no longer counts against `maximum_open_trades`.
- A leftover sliver below the venue's smallest order that no source prices any more counts at
  cost, with a note, instead of blanking NAV and blocking every buy.
- A segment with a target and nothing held in it now reports its drift.
- When an alert notice cannot be delivered, the message says the system will set it up again
  rather than asking you to turn it back on; error hints point to `/help <command>`.

### Docs

- Corrected what `/trade cancel` removes, the fee-inclusive average cost, the terminal behaviour
  of `/alert create` and `/brief enable`, what `/watchlist` lists, which commands read any case,
  who counts as the operator, the alert retry timing, `schedule run-now` on a one-time job, and
  the user guide's command map.

## [1.0.16] - 2026-10-22

VN funds are now treated as index trackers, `/rebalance` sells a holding back to its cap and says
why a sale has to wait, and a call served again later in the day tells you when your book has
changed since. No database change.
> Quỹ ETF VN giờ được đối xử đúng là quỹ bám chỉ số, `/rebalance` giảm bớt mã vượt trần và nói rõ khi lệnh phải chờ, còn đề xuất được dùng lại trong ngày sẽ báo khi sổ của bạn đã đổi. Không đổi cơ sở dữ liệu.

### Rebalancing

- A holding past its per-name, fund or sector cap by more than the 5/25 band is sold back to the
  cap (`over-cap`), even when its score is neutral. A name on your exclusion list is trimmed too.
- A sector over its cap gives back its weak-scored names first and whole; if that is enough, the
  other names keep their weight.
- A sale held back says why: not enough has settled yet, or the name trades too thinly to sell in
  one go.
- When a fund or sector cap is what left a segment short, the names offered sit outside that cap.

### VN funds

- A fund gets a review level 3 ATR away with a 3:1 reward, is never counted in a sector and is
  never sold for a weak score; the segment's core stays with the fund you hold unless another
  leads by a clear margin.
- Fund scores read the index the fund tracks and say when that index is behind.

### Suggestions and the brief

- Scores read the same everywhere, and `/themes` explains its 0-100 score.
- `/suggest` and `/brief` name the plan's own reason for a sale; a sale under the plan's rules is
  no longer held back by a side claim in the debate, and the debate is told which cap was passed.
- A call served again after you record a trade or a deposit says the book has changed, and the
  brief lists those names with `/suggest <ticker> force`.

### Fixes

- A held fund no longer raises "sector unknown".
- The chat agent gets the same "factors disagree" wording as the CLI.
- The brief no longer repeats `/rebalance`'s own notes.

## [1.0.15] - 2026-10-21

A VN stock you hold that closes at its ceiling is now proposed for a trim at the next open, and a
held name no longer loses its exit plan when a later run that day sells or cannot price it. No database change.
> Cổ phiếu VN bạn giữ mà đóng cửa ở giá trần giờ được đề xuất bán bớt ngay phiên mở cửa sau, và mã đang giữ không còn mất kế hoạch thoát khi một lần chạy sau trong ngày đề xuất bán hoặc không tính được giá. Không đổi cơ sở dữ liệu.

### Selling a held name

- New reason `ceiling-close`: a VN stock in a short-horizon segment that closed at or just under its
  ceiling is proposed for a trim of your first take-profit share at the next open, while the gap is
  still there.
- A sale smaller than one board lot says so, instead of saying you already sold.
- A held name the system wants to sell but holds says why the sale was due.
- When a trim and an evidence reason sell the same number of shares, the evidence reason is named.
- A name blocked at the ceiling or floor, or by full foreign room, says which.
- The brief says why each held name is reduced.

### Exit plans

- A sale or an unpriced run on the day you record a buy keeps the rest of the position on its exit
  plan, so stop and take-profit alerts keep watching it.
- A holding with only a stop or only a take-profit counts as watched.

### Your book

- `/update` takes a bare ticker the way `/record` does; the other fields stay written out.
  Dividend, split and distribution lines take a bare ticker too.
- `/update` of a USDT row asks for `fx` only where the rate changes the book.
- A crypto sale whose fee was taken in the coin is booked instead of skipped.

### Fixes

- A shared cost cap covers a whole workflow run, and the spend estimate no longer counts the prompt
  twice.
- A reply cut off at the length limit keeps the text it had.
- Tapping an approval while its prompt is still sending now updates the prompt.
- The agent's `hosts` list also limits pages `research` reads directly.
- `/schedule edit` keeps the job's timezone; `onboard` keeps the newest 5 config backups.
- One-letter and digit-leading crypto symbols (`S`, `1INCH`) are recognized.
- `[trading.alerts] breakout_sessions` must be at least 5.

## [1.0.14] - 2026-10-21

A VN quarter reaches the analysis as soon as its income statement is out, even before its cash
flow. The assistant also asks before changing a preference it already remembers.
> Một quý của cổ phiếu VN vào phân tích ngay khi có kết quả kinh doanh, kể cả khi chưa có lưu chuyển tiền tệ. Trợ lý cũng hỏi bạn trước khi đổi một sở thích đã ghi nhớ.

### Changes

- A quarter without its cash flow is kept; its cash figures stay blank instead of reading as zero.
- The missing cash flow is filled from CafeF (`cafef-statements`) when its profit matches the
  quarters already stored.
- New notes when a quarter has no cash flow or the latest quarter is late.
- The "results are due" note also shows on the deadline day.
- Changing a remembered preference: the assistant asks once and saves it when you agree.

## [1.0.13] - 2026-10-21 [IMPORTANT]

Security and reliability fixes. The agent asks before opening a link it built itself, so a web page
can no longer leak your holdings through a link. `upgrade --rollback` also rolls back the database.
> Sửa lỗi bảo mật và độ ổn định. Agent hỏi bạn trước khi mở link do nó tự ghép, nên trang web không thể lấy danh mục của bạn qua link. `upgrade --rollback` đưa cả cơ sở dữ liệu về bản trước.

### Fixes

- `upgrade --rollback` (and the automatic rollback) also takes the database back, after asking. An
  older release refuses a newer database instead of misreading it.
- `db migrate down --to <id>` undoes every migration after `<id>`.
- A scheduled job stopped by a spend cap or rate limit waits instead of being switched off.
- The agent asks before reading a link it built or changed, one with extra headers, or more than
  `[loop] max_unasked_fetches` pages in a run (default 10). Links you send open as before.
- A VN sale can no longer exceed what you hold.
- VN prices land exactly on the price step, so a bar that touched a stop counts as touching it.
- Outbound requests block more disguised local addresses.
- `db restore` and `db reset` always keep a full backup first.
- `upgrade` no longer rolls back a daemon that is just slow to start.
- A segment with a 0% target opens no new position; held names keep their exits.
- Smaller fixes to gold premium, crypto funding, OKX listings, brief exits, OpenRouter errors,
  chat commands on Telegram and Zalo, and the installers.

## [1.0.12] - 2026-10-20

The brief opens with one market story and checks earlier ones, at no AI cost. A tiny leftover after
a full sale no longer counts as a holding.
> Bản tin mở đầu bằng một câu chuyện thị trường và soát lại các câu chuyện trước, không tốn phí AI. Phần lẻ còn sót sau khi bán hết không còn bị tính là vị thế.

### Brief

- One market story per morning: what happened, the numbers, a reading, what could prove it wrong
  and what to watch.
- Before your first recorded trade, the brief asks you to `/record` it.
- A holding with no price yet no longer reads as an empty book.

### Portfolio

- A leftover below the venue's smallest order is skipped everywhere you plan or trade; its value
  still counts in the total.

## [1.0.11] - 2026-10-20

Fixes: `db reset` can back up first again, a rejected AI key is reported correctly, and a past day's
USDT rate no longer changes. Source lines show the day.
> Sửa lỗi: `db reset` sao lưu trước được trở lại, khóa AI bị từ chối được báo đúng, và tỷ giá USDT của ngày đã qua không còn đổi. Dòng nguồn ghi cả ngày.

### Fixes

- `db reset` no longer stops when you accept its backup; `| head` prints no broken-pipe error.
- A rejected AI key is reported as such, not as a rate limit; a failed connection is not billed.
- Telegram stops after repeated rejected tokens; ChatGPT sign-in refreshes in time.
- Source lines show the day; Telegram never splits a code block.

### API

- `approval_requested` adds `label` and `expiresAt`; `/v1/chat/history` pages by `idx`.

## [1.0.10] - 2026-10-20

Setup and chat explain themselves better, and three config keys are renamed.
> Thiết lập và chat dễ hiểu hơn, và ba mục config được đổi tên.

### Setup and chat

- `onboard` tests the key it saves and says why a test failed.
- `key set` warns when you save a name the config never reads.
- `/profile`, `/update` and `/alert` show what they do; commands accept any letter case.

### Config (action needed)

- Renamed: `[trading.themes] max_cost_usd` to `maximum_cost_usd`, `[web_search] cache_ttl_seconds`
  to `cache_ttl_ms`, `[channels.*] gap_note_minutes` to `gap_note_ms`. An old name stops `start`
  and points at the sample.

### Fixes

- Zalo stops only after three 401s in a row; `cost --period week` starts on Monday.

## [1.0.9] - 2026-10-19

Setup no longer freezes on macOS, and its lists are picked with the arrow keys.
> Thiết lập không còn treo trên macOS, và chọn danh sách bằng phím mũi tên.

### Fixes

- `curl ... install.sh | sh` no longer freezes at the first question on macOS.
- `onboard` lists use ↑ ↓ and Enter; re-running it lets you change several parts in one go.
- A missing key for a fallback model is only a warning.

## [1.0.8] - 2026-10-19

Safer to leave running: daily backups, start at login, keys in a private file, and notices when
something goes wrong. The first start adds one database column (after a backup).
> An toàn hơn khi để chạy lâu: sao lưu mỗi ngày, tự chạy khi đăng nhập, khóa lưu trong tệp riêng, và báo khi có sự cố. Lần chạy đầu tự thêm một cột vào cơ sở dữ liệu (sau khi sao lưu).

### Running

- Daily SQLite backup, newest three kept (`[retention] daily_backups`).
- `openalpha autostart enable` starts OpenAlpha at login.
- You are told about a crash, a missed brief, or a chat channel down for 15 minutes.

### Setup

- `openalpha key set NAME` saves a key to a private file; `onboard` offers the same.
- `onboard` asks your book's currency.

### Chat and trading

- A paired chat is your default chat for notices, alerts and briefs.
- `pair revoke` stops everything sent to that chat.
- A typed price ten times off the market asks you to confirm before saving.
- Approvals work on Zalo by typing a short code.
- `/record` takes shorter lines: `/record buy FPT 100 58400`.
- `/delete <id>` now shows the row first; `/delete <id> confirm` removes it (scripts must add
  `confirm`).

### For integrators

- `DaemonTask.start(signal, options?)` takes an options object instead of a positional `onReady`.

## [1.0.7] - 2026-10-19

Telegram replies keep their context, a quiet chat rechecks prices, and web search can use DeepSeek.
No database change.
> Trả lời một tin trong Telegram là OpenAlpha biết bạn hỏi tiếp tin nào, chat để lâu thì xem lại giá trước khi trả lời, và tìm kiếm web dùng được DeepSeek.

- Replying to an answer in a private Telegram chat continues from it.
- After a quiet spell, the next answer rechecks prices.
- `[web_search] provider = "deepseek"`: cheap and strong on Vietnamese sources.
- `config validate` names a wrong `[channels.*]` value.

## [1.0.6] - 2026-10-18

Updates are easy to see and install from chat, the debate reads its evidence more carefully, and
Windows on ARM gets a native build. No database change.
> Bản mới dễ thấy và cài ngay trong chat, phần tranh luận đọc dữ liệu kỹ hơn, và Windows chip ARM có bản riêng.

- The update notice says what changed and whether it is important.
- `/upgrade confirm` installs from chat and restarts the bot; `upgrade --rollback` goes back.
- `[update] auto = true` installs patch releases overnight.
- The debate names the company and sector, dates its prices and shows five quarters of VN accounts.
- Win rates count only calls whose window has passed.
- A buy too small to rest its stop is refused.

## [1.0.5] - 2026-10-18

A friendlier first run: OpenAlpha starts without any key and says what each missing key holds back.
No database change.

- `start` never stops for a missing key; it lists what is missing.
- `doctor` and `config validate` list every problem at once.
- Numbers like `100.000.000` are refused with their plain form.
- One word for a portfolio bucket: segment.
- `/v1/rebalance` renames `sleeves` to `segments`.

## [1.0.4] - 2026-10-16

Easier reports and correct USDT bookkeeping: every report opens with its answer, and the ledger
records the rate you paid for USDT. No database change.

- `fx <rate>` or `fx auto` on a `/record` line books your rate or the market's.
- A venue holds USDT as its own cash at average cost.
- `/suggest` opens with the call; `/rebalance` opens with the plan.

## [1.0.3] - 2026-10-15

A hardening release: safer orders, a more honest track record and a sturdier daemon. The first
start adds one database column (after a backup).

- One fill books one row, whichever path records it first.
- Alerts, trailing stops and the brief keep running after one failure.
- Telegram, Zalo and social posts retry and never send twice.

## [1.0.2] - 2026-10-15

The first public release: a self-hosted trading research analyst for Vietnamese stocks, gold and
crypto. It finds ideas, argues both sides, sizes the trade against your whole book and keeps an
honest record. It never places an order you did not approve.

- One-line install for macOS, Linux and Windows; `openalpha onboard` sets it up.
- A seven-persona debate; entry, stop, target and size are set by code.
- `/reflect` scores past calls; the ledger is the truth for your book.
- Orders on OKX and Binance through `/trade`, always approved.
- CLI, Telegram, Zalo, HTTP API and MCP; the model never sees your money.

[1.0.15]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.15
[1.0.14]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.14
[1.0.13]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.13
[1.0.12]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.12
[1.0.11]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.11
[1.0.10]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.10
[1.0.9]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.9
[1.0.8]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.8
[1.0.7]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.7
[1.0.6]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.6
[1.0.5]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.5
[1.0.4]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.4
[1.0.3]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.3
[1.0.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.2
