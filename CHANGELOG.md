# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each release opens with a short English summary; from 1.0.6 on, one `> ` line in Vietnamese follows
it. OpenAlpha shows both in its update notice. A release you should install soon carries
` [IMPORTANT]` after its date.

## [1.8.14] - 2026-11-26 [IMPORTANT]

A link in a restored todo list no longer opens without asking, a buy whose run is canceled right after the fill still gets its stop, a Binance fill billed in several fee coins is no longer reported as rejected, and the web version starts the chat on a file you open. No database change.
> Link trong danh sách việc cần làm được khôi phục không còn tự mở mà không hỏi, lệnh mua có phiên chạy bị hủy ngay sau khi khớp vẫn được đặt lệnh cắt lỗ, lần khớp Binance bị thu phí bằng nhiều đồng không còn bị báo là bị từ chối, và bản web mở cuộc trò chuyện của file bạn vừa mở. Không có thay đổi cơ sở dữ liệu.

### Changed

- `/suggest stops` and the brief's stale-positions section list short-horizon holdings only, the only ones a stale reading sells.
- `key list`, `autostart enable` and the office page's key list ignore a key file other users can read, as the service already does at start.
- A social post linking to a `javascript:` or `data:` address asks first, like any other outside link.
- World gold's own factors follow the holidays set under `[trading.markets.gold]`.
- The `send_time` guide says the brief time must come before the open of every market your venues trade.

### Fixed

- After a long chat was compacted, a link in the restored todo list counted as one you typed: `web_fetch` opened it without asking and citations trusted it. A tool result carrying a todo block could also replace the agent's list.
- Five harmless warnings in a text could hide a blocking one from the memory, schedule and source checks.
- `/record` of a crypto fill made after midnight UTC was refused as a future day in a US-based book.
- Canceling a run right after the exchange filled could leave the fill unrecorded or the new position without its stop.
- A Binance fill billed in a coin with no price was reported as rejected and its stop skipped, and `/record sync binance` stopped on it.
- An exit that filled while `/trade cancel` ran was announced twice.
- World gold counted weekend bars from its backup source, tightening `gold-vn` stops and shifting gold factors.
- Clearing chat history on Postgres could delete a chat that had just started.
- Web version: opening a saved file kept the previous file's chat, and a restart (language, keys, opening a file) left a running reply spinning.
- The crypto execution skill told the agent to amend a Binance exit, which Binance refuses.
- Release checks: the licence check accepted a required copyleft licence beside a permissive choice, the architecture checks missed re-exports, dynamic imports and code after a block comment, and the strategy version check missed gold's macro reference ranges.

## [1.8.13] - 2026-11-25 [IMPORTANT]

Channel `/memory` and `/schedule` now work on the same memories and jobs as the CLI, an exposed HTTP API can no longer redirect failure notices or a provider's address, a new profile's segments stay within each category's maximum, and `/trade` counts only a resting stop-loss as protection. One database change; the upgrade runs it for you, and briefs stored before it are rebuilt on the next run.
> `/memory` và `/schedule` trên kênh chat giờ dùng chung ghi nhớ và lịch với CLI, API HTTP khi mở ra ngoài không còn đổi được nơi nhận thông báo lỗi hay địa chỉ của nhà cung cấp, nhóm của hồ sơ mới không vượt mức tối đa của loại tài sản, và `/trade` chỉ tính lệnh cắt lỗ đang treo là đã bảo vệ. Có một thay đổi cơ sở dữ liệu; lệnh nâng cấp tự chạy nó, và các bản tin đã lưu trước đó sẽ được dựng lại ở lần chạy tới.

### Changed

- `/brief` stores one brief per market region, so two regions on the same day no longer replace each other's brief.
- A new profile's seeded segment targets stay within each category's maximum; the excess goes to cash.
- `/rebalance` trims a segment's funds together back to the ETF ceiling, counting the core at its floor, and no longer suggests adding to a name that has a standing reduce.
- `/trade` and the agent's exit view count only a resting stop-loss as protection. A position guarded only by a take-profit is named as such and points to `/trade cancel` first.
- A tool's time limit pauses while its run waits for you to review a research plan, as the run's own limit already did.
- While `[api] public_url` is set, `POST /v1/config` refuses changes to `schedule.failure_target`, a channel's `fallback_chat_id`, a provider's address and the variable that holds its key.
- Plugin workflow commands run as the local operator, as channel commands do.
- Release downloads follow at most five redirects, and only to https.

### Fixed

- Channel `/memory` and `/schedule` read and wrote a separate set per chat sender instead of yours.
- A merged market read did not name the source an open circuit breaker had skipped.
- A bars read ending on a weekend or holiday flagged the series as stale and fetched it again.
- The factor board's medians counted factors that carry no weight.
- Exit recovery did not adopt an exit the venue had already triggered.
- Editing a ledger row to another instrument did not mark a reused suggestion for the old one as outdated.
- A sale whose fee was larger than its proceeds did not take the difference from cash on the trade day.
- The scheduler could start more due jobs in one tick than its per-tick limit.
- Compacting a long chat could replace a short tool result with a longer stub.
- A model stream that had started answering could still time out on the first-output limit, and its watchdog could arm again after firing.
- A blank OpenRouter rate was read as free, and a request could be retried without a rejected field after it had already streamed output.
- A blocked MCP tool description left the tool with no text; it now shows the server name. A memory whose secret was split across its key and value was saved.
- A cancelled catalog read was reported as an empty listing.
- Gemini: an empty tool call id was kept instead of replaced.
- Web version: the macro page showed empty verdict fields for a read that carries only readings, screen boards kept old labels after a restart, a refused restart dropped the new language, and a refused steer message gave the chat no answer.

## [1.8.12] - 2026-11-23

Deleting a ledger row now marks a reused suggestion as outdated, foreign cash stays correct when a buy spends a currency's whole balance, a sale whose fee passes its proceeds needs the cash to pay it, and the gold COT line shows its real rank. One database change; the upgrade runs it for you.
> Xóa một dòng trong sổ giờ đánh dấu đề xuất dùng lại là đã cũ, tiền ngoại tệ vẫn đúng khi một lệnh mua tiêu hết số dư của loại tiền đó, lệnh bán có phí lớn hơn tiền thu phải có đủ tiền để trả, và dòng COT của vàng hiện đúng thứ hạng. Có một thay đổi cơ sở dữ liệu; lệnh nâng cấp tự chạy nó.

### Changed

- `/delete` counts as a change to your book, as `/record` and `/update` do: a reused `/suggest` answer says that name or the book changed since it was made.
- A held name with no exit plan whose planning fails or finds no levels is tried again after 15 minutes instead of every minute.
- When a trailing stop is raised, a stop at the venue that covers only part of the position is no longer named as resting there, and a name split across venues where one venue could not be read is named as moved by hand.
- `doctor` reports the missing key when `[model_defaults]` names `api_key_env` without a `provider`.
- A command delivered again while it is still running or cooling down is dropped silently instead of answered as rate limited.
- Install scripts use a private folder per run, so two installs at once never share a file. `install.ps1` puts the previous `openalpha.exe` back when the final swap fails, and adds TLS 1.2 to the shell's protocols instead of replacing them.

### Fixed

- After a buy that spent a currency's whole balance, foreign cash from a sale that settled in between could still show as available, and a spend could take its cost from the wrong exchange rate.
- A sale whose fee was larger than its proceeds was booked without checking cash and could leave the venue's cash negative.
- The gold COT "vs 1 year" line printed "lowest in the window" or "above 1%" instead of the real rank.
- A name you hold could resolve to another market's listing of the same ticker while your market's listing was still loading.
- The screener measured its average range over one session more than `breakout_sessions`.
- The sector cap warning printed the sector's id instead of its name, SEC insider filings showed `&amp;` in names and titles, and a VNDirect quote with no high or low yet was dropped instead of kept without its session range.
- The `openrouter-decisions` provider called a wrong address when `base_url` ended with `/`.
- Clearing chat history on Postgres could delete a chat a run had just started using.
- A notice that failed to save could stop every later notice from being saved and keep the daemon from shutting down cleanly.
- Social network keys were not hidden from logs and outbound text like other keys, and a network's register example on another host was accepted.
- `web_search` through DuckDuckGo broke links holding encoded characters such as `%26` or `%2F`.
- `file_edit` did not check that its temporary file was opened inside the workspace.
- `autostart enable` on Windows broke on a path holding a typographic apostrophe.
- A timed-out cloud sign-in token request was reported as a passing network error rather than a timeout, and work queued after the database closed on a failed rollback failed with a driver error instead of a storage-closed one.
- Web version: the clock preview drifted an hour on a daylight-saving day, and switching to 2D after a failed 3D load set the office up twice.

## [1.8.11] - 2026-11-23 [IMPORTANT]

A page token can no longer point a channel's token file at another file on your machine, a long chat no longer lets the agent open a link it read on a fetched page without asking, and a take-profit tranche of 100% now sells the whole position at the take-profit everywhere it is shown, alerted and scored. No database change.
> Token của trang web không còn trỏ được tệp token của kênh sang một tệp khác trên máy bạn, cuộc trò chuyện dài không còn cho agent mở link đọc được trong trang mà không hỏi, và chốt lời từng phần 100% giờ bán toàn bộ vị thế ở mức chốt lời ở mọi nơi hiển thị, cảnh báo và chấm điểm. Không có thay đổi cơ sở dữ liệu.

### Changed

- `take-profit-tranche-pct 1` sells the whole position at the take-profit: the plan says so, the R:R and stake are measured to it, the held take-profit stays put until it sells, and the track record grades those calls there. Plans that leave whole at the target (a reduce, a fund, a market with no trailing stop) are unchanged.
- A channel's `token_file` changes only from the CLI or in `config.toml`, like `token_env`.
- After cancelling the rest of an unfilled order, `/trade` reads the order back until the venue reports it finished; one it never sees finish is left flagged to reconcile instead of being called unfilled.
- Web version: changing a custom venue's market is refused while your book has rows on that venue.
- Zalo personal runs on zca-js 2.3.0, which fixes an unhandled message type in its listener.

### Fixed

- A page token could set a channel's `token_file` to any local file and restart the daemon.
- After a long chat was compacted, a link the agent had read on a fetched page could be opened without asking.
- A configured key could drop out of log scrubbing after many credential saves.
- A research source flagged for prompt injection could lose its warning once its paragraphs were ranked, and coin names from crypto rankings reached prompts unfiltered.
- Research dropped a claim when a second line of inquiry quoted the same passage from the same source.
- Spending foreign cash that had settled, while a sale was still settling, used the unsettled sale's exchange rate for its cost.
- A stop finer than the instrument's price step became zero and was refused by the venue only after the entry filled; it is now refused before.
- `/themes` showed earlier sectors and stocks under a weakening or ended theme when the screen step failed.
- The track record could count a resting buy as filled on a session locked at the ceiling.
- A FRED value left blank read as zero.
- Crypto and world gold could treat the previous day as settled during the first 29 minutes after midnight UTC.
- Web version: the 3D office kept redrawing after a lighting change, a slow older chat page could overwrite a newer one, and a failed 3D load could show the fallback note after you had already switched to 2D.
- `autostart enable` refuses an argument with a line break, `db restore` writes the restored file private, and an aborted Zalo personal login no longer leaves its QR image behind.

## [1.8.10] - 2026-11-23 [IMPORTANT]

Cancelling an exit that had already filled now books the sale instead of dropping it from your book, moving an OKX exit goes through, and Gemini models no longer fail when they call several tools at once. One database change; the upgrade runs it for you.
> Hủy một lệnh thoát đã khớp giờ ghi lệnh bán vào sổ thay vì làm mất nó, dời lệnh thoát trên OKX đã chạy được, và mô hình Gemini không còn lỗi khi gọi nhiều công cụ cùng lúc. Có một thay đổi cơ sở dữ liệu; lệnh nâng cấp tự chạy nó.

### Changed

- `/trade cancel` and the Cancel exit button read each exit back after cancelling and say which of three things happened: the exit was cancelled, it had already filled (the sale is booked and you get the fill notice), or the venue did not confirm it (it may still rest; check the venue).
- Bare `/brief` builds today's brief when none is stored yet, as `/brief force` does, instead of showing an older day's. Building it spends the brief's model calls.
- An agent's 100-job cap now holds when jobs are added at the same moment from the CLI, the API and the agent's schedule tool.
- Memory search matches Vietnamese typed with decomposed accents, and a search keeps at most 16 words. Memories saved before are rewritten to the composed form once, at upgrade.
- Web version: a raw copy of the installed version's database file is named as one instead of reported as broken, and a file whose tables do not match its own migrations is refused. The answer to a cancelled exit is laid out like the answer to a placed order.

### Fixed

- Cancelling an exit that had already filled at the venue dropped the sale from your book.
- Moving an OKX exit's take-profit or stop was refused by OKX.
- `/trade status` read a stop covering part of an OKX position as guarding all of it; the uncovered size now shows as unguarded.
- Staging a buy counted the name being bought as one of your untracked open trades.
- Foreign cash from a sale that had not settled yet (T+N) counted as available at its old cost, so a buy or withdrawal could spend money not yet there.
- A foreign-currency row marked as needing no conversion (a deposit, withdrawal, fee, loss, transfer or market row) was booked at one base unit per unit; it is now refused.
- Gemini models failed when they called several tools in one turn.
- A suggestion's cooldown and round-trip windows were counted from a day with no session, such as a weekend or holiday; they now count from the last session.
- A screener alert waiting to be delivered could be switched off before it was sent.
- Settled price bars could include bars past the window asked for, a Yahoo metals quote is marked as priced in dollars, and a zero or negative Vietcap chart price is dropped.
- On Postgres, a run that had already lost its chat to a newer run could still write messages to it.
- Zalo: a 403 reply is retried instead of treated as final. Zalo personal: a group message with an unusual mention list no longer breaks reading it, and a failure to lock down the saved credentials is logged.
- `file_list` with a glob matched nothing on Windows.
- A schedule time with an offset outside -12:00 to +14:00 is refused.
- Behind a proxy, the API reads the client address from `X-Forwarded-For` first, then `CF-Connecting-IP`, then `X-Real-IP`.
- Web version: a failed import, a failed autosave or a stopped worker no longer leaves the page stuck.

## [1.8.9] - 2026-11-20

`/trade okx:SUI` now trades the coin even when a US stock shares the symbol, the order cash check counts USDT held at a venue the way the book does, and a key in `[model_defaults]` no longer reaches another vendor's server.
> `/trade okx:SUI` giờ đặt lệnh đúng đồng coin kể cả khi trùng ký hiệu với cổ phiếu Mỹ, phần kiểm tra tiền mặt khi đặt lệnh tính USDT đang giữ ở sàn đúng như sổ, và khóa trong `[model_defaults]` không còn bị gửi tới máy chủ của hãng khác.

### Changed

- A key named in `[model_defaults]` is lent to an entry of another provider only when that provider is the same vendor (`openrouter-decisions` beside `openrouter`), whatever variable you named. Vertex and Azure entries now sign in with your cloud account instead of sending the router's key, a server on this machine gets no key, and another hosted provider needs its own `api_key_env`: without one, `doctor` names it and the entry is refused at start, where before its calls failed. A `[model_defaults]` that names no provider still lends its key to every entry.
- `/portfolio nav` counts a deposit from the start of its day and a withdrawal at its end, so a deposit much larger than the book is no longer read as a return. Your history is recomputed on the next read; a book with no deposit or withdrawal reads as before.
- Scheduled jobs, heartbeat ticks, workflow steps and a command's hand-off to an agent no longer learn preferences from their prompt, which is stored or composed rather than typed for that run. Saved preferences still shape their replies.
- `shell_exec` refuses a blocked interpreter or launcher before it asks for your approval, not after.
- A spawned helper no longer lists `memory_recall`, which could never find anything there.
- A broken `HEARTBEAT.md` (a link, a pipe, too large or unreadable) is ignored as if missing and warned about once, not on every tick.
- Web version: `/research`, and research asked for in chat, check the keys of both research models and the search key before any call; a model with no key of its own counts as ready when another model in its chain has one.

### Fixed

- `/trade spot`, `/trade exit` and `/trade cancel` with `okx:` or `binance:` looked the name up among stored stocks first, so a coin sharing a US or VN symbol (SUI, LINK, HDB...) was refused, and a cancel said no exit rested while one did. The venue now picks the market, crypto segment switched off included.
- The order cash check counted a venue's USDT at its old cost together with its VND, so a USDT buy above the USDT held could pass and then fail to book, or an affordable one be refused. It now uses the cash the book would pay from, and says how short it is in that currency.
- A take-profit or stop that filled between 19:00 and midnight New York time for a US-based book could fail to book until the next day; it now books at once without asking the exchange again.
- Cancelling an OKX exit that had already triggered or been cancelled failed instead of closing it.
- A Binance sell charged partly in the coin sold (BNB) booked too few coins as sold.
- `/portfolio nav` could turn negative for good after a large same-day deposit followed by a loss.
- A long chat trimmed a large tool result one step late, and a link the answer took from a trimmed result could be stripped as unverified. Results are now trimmed before every model call and their links still count.
- Compacting a long run now gives the summary a shortened copy of older tool results instead of none, so facts they established are kept.
- `/schedule run` cancelled from Telegram or the office page now stops the job.
- One office page tab closing no longer stops a reply another tab started on the same conversation.
- In a Telegram group, a photo or file whose caption mentions the bot is now answered.
- A delegated helper that ended without acting reported an approval timeout; it now reports a failed run with the reason.
- Web version: the "Change budget" button, which opened the model settings, is gone (the daily cap is fixed there), and a finished `/research` no longer makes a request that fails.
- `plugin update` on a built-in plugin names the right reason.
- Hardening: `HEARTBEAT.md` is opened without following a link and without waiting on a pipe.

## [1.8.8] - 2026-11-20

Editing a trade in another currency keeps the rate you paid, a book holding only cash shows its value and plan on the office page, and a fund's review level no longer shrinks suggested buys.
> Sửa một giao dịch bằng ngoại tệ giờ giữ đúng tỷ giá bạn đã trả, sổ chỉ có tiền mặt hiện đủ giá trị và kế hoạch trên trang văn phòng, và mức xem lại của quỹ không còn làm nhỏ khối lượng mua được đề xuất.

### Changed

- A link that comes back from an MCP tool or a social post no longer opens without asking; only your own words and OpenAlpha's built-in network tools (search, news, market data) do.
- `GET /v1/config` hides an MCP server's arguments, as `config show` already did.
- `shell_exec` also refuses the Windows shells and script hosts (`cmd`, `powershell`, `pwsh`, `wscript`, `cscript`, `mshta`) and a blocked program named with `.exe`, `.cmd`, `.bat` or `.com`.
- A brief from an earlier day stands in for today's only while your profile is unchanged since it was built; after an edit, `/brief` builds a fresh one.

### Fixed

- Editing a trade in another currency on a day when that currency also reached the venue later (a USDT deposit after a buy paid in VND) refused the rate you stated, and on the office page saved the day's market rate instead. The edit now keeps its place in the day and the rate you paid. The confirmation, `/ledger` and `/record sync` no longer call such a buy paid from held cash.
- A held fund's review level counted as open risk, shrinking suggested buys, and could put the fund in the "no planned stop" warning. It now counts as neither.
- The office page called a book holding only cash empty; it now shows the total, cash, segments and the rebalance plan.
- `db import` into Postgres failed on scheduler history and left its counter behind; it now imports and resyncs it.
- `doctor` checks the book's currency on Postgres too.
- The monthly scorecard could print twice after an update changed the brief's layout; a brief day skipped after downtime is no longer recorded as sent.
- `upgrade` names the version just installed in the restart hint, and after `--rollback` says to restart without naming one.
- `key set` mentions plugin sources only when plugin code can load (`allow_untrusted` and `allow_code`).
- A data source's health counts one request shared by several readers once.

## [1.8.7] - 2026-11-20

A cash dividend paid in another currency now lowers that holding's cost, `/rebalance` again proposes the sale that brings a sector over its cap back down, and a leveraged US fund you hold is watched with a real stop.
> Cổ tức tiền mặt trả bằng đồng tiền khác giờ cũng hạ giá vốn của mã đó, `/rebalance` lại đề xuất lệnh bán đưa một ngành vượt trần về đúng trần, và quỹ đòn bẩy Mỹ bạn đang giữ được theo dõi bằng mức cắt lỗ thật.

### Changed

- A sale into currency cash a venue holds, and a dividend, now take an `fx` rate you state; without one they are valued at that day's market rate as before, never asked. So a day the rate source has no rate for no longer blocks the row. A buy, fee or transfer paid from currency cash the venue holds still takes no rate, and the refusal says so.
- While `[api] public_url` is set, saved for the next start included, signing ChatGPT out, approving a pairing and making a job for another chat happen on the server. The office page shows the command to copy instead of the button.
- `openalpha config show` and `config get` hide an MCP server's address, `env` table and arguments, where a `${VAR}` is already filled in.
- A background task paused because the machine is offline (a sleeping laptop, say) now says that plainly, instead of naming `example.com`, the address it checks the network with.

### Fixed

- A cash dividend in another currency than the book's (a US share's USD dividend in a VND book) now counts in the holding's cost after dividends.
- `/rebalance`: a sector past its cap could end with no sale, or too small a one, when the name to trim still scored above zero. The trim now holds, and the warning names the cap you set rather than the room left under it.
- A leveraged or inverse US fund you hold (TQQQ, SQQQ) reads as a stop on `/portfolio`, its row and the market-drop alert, as its plan and exit alerts already treated it. Before, those places called it a level to review.
- The exit plan message for a newly held name prints prices as every other surface does: a VN stock at board scale with the scale note under it, VN gold in VND per tael.
- A crypto buy call served again from an earlier day now says when your book changed since it was made.
- The first take-profit on a holding already partly sold, where what is still owed is under one board lot, now names that share instead of the plan's whole one.
- A resting buy that fills on a later session counts T+N settlement from its fill in the track record.
- Stopping OpenAlpha while an order is being checked or exits are reconciled no longer logs failures for each one, and one market's failed list load no longer hides another market's note.
- The office page wraps a long ChatGPT account name inside its card.
- Hardening: an MCP server's request never follows a redirect; a plugin whose `plugin.toml` is a link, or a `git://` source, is refused; a key saved from the office page is hidden in logs at once; fetched pages lose a further set of invisible characters and script blocks closed with a space; a link you typed in capitals or with brackets or commas counts as yours, so the agent opens it without asking.

## [1.8.6] - 2026-11-18

A web page OpenAlpha reads can no longer send it on to a link of the page's choosing without asking you, and text you cannot see no longer reaches the analysts unnoticed. Your keys are now hidden in logs and tool results whatever they look like.
> Trang web OpenAlpha đọc không còn tự dẫn nó sang link do trang chọn mà không hỏi bạn, và chữ vô hình không còn lọt tới các nhà phân tích mà không ai hay. Khóa của bạn giờ được che trong nhật ký và kết quả công cụ, dù trông thế nào.

### Changed

- Reading the web: the agent still opens a link you sent, or one a search or news read brought back, without asking. A link it picks off a page it has just read now waits for your approval, since a page can plant links that would carry what the agent read, such as the names you hold, to someone else.
- The office page's config editor shows each MCP server's address as `********`, and `openalpha config show` masks it too, since a hosted server's key often sits in its address. Saving keeps the address from the file.

### Fixed

- Headlines, company events and other text from data sources lose every invisible character (soft hyphens, direction marks, Unicode tag characters) before a model reads them. Tag characters, which can carry hidden instructions, now count as text-hiding: a web page or tool result holding them reaches the model with a security notice, and a skill holding them is refused.
- A line break inside a headline, a company event or a theme's evidence can no longer forge an extra line in what the analysts read, such as a fake evidence item for a theme claim to cite.
- Every key your config reads (models, web search, exchanges, data sources, chat channels) and the API token are hidden in logs, errors and tool results, even a bare key with no name beside it, and memory refuses to store one. A key kept under its `OPENALPHA_` name counts too. An MCP server's `${VAR}` values do not, since they also fill commands and paths.

## [1.8.5] - 2026-11-17

Ask for a price before a market's list of names has loaded and OpenAlpha now waits a few seconds for it and answers, instead of saying it doesn't know the name. Your cost on a holding that paid cash dividends now matches your broker's app.
> Hỏi giá khi danh sách mã của thị trường chưa tải xong thì OpenAlpha giờ chờ vài giây để tải rồi trả lời, thay vì báo không biết mã. Giá vốn của mã đã nhận cổ tức tiền mặt giờ khớp với app công ty chứng khoán.

### Changed

- A holding that earned cash dividends you recorded shows its cost after dividends, the way a Vietnamese broker does: what you paid with fees, less the dividend grossed back up to what was declared before the 5% tax. The suggestion report, `/portfolio`, the line after `/record` and the office page's ticker card all show it and measure that holding's profit and loss from it, and the report keeps what you paid beside it. `[trading.markets.<id>] dividend_tax` sets the withholding rate; US shares keep the cost paid unless one is set. The brief counts a holding as in loss against the same cost, and a dividend recorded at a venue that holds none of that name says it lowers no cost. NAV, the book's total profit and loss and realized profit are unchanged.
- The suggestion report says "your cost, fees included" instead of "you bought at", since the figure always held the buy fee.
- `/profile` and `/portfolio` list the switched-off markets with the name each one takes and the command that switches one on. The chat's welcome line and the steps `onboard` prints after setup point to `/profile` and `/setup` instead of asking you to run `/refresh` first, since data now loads the first time you ask.
- A bare ticker that finds no price names the switched-off markets that could list it, with the two ways in: `equity-us:AAPL`, or `/profile enable equity-us`. Through an AI app, the assistant offers the same and asks before switching a market on.

### Fixed

- A price or suggestion asked for in a stock market whose list of names has not loaded yet waits for it, up to about half a minute, then answers. Naming the market (`/price equity-us:AAPL`) loads it even while that market is switched off. Recording a trade never waits.
- When a list still has not loaded, the message says it is loading or its source didn't answer, and how to retry, instead of telling you to run `/refresh` first.
- `mcp serve` beside a running background service now loads a market the assistant switches on at once, instead of at the service's next scheduled refresh.
- Setting a segment's own target in `/profile` no longer moves its row down the table.
- The `openalpha-mcp` package page on npm is in English only, and its description names US stocks too.

## [1.8.4] - 2026-11-17

Through an AI app, a market you switch on or a name you start watching now has prices within seconds, with no restart, and a session the app keeps open for days keeps getting each new close.
> Qua ứng dụng AI, thị trường bạn vừa bật hay mã bạn vừa theo dõi giờ có giá sau vài giây mà không cần mở lại app, và phiên app giữ mở nhiều ngày vẫn nhận giá đóng cửa của từng phiên mới.

### Fixed

- `mcp serve` with no background service running loads a market as soon as the assistant switches it on or watches a name in it. Before, that market stayed without a list of names until the app was restarted.
- `mcp serve` with no background service running refreshes the markets you use every hour, not only as it starts.
- The assistant no longer tells you to run `/refresh`, which the AI app does not have, while a market is still loading.

## [1.8.3] - 2026-11-17

AI apps that use OpenAlpha without the background service now get Vietnam stock prices from the first start: `mcp serve` loads the market data itself instead of waiting for a refresh nobody runs.
> Ứng dụng AI dùng OpenAlpha mà không chạy dịch vụ nền giờ có giá cổ phiếu Việt Nam ngay từ lần khởi động đầu: `mcp serve` tự tải dữ liệu thị trường thay vì chờ một lần làm mới không ai chạy.

### Fixed

- `mcp serve` with no background service running refreshes the markets you use once as it starts. On a first start the list of names loads within a minute and the price history within a few minutes; a later start only tops up what went stale. Before, every Vietnam ticker answered that the market's list of names was missing until `openalpha start` or `/refresh` ran.

## [1.8.2] - 2026-11-17

OpenAlpha is now listed on the official MCP Registry, so AI apps that read it can find and add it. Each release carries an extension for the Claude app, and the `openalpha-mcp` npm package starts OpenAlpha from apps that install servers with `npx`. `mcp serve` no longer needs a config file to start.
> OpenAlpha giờ có trên MCP Registry chính thức, nên các ứng dụng AI đọc registry tìm và thêm được nó. Mỗi bản phát hành kèm một tiện ích cho ứng dụng Claude, và package npm `openalpha-mcp` chạy OpenAlpha từ các ứng dụng cài server bằng `npx`. `mcp serve` không còn cần tệp cấu hình mới khởi động được.

### Added

- `openalpha.mcpb` on every release: an extension for the Claude app on macOS and Windows. Open it with the Claude app; it starts the OpenAlpha you installed, from `~/.local/bin` unless you point its install folder setting elsewhere.
- The `openalpha-mcp` npm package for apps that install MCP servers with `npx` (`npx -y openalpha-mcp`). It also starts the OpenAlpha you installed, and reads `OPENALPHA_INSTALL_DIR` when you installed it somewhere else.
- OpenAlpha is listed on the MCP Registry as `io.github.alex2loop/openalpha`; directories such as Glama and PulseMCP mirror it.

### Changed

- `mcp serve`, `mcp surface` and `mcp install` work before `openalpha onboard`: until a `config.toml` exists, the defaults apply.
- The server entry `mcp install` prints names your data folder, and your config file only once it exists.

## [1.8.1] - 2026-11-17

A round of fixes. Crypto fills on a US-home book are dated on your day, refusals and market figures print in the right currency and unit, and the brief reads the session that actually settled. In the web app you can now pick which agent or model answers, and a run that stops without a reply says why.
> Một đợt sửa lỗi. Lệnh crypto khớp trên sổ nhà Mỹ được ghi theo ngày của bạn, câu từ chối và số liệu thị trường in đúng tiền tệ và đơn vị, bản tin đọc đúng phiên đã chốt. Trên ứng dụng web, bạn giờ chọn được agent hoặc mô hình trả lời, và lượt chạy dừng mà không có câu trả lời sẽ cho biết lý do.

### Changed

- The web app can pick the agent that answers (`/agent <id>`) and the model (`/model <selector>`), as Telegram and Zalo can; the terminal still picks them with `chat --agent`.
- `/v1/ohlcv` and `/v1/price-chart` answer `unavailable` with a sentence for a market with no price history of its own, such as SJC gold, instead of `not_found`.
- The Vietnam index price history tries vietcap-chart before entrade when vndirect does not answer.
- The test button for a model provider is now counted in your AI spend, under `provider-test`.

### Fixed

- A fill is dated on its market's day, never later than your book's: a crypto fill made in the US evening is booked on the day it is in New York, in `/record sync`, order fills and stop exits.
- A refused order prints each cap in its own currency, never a VND figure labelled USDT.
- The leader's share of a sector, session times (now printed in your clock), Vietnam index levels in `/watchlist`, `/market` and alert questions, and the session high and low given to the assistant use the right units.
- The brief counts its AI cost after the debates, reads the session that settled rather than the calendar day, no longer prints the monthly scorecard twice after an update, keeps each market's stories apart, and reads a missing foreign-flow figure as missing rather than zero.
- A second opinion on a name you do not hold no longer carries notes about your book.
- The `/record` line a suggestion offers carries the day the trade can happen.
- Theme scores: stale commodity readings are left out, a theme keeps its earlier sectors when the screen could not be read, and crowding can read "undecided" when one signal is missing.
- On the office page: a halted run shows its reason instead of an empty card, `/SUGGEST` and `/suggest` are the same command, "Add to it" refuses a `/` line, a mouse wheel that scrolls by lines zooms like one that scrolls by pixels, today's boards follow your own day, a failed digest read keeps the last one, and the file autosave keeps a change made while a copy was being written.
- OpenRouter prices stay current whichever feed refresh fetched them, the spend ceiling reserves enough for models that always reason, and a local model is free only for that model, not for every model of its provider.
- An approval answered with a choice it did not offer is refused, and an alert handed back mid-send keeps its attempt count.

## [1.8.0] - 2026-11-16

US names now show their next earnings date and warn that the price can gap on the report, risky 8-K filings are flagged, and a buy is held after a bankruptcy filing or a warning that past accounts cannot be relied on. `/overview` and the US brief show market breadth and distribution days. `/reflect` shows how far calls ran for and against you before they closed. The brief now opens with your home market.
> Mã Mỹ giờ hiện ngày báo cáo kết quả kinh doanh sắp tới và cảnh báo giá có thể nhảy vọt khi công bố. Các 8-K rủi ro được gắn cờ, và đề xuất mua bị giữ lại khi công ty nộp đơn phá sản hoặc báo số liệu tài chính cũ không còn tin được. `/overview` và bản tin Mỹ có độ rộng thị trường và số phiên phân phối. `/reflect` cho thấy đề xuất đã chạy bao xa theo hướng có lợi và bất lợi trước khi đóng. Bản tin giờ mở đầu bằng thị trường chính của bạn.

### Added

- The next earnings date of a US name, before the open or after the close, with the EPS forecast, from Nasdaq's calendar: on `/price`, in the analysis and in the brief's "Filings, earnings and ex-dividend dates" list. Every answer on a name that reports within the next few sessions says the price can gap overnight past any stop.
- Five 8-K items are flagged on US names: bankruptcy filing, material impairment, listing notice, change of auditor, and past financials not to be relied on. An answer on the name says what was filed and when; a bankruptcy filing or a non-reliance notice holds a buy until you have read it, while selling stays open. The brief always keeps a flagged filing in its list and asks you to read it when you hold the name.
- `/reflect` shows, at the median and in risk units, how far winners went against you and how far losers and stopped-out calls went your way before they closed. A median shows once enough calls back it.
- US market breadth in `/overview` and the US brief: the share of names above their 200-session average, and distribution days (a major index fund closing down on higher volume) over the recent sessions. The US brief tells the stories "Breadth is widening", "Breadth is narrowing" and "Heavy selling days are piling up".
- The single-name screen view, for example `/screen crypto BTC`, shows the name's rank, verdict and composite score.

### Changed

- The brief opens with your home market: the header strip leads with its index (Nasdaq Composite for a US home), and the verdict and the change since the last session read that market only. A figure whose section is missing, such as USD/VND on a US home, is left out.
- The office page lays out the brief and its other views at the page's width instead of a phone's, and the brief's header strip never splits a figure across lines.
- `openalpha start` and `status` name each background task when its first pass starts and say when it is done or why it failed, instead of reporting all tasks idle while one is still working.
- Insider purchases filed in one Form 4 are listed one by one.

### Fixed

- Warrants, preferred shares, notes and units, including warrants on American depositary shares, no longer appear on the US board, and a Nasdaq name with no trades no longer stops its price history from loading.
- A US macro backdrop stored without some drivers (the dollar index and VIX when FRED did not answer) is fetched again by the next refresh after 15 minutes, so the brief no longer reports them missing for the rest of the session.
- The web edition records your book's value while the page is open, so its value history no longer stays empty.

### Upgrading

- Resolved calls now store how far the price ran for and against them. 1.7.0 cannot read those calls, so going back to 1.7.0 with `openalpha upgrade --rollback` drops them from your track record. Downgrading to 1.7.0 is not supported.

## [1.7.0] - 2026-11-15

A name's card now draws its price chart over one, three or six months or a year, with volume and the 50- and 200-session averages. `/overview` and the market tab show who bought and who sold on the Vietnam market, and which sectors the money went into. The Screen board has a clearer Vietnamese name.
> Thẻ mã giờ có biểu đồ giá 1 tháng, 3 tháng, 6 tháng hoặc 1 năm, kèm khối lượng và đường trung bình 50, 200 phiên. `/overview` và thẻ Thị trường cho thấy ai mua, ai bán trên thị trường Việt Nam và tiền đang vào ngành nào. Màn lọc đổi tên thành Bảng lọc mã cho dễ hiểu.

### Added

- Price chart on a name's card: pick 1M, 3M, 6M or 1Y (3M by default; the page remembers your pick), with volume bars, MA50 (solid), MA200 (dotted) and your plan's levels. Markets with no price history of their own, such as SJC gold, show no picker.
- How a session's volume compares with its 20-session average, on the card and in `/price`.
- "Who bought, who sold" for the Vietnam market in `/overview`, on the market tab and in the assistant's market overview: foreign investors, proprietary desks and everyone else over the last 21 sessions, their 5-session averages, a plain reading (both selling, both buying, on opposite sides, or only one side trading) and how many sessions in a row foreign investors have bought or sold. It is dated by the newest session the desks have reported, so a late report never mixes two days.
- "Where the money went": the five sectors with the most traded value against their 20-session average and their share of the market, in `/overview` and on the market tab.
- `GET /v1/price-chart` for apps (bars, averages and volume against average for one name over `1m`, `3m`, `6m` or `1y`).

### Changed

- In Vietnamese, "Màn lọc" is now "Bảng lọc mã" everywhere.
- `/overview` no longer prints today's foreign total on its own when the flow block already covers today, and the proprietary desk line now sits inside the flow block.

### Fixed

- Sector strength is dated by the session it was traded, not by a weekend day.

## [1.6.3] - 2026-11-13

Order caps now count orders that filled at the exchange but never reached your ledger, gold rebalancing prices a buy at what the shop charges, Zalo shows command replies without long links, and the same event reads the same everywhere.
> Hạn mức lệnh giờ tính cả lệnh đã khớp ở sàn nhưng chưa vào sổ, kế hoạch cân bằng vàng tính giá mua theo giá tiệm bán ra, Zalo hiện kết quả câu lệnh không kèm đường link dài, và cùng một sự kiện được gọi giống nhau ở mọi nơi.

### Changed

- `maximum_price_drift` is capped at `0.1` (ten percent). A config with a larger value, such as `5` typed for five percent, is refused at startup with a message naming the key, instead of quietly switching the drift guard off.
- On Zalo, command replies, briefs and alerts read like the terminal: a source shows its name without the long redirect link, and detail lines keep their indent. Answers from the assistant keep their links.
- One word per event: a broken stop is "thủng mức cắt lỗ" / "broke its stop" in the terminal, chat and the web; "Lãi/lỗ" and "P/L" label profit and loss; the most-traded board has one name; the English gold board reads "shop buys / shop sells".
- `/market enable` and `/market` say plainly when no send times are set and name the `send_times` key to add.
- `openalpha --help` and `help <command>` work even when `config.toml` cannot be read.
- `agent bind --help` marks `--channel` as required.

### Fixed

- A buy now counts orders that filled at the exchange but are not in your ledger yet against the per-name and per-group caps, both on the confirmation prompt and again just before the order goes out.
- `/rebalance` sizes a buy of gold you already hold at the shop's selling price and a sale at its buying price; if the shop board cannot be read, a planned sale still shows, at your book's price.
- The reserve warning and the cash advice in `/rebalance` read the same settled cash; a note says when foreign cash sits at cost while the table marks it at today's rate.
- The web hides "Unrealized P/L" while a holding has no price, as the terminal does, and shows the server's own figure.
- `/suggest` on a tokenized stock (for example NVDAB or NVDAX) says what it is instead of "check the spelling" or analysing it as a coin; more stablecoins and tokenized stocks stay off the crypto board and breadth.
- A record dated in the past no longer converts at an exchange rate from days after that date when the rate providers are down.
- The VN gold board is read once per day asked instead of on every price read.
- A replan for an older strategy version that fails during a provider outage is retried later instead of waiting for the next session, without a warning on every check.
- A repeated `limit`, `tp` or `sl` in `/trade` is refused instead of silently keeping the last one.
- The web budget fields use the page's decimal separator.
- On the web, Book and Today update right after a `/record`, `/update`, `/delete` or `/profile` change typed in the chat, and the web version saves its copy then too; a holding shows its own price, not "—".
- Error lines that list channels say "(không có)" in Vietnamese.
- Docs: a run that times out exits with code `12`; the commands open to every chat member are named; `zalo login` gives up after five minutes; missing release links were added.

## [1.6.2] - 2026-11-12

Gold prices name their unit everywhere and gold alerts watch the price the shop pays you; orders re-check your caps right before they go out; a mistyped ticker is asked about before it reaches your ledger; and the web, the terminal and chat read figures, dates and Vietnamese terms the same way.
> Giá vàng giờ ghi rõ đơn vị ở mọi nơi và cảnh báo giá vàng theo dõi giá tiệm mua vào; lệnh được kiểm lại hạn mức ngay trước khi gửi đi; mã gõ nhầm được hỏi lại trước khi vào sổ; và web, terminal, chat đọc số liệu, ngày tháng và thuật ngữ tiếng Việt giống nhau.

### Changed

- Gold prices show their unit, per lượng (tael) or per ounce, on every surface: prices, the market tab and its session card, the price tape, the brief, alerts, exit levels and analysis lines. A gold shop's board shows its buy and sell prices and the gap between them, never a "closing price".
- A price alert on VN gold watches the buy price, what the shop pays you, the same side your holding is valued on, and every place it appears says so. Alerts you already set keep their level and are now read this way.
- In Vietnamese, a suggestion is an "đề xuất", something you type is a "câu lệnh" and a call to the AI is a "lượt gọi", in the terminal, in chat, on the office page and in the guides; "lệnh" is kept for an order at an exchange.
- The web reads figures like the terminal and chat: no "-0,00", macro and benchmark weights in whole percents that add up to 100, a portfolio's return in the same form as `/portfolio`, and grouped token counts.
- Win rates and hit rates are a whole percent everywhere; a cap line that would round to its own cap shows two decimals instead.
- AI spend in the terminal never reads "0,0000 USD" for a call that cost something; `/cost` shows its dates day-first, and large token counts read as "1,2M".
- History says why a run stopped (turn limit, budget, a restart) in your language, followed by the provider's message when it adds something.
- `openalpha logs --help`, `key --help`, `autostart --help` and `db migrate --help` mark the default subcommand and show its flags.
- The web trade form opens on your home market's trading day, the day the terminal and chat propose.
- Sector names use one capitalization per language, and English text uses US spelling.

### Fixed

- `/record` and `/update` no longer book a ticker no market lists. A typo such as `equity-vn:FPQ` is held with the closest name ("FPC?") and a button to confirm it as a real trade, for a delisted or newly listed name. The assistant and the web trade form ask the same way; trades read from your exchange are never held.
- An order now re-checks your profile's position, segment and ETF caps just before it goes out. A cap the order prompt showed you passes only if it has not grown since you looked; one crossed or deepened in between, by another fill or a price move, refuses the order and says which cap, in your language.
- `/rebalance` sells a fund you hold in a segment whose ETF cap is 0, whatever its score, and says why.
- A ledger figure far beyond any real one (a slip of several zeros) is refused and named instead of breaking your book's totals.
- A staged order whose saved record cannot be read keeps its confirm code, and `/trade` status no longer fails because of it.
- Editing and deleting an agent at the same moment no longer race, so an edit cannot bring back a deleted agent.
- Saving settings on the web is all or nothing.
- The guides state how long macro documents are kept (at least 775 days), and `config.sample.toml` lists every built-in venue that cannot set markets.

## [1.6.1] - 2026-11-12

Money, prices and your ledger now read the same on the web, in the terminal and in chat, with cents in a dollar book and every digit you recorded. An ETF cap of 0 now really keeps funds out, and a few rare failures that could lose a settings change or stop OpenAlpha are fixed.
> Tiền, giá và sổ giao dịch giờ hiển thị giống nhau trên web, trong terminal và trong chat: sổ tính bằng đô la có số lẻ đến cent, và sổ giữ đủ mọi chữ số bạn đã ghi. Trần ETF bằng 0 giờ chặn được ETF thật sự, và vài lỗi hiếm có thể làm mất một thay đổi cài đặt hay làm OpenAlpha dừng đã được sửa.

### Changed

- On the web, money follows its currency's own decimals (cents in a USD book, whole đồng in a VND one), crypto prices keep the digits they show in chat (2.346, not 2.35), and gains and losses carry ▲/▼ and their colour, on each holding too.
- The ledger shows every digit you recorded, so you can check it against your broker's slip; on a phone each row wraps to two lines instead of cutting a figure.
- AI spend reads the same everywhere in your language, for example "0,0142 USD / 2,0000 USD (1%)".
- Large English figures are spelled out ("76.5 billion"), and the win rate per model shows a whole percent with its likely range, as `/reflect` does.
- On a phone the header shows today's AI spend alone (the cap is one tap away), and the web version hides the clock and the 2D | 3D switch on narrow screens so the "Not advice" note always fits.
- In Vietnamese, past calls are called "đề xuất" and portfolio buckets "nhóm" everywhere.
- A run stopped by its budget no longer quotes dollar amounts in its history.

### Fixed

- A buy of an ETF into a segment whose ETF cap is 0 is now flagged by `/trade` and refused by the assistant, with a plain line saying your profile keeps ETFs out.
- Two settings saves at the same moment, from two tabs, no longer lose one; the second is told the settings changed.
- With Postgres, a connection dropped in the middle of a write no longer stops OpenAlpha.
- When Telegram asks the bot to slow down, it now waits as long as Telegram asked.
- A drawing error on the office page shows a short message and a Reload button instead of a blank page.
- Long model names wrap at the slash on a phone instead of in the middle of a word.

## [1.6.0] - 2026-11-12

The office page now shows who worked on each run, for how long and at what cost, and says plainly when it has lost touch with OpenAlpha. Crypto moves, the Screen board and a name's past calls read the same everywhere.
> Trang văn phòng giờ cho thấy ai làm gì trong mỗi lượt chạy, mất bao lâu và tốn bao nhiêu, và nói rõ khi mất liên lạc với OpenAlpha. Biến động giá crypto, Màn lọc và các đề xuất cũ của một mã giờ đọc giống nhau ở mọi nơi.

### Added

- "Who did what": a timeline of each run on the office page, one lane per person with how long they were busy and, on the installed app, what they cost.
- When the page loses OpenAlpha it says since when, freezes the office and greys out Stop.
- `GET /v1/runs/:runId/timeline` for apps.

### Changed

- A crypto move is always measured against the last settled close, never a rolling 24-hour figure; with no close it shows no move.
- A name's card counts its past calls as `/reflect` does: repeats once, only calls whose window has passed.
- On the Screen board search, the name whose ticker you typed comes first.
- Answers name markets in full ("Crypto market"), and `/screen` with a wrong number says it takes 1 to 50.

### Fixed

- At start the office shows one data refresh, not three.
- A data refresh stopped halfway is tried again within minutes.
- `/screen equity-vn:FPT crypto` answers with the kind problem alone.
- The "reasoning not supported" warning is logged once per provider, model and setting, not on every request.

## [1.5.1] - 2026-11-11

You can now find a name on the Screen board by ticker or company name, and read its key figures (P/E, profitability, growth, debt, liquidity, money flow) on its card or with `/screen FPT`. The figures read more plainly everywhere, grouped by what they tell you.
> Giờ bạn tìm được một mã trên Màn lọc theo mã hoặc tên công ty, và xem chỉ số chính của mã đó (P/E, sinh lời, tăng trưởng, nợ, thanh khoản, dòng tiền) ngay trên thẻ mã hoặc bằng lệnh `/screen FPT`. Các chỉ số ở mọi nơi cũng dễ đọc hơn, chia nhóm theo ý nghĩa.

### Added

- A search box on the Screen board (web) finds names by ticker or company name, with or without accents; when nothing matches it says so and points to the names the board left out.
- A name's card shows "Key figures", the same grid as its Screen row; a name the screen left out gets a line saying why there are none.
- `/screen <ticker>` (or `market:ticker`) prints one name's figures; the chat link under it opens that name's card.

### Changed

- Figures are grouped into Valuation, Profitability, Growth, Financial health, Price & liquidity and Money flow, with P/E and the sector P/E first, on the Screen board, a name's card and in chat alike.
- Labels read more plainly (ROE, ROA, ROIC, revenue and profit growth, gross margin, 50-session average, daily swing, foreign room left), and a place on the board reads "… against the board".
- On the web, rises show in green and falls in red, group headings are larger, and the Screen board's value limits fold under "Filter by figures" with the count of names right under the search box.
- In chat, group headings are bold and a live price reads "at 10:48" instead of "now 10:48".

## [1.5.0] - 2026-11-10

The morning brief reads more easily, with a headline strip and every market in plain words, and the track record now counts only calls whose window has passed, names each result for what it was, and keeps open plans through a dividend or split. The Vietnamese board uses far less memory. The database gains two tables; the upgrade runs them for you.
> Bản tin sáng giờ dễ đọc hơn, có dải số liệu chính ở đầu và mọi thị trường được viết bằng lời dễ hiểu. Thành tích đề xuất giờ chỉ tính những đề xuất đã hết thời hạn theo dõi, gọi đúng tên từng kết quả, và giữ kế hoạch đang mở qua đợt chia cổ tức hay chia tách. Bảng cổ phiếu Việt Nam tốn ít bộ nhớ hơn nhiều. Cơ sở dữ liệu thêm hai bảng; lệnh nâng cấp tự chạy chúng.

### Added

- The brief opens with a strip of headline figures (VN-Index, VN30, SJC gold, world gold, bitcoin, USD/VND) and a session title, and lists one line per index with VN-Index first.
- The brief quotes the S&P 500, the US ten-year yield and Brent, and says when a macro figure has gone stale.
- Every market section prints in the brief: money flow, the index review, events, the gold dealer board and Vietnamese economy headlines.
- Two new results in the track record: a target that banked part and gave the rest back counts as a miss, and a stop the trail had raised above entry counts as a win.
- `/reflect` ends with how many calls already hit a level but are still inside their window, and breaks the record down by strategy version and by debate model.
- Each factor line in `/reflect` says how often the factor was right against the market's benchmark, or against that session's board average.

### Changed

- The track record counts a call only once its window has passed (4 weeks short, a quarter long), so a quick stop-out no longer drags the rates down before the winners finish.
- Repeat calls on the same name fold into one before the newest calls are picked, so a long hold no longer fills the record with copies of one move.
- A dividend or split no longer closes open plans: their levels move to the new price scale, a buy's quantity is rescaled to the board lot, and they keep counting. Your ledger is not touched.
- The Vietnamese composite no longer weighs trend, which had not separated winners on the history measured.
- A suggestion's "I am wrong if" conditions are checkable inside the call's window, such as the next quarterly report, and a call that goes ahead always names at least one. A call that waits titles them "Drop the buy idea if".
- The Vietnamese board reads one name at a time and keeps no raw bars, reads the supervision lists once a day, and reuses screened names while nothing they read has changed. The daemon logs its memory on each refresh.
- Binaries start faster: they ship as bytecode, and the MCP client and the HTML converter load on first use.

### Fixes

- The watchlist dialog in Settings stays open after adding a name, so you can add the next one straight away.
- A stored brief from before this release is rebuilt instead of losing its result words.
- An MCP server that fails to load is skipped instead of stopping the rest.
- A web page talking to an older daemon falls back to the plain result instead of showing a raw label.

## [1.4.3] - 2026-11-06

You can now see a stock's sector right beside its ticker, and the ticker card draws its chart again for Vietnamese and US stocks and for crypto.
> Giờ bạn thấy ngay một mã thuộc ngành nào ngay cạnh mã, và thẻ mã đã vẽ lại biểu đồ cho cổ phiếu Việt Nam, Mỹ và tiền mã hóa.

### Added

- The sector sits beside the ticker on the Opportunities rows, `/screen`, `/price`, the web screen rows and every ticker card (for example "TCB · Banks"). Crypto, gold, indices and funds show none.

### Fixes

- The ticker card draws its chart again for Vietnamese stocks, US stocks and crypto. VN gold no longer shows a world-gold chart under its VND price.
- A ticker card re-reads the live price only while its market is trading.
- Opening a name from a long list starts its card at the top instead of where the list was scrolled.
- Opportunities lists only the markets you have switched on, as the Market tab does, so a switched-off market no longer shows an outdated board.

## [1.4.2] - 2026-11-06

The getting-started list folds a step away as soon as you finish it, including when you keep the default profile or skip the book.
> Danh sách bắt đầu giờ thu gọn ngay bước bạn vừa xong, kể cả khi bạn giữ hồ sơ mặc định hay bỏ qua bước ghi sổ.

### Fixes

- "Keep the defaults" and "Nothing yet, skip" in the getting-started list now fold their step to its check and title, as the other steps do.

## [1.4.1] - 2026-11-06

The web edition and the homepage now count visits with Cloudflare Web Analytics: no cookies, no fingerprinting, only page views and page load speed, and never your keys, ledger or chats. The privacy policy is now version 1.1.
> Bản web và trang chủ giờ đếm lượt truy cập bằng Cloudflare Web Analytics: không cookie, không lấy dấu vân tay, chỉ đếm lượt xem trang và tốc độ tải trang, và không bao giờ thấy key, sổ hay cuộc trò chuyện của bạn. Chính sách quyền riêng tư lên phiên bản 1.1.

### Changed

- The web edition's and homepage's content security policy allows Cloudflare's analytics script and its reporting host, and the privacy policy, web guide and homepage say so.
- The README shows a support link near the top, beside the Zalo group.

## [1.4.0] - 2026-11-05

OpenAlpha now runs in the browser at web.openalpha.link: market data, your book and a two-sided
analysis on your own AI key, all inside the tab. Market terms explain themselves, the brief and
`/overview` share one set of labelled facts, and `/suggest` and `/record` refuse an index or a
futures contract. On the web you can also chat with the assistant, which looks things up and explains but makes no buy or sell call. The database gains two tables; the upgrade runs them for you.
> OpenAlpha giờ chạy ngay trên trình duyệt tại web.openalpha.link: dữ liệu thị trường, sổ của bạn và phân tích hai chiều bằng key AI của bạn, tất cả trong tab. Thuật ngữ thị trường tự giải thích, bản tin và `/overview` dùng chung một bộ số liệu có nhãn, còn `/suggest` và `/record` từ chối chỉ số và hợp đồng tương lai. Trên bản web bạn cũng trò chuyện được với trợ lý: tra cứu và giải thích, không đưa lời khuyên mua bán. Cơ sở dữ liệu thêm hai bảng; lệnh nâng cấp tự chạy chúng.

### Added

- The web edition and its homepage (openalpha.link). Keys stay on your device, AI spend is capped at 5 USD a day, and the database saves to and loads from a file. Chat history comes back after a reload.
- On the web, chat with the assistant in plain words; it only reads and gives no buy, sell or hold call, size or price level. Settings has one main AI model, with optional models for analysis and research.
- A glossary of 39 terms in Vietnamese and English: a dotted word opens its definition, and `/glossary [term]` prints it anywhere.
- The brief, `/overview` and the office page state crypto funding, open interest, long/short ratio, taker buy share, fear and greed and the VN gold premium as labelled facts.
- The screen board shows each name's readings in one grid, with value limits and a second sort.
- The ticker page shows the session range and volume, and the VN gold dealer's buy and sell prices.
- On the web, each analysis opens with what to watch: the conditions that would prove each side wrong.
- On the web, the model picker shows each model's price and whether it can call tools, and the first-run guide has a "choose the AI model" step.
- A Vietnamese link-preview image for the homepage and the web edition.
- The web header has a "Get the full app" button that opens the install steps; the web and installed comparison starts with the same link.

### Changed

- `/suggest` refuses an index or a futures contract before any AI call and points to an ETF; `/record` and `/update` refuse a row naming one.
- Rebalance reads each segment and capped name against the level you set, largest gap first, with a shortcut to edit the levels.
- The target weights dialog switches a segment on or off and resets to defaults.
- The Market tab and Today list only the markets you switched on; world gold stays as a reference.
- The AI label no longer names the model, and an answer does not repeat it where the screen already shows it.
- On the web, an analysis ends by saying a buy or sell plan needs the installed version.
- The default main model on the web ships with a fallback model.
- The Zalo Personal library loads only when that channel is used.
- The installed version presents a current browser when it reads data sources.
- Deploys go through `bun run deploy:web` and `bun run deploy:site`, which refuse a staging build for production and the reverse.
- The web edition and homepage send cross-origin isolation headers and pin Trusted Types to the page's one policy.
- The consent for a router such as OpenRouter says it passes the request on to the model's host, and the privacy policy names the groups of data sources.

### Fixes

- An analysis side that names nothing that could prove it wrong is asked again.
- Identical provider requests share one round trip, and slow readings come from a short cache.
- A provider request never follows a redirect, and the command bar refuses a line holding a key.
- Office page layout: header switches on one line, an empty market says so.
- On the web, chat answers at once when no AI key or search key is allowed, instead of starting a run.
- `/research` drops sources dated in the future, stays on markets and investing on the web, and hands the agent a shorter list of gaps.
- Chat history keeps what you typed for a command handed off to the assistant, and reads the same after a reload.
- Office bubbles show the step line in your language, never the model's raw reasoning.
- Esc, a click outside or the close button on a dialog opened from Settings return to Settings, with what you typed kept.
- A bare ticker is no longer looked up in a market you switched off, so `BTC` stays the coin instead of booking as a US fund; `equity-us:BTC` still reaches the fund.
- `/price` on a NYSE name after US hours shows the price when nasdaq leaves the day's change blank.
- A refused `/suggest` no longer offers to run again or set an alert on the name it refused.
- More provider keys are hidden when pasted into chat (Tavily, xAI, Groq, Brave and others, or any key written after "key" or "khóa"), and the web refuses to open a database file over 256 MB.

## [1.3.0] - 2026-11-03

US stocks and ETFs can now be your home market: the 500 largest US companies and a fund board,
sector strength against SPY, a morning brief at 08:15 New York time with filings and ex-dividend
dates, and Lower Manhattan on the office page. English is the default language. `/screen crypto`
keeps only coins a venue you trade at lists, and the app's restart line, command box and market
picker are easier to read. No database change.
> Cổ phiếu và ETF Mỹ giờ có thể là thị trường chính: 500 công ty lớn nhất nước Mỹ và bảng quỹ, sức mạnh ngành so với SPY, bản tin sáng lúc 08:15 giờ New York kèm báo cáo nộp SEC và ngày giao dịch không hưởng quyền, cùng phố Lower Manhattan trên trang văn phòng. Tiếng Anh là ngôn ngữ mặc định. `/screen crypto` chỉ giữ coin mà sàn bạn đang giao dịch niêm yết, còn dòng khởi động lại, ô lệnh và ô chọn thị trường trong ứng dụng dễ đọc hơn. Không đổi cơ sở dữ liệu.

### Added

- US stocks and ETFs as a home market (`[locale] region = "us"` or the onboarding question): the 500 largest US companies and a fund board, scored on momentum, volatility and, with an SEC contact email, value and quality, sized in dollars at the `us-broker` venue. Leveraged and inverse funds are never suggested for purchase.
- US sector strength: sectors ranked against SPY over 20 and 60 sessions, in chat and on the office page.
- A morning brief for a US home at 08:15 New York time, with a "Filings and ex-dividend dates" list for the names you hold or watch. Market warm-up now runs 90 minutes before each open (Vietnam: 07:30).
- New data: Nasdaq (listings, quotes, history, dividends), SEC (annual accounts, earnings releases, insider purchases), the US 10-year less 3-month yield spread, and Coinbase crypto prices.
- The office page shows Lower Manhattan for a US home, with its own holidays, weather and ticker suggestions.
- `/price` and `/suggest` read a symbol shared by a stock and a coin (LINK, ATOM) as the one you hold or watch, and name the other.

### Changed

- English is the default: the README opens in English (Vietnamese in `README.vi.md`), and `onboard` starts in English unless your computer runs in Vietnamese. A config without `[locale] language` answers in its home market's language, so existing Vietnam books stay Vietnamese.
- Settings > Display can switch the home market; `/setup` asks about every tradable market. When a saved profile keeps the new home market switched off, `/profile` and the morning brief say so and name `/profile enable`.
- `/overview` with no market shows only the markets you use.
- Refresh covers only the markets your profile uses; Vietnamese gold stays off until `/profile enable`.
- In Vietnamese the assistant always calls itself "mình".

### Fixes

- `/screen crypto` keeps only coins a venue you trade at lists (the default venue, an exchange with your key, or one your book names), instead of any venue the app knows. A book kept at OKX no longer sees a coin only Binance sells at the top of the board.
- A US name missing from one weekly Nasdaq listing is no longer delisted until the next listing confirms it.
- SEC net income filed at the wrong scale (Arista's 2025 read as $3,511) no longer drags a company's value and quality ranks.
- Sectorless US names get no return-on-equity rank, and a foreign filer's accounts stay in its reporting currency.
- The US calendar closes at 13:00 on early-close days (day after Thanksgiving, July 3, December 24).
- Analysts debating a US fund read the macro-liquidity method instead of stock valuation methods.
- The app's settings save again while a model key is missing or pending restart, switching provider picks that provider's default model, and the desktop first run no longer refuses a config with a key set.
- In the app, the restart line after a settings change sits on the same glass as the offline bar instead of floating bare over the office. The command box leads with a chat mark instead of a `/` that looked already typed, and pressing `/` on an empty box starts a command with the `/` in place. The market picker on Ideas > Opportunities uses the short segment names on one row instead of wrapping full market names over two.
- US stocks get their own colour and short name in the app, and class-share tickers such as BRK.B link to their page.

## [1.2.2] - 2026-10-30

The ticker page now shows what the trader is waiting for before an entry, the full factor checklist
and VN foreign net flow. Background work is visible as it happens: the office page, `start`,
`status` and `/health` name the automatic jobs at work and why one failed. A retried scheduled job
past its grace no longer goes out late, a channel `token_file` may start with `~/`, and a long list of
QA fixes lands. The README and guides were reworked for newcomers. No database change.
> Trang mã giờ cho thấy trợ lý đang chờ điều gì trước khi vào lệnh, đầy đủ bảng nhân tố và dòng tiền ròng khối ngoại. Việc chạy nền hiện ra ngay khi đang chạy: trang văn phòng, `start`, `status` và `/health` nêu các việc tự chạy đang làm và lý do việc nào hỏng. Việc theo lịch thử lại quá hạn không còn gửi trễ, `token_file` của kênh ghi được `~/`, cùng nhiều lỗi nhỏ được sửa. README và hướng dẫn được viết lại cho người mới. Không đổi cơ sở dữ liệu.

### Office page

- The ticker page and the Ideas call card show what the trader waits on before the entry, and the
  factor checklist laid out as `/suggest` prints it: groups, rows and their readings at their own
  depth, the quoted evidence muted.
- VN foreign-flow factor rows carry the foreign desk's net flow over the same sessions, on every
  surface.
- The "Why?" dialog and the Ideas folds title each case by what it argues (case for buying, case for
  waiting, facts checked against the sources) and drop the repeated label inside.
- Slash commands typed in the page chat answer in chat shape, without padded columns, and a wrapped
  line keeps its indent. `/transactions` there shows the chat's 10 rows.
- The running chip and the jobs list follow every background pass live.
- The settings page saves with the config's version, so a stale page can no longer put an older
  config back.

### Status and jobs

- `start`, `start --background`, `status` and `/health` say which automatic jobs are running and
  which failed; `status` and the page give the reason. The market data sweep at each start shows as
  one task. "Automatic jobs" (việc tự chạy) is now the one name on every surface.
- A scheduled retry past `late_grace_ms` is skipped, as the guide says: a 07:30 brief retried at 08:00
  no longer goes out as if on time.

### Fixes

- A channel `token_file` such as `~/.secrets/telegram-token` was read relative to the folder the
  daemon started in, so the bot got no token; `~/` now means your home folder.
- `config validate` and the office config editor refuse an unknown `[notices] chat` kind, which
  before only stopped the daemon at start.
- A chat or channel bound to a debate persona or research worker falls back to its entry agent;
  `/agent`, `agent bind`, `chat --agent` and `schedule add` refuse them.
- Model prices: `gemini-2.5-flash`, `gpt-oss-20b` and other bare ids no longer fall back to the
  conservative rate when the OpenRouter feed is down.
- A Gemini prompt blocked outright ends as filtered instead of retrying and cooling the model.
- Two venue syncs at once no longer overwrite each other.
- Telegram's restart backoff starts over after a healthy run.
- Gold, SSI and VNDirect boards: one bad gold row no longer drops the board, and an SSI or VNDirect
  board that reads partly is refused instead of tallied short.
- CLI: `history show` is translated, `chat --max-turns 0` and a non-decimal `--max-cost-usd` are
  refused, `agent pause|resume` refuses an id together with `--all`, `upgrade --check --rollback`
  exits 2 like any usage error, and `--help` after `--` is read as an argument.
- The `now` tool shows the time year first on a 24-hour clock in every language.
- A shortened suggestion (call cards, the report the chat agent relays) says what it leaves out and
  names `/suggest <market:ticker>` to see it in full, instead of a hint about a lean mode.

### For integrators

- A write that conflicts with another edit exits 18 (15 stays the loop halt).
- `GET /v1/config` answers a version; `POST /v1/config` with `If-Match` is a conflict once the file
  changed since.
- `GET /v1/live` carries `tasks`, and a `tasks_changed` event follows each background pass; the
  suggestion card answers `factors` and `watch`.
- A blank chat frame on the socket is refused as malformed instead of starting a billed turn.

### Docs

- The README opens with the demo and why to use it, then a five-step quick start: install, check,
  pick the web page (`openalpha start --background`, `openalpha web`) or `openalpha chat`, see a
  first suggestion, then `/setup` and the ledger. The FAQ is its own section.
- Windows installs with `irm .../install.ps1 | iex` in the PowerShell window you have open; the
  installer adds itself to that window's PATH, so `openalpha` works there at once.
- The gold examples write `gold-vn:SJC`, since SJC is also a stock ticker.
- The sample configs say what the code does: `[[models]]` needs only `provider` after
  `[model_defaults]`, the debate runs in three serial stages, a hand-traded broker can take
  `markets`, agent run limits never exceed `[loop]`, and the minimal configs save the key with
  `openalpha key set` and show `currency`.
- Every guide was checked against the code in both languages; wrong defaults, quotes, flags and
  names were corrected, and missing flags (`db export --table`, `logs --follow`, `config get` and
  others) documented.

## [1.2.1] - 2026-10-29

VN market holidays are now worked out from the law for every year, so 2027 and later need no update
from us. Scheduled jobs ride out a short network outage instead of switching themselves off, and a
job whose time passed while the daemon was down waits for its next time rather than running late.
The office page and API answer within about a second of `start`, instead of after up to a minute of
loading market data, and a slow Telegram or Zalo no longer holds the start. A busy API port no longer
stops the daemon. Several sizing and booking figures now include fees
the way the order path charges them.
> Ngày nghỉ của sàn VN giờ được tính theo luật cho mọi năm, nên từ 2027 trở đi không cần chờ bản cập nhật. Việc theo lịch không còn tự tắt chỉ vì mất mạng vài phút, và việc lỡ giờ khi dịch vụ nền đang tắt sẽ đợi lần kế tiếp thay vì chạy trễ. Trang văn phòng và API trả lời trong khoảng một giây sau khi khởi động, thay vì phải chờ tới một phút nạp dữ liệu thị trường, và Telegram hay Zalo chậm không còn làm chậm cả lúc khởi động. Cổng API bị chiếm không còn làm dịch vụ nền dừng lại. Một số con số về khối lượng và ghi sổ giờ đã tính phí đúng như khi đặt lệnh.

### Calendar

- VN closures follow Labor Code art. 112: New Year, Tet (with the usual days around it), Hung
  Kings, 30/4, 1/5, National Day and its adjacent day, and Vietnam Culture Day from 2026, plus the
  next weekday when one falls on a weekend. Swap days the government announces go under
  `[trading.markets.<id>] holidays`; the new `open_days` reopens a day the rules close. A date in
  both lists, or on the market's weekend, stops the start.
- The "holiday table is out of date" warning is gone: there is no table to run out.
- Checked against the real tape for 2020-2025: 29 April 2024 (a swap day) is closed, and National
  Day 2021 took its second day on 3 September, not 1 September.

### Scheduler and delivery

- While the host is offline, due jobs wait and no failure is counted; only real failures still
  switch a job off after three in a row.
- A cron job more than `[schedule] late_grace_ms` (15 minutes) late skips to its next time; interval
  and one-time jobs still run. The intraday report skips a send it woke too late for.
- At shutdown, channels stop taking new messages at once (they wait for the next start) and queued
  notices get their one last attempt before the channels close. A reply cut by the restart says so
  instead of showing an error.
- A message Telegram or Zalo refuses for good is not retried.
- An API port already in use is reported as a degraded item; the daemon keeps running.
- Start-up no longer waits for market data: the API binds first and `GET /v1/health` reports
  `starting` until the daemon is ready (writes and live streams answer `unavailable` meanwhile).
  The boot refresh runs in the background; only the trading loops that read market data wait for
  its first pass, for at most a minute.
- Telegram and Zalo check their token once at start; a slow network is retried by the polling loop
  instead of holding the start, and the Telegram command menu is installed in the background. A
  wrong token is still reported at start.
- `status`, `start` and every other command list all the config problems `config validate` lists,
  not only the first section's.
- With a config that cannot be read, `doctor` checks only config, daemon and version and marks the
  rest as waiting, instead of reporting on the defaults (`doctor web-search` showed duckduckgo ✓).
- `/profile set reserve-pct-nav 5` names the allowed range instead of a message about pinned targets.
- `/reflect` calls a repeated suggestion a suggestion, not an order.
- `web` and `connect` say why the daemon has no API (its port taken by another program, say)
  instead of reporting a refused token from whatever holds that port.
- A run that stops on something you can fix, such as an unset key, is logged as a warning, not an
  error.
- A terminal command sent while the daemon is still starting waits for it, then runs there, instead
  of running a second copy of the work (a `/refresh`, say) in the terminal.

### Trading

- A plan made from a recorded fill on or after an ex-date is priced on the new basis, and a plan
  is only scaled by the ex-dates it has not absorbed yet. Same-day cash and share actions give one
  reference price whatever order the provider lists them in.
- Averaging down no longer counts a dividend with no published amount as zero, and says when some
  dividends could not be counted.
- The reminder to record a dividend is built from every event, not only the ones the brief shows.
- An OKX rebate books as no fee; a Binance fill whose trades are not listed yet waits for
  `/record sync` instead of booking a zero fee.
- A buy into a switched-off segment shows as a cap breach and `order_place` refuses it.
- Suggested buys and the batch cash check leave room for the fee, plus the price drift a market
  order may fill through on an exchange `/trade` reaches; `/rebalance` leaves room for the fee.
- One name with zero turnover no longer withholds the whole `/rebalance` plan.

### Office page and API

- The ticker card now really shows a corporate action's terms (1.2.0 promised them but showed only
  the payment day): cash per share, new shares per 100, subscription price and payment day.
- On a held position, a first exit that sits under your cost reads "Trim on a rebound to ..., still
  below your cost" instead of "Take profit".
- The VN event note groups its figures the Vietnamese way (`2.250.000 CP`, `10.000 đ/cp`) instead
  of the provider's `2,250,000` and bare `10000`.
- The sign-in lockout has its own error code, `locked`; other refusals show their reason, and a
  sign-in link survives a daemon that is restarting.
- Too many open tabs reads as such, not as offline.
- `GET /v1/health` no longer carries a `status` that was always `ready`.
- A request the client already dropped is answered 499 and logged at debug.
- `POST /v1/respond` answers `not_found` for a request that is no longer waiting, instead of a
  silent ok.
- Chat history pages never start in the middle of a turn; rate-limited commands are not stored;
  deleting a chat also removes its agent binding.

## [1.2.0] - 2026-10-29 [IMPORTANT]

Plans and exit alerts now follow a held VN stock across its ex-dividend date, so a dividend gap no
longer reads as a stop being hit. On the office page, buttons run their command right where you
press them, chat history keeps the commands you typed, and CLI chats can be deleted from the
sessions list. Three database changes; the upgrade runs them for you.
> Kế hoạch và cảnh báo thoát lệnh giờ theo đúng mã đang giữ qua ngày giao dịch không hưởng quyền, nên khoảng giảm giá do chia cổ tức không còn bị đọc nhầm là chạm mức cắt lỗ. Trên trang văn phòng, các nút chạy lệnh ngay tại chỗ, lịch sử trò chuyện giữ lại các câu lệnh bạn gõ, và xóa được cuộc trò chuyện CLI ngay trong danh sách. Có ba thay đổi cơ sở dữ liệu; lệnh nâng cấp tự chạy chúng.

### Ex-dividend dates

- On a cash dividend's ex-date, `/suggest` scales the stored bars and the standing stop and
  take-profit by the dividend, so the morning plan and the exit alerts stand on the new price. A
  share dividend, bonus issue or rights issue is priced the way the exchange sets the reference
  price; an action with no published terms starts that day's plan fresh.
- The brief's events and the ticker card show the terms: cash per share, share ratio,
  subscription price and payment day. A held name with a dividend or share distribution gets a
  line reminding you to record it.
- Averaging down no longer reads every ex-date as a loss: the cost it compares against nets out
  the dividends your shares already earned.
- vndirect share dividends and bonus issues are labelled as such, not as splits.

### The office page

- A button that names a whole command runs it at once and waits in place while it runs. Refresh
  data, Write today's brief again, Run again on Themes and Screen again show their result where
  they sit and leave nothing in the chat; a refusal before the run starts shows under the button.
- Analyze buttons on the ticker card, Opportunities and a `/suggest` answer offer a fresh
  analysis once a call is stored.
- The sessions list dates each chat by its last message and counts exchanges. Each row's menu
  opens the chat in its own tab or deletes it (app and CLI chats, with Undo for a few seconds).
  New messages from another channel show up while you read it.
- A cleaner why dialog and folded panel rail. A half-typed line survives a button press, and
  Enter while Safari composes a word (Vietnamese input) finishes the word, not the line. No cost
  estimate beside buttons.

### Chat history

- Commands you type are kept in the chat's history on every channel and shown as they first
  appeared, with the AI calls under an answer. The assistant never reads them back.
- Scrolling near the top loads older messages.

### Smaller changes

- An order the ledger has not booked yet shows what the exchange filled, with the average fill
  price, in bare `/trade`, `/trade reconcile` and the Orders tab.
- A sale held back by settlement says so, instead of calling it smaller than a board lot.
- Startup refuses a `[trading.briefs] send_time` at or after the home market's open; the brief
  used to be skipped every morning.
- A broken `config.toml` exits 2 on every command that needs it; `version` still runs, and `doctor`,
  `onboard` and `config validate` still run and exit 1. `/cost` prints money and tokens like the run
  footer.
- `openalpha db import` reads exports from older releases, columns dropped or added since
  included.

### Upgrading

- A new column marks command turns kept for display, columns nothing read leave `memory_kv`,
  `notices`, `runs` and `trading_profiles`, and sessions get an indexed last-message time. Older
  binaries cannot open the upgraded database; `openalpha upgrade --rollback` takes it back after
  an `openalpha upgrade`.

## [1.1.2] - 2026-10-28

The office page's first-run checklist names the key your configured model reads, not another
provider's. No database change.
> Danh sách việc cần làm lần đầu trên trang văn phòng giờ ghi đúng tên khóa mà mô hình bạn cấu hình đọc, không còn ghi tên khóa của nhà cung cấp khác. Không đổi cơ sở dữ liệu.

### Changes

- "Connect an AI model" names the variable the first model in `[[models]]` reads its key from.
  A model that signs in instead points to Settings > Providers.

## [1.1.1] - 2026-10-28

The office page now opens with no config edit: the API is on by default, still on `127.0.0.1`
only. A second daemon on the same port stops with a clear message instead of sharing it. No
database change.
> Trang văn phòng giờ mở được mà không cần sửa cấu hình: API bật sẵn, vẫn chỉ nghe trên `127.0.0.1`. Dịch vụ nền thứ hai dùng cùng cổng sẽ dừng kèm thông báo rõ ràng thay vì dùng chung cổng. Không đổi cơ sở dữ liệu.

### Changes

- `[api] enabled` defaults to `true`; set it to `false` to keep the port closed. `openalpha start
  --background` then `openalpha web` is all the office page needs.
- Two daemons pointed at one `[api] port` no longer share the socket silently: the second stops
  and says to run `openalpha stop` or pick another `[api] port`.
- The starter config no longer writes `[api] enabled = true`.

## [1.1.0] - 2026-10-28

A new office page: your analysts work in a pixel-art office you open in the browser, with your
book, ideas, markets, costs and chat beside it. The daemon now serves it, along with a `/v1` API
for client apps. Six additive database changes; the upgrade runs them for you.
> Trang văn phòng mới: các nhà phân tích AI làm việc trong một văn phòng pixel mở bằng trình duyệt, bên cạnh là danh mục, đề xuất, thị trường, chi phí và khung chat. Dịch vụ nền giờ phục vụ trang này cùng API `/v1` cho ứng dụng khách. Có sáu thay đổi cơ sở dữ liệu kiểu thêm mới; lệnh nâng cấp tự chạy chúng.

### The office page

- `openalpha web` prints a one-time sign-in link; `openalpha connect` signs in another device.
  Signed-in browsers are listed, and `openalpha api rotate` signs them all out.
- A 2D and a 3D office show every run as it happens: who is working, the step it is on, its
  AI calls and its result on the room's whiteboard. Click a person or room for details.
- The info panel has Today, Portfolio, Ideas and Market tabs. Office, Info only and narrow-screen
  layouts share one floating command bar; the chat sits beside it.
- The command bar suggests commands and arguments; forwarded commands run in the daemon like
  local ones.
- Approvals and questions from every channel, scheduled jobs and the AI cost report (daily chart,
  per-run calls) are on the page. You can also record dividends, splits, rights and transfers,
  reconcile with venues and sync fills there.
- Light and dark themes, keyboard shortcuts, screen-reader text and touch layouts.

### Daemon and API

- An HTTP/WS API under `/v1` (off by default, `[api]`), with a bearer token from `openalpha api
  token`. With `[api] public_url` set it withholds shell, file writes, external tools, pairing
  approval and orders.
- Live run feed, notices with read state, event-triggered jobs, agents created and edited from
  the API, and a `spawn` tool for temporary child agents.
- `restart` restarts in place; `doctor` shares the CLI probes and prints fix lines; the update
  notice shows release notes.

### Smaller changes

- `openalpha mcp install --host muse` adds Muse Code.
- Raising `reserve-pct-nav` past the cash target lifts the target with it; a cash target set
  below the reserve is refused.
- `schedule show` leaves out the next run of a paused job.
- Vietnamese text now says "dịch vụ nền", "mô hình", "cuộc trò chuyện" and "phiên chạy"
  throughout.

### Upgrading

- New tables for runs, notices, job event triggers and browser sessions, plus new columns for
  debate models and run tickers. Older binaries cannot open the upgraded database; `openalpha
  upgrade --rollback` takes it back after an `openalpha upgrade`.

## [1.0.17] - 2026-10-23

`/themes run <id>` reports on one theme, an ended theme says why and what to do, a leftover
sliver no longer blanks NAV, and the chat agent no longer sees your loss figures. No database
change.
> `/themes run <id>` giờ báo cáo riêng một chủ đề, chủ đề đã kết thúc nói rõ lý do và việc cần làm, phần cổ phiếu lẻ còn sót không còn làm trống tổng tài sản, và trợ lý chat không còn thấy số lỗ của bạn. Không đổi cơ sở dữ liệu.

### Themes

- `/themes run <id>` reports on that theme alone, its sectors and companies included.
- An ended theme is labelled "Ended", hides its odds, says why and suggests `/themes retire <id>`.
- A proposed theme lists every condition that would end it, each naming a figure and a period.
- The track record and "was" compare only scores made the same way.
- A failed sector check keeps the previous sectors, dated; low-confidence names stay under their
  sector instead of ranking among the top stocks.
- Macro and quarter lookbacks are more careful, and each run reads headlines archived since the
  last one.

### Suggestions, portfolio and alerts

- The report the chat agent relays drops your realized loss and how far a holding sits under
  cost.
- An unpriced sliver below the venue's smallest order counts at cost instead of blanking NAV.
- Adding to a held name no longer counts against `maximum_open_trades`.
- A segment with a target and nothing held now reports its drift.
- `/update` keeps a row's note and exit leg.
- Track record, calibration and debate history fold repeated calls and stay within their focus.
- Exit alerts at an existing level no longer fail every minute; a missing price series is
  retried every 15 minutes.
- `/profile set preferred-locale` is gone: replies always follow `[locale] language`.
- `/watchlist` and `/alert` show progress; `key set` suggests the name your config reads.

### Docs

- Fixed several command descriptions that had drifted from the code.

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

[1.8.14]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.14
[1.8.13]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.13
[1.8.12]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.12
[1.8.10]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.10
[1.8.9]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.9
[1.8.7]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.7
[1.8.6]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.6
[1.8.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.8.2
[1.7.0]: https://github.com/alex2loop/openalpha/releases/tag/v1.7.0
[1.6.3]: https://github.com/alex2loop/openalpha/releases/tag/v1.6.3
[1.6.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.6.2
[1.6.1]: https://github.com/alex2loop/openalpha/releases/tag/v1.6.1
[1.6.0]: https://github.com/alex2loop/openalpha/releases/tag/v1.6.0
[1.5.1]: https://github.com/alex2loop/openalpha/releases/tag/v1.5.1
[1.5.0]: https://github.com/alex2loop/openalpha/releases/tag/v1.5.0
[1.4.3]: https://github.com/alex2loop/openalpha/releases/tag/v1.4.3
[1.4.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.4.2
[1.4.1]: https://github.com/alex2loop/openalpha/releases/tag/v1.4.1
[1.4.0]: https://github.com/alex2loop/openalpha/releases/tag/v1.4.0
[1.3.0]: https://github.com/alex2loop/openalpha/releases/tag/v1.3.0
[1.2.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.2.2
[1.2.1]: https://github.com/alex2loop/openalpha/releases/tag/v1.2.1
[1.2.0]: https://github.com/alex2loop/openalpha/releases/tag/v1.2.0
[1.1.2]: https://github.com/alex2loop/openalpha/releases/tag/v1.1.2
[1.1.1]: https://github.com/alex2loop/openalpha/releases/tag/v1.1.1
[1.1.0]: https://github.com/alex2loop/openalpha/releases/tag/v1.1.0
[1.0.17]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.17
[1.0.16]: https://github.com/alex2loop/openalpha/releases/tag/v1.0.16
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
