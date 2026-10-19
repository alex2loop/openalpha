# Bộ test case không cần key

Phủ mọi lệnh CLI và mọi lệnh chat chạy được khi không có khóa AI, khóa sàn hay token kênh. Chạy lại mỗi khi code đổi hoặc trước khi release. Mục M (bản sao sổ thật, cần khóa AI) và mục N (bot Telegram thử, cần khóa AI và người bấm trên điện thoại) là hai ngoại lệ, chạy trước release; các ca cần key khác nằm ở cuối, ngoài phạm vi.

## Quy tắc an toàn (bắt buộc)

- Không bao giờ chạy `/trade confirm`.
- Không đụng `~/.claude` thật: mọi lệnh chạy với `HOME` thử.
- Không chạy daemon với token kênh thật; mục N chỉ dùng bot thử (`TELEGRAM_BOT_TEST_TOKEN`) trên bản sao dữ liệu. Không in giá trị khóa, chỉ in tên biến.
- Không commit/push.

## Chuẩn bị

```bash
cd ~/codes/trading/opensources/openfin/openalpha
S=<scratchpad>/qa; mkdir -p $S
B=$S/openalpha
bun run gen && bun build src/app/main.ts --compile --outfile $B
QA=.superpowers/qa                  # drive.py nằm ở đây

nokeys() { unset OPENROUTER_API_KEY OKX_API_KEY OKX_API_SECRET OKX_API_PASSPHRASE BINANCE_API_KEY BINANCE_API_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_BOT_TEST_TOKEN OPENALPHA_COINGECKO_API_KEY OPENALPHA_FRED_API_KEY EXA_API_KEY TAVILY_API_KEY OPENALPHA_DATA_DIR; }
sb() { export HOME=$S/$1 LANG=vi_VN.UTF-8; mkdir -p $HOME; nokeys; }   # một sandbox = một HOME; sandbox `en` dùng LANG=en_US.UTF-8
oc() { $B chat -m "$*"; echo "(exit $?)"; }           # một lệnh chat
```

- Lệnh tương tác: `python3 $QA/drive.py 'trả lời 1|trả lời 2|^D' $B onboard`. `|` tách câu trả lời, `^D` = Ctrl-D, env `GAP` (mặc định 2.5 giây) và `DEADLINE` (mặc định 150 giây).
- Lần `/refresh` đầu mất ~5 phút: đừng bọc trong `timeout`. Khi đầu ra không phải terminal (`oc`, pipe) stderr có một dòng tiến độ mỗi ít nhất 10 giây (không phải một dòng mỗi mã) và stdout chỉ có câu trả lời.
- Sandbox: `main` (luồng chính), `fresh` (máy trống, chưa nạp dữ liệu), `en` (`LANG=en_US.UTF-8`), `rm` (gỡ và cài lại).
- Mong đợi chung cho mọi ca: không có dòng "Đã có lỗi khi chạy câu lệnh đó" hay "Đã xảy ra lỗi"; lệnh cần mô hình thì nêu đúng tên biến khóa cần đặt.

## A. Cài đặt - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| A1 | `curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh \| sh` | Cài bản release mới nhất vào `$HOME/.local/bin`, vào onboard |
| A2 | Onboard qua `drive.py`: tiếng Việt, OpenRouter, mô hình, mức chi, bỏ qua Telegram | Ghi `~/.openalpha/config.toml`; chưa có khóa thì không thử mô hình, mục "Tiếp theo" nhắc `export OPENROUTER_API_KEY=...`, rồi theo thứ tự: chat với /refresh và /setup, ghi số tiền bằng /record, chạy nền, doctor |
| A3 | `OPENALPHA_NO_ONBOARD=1` + install.sh | Cài xong, không vào onboard |
| A4 | `OPENALPHA_VERSION=<bản trước>` + install.sh | Cài đúng bản đó; lần chạy sau CLI nhắc có bản mới |
| A4b | install.sh lần nữa đè lên bản đã cài (không `OPENALPHA_VERSION`) | Một dòng `OpenAlpha v<bản>` và một dòng "Bạn đang dùng bản mới nhất.", không lặp; `$B upgrade` in đúng hai dòng ấy |
| A5 | `curl ... config.minimal.toml -o ~/.openalpha/config.toml --create-dirs` | Tải được. Chưa đặt khóa: `config validate` nêu `OPENROUTER_API_KEY`, còn `oc /transactions` vẫn chạy và chat thường nêu tên biến khóa. Có khóa (giả): `config validate` in `✓ OK`, `config show` có `"maxDailyUsd": 2`. Khóa giả mà chat thường: báo "Nhà cung cấp AI từ chối khóa API của bạn." kèm cách sửa (chỉ khi chính nhà cung cấp từ chối; lỗi đăng nhập như `auth login` giữ chẩn đoán riêng, không dùng câu này) |
| A6 | `$B onboard < /dev/null` | Báo cần terminal tương tác, không treo |
| A7 | Chạy lại `$B onboard` qua `drive.py` → sửa mức chi, ngôn ngữ | Menu sửa; ghi `.bak`; giá trị mới có trong `config show` |
| A8 | Bản clone: `bun install && bun run dev -- onboard` | Vào onboard như bản cài |
| A9 | Khối 3 lệnh đầu mục "Bắt đầu nhanh" của README, sandbox mới `qs`: chạy đúng 3 dòng (`curl ... install.sh \| sh` với `OPENALPHA_NO_ONBOARD=1` và `config.minimal.toml`; `export OPENROUTER_API_KEY=...` bỏ trống vì là bộ không key; `DEADLINE=900 python3 $QA/drive.py '/refresh\|/suggest FPT\|^D' $B chat`) | `/refresh` nạp xong không lỗi. `/suggest FPT` không có khóa thì nêu đúng tên biến `OPENROUTER_API_KEY`, không có dòng "Đã có lỗi". `/suggest FPT` gõ trước `/refresh` báo chưa nạp dữ liệu và bảo chạy /refresh. Lệnh trong README chép là chạy, không phải sửa gì |

## B. Lệnh hệ thống - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| B1 | `$B` (không kèm gì), `$B --help`, `$B help`, `$B <lệnh> --help` cho cả 30 lệnh | Có trợ giúp, exit 0; `help` đứng cuối danh sách |
| B1b | `$B help chat`, `$B help config validate`, `$B chta`, `$B help chta` | `help chat` giống `chat --help`; `help config validate` giống `config validate --help`; gõ sai: "Câu lệnh không xác định: chta", "Có phải bạn muốn dùng 'chat'?", "Chạy `openalpha --help` ..." (có tên chương trình), exit 1 |
| B2 | `$B version`, `$B --version`, `$B -v` | Cả ba in cùng một kết quả; phiên bản đúng với `package.json` và mục mới nhất trong `CHANGELOG.md` |
| B3 | `$B upgrade --check`, `$B upgrade` | Báo đang dùng bản mới nhất, hoặc nâng lên mà giữ dữ liệu; khi daemon đang chạy nền, `$B upgrade` bật nó lại trên bản mới (`status` không còn báo lệch phiên bản); khi có bản mới, thông báo nêu điều đáng chú ý, số bản đã bỏ lỡ và bản sửa lỗi quan trọng (khớp dòng **Cập nhật** của README) |
| B3a | `$B upgrade --rollback` | Quay về bản cài trước mà giữ dữ liệu và cấu hình; chưa có `.old` thì báo chưa có bản nào, mã thoát 1 |
| B4 | `$B doctor`, `$B doctor --online` | Nhãn từng dòng theo ngôn ngữ cấu hình (vi: "cấu hình", "mô hình", "nguồn dữ liệu"...). Thiếu khóa AI: dòng "cấu hình" vẫn xanh, dòng "mô hình" ✗ nêu đúng tên biến khóa thiếu và cách đặt, không lộ giá trị; `--online` không thêm dòng "openrouter probe failed" cho cùng nguyên nhân (đếm 1 vấn đề, tiếng Anh "1 problem found."); các dòng khác (giao dịch, nhà cung cấp) vẫn chạy chứ không "chờ sửa lỗi config". Máy trống: logging, database, daemon, giao dịch và từng nguồn tùy chọn (coingecko, fred) là dòng `i` trung tính, không phải `!`; mỗi nguồn nói khóa đó thêm được gì; chỉ dòng `✗` làm exit 1. Sau một lần chạy hỏng vì config sai (ví dụ `provider = "openrouterr"`), dòng cơ sở dữ liệu vẫn là `i` "chưa tạo", không phải ✗ "thiếu bảng _migrations" |
| B5 | `$B status` | Chạy, báo daemon không chạy. Khi daemon chạy: "daemon: đang chạy v<phiên bản> (pid ...)"; sửa `version` trong `~/.openalpha/openalpha.pid` thành bản cũ thì thêm dòng "Bản đang cài là v..., nhưng daemon vẫn chạy bản khác..."; xóa hẳn `version` thì "một bản cũ chưa báo phiên bản" kèm cùng dòng nhắc |
| B6 | `$B start` (không khóa AI; dùng `--background` rồi `$B stop`) | Vẫn khởi động (~1 phút): dòng `✓ Daemon v<phiên bản> đã chạy nền (pid ...)`, rồi dưới tóm tắt có đúng một dòng `!` "Chưa đặt biến môi trường OPENROUTER_API_KEY nên model ... chưa chạy được..." (stderr); `status` báo đang chạy; `chat -m "hi"` nêu tên biến khóa; `daemon.stderr.log` chỉ có dòng cảnh báo ấy. Có khóa giả và không kênh: không có dòng `!` nào |
| B7 | `$B stop`, `$B restart` | `stop`: "Chưa chạy."; `restart` dừng rồi khởi động lại, giống B6 (khởi động được, kèm cảnh báo thiếu khóa) |
| B6b | Sandbox thêm `[api] enabled = true`, `port = 18765`, `token_env = "API_TOK_X"` (đặt `API_TOK_X=short`), một `[[mcp.servers]]` stdio có `env = { A = "${MCP_X}" }` (chưa đặt), `[web_search] provider = "exa"` với `api_key_env` chưa đặt, `[channels.telegram] token_env` chưa đặt, không khóa AI; `$B start --background`, rồi `$B config validate`, `$B chat -m "/portfolio"`, `$B stop` | `start` thành công kèm năm dòng `!`, phần tóm tắt không có dòng "Kênh: telegram" hay "API: cổng ..." (kênh và API chưa mở; có token API đủ 32 ký tự thì dòng API hiện lại) (khóa AI, máy chủ MCP, tìm kiếm web, Telegram, API: "... token_env ... ngắn hơn 32 ký tự ... API chưa mở"); cổng 18765 không mở; `config validate` liệt kê các mục khóa/biến (không có mục API); `/portfolio` chạy bình thường. Cổng API đang bị tiến trình khác dùng thì `start` vẫn dừng và nêu số cổng |
| B8 | `$B config show`, `config get budget.maxDailyUsd`, `config path`, `OPENROUTER_API_KEY=x $B config validate` | Bí mật được che (`apiKey`), còn thời lượng như `credentialCooldownMs` in số; giá trị đúng; validate `✓ OK` (không khóa thì báo đúng tên biến, exit 1, cùng các phát hiện khác nếu có) |
| B9 | Làm hỏng `config.toml` cùng lúc nhiều chỗ (sai kiểu `max_daily_usd = "abc"` và `[api] port = "x"`, `default_for = "equity-vn"`) rồi `config validate` | Một lần chạy liệt kê mọi trường lỗi, kể cả lỗi trong `[trading]` (`trading.venues.vps.default_for`) cùng danh sách với lỗi `budget`/`api`, mỗi dòng "- đường.dẫn: ..." bằng tiếng Việt ("cần một con số...", "cần một danh sách trong ngoặc vuông..."), không có tên kiểu tiếng Anh, tối đa 8 dòng rồi "và còn N chỗ nữa"; thêm một mục lạ (`[logging]`) thì vẫn liệt kê đủ lỗi `budget` và `[trading]`, kèm dòng riêng "có mục không nhận ra: [logging]"; sửa lại thì qua |
| B9a | Thêm khóa gõ sai (`max_daly_usd = 3` dưới `[budget]`), `config validate` | Dòng "budget.max_daly_usd: không phải thiết lập tôi biết, có phải ý bạn là max_daily_usd?"; khóa quá xa tên nào thì chỉ trỏ tới URL config.sample.toml trên GitHub, không trỏ tới file cục bộ. Tên ngắn không bị gợi ý bừa: `foo = 1` dưới `[budget]` chỉ trỏ tới URL. Mục gõ sai (`[bugdet]`) được gợi ý "Có phải ý bạn là `[budget]`?"; mục quá xa (`[zzzzzzzz]`) chỉ trỏ tới URL |
| B9b | `provider = "openrouterr"` (gõ sai nhà cung cấp), `config validate`; rồi `$B chat -m hi` | `config validate` exit 1, báo một lần cho mỗi nhà cung cấp lạ: "Mô hình ... đang dùng nhà cung cấp openrouterr mà tôi không biết. Có phải ý bạn là openrouter?..."; `chat` in đúng câu đó (không phải tiếng Anh thô), exit 2, không có dòng "--verbose"; `doctor` cùng câu |
| B9c | Đặt `provider` đúng, bỏ khóa (`env -u OPENROUTER_API_KEY $B config validate`) sau khi cố ý thêm lỗi nhà cung cấp ở B9b | Cả hai phát hiện cùng hiện: câu nhà cung cấp lạ và câu thiếu `OPENROUTER_API_KEY` kèm đúng dòng `export OPENROUTER_API_KEY=...`; exit 1. Config sạch mà thiếu khóa: chỉ một dòng thiếu khóa, exit 1 |
| B9d | Thêm `[web_search]` với `provider = "exa"`, `api_key_env = "EXA_KEY_X"`, `fallback_provider = "tavily"`, `fallback_api_key_env = "TAVILY_KEY_X"` (cả hai biến chưa đặt), khóa AI giả `OPENROUTER_API_KEY=x`: `$B chat -m "/portfolio"`, `$B doctor web-search`, `$B config validate`; rồi `EXA_KEY_X=dummy $B doctor web-search` | `/portfolio` chạy bình thường (trước đây mọi lệnh bị chặn); `doctor web-search` ✗ "Chưa đặt biến môi trường EXA_KEY_X nên [web_search] chưa chạy được. Đặt bằng `export EXA_KEY_X=...` ...", exit 1; `config validate` in đúng một dòng ấy, exit 1; `start` in cùng dòng (dấu `!`, stderr) ngay dưới phần tóm tắt, chỉ khi bên chính thiếu khóa. Có `EXA_KEY_X`, thiếu `TAVILY_KEY_X`: `doctor web-search` `!` "provider=exa (có key); bên dự phòng đang tắt vì chưa đặt TAVILY_KEY_X...", exit 0, `config validate` `✓ OK`. Công cụ `web_search` và `/research` khi bên chính thiếu khóa từ chối với câu trên, không rơi về DuckDuckGo (đường LLM cần khóa AI thật, nên kiểm bằng `createWebRetrievalService` trong `bun -e`); log có `web_search.key_missing` / `web_search.fallback_key_missing`. Provider cần khóa mà không khai `api_key_env` vẫn là lỗi cấu hình |
| B9e | `[web_search] provider = "deepseek"`, `api_key_env = "DEEPSEEK_API_KEY"` (chưa đặt), khóa AI giả: `config validate`, `doctor web-search`, `chat -m "/portfolio"`; rồi `DEEPSEEK_API_KEY=dummy`; rồi bỏ `api_key_env` | Thiếu khóa: cùng câu như B9d với tên `DEEPSEEK_API_KEY`, exit 1, `/portfolio` vẫn chạy. Có khóa: "provider=deepseek (có key)", `✓ OK`. Không khai `api_key_env`: "Nhà cung cấp tìm kiếm deepseek cần API key...", exit 1 |
| B9f | Dưới `[channels.telegram]`: `gap_note_minutes = -1`, rồi `= 2.5`, rồi `gap_note_minute = 30`; thêm cùng lúc `max_daily_usd = "abc"` dưới `[budget]`; `config validate`, `status`, `start --background` | Mỗi lần một dòng "- `channels.telegram.gap_note_minutes`: ..." bằng tiếng Việt ("giá trị phải từ 0 trở lên", "cần một số nguyên...", "có phải ý bạn là `gap_note_minutes`?"), cùng danh sách với lỗi `budget`; `status` và `start` in đúng câu đó, không phải "Đã xảy ra lỗi ngoài ý muốn" hay "lỗi thiết lập bên trong"; `start` dừng ngay, không chờ nạp dữ liệu |
| B10 | `$B provider list`, `$B provider models` | Có danh mục nhà cung cấp, model và giá |
| B11 | `$B auth status` | "chatgpt: chưa đăng nhập", không lỗi |
| B12 | `$B cost`, `cost --period week`, `cost --from 2026-10-01 --to 2026-10-16 --breakdown` | Bảng chi phí ($0 khi chưa gọi model) |
| B13 | `$B logs tail --lines 20`, `logs tail --agent chat`, `python3 $QA/drive.py 'y' $B logs clear` | In log; `clear` hỏi y/N rồi dọn log cũ |
| B14 | `$B workspace cleanup --all` (không cờ thì báo cần `--agent <id>` hoặc `--all`) | Thu hồi thư mục tạm, hoặc báo không có gì để thu hồi |
| B15 | Đặt `[api] enabled = true`; `$B api token`, `$B api rotate`, `$B api token` | Token đổi sau rotate. Khi `enabled = false` cả `token` và `rotate` chỉ báo API đang tắt |
| B16 | `$B setup catalog`; `$B setup` (thiếu tham số) | JSON danh mục nhà cung cấp; thiếu tham số thì `{"ok":false,"code":"usage"}` |

## C. Cơ sở dữ liệu - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| C1 | `$B db migrate`, `db migrate up` | "đã cập nhật". Không chạy `down` trên dữ liệu cần giữ |
| C2 | `$B db integrity`, `$B db stats`, `$B db cleanup --older-than 30d` | Integrity ok; có số dòng/kích thước; cleanup báo số dòng đã dọn (thiếu `--older-than` thì in cách dùng) |
| C3 | `$B db backup` rồi `python3 $QA/drive.py 'y' $B db restore <tệp>` | Hỏi xác nhận; khôi phục được, dữ liệu như trước |
| C4 | `$B db export --out $S/exp` | Xuất N dòng ra các tệp |
| C5 | `$B db import --in $S/exp` khi DB có dữ liệu | Từ chối |
| C6 | `$B db reset --yes` rồi `db import --in $S/exp` | Nhập lại đủ N dòng |
| C7 | `python3 $QA/drive.py '\|y' $B db reset` (Enter rồi y); `python3 $QA/drive.py 'k\|n' $B db reset`; `db restore <bản vừa sao lưu> --yes` | Câu đầu hỏi "Sao lưu cơ sở dữ liệu hiện tại trước khi xóa không?" `[C/k]`; Enter sao lưu vào `backups/` rồi mới hỏi xóa; `k` không sao lưu; `--yes` không hỏi câu nào. Khôi phục bản sao thì dữ liệu trở lại |

## D. Sổ và danh mục - sandbox `main` (sau `/refresh`)

| # | Lệnh | Mong đợi |
|---|---|---|
| D1 | `oc /record deposit vps 100000000 VND 2026-08-14` | "Đã ghi", tiền mặt 100.000.000 VND |
| D2 | `oc /record buy vps equity-vn:FPT 100 62000 VND 2026-08-14` | Phí tự tính 9.300; có khối "Đã đặt kế hoạch thoát" (cắt lỗ, chốt lời) dù giá mua nằm sát trần của phiên tới; `/portfolio` không còn dòng "vị thế chưa có kế hoạch thoát: FPT" |
| D3 | `/record sell vps equity-vn:FPT 50 63000 VND 2026-08-20` | Ghi bán; lãi/lỗ đã chốt hiện ở `/portfolio` |
| D4 | `/record withdrawal`, `fee`, `loss`, `transfer vps okx ...` | Mỗi loại ghi đúng, số dư đổi tương ứng |
| D5 | `/record dividend`, `rights`, `split` cho FPT | Khối lượng/giá vốn điều chỉnh đúng |
| D6 | `/record deposit okx 1000 USDT 2026-08-14 fx 26600` rồi `/record buy okx crypto:BTC 0.001 60000 USDT 2026-08-14`; thêm `[trading.venues.sjc]` (như README) rồi `/record buy sjc gold-vn:SJC 1 120000000 VND 2026-08-14` | Ghi được, mỗi dòng có kế hoạch thoát. Crypto ghi bằng VND thì báo phải ghi bằng USDT; `buy vps gold-vn:SJC` thì báo VPS không giao dịch vàng |
| D7 | `/record buy vps FPT 100 58.400 VND 2026-08-14` (số có dấu nhóm), `/record deposit vps 100000000 VND 2026-13-45`, `/record buy vps equity-vn:FPT -100 62000 VND 2026-08-14`, `... fx abc`, `/record foo bar`, `/update <mã> buy ... 0 VND 0 ...` | Không ghi. Dòng đầu nêu ô sai: "\"58.400\" đọc được hai kiểu nên tôi chưa ghi...", "Chưa hiểu ngày...", "Chưa hiểu khối lượng...", "Chưa hiểu tỷ giá...", "Chưa hiểu giá \"0\"..."; dòng sau là "Gõ riêng /record để xem đầy đủ cú pháp." (với `/update` là "Gõ riêng /update..."), không in cả trang cách dùng. Sai loại giao dịch hoặc thiếu ô (`/record foo bar`) thì chỉ in cách dùng. `/record deposit vps 1.000.000 VND 2026-08-14` và `/record buy vps equity-vn:FPT 100 58.400 VND 2026-08-14` và `/record buy vps equity-vn:FPT 1.000 58400 VND 2026-08-14` báo số đọc được hai kiểu, chưa ghi, và gợi ý viết liền `1000000` / `58400` / `1000` (hoặc `1.5` nếu là số lẻ); `/record buy okx crypto:BTC 0.001 60000.125 USDT ...` vẫn đọc dấu chấm là số lẻ |
| D8 | `oc /record help` | In cú pháp chia nhóm "Mua bán" / "Tiền vào ra"; ví dụ dùng giá 58400 |
| D9 | `/transactions`, `/transactions 10`, `/transactions 30d`, `/transactions 2026-08-01..2026-08-31`, `/transactions <mã bút toán>` | Lọc đúng (`30d` chỉ lấy dòng trong 30 ngày qua: dòng ghi tháng 8 thì báo "Không có giao dịch nào từ ... đến ...", muốn thấy dòng thì ghi thêm một dòng ngày gần đây); mã bút toán cuối dòng giữ nguyên, lọc từ mã đó trở đi; cuối trang có dòng "×1.000 VND" khi có giá VPS. Ghi chú dài (nếu có) cắt ở 60 ký tự kèm "…" |
| D10 | `/update <mã> buy vps equity-vn:FPT 100 61000 VND 0 2026-08-14`, `/update help` | Sửa được; `/transactions` thấy giá mới. `help` in "Cách dùng" + ví dụ giá 58400 |
| D11 | `/delete <mã>`, `/delete <mã> confirm`, `/delete zzzzzz` | Lệnh đầu in dòng và nút/dòng "Xóa dòng này" mà chưa xóa; `confirm` xóa được; mã sai thì báo "Không có giao dịch nào mang mã zzzzzz" |
| D12 | `/portfolio`, `/portfolio nav`, `/portfolio nav 1m`, `/portfolio nav all` | Tổng tài sản; tiền mặt vượt mục tiêu thì ngay dưới có ⚠️ "Tiền mặt đang chiếm ... cao hơn mục tiêu ... · /rebalance"; mục 💰 Tiền mặt và 💹 Lãi/lỗ tách riêng, lệnh đã chốt thành bảng có "bán <ngày>"; vị thế ghi "x% danh mục" và có thanh "cắt lỗ ... chốt ..."; dòng tập trung ngành nằm trong mục phân bổ; hồ sơ và "×1.000 VND" ở cuối. Dùng "danh mục", không "NAV" |
| D13 | `/rebalance` | Dòng đầu là kết luận ("Hôm nay nên MUA n mã, tổng ..." / "BÁN n mã" / "BÁN ... và MUA ...", hoặc "Việc đáng làm..."), mỗi lệnh tối đa 3 dòng ("MUA <mã>: thêm ... danh mục, a -> b - lý do"), vị thế vi phạm kế hoạch nằm dưới "Làm trước"; nhóm thiếu mã mua là một dòng ⚠️ "... hôm nay đáng xem nhất là ... · /watchlist add" hoặc "chưa có mã nào ở nhóm này đủ điều kiện mua"; dòng "Hôm nay chỉ nên dùng khoảng ..." không xuất hiện khi đã có cảnh báo thị trường Trung lập/rủi ro; tổng tài sản và hồ sơ ở cuối |
| D14 | `/reconcile` | Liệt kê sàn thiếu khóa (OKX, Binance) và sàn ghi tay (VPS, tiệm vàng) |
| D15 | `/record sync okx`, `/record sync binance` | Báo sàn chưa có khóa, nêu tên biến; không có dòng "... được quy đổi theo giá thị trường" |
| D16 | Thêm `[trading.venues.ssi]` (`default_for = ["equity-vn"]`, `fees` như README) vào config sandbox; `config validate`; `oc /record deposit ssi 100000000 VND 2026-08-14`; `oc /record buy ssi equity-vn:FPT 100 62000 VND 2026-08-14` | `✓ OK`; hai dòng ghi với "Sàn: SSI". Đổi `default_for` thành `markets` vẫn `✓ OK`. Gỡ hẳn khối `[trading.venues.ssi]` thì mọi lệnh ghi báo "Sổ có dòng ngày 14/08/2026 ở sàn ssi, nhưng config.toml không còn khai sàn này..."; `/record deposit xyz ...` vẫn báo "Không có sàn nào tên xyz"; khai lại thì ghi được |
| D17 | Sổ mới: `oc /record deposit binance 1000 USDT 2026-08-14 fx 26600`; `oc /record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14`. Sổ mới khác: `oc /record deposit binance 26600000 VND 2026-08-14`; `oc /record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14 fx 26600`; `oc /record buy binance crypto:BTC 0.001 60000 USDT 2026-08-14 fx auto` | Sổ đầu: nạp in "Tỷ giá: 26.600 VND/USDT (giá bạn trả)" (cột `fx_rate` 26600, nguồn `operator`); lệnh mua ghi ngay, "Tỷ giá: trả bằng USDT đang giữ tại sàn...". Sổ sau (sàn chỉ có VND): mua `fx 26600` in "(giá bạn trả)"; `fx auto` in "(giá thị trường ngày 14/08/2026)" khoảng 26.036. Phí 0,6 USDT tự tính |
| D18 | Sàn crypto ghi tay: `[trading.venues.bitget] markets = ["crypto"]`, `fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }`; `config validate` | `✓ OK` |
| D19 | Một phiên REPL (`drive.py`): nạp VND; `/record confirm`; mua 1 BTC; `/record confirm`; mua 0.01 BTC USDT không `fx`; `/record buy ... 0.0x`; `/record confirm` hai lần; mua 0.001 BTC không `fx`; `/record deposit binance 1 VND 2026-08-14`; `/record confirm` | Nạp ghi ngay. Confirm đầu: "Không có giao dịch nào đang chờ". Mua 1 BTC bị từ chối ngay, không giữ gì. Mua 0.01 BTC hiện bản xem trước (tỷ giá thị trường, tiền mặt thay đổi, dòng P2P, hai cách) và chưa ghi. Dòng gõ sai in cách dùng, dòng chờ vẫn giữ. `/record confirm` ghi, tiền mặt giảm đúng số đã xem trước; lần hai: không có gì đang chờ. Mua 0.001 BTC được giữ; nạp 1 VND in "Giao dịch đang chờ xác nhận trước đó đã được bỏ." rồi ghi; confirm cuối: không có gì đang chờ |
| D20 | Sổ mới, một phiên REPL (`GAP=7 DEADLINE=240`, lệnh mua chờ tỷ giá lâu hơn 2,5 giây): nạp 1000 USDT `fx 26600`; mua 0.01 BTC USDT không `fx`; mua 0.1 BTC USDT; rút 100 USDT không `fx`; `/record confirm`; nạp 1.000.000 VND; mua 0.5 ETH 2400 USDT; rút 2.000.000 VND. Sổ thứ hai: nạp 26.600.000 VND, mua 0.01 BTC `fx auto`, rồi nạp 10 USDT ngày 13/08 `fx 26600` | Lệnh mua 0.01 BTC ghi ngay, dòng tỷ giá "trả bằng USDT đang giữ tại sàn", `/transactions` có dòng "Tiền mặt ở đây quy đổi theo tỷ giá của từng dòng". Mua 0.1 BTC và 0.5 ETH bị từ chối vì thiếu USDT. Rút 100 USDT được giữ chờ xác nhận, tiền mặt thay đổi -2.660.000 (giá vốn bình quân, không phải giá thị trường). Rút 2.000.000 VND bị từ chối: "Tiền đã về tại Binance ngày 14/08/2026 chỉ có 1.000.000 VND, không đủ cho dòng này". Sổ thứ hai: dòng nạp USDT ngày 13/08 bị từ chối, nêu ngày 14/08 |
| D21 | Trên sổ của D20 sau lệnh mua 0.01 BTC: `oc /portfolio` | Mục tiền mặt có "Trong đó tại Binance: ... USDT, giá vốn ..., theo giá hôm nay khoảng ...", mục lãi/lỗ có dòng chênh tỷ giá trên ngoại tệ đang giữ (âm nhẹ ngay sau khi nạp ở 26.600), tổng tài sản = tiền mặt + vị thế + chênh tỷ giá, các nhóm trong bảng phân bổ cộng đúng 100%. Rút hết USDT thì dòng USDT biến mất và không có cảnh báo thiếu tỷ giá |
| D22 | Sổ mới: nạp 1000 USDT `fx 26600`; mua 0.01 BTC giá 60000 phí 0.6 USDT; rút 399.4 USDT `fx 27000`; `oc /portfolio` | Đã nạp ròng 15.816.200, lãi đã chốt +159.760, giá vốn phần đang nắm 15.975.960, tiền mặt 0 (đã rút hết USDT) |
| D23 | Sổ mới, từng lệnh `oc` riêng: `/record deposit vps 1000000 VND 2026-08-14 fx 26000`; cùng lệnh với `fx auto`; `/record deposit vps 100 USDT 2026-08-14 fx 26600`; `/record split vps equity-vn:FPT 10 2026-08-14 fx 1` | Hai dòng đầu: "Dòng này đã ghi bằng VND nên không cần tỷ giá - bạn bỏ phần fx đi là được." Dòng ba: "Tiền mặt tại VPS chỉ ghi được bằng VND hoặc đồng mà sàn này giao dịch, nên chưa ghi được USDT." Dòng tư in cách dùng. `/transactions` trống |
| D24 | Sổ có `deposit binance 26600000 VND`: `oc "/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14"` rồi `oc "/record confirm"` (hai tiến trình) | Lệnh đầu in bản xem trước, kết thúc "Lệnh này chờ 10 phút rồi tự bỏ.", chưa ghi. Confirm ở tiến trình khác: "Không có giao dịch nào đang chờ xác nhận..."; `/transactions` không có dòng BTC |
| D25 | Trên sổ thứ hai của D17: `/update <mã dòng mua 0.01 BTC> buy binance crypto:BTC 0.01 60000 USDT 0.6 2026-08-14` (không `fx`), rồi cùng lệnh thêm `fx 26600`; `/delete <mã> confirm` | Không `fx`: "Dòng này ghi bằng USDT. Khi sửa, bạn thêm tỷ giá ở cuối..." và không giữ chờ xác nhận. Có `fx`: sửa được, "Tỷ giá: 26.600 VND/USDT (giá bạn trả)". Xóa được |
| D26 | Thêm `[trading.venues.sjc]` (`markets = ["gold-vn"]`, `fees = { buy = 0, sell = 0 }`) như khối Vàng trong nước của README; `config validate`; `oc /profile enable gold-vn`; `oc /price SJC`; `oc /record deposit sjc 150000000 VND 2026-08-14`; `oc /record buy sjc gold-vn:SJC 1 120000000 VND 2026-08-14` | `✓ OK`; `/price` in giá mua vào, bán ra và chênh mua bán; hai dòng ghi với "Sàn: SJC", lệnh mua có kế hoạch thoát tính theo giá tiệm mua vào. Thiếu `fees` thì `config validate` báo cần khai phí; ghi vàng ở `vps` bị từ chối "VPS không giao dịch Vàng trong nước". Ghi thêm `/record buy sjc gold-vn:SJC 0.1 ...` (1 chỉ) và `gold-vn:PNJ-RING`: ghi được, khối lượng 0,1, dòng "Giá: 120.000.000 VND/lượng" (không có "/SJC" phía sau); `/price PNJ-RING` in giá theo lượng |
| D27 | Sổ mới (theo README, đoạn ngay dưới bước 4): nạp và mua FPT như D1-D2; `oc /record sell vps equity-vn:FPT all 65000 VND 2026-08-20`; `oc /record withdrawal vps 1000000 VND 2026-08-21`; `oc /transactions` lấy mã dòng rút; `oc /update <mã> withdrawal vps 2000000 VND 2026-08-21`; `oc /delete <mã> confirm`; `oc /record`; `oc /record withdraw vps 1000000 VND 2026-08-21`; `oc /record sell vps equity-vn:FPT 50 65000 VND` (thiếu ngày) | `all` bán hết 100 FPT; ở `/portfolio` FPT chỉ còn trong bảng lệnh đã chốt, không còn là vị thế đang giữ. Rút tiền ghi "Rút tiền". `/transactions` có mã cuối mỗi dòng; `/update` in "Đã sửa" với 2.000.000; `/delete` in "Đã xóa" và dòng biến mất. `/record` trơn in các nhóm "Mua bán", "Tiền vào ra", "Quyền, cổ tức, chia tách". `withdraw` (thiếu `al`) và dòng thiếu ngày không ghi, chỉ in cách dùng |
| D28 | Sổ có VPS là sàn duy nhất giữ `equity-vn`, danh sách mã đã nạp: `oc /record buy FPT 100 58400`, `oc /record buy FPT 100 58.400`, `oc /record rights FPT 10 10000`, `oc /record buy ZZZZ 1 1`, `oc /record buy vps equity-vn:FPT 100 58400 VND 2026-10-17` | Dòng 1 ghi VPS, VND, hôm nay và xác nhận in "FPT · Thị trường chứng khoán Việt Nam"; dòng 2 bị từ chối vì số có dấu nhóm y như dạng đầy đủ; dòng 3 báo cần ghi phí; dòng 4 báo chưa thấy mã (không có yêu cầu mạng trong log); dòng 5 là dạng đầy đủ, không đổi |

## E. Hồ sơ - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| E1 | `/profile show`, `/profile help` | Hiện hồ sơ; in cú pháp có ví dụ và mỗi trường một dòng giải thích bằng tiếng Việt (nhóm Khẩu vị rủi ro, Kỳ hạn và mục đích, Giới hạn mua, Chia đợt, Tỷ trọng mục tiêu và trần), `goal <preserve\|income\|grow>` kèm nghĩa từng giá trị; số tỷ lệ giải thích một lần ("0.2 là 20%"); không có "regime", "tranche" thô ngoài tên trường |
| E2 | `/profile set risk-level balanced` (rồi `conservative`, `aggressive`) | Gieo lại các mức quanh nó |
| E3 | `/profile set horizon equity-vn long`, `goal income`, `reserve-pct-nav 0.1`, `risk-per-trade-pct-nav 0.01`, `position-cap crypto 0.05` | Mỗi trường nhận (tỷ lệ: 0.1 là 10%); `show` phản ánh |
| E4 | `/profile set segment-target crypto 0.3` | Các nhóm khác nhường lại, tổng 100% |
| E5 | Giá trị lấn vào tiền dự phòng / ngoài khoảng, kể cả `reserve-pct-nav 5`, `reserve-pct-nav -0.1`, `position-cap crypto 1.5` | Từ chối, nói lý do: "... phải nằm trong khoảng ... Ghi dạng tỷ lệ: 0.2 là 20%." |
| E6 | `/profile disable crypto`, `/profile enable crypto`, `/profile enable gold-vn`, rồi `/profile disable gold-vn` và `/refresh` | Đổi nhóm; sau khi đã lưu hồ sơ, `/refresh` báo "Bỏ qua Vàng trong nước vì bạn đã tắt..." (nhóm còn giữ hay theo dõi mã thì vẫn nạp; hồ sơ chưa lưu thì nạp mọi thị trường) |
| E7 | `/profile reset` | Về mặc định |

## F. Dữ liệu thị trường - sandbox `fresh` rồi `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| F1 | `fresh`: `/screen equity-vn`, `/screen crypto` trước `/refresh` | Lần đọc đầu tự nạp dữ liệu thị trường đó rồi in bảng xếp hạng (cổ phiếu VN vài phút, có dòng tiến độ; crypto vài giây); lần sau trả lời ngay |
| F2 | `oc /refresh` | ~5 phút; bảng từng loại dữ liệu; giờ tự làm mới kế tiếp |
| F3 | `/refresh equity-vn force`, `/refresh gold-vn` | Nạp lại / nạp riêng thị trường |
| F4 | `python3 $QA/drive.py '/refresh crypto force\|^D' $B chat` | Hiện tiến độ "Đang tải lịch sử giá - N/M mã" |
| F4b | `oc '/refresh equity-vn' 2>&1 \| cat` (không TTY) | Dòng đầu "Thị trường chứng khoán Việt Nam · Đang cập nhật danh sách mã niêm yết…", rồi mỗi ~10 giây một dòng "Thị trường chứng khoán Việt Nam · Đang tải ... N/729 mã…"; không có ký tự điều khiển hay vẽ lại dòng; `2>/dev/null` chỉ còn kết quả |
| F4c | Sandbox có `[channels.telegram] token_env` đặt token giả (`123:abc`), khóa AI giả, `$B start --background`; lặp lại với `token_env` trỏ biến chưa đặt; rồi cả hai không có khóa AI; rồi `$B start` ở tiền cảnh (dừng bằng Ctrl-C sau ~70 giây) | In "Đang khởi động daemon...", chờ khoảng một phút, rồi `✓ Daemon ... đã chạy nền` (thoát mã 0) và dưới các dòng tóm tắt một dòng `!`: "Telegram từ chối bot token hiện tại..." (token giả) hoặc "Telegram đang bật nhưng chưa có bot token..." (chưa đặt biến); thiếu khóa AI thì thêm dòng "Chưa đặt biến môi trường OPENROUTER_API_KEY..." trước. `status` báo đang chạy rồi `stop` dừng; kênh không nhận tin của ai. Tiền cảnh: dòng khóa AI hiện ngay dưới tóm tắt, dòng Telegram hiện khi các kênh mở (~1 phút), cả hai trên stderr. Không kênh và có khóa: không có dòng `!` |
| F5 | `/screen equity-vn 20`, `/screen equity-vn 10 etf`, `/screen crypto`, `/screen gold-vn` | Bảng xếp hạng; 3 yếu tố mỗi mã xếp ▲ trước ▼; ghi "khối lượng/TB 20" (không "KL"). `gold-vn` không có bộ lọc yếu tố nên báo chưa có mã để xếp hạng |
| F6 | `/price FPT`, `/price crypto:BTC`, `/price gold`, `/price ZZQXW` | Giá + nguồn; FPT có dòng "Cao/thấp phiên ..." (chỉ khi nguồn có dữ liệu trong phiên); mã không tồn tại: "Không lấy được giá:" rồi ngay dưới "⚠️ Không thị trường nào đang niêm yết mã ZZQXW." |
| F7 | `/market`, `/overview`, `/overview crypto`, `/overview xyz`, `/sources` | Có nội dung. `/overview`: bảng yếu tố vĩ mô in một lần, vàng trong nước ghi "giống hệt phần Vàng thế giới ở trên" (cả cuối tuần, khi hai khối mang ngày dữ liệu khác nhau), không có dòng "Đủ dữ liệu cho 100%", nút cuối trỏ `/overview <thị trường>`. `/overview crypto` chỉ in khối crypto; `xyz` in cách dùng kèm danh sách thị trường. `/market`: mục phiên ⏱️ / 📘, dòng tràn thụt sâu hơn. `/sources`: tiêu đề 🔗, trạng thái dòng riêng; chưa gọi nguồn nào thì "Chưa gọi nguồn nào trong phiên này...", mọi nguồn tốt thì "Mọi nguồn đều đang phản hồi.". Tin tiếng Anh có "(tiếng Anh)" |
| F8 | `/watchlist add FPT HPG BTC`, `/watchlist`, `/watchlist remove HPG`, `/watchlist add crypto:UNI` | Danh sách đúng (tiêu đề 👀); tiền tố giải trùng tên; mã không có ở thị trường đã ghi (`crypto:HDB`) thì báo "HDB không niêm yết trên thị trường crypto" |
| F9 | `/alert create FPT above 130` trong terminal, `/alert list`, `/alert help` | không có kênh nào được cấu hình thì `create` từ chối: "Mình chưa có chỗ nào để gửi cảnh báo này..."; có kênh (kể cả chỉ cấu hình) thì tạo được và nói sẽ báo qua kênh đó; `/alert disable <6 ký tự>` tắt được; `list` và `help` in nội dung |
| F10 | `/reflect` | Chạy (có thể "chưa có gì để chấm"). Có dữ liệu: bảng phiên bản xếp mới nhất trước, không trùng dòng; nhóm yếu tố chưa đủ dữ liệu gom 1 dòng; "Đã chốt gần đây" có ngày đề xuất; đề xuất hết hạn chưa khớp đếm riêng ("chưa từng khớp"); dùng "đề xuất", không "lệnh" |

## G. Lệnh cần mô hình khi không có khóa - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| G1 | Một câu chat thường | Báo thiếu `OPENROUTER_API_KEY`, kèm cách đặt |
| G2 | `oc /suggest HPG` | "CHƯA KẾT LUẬN hôm nay", nêu tên biến `OPENROUTER_API_KEY` và cách đặt, rồi `/suggest HPG force` |
| G3 | `oc /suggest ZZQXW` | "Không thị trường nào hỗ trợ mã ZZQXW". (XYZ là coin có thật trên CoinGecko nên không dùng làm mã giả) |
| G4 | `/research quick ...`, `/themes` | `/research` nêu tên biến khóa; `/themes`: nêu tên biến khóa và dòng `export ...`; $0 |
| G5 | `/brief`, `/brief force` (có watchlist) | Bản tin có mục đề xuất, footer $0. Vị thế đang có kế hoạch thoát (ví dụ BTC mua ở D6) vẫn giữ kế hoạch sau `/brief` và `/suggest` không khóa: `/portfolio` còn thanh "cắt lỗ ... chốt ...", bảng `suggestions` không có dòng mới cho lượt chưa kết luận. "Chốt lại" mở bằng câu nhận định phiên (khi có), nhãn TB50; đề xuất ghi `MUA` / `CHỜ` / `BÁN BỚT`; đề xuất đã có kết quả có ngày; "Việc tiếp theo" kèm lệnh; tin tiếng Anh có "(tiếng Anh)". "Vị thế đang lỗ": "mã đang lỗ · lãi/lỗ chung", bỏ các đếm bằng 0; "Đề xuất đã có kết quả" không lặp chữ "kết quả"; "Nhịp liên thị trường" không lặp tên thị trường; không có dòng "mô hình có dữ liệu 100%"; dòng tràn thụt dưới dòng cha |
| G6 | `/brief enable 08:00` trong terminal | Từ chối: "Chưa bật bản tin sáng: cuộc trò chuyện này không nhận được tin nhắn định kỳ." |
| G7 | `/setup` | Nêu tên biến khóa, không treo |
| G8 | `/trade spot binance:BTC buy 0.001 limit 60000 tp 70000 sl 56000`, `/trade help` | Không đặt lệnh; nêu biến khóa OKX/Binance. `/trade help` (khi chưa có khóa sàn) in đủ cú pháp rồi mới tới dòng nêu biến khóa, có dòng giải thích tp (giá chốt lời), sl (giá cắt lỗ), limit (giá chờ khớp, bỏ trống thì khớp theo giá thị trường). **Không** gõ `/trade confirm` |
| G9 | `/trade halt`, `/trade resume` | Khi chưa có khóa sàn: cùng câu nêu biến khóa như G8 (halt chỉ có nghĩa khi có sàn) |

## H. Lệnh chat chung - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| H1 | `/help` | Liệt kê đủ lệnh, chia 4 nhóm: 💬 Chung, 📊 Danh mục và giao dịch, 🗺️ Thị trường, 💡 Phân tích và đề xuất |
| H1b | `/help suggest`, `/help /record`, `/help sugest`, `/help zzzzz`, `/help exit` (cả `chat -m` lẫn gõ trong REPL) | Hai câu đầu: mô tả rồi "Cách dùng" đúng như khi gõ sai tham số; `sugest`: "Tôi chưa có câu lệnh /sugest. Có phải /suggest? Gõ /help ..."; `zzzzz`: bản không gợi ý; `exit`: một dòng mô tả |
| H2 | `/health`, `/config`, `/cost` | Có tiêu đề 🩺 / ⚙️ / 💸, các dòng thụt vào một cấp; `/cost` có dòng "Phiên chat này: ..." |
| H3 | `/agent`, `/model` | Hiện trợ lý / model hiện tại |
| H4 | `/agent default`, `/agent ngan-hang`, `/model <selector>` trong terminal | "Câu lệnh này chỉ dùng được trong kênh chat..."; `/agent` thêm "chọn trợ lý ngay khi mở phiên chat: `openalpha chat --agent <id>`"; không in "Đã có lỗi khi chạy câu lệnh đó" |
| H5 | `/memory`, `/memory <từ không có>`, `/schedule`, `/schedule show <id>`, `/social`, `/social drafts` | Có nội dung (tiêu đề 🧠 / ⏰) hoặc một câu báo trống có icon: "🧠 Chưa có mục bộ nhớ nào.", "🧠 Không có mục bộ nhớ nào mang khóa <từ>.", "🧠 Không tìm thấy mục bộ nhớ nào khớp." (`/memory find <từ>`), "⏰ Chưa có tác vụ nào được lên lịch.", "📝 Không có bản nháp nào đang chờ bạn duyệt.". Bản nháp (nếu có) ghi ngày theo `[locale] timezone` |
| H6 | `/themes show` | Liệt kê chủ đề (có thể trống) |
| H7 | REPL qua `drive.py`: `/new`, `/continue`, `/exit`, `/quit`; `$B chat -c` | Phiên mới / tiếp tục / thoát sạch; sau khi thoát, `history list` ghi phiên đó và mọi phiên bị `/new` thay là "xong", không phải "đang mở". `/continue` ngay sau `/new` (hoặc sau một lượt đã xong) báo "Không có lượt nào dừng giữa chừng để tiếp tục" và không gọi mô hình |
| H8 | `/khongco`, `/scren` (gõ sai) | Báo lệnh không có, gợi ý lệnh gần nhất |
| H9 | `/upgrade` trong `$B chat`, `/upgrde` (gõ sai) | `/upgrade` in bản đang dùng và trạng thái bản mới kèm lệnh CLI; `/upgrde` gợi ý `/upgrade`, không gợi ý `/trade` |
| H10 | `/upgrade confirm` trong `$B chat` | Báo từ cửa sổ này không tự cập nhật được và nêu lệnh `openalpha upgrade`; trong chat Telegram với daemon `start --background`: nút "Cập nhật ngay", bot im rồi nhắn đã lên bản mới (cần bản cũ hơn bản mới nhất) |

## I. Agent, bộ nhớ, lịch, lịch sử - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| I1 | `$B agent add ngan-hang`, chép TOML trong README | Tạo tệp mẫu |
| I2 | `$B agent list`, `$B agent show ngan-hang` | "Ngân hàng · Dài hạn", trần $0.5/ngày |
| I3 | `$B agent pause ngan-hang`, `resume`, `pause --all`, `resume --all` | Đổi trạng thái |
| I4 | `$B agent bind ...`, `bindings`, `unbind ...` | Liên kết hiện rồi biến mất |
| I5 | `$B agent remove ngan-hang` | Xóa agent người dùng; agent dựng sẵn thì từ chối |
| I6 | `$B memory store k vang`, `recall k`, `search vang`, `list`, `remove k` | Vòng đời đủ (`search` cần từ 3 ký tự trở lên, chỉ tìm trong giá trị) |
| I7 | `$B history list`, `show <id>`, `delete <id>`, `clear` | Có các phiên từ G1; `delete` và `clear --yes` xóa được cả phiên còn ghi "đang mở" khi không có lượt nào đang chạy; `show` ghi "kết thúc: dừng vì gặp lỗi" (không phải `error` thô), chi tiết kỹ thuật nằm ở dòng "chi tiết" |
| I8 | `$B schedule list`, `show`, `add`, `edit`, `pause`, `resume`, `remove` | Vòng đời đủ (không `run-now` một job cần mô hình) |
| I9 | `$B workflow list` | "workflow (0)" khi chưa có |
| I10 | `$B pair list --channel telegram`, `--channel zalo` | "đang chờ (0)", không lỗi (thiếu `--channel` thì báo cần) |

## J. Plugin, skill, MCP, xã hội - sandbox `main`

| # | Lệnh | Mong đợi |
|---|---|---|
| J1 | `$B plugin list`; thêm `[plugins] dirs = [...]` vào config, tạo plugin mẫu (`plugin.toml` + một skill), `plugin install <thư mục> --yes`, `update`, `uninstall`; thêm khóa lạ vào `plugin.toml`, `plugin update zz`, `plugin uninstall zz`, `plugin install /nope` | Vòng đời đủ; chưa có `plugins.dirs` thì báo cần cấu hình. Lỗi do người dùng sửa được đều bằng tiếng Việt, không có dòng "--verbose": khóa lạ trỏ tới hướng dẫn plugin, `update` plugin chưa cài nói cài lại, `uninstall` plugin chưa cài báo "Chưa cài plugin zz nên không có gì để gỡ", gỡ lần hai cũng vậy, đường dẫn sai nói kiểm tra lại |
| J2 | `$B skill list`; `skill install <đường dẫn cục bộ>` | Cài được |
| J3 | `$B mcp surface` | Liệt kê công cụ công khai qua MCP |
| J4 | `$B mcp install`, `mcp install --host codex` (cursor, vscode, gemini, opencode, zed) | Ghi vào `$HOME` thử; `~/.claude` thật không đổi mtime |
| J5 | `$B mcp serve` + gửi `initialize` và `tools/list` qua stdio | Trả danh sách công cụ, thoát sạch khi đóng stdin |
| J6 | `$B social list` | Trống, không lỗi |
| J7 | `bun run typecheck` (gồm `scripts/sdk-embedder-smoke.ts`, tệp chỉ để kiểm kiểu, không chạy trực tiếp) | Qua |

## K. Tiếng Anh - sandbox `en`

| # | Lệnh | Mong đợi |
|---|---|---|
| K1 | Onboard | English được chọn sẵn |
| K2 | D16-D27 chạy lại bằng tiếng Anh; `doctor`, `/record deposit ...`, `/price FPT`, `/portfolio`, `/rebalance`, `/overview crypto`, `/brief`, `/reflect`, `/help`, `/agent default`, chat không khóa | Toàn bộ tiếng Anh, kể cả câu báo thiếu khóa; "of your portfolio" thay cho "NAV"; `/help` chia 4 nhóm |
| K3 | Ví dụ trong `README.en.md` | Chạy đúng như README tiếng Việt. `config.minimal.en.toml` (README.en trỏ tới) cho câu trả lời tiếng Anh, `config validate` `✓ OK` khi có khóa |

## L. Gỡ và cài lại - sandbox `rm`

| # | Lệnh | Mong đợi |
|---|---|---|
| L1 | `$B stop`, `$B db export --out $S/backup` | Xuất N dòng |
| L2 | Xóa `$HOME/.local/bin/openalpha` và `$HOME/.openalpha` | Gỡ sạch |
| L3 | Cài lại, `onboard` (config đã bị xóa ở L2), `db reset --yes`, `db import --in $S/backup` | Watchlist và sổ trở lại |

## M. Bản sao sổ thật, cần khóa AI - sandbox `book`

Ngoại lệ duy nhất của bộ không cần key, chạy trước mỗi release. Mục đích: bắt lỗi chỉ hiện khi có lịch sử thật (đề xuất đã có kết quả, vị thế đang giữ, nhiều đề xuất chấm cùng một lượt), điều mà sandbox trống không bao giờ có. Sổ thật chỉ được đọc để sao chép; mọi lệnh chạy trên bản sao.

```bash
SB=$S/book; rm -rf $SB && mkdir -p $SB/home && cp -R ~/.openalpha/data $SB/data
unset OKX_API_KEY OKX_API_SECRET OKX_API_PASSPHRASE BINANCE_API_KEY BINANCE_API_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_BOT_TEST_TOKEN
db() { sqlite3 "file:$SB/data/openalpha.sqlite?mode=ro" "$@"; }
ob() { HOME=$SB/home OPENALPHA_DATA_DIR=$SB $B chat --config ./config.toml -m "$*" --mode bypass --max-cost-usd 0.60 | tee -a $SB/out.txt; }
# Mã VN đang giữ và đã có đề xuất chốt kết quả:
db "select distinct s.ticker from suggestions s join ledger_entries l on l.ticker = s.ticker and l.txn_kind = 'buy' where s.market = 'equity-vn' and s.return_pct is not null"
T=<một mã ở trên>
```

| # | Lệnh | Mong đợi |
|---|---|---|
| M1 | `ob /suggest $T force` | Chạy xong, footer có chi phí, không có dòng "Đã có lỗi". Không đặt `OPENALPHA_DATA_DIR` thì không chạy ca này |
| M2 | So dòng "Khuyến nghị $T gần nhất đã có kết quả" với `db "select day, exit_day, return_pct from suggestions where ticker = '$T' and focus_key = 'default' and return_pct is not null order by resolved_at desc, exit_day desc, id desc limit 1"` | Ngày đề xuất = `day`, ngày đóng = `exit_day` (ngày đề xuất luôn trước ngày đóng), % = `return_pct` × 100. Khi nhiều dòng cùng `resolved_at` thì là dòng `exit_day` muộn nhất |
| M3 | So "Bạn đang giữ ... / Bạn mua ở ... / đang ▲▼ ..." với `db "select quantity, unit_price, fee from ledger_entries where ticker = '$T' and txn_kind = 'buy'"` | Số lượng khớp sổ; giá vốn = (Σ số lượng × giá + phí) / số lượng; % lãi = giá lúc phân tích / giá vốn − 1; dòng "giảm tương đương x% tổng tài sản" = số lượng × (giá − cắt lỗ) / tổng tài sản |
| M4 | So "tăng trưởng DT / LN" trong Nhìn nhanh và các quý được nhắc trong tranh luận với `quarterly_accounts` của `$T` | Bốn quý gần nhất so với bốn quý trước khớp tới 2 chữ số lẻ; quý được nhắc (Q2/2026...) có trong bảng, số liệu đúng chiều tăng/giảm |
| M5 | `grep -nE '\b20[0-9]{2}-[01][0-9]-[0-3][0-9]\b' $SB/out.txt` | Không dòng nào: mọi ngày, kể cả trong lời văn của tranh luận, viết theo kiểu dd/mm/yyyy |
| M6 | `rm -rf $SB` | Bản sao đã xóa; sổ thật không có dòng đề xuất mới của lượt này |

## N. Telegram với bot thử, cần khóa AI - sandbox `tg`

Cần người thao tác trên điện thoại. Chạy bản đang sửa trên bản sao dữ liệu thật với bot thử mà `./config.toml` trỏ tới (`token_env = "TELEGRAM_BOT_TEST_TOKEN"`); khóa AI là `OPENALPHA_OPENROUTER_API_KEY`. Hai biến này chỉ có trong `~/.zshrc`, nên lệnh chạy qua `zsh -ic` và bỏ khóa sàn ở đó. Không có daemon thật nào đang dùng bot thử (`pgrep -fl openalpha`), nếu không hai bên giành tin nhắn. Mỗi câu chat tốn vài cent.

```bash
SB=$S/tg; rm -rf $SB && mkdir -p $SB/home && cp -R ~/.openalpha/data $SB/data
awk '{print} /^\[channels.telegram\]/{print "gap_note_minutes = 1"}' ./config.toml > $SB/config.toml
tg() { zsh -ic "unset OKX_API_KEY OKX_API_SECRET OKX_API_PASSPHRASE BINANCE_API_KEY BINANCE_API_SECRET TELEGRAM_BOT_TOKEN; HOME=$SB/home OPENALPHA_DATA_DIR=$SB $B $*"; }
db() { sqlite3 "file:$SB/data/openalpha.sqlite?mode=ro" "$@"; }
# Lịch sử phiên chat Telegram mới nhất (chữ người gõ và câu trả lời):
chatlog() { db "select idx, role, strftime('%H:%M:%S', created_at/1000, 'unixepoch', '+7 hours'), substr(replace(content, char(10), ' '), 1, 200) from session_messages where session_id = (select session_id from session_messages group by session_id order by max(created_at) desc limit 1) order by idx"; }
tg start --background
```

| # | Thao tác | Mong đợi |
|---|---|---|
| N1 | Nhắn bot "chào"; `tg pair approve <mã bot gửi>` | Bot gửi mã ghép nối; `pair approve` in "đã ghép nối: <chat id>"; tin sau đó được trả lời |
| N2 | Hỏi "giá FPT và HPG hôm nay thế nào?"; khi trả lời xong, bấm trả lời vào câu đó: "thế mã đầu tiên thì sao?" | Câu sau nói về FPT. `chatlog`: dòng `user` chỉ có chữ bạn gõ, không có `pasted_content` hay lời dẫn |
| N3 | Gõ `/suggest HPG` (chạy lâu); trong lúc bot còn soạn, bấm trả lời vào một câu trả lời trước đó và hỏi tiếp | Bot trả lời xong `/suggest` rồi mới trả lời riêng câu hỏi tiếp, đúng tin bạn trả lời. `chatlog`: dòng `user` của câu hỏi tiếp nằm sau câu trả lời `/suggest`, không chen giữa các lượt gọi công cụ của nó |
| N4 | Bôi chọn một đoạn trong một câu trả lời (ví dụ đoạn nói về HPG), bấm trả lời: "giải thích đoạn này" | Bot giải thích đúng đoạn đã chọn, không phải cả câu trả lời |
| N5 | Đợi hơn 1 phút sau câu trả lời gần nhất, hỏi lại "giá FPT hôm nay thế nào?" | Bot gọi lại `market_price` (thấy trong `chatlog`) thay vì nhắc lại giá cũ, và nói đã một lúc trôi qua. Lời nhắc không nằm trong `chatlog` |
| N6 | Khi có cảnh báo hoặc bản tin sáng gửi tới, bấm trả lời: "tin này nói gì?" | Bot biết đó là loại tin nào, không nhắc số tiền hay khối lượng của bạn. Không có tin nào tới thì ghi "chưa chạy" |
| N7 | `[web_search] provider = "deepseek"`, `api_key_env = "DEEPSEEK_API_KEY"` (có khóa, qua `zsh -ic`); gọi `createProviderRunner(...).search` với `deepseekSearch` trong `bun` như B9d: một trang (`cafef.vn`), hai trang (`cafef.vn`, `vietstock.vn`), truy vấn dài hơn 128 ký tự kèm `vnexpress.net`, lọc 7 ngày | Mỗi ca có kết quả, đúng trang được chọn, có ngày đăng; lọc 7 ngày chỉ có bài trong 7 ngày. Mỗi lượt khoảng $0.00075. Ca nào ra 0 kết quả mà vẫn bị tính phí là lỗi |
| N8 | `tg stop`; `rm -rf $SB` | Daemon dừng, không còn tiến trình sandbox; bản sao đã xóa; sổ thật không có dòng ghép nối hay đề xuất mới |

## Kết thúc

- `pgrep -fl "$S"` không còn tiến trình sandbox.
- `bun run lint && bun run typecheck && bun run check && bun run lint:arch` đều qua.

## Ghi chú đã biết (không phải lỗi)

- Log: SSI 403 (nguồn bị chặn), CoinMarketCap 429 (chạy song song nhiều lượt).
- `/watchlist add` trước `/refresh` có cảnh báo nguồn coingecko/coinmarketcap.

## Ngoài phạm vi: cần key

- Khóa AI, khối 3 lệnh đầu mục "Bắt đầu nhanh" (A9 có khóa thật): `/suggest FPT` in kế hoạch giống GIF `assets/readme/demo.vi.gif` (dòng đầu, giá vào, cắt lỗ, chốt 33%, mục tiêu xa, mục 🎯 và dòng `/record buy ...` cuối).
- Khóa AI: `/suggest` (bố cục mong đợi: dòng đầu `nên MUA` / `nên BÁN BỚT` / `CHƯA MUA hôm nay` / `CHƯA MUA THÊM hôm nay` (mã đang giữ) / `GIỮ NGUYÊN`, dòng đầu không có mức giá, mỗi mức giá một dòng (quỹ ETF ghi "Xem lại tại" thay cho cắt lỗ), 📌 lập luận và 🚩 Tôi sai khi trước 📶 Nhìn nhanh, Nhìn nhanh chia Điểm cộng / Điểm trừ / Thông tin thêm, không có mục nguồn khi không trích dẫn, ngày dữ liệu và hồ sơ ở cuối), `/research`, `/themes`, `/setup`, chat, `chat --agent`, `doctor --online` dòng thử mô hình, `start` daemon, `/brief` có chi phí, `schedule run-now`, `workflow run`.
- Khóa sàn (testnet Binance, `simulated = true`): `/trade` thật; `/record sync binance` in một dòng cho mỗi đồng tiền quy đổi theo giá thị trường (số ít khi một dòng); `/reconcile` có số dư, so USDT: khớp thì không báo, lệch 1 thì báo USDT lệch 1, rút hết USDT trong sổ thì báo toàn bộ USDT trên sàn là chênh, có câu "Tiền trên sàn chỉ được đối chiếu khi..." khi có chênh.
- Khóa AI, đề xuất làm trong phiên: `/suggest <mã>` lúc phiên đang chạy, sau giờ đóng cửa `/refresh` rồi `/suggest <mã>` lại: chạy mới (có tốn phí), dữ liệu ngày hôm nay, không có dòng "♻️ Dùng lại"; gõ lần nữa thì dùng lại miễn phí. Không có khóa thì không ghi đè nhận định đã có.
- Khóa AI + ghi sổ qua chat: "ghi giúp mình nạp 1000 USDT vào Binance hôm qua" thì model hỏi tỷ giá, không tự ghi; trả lời "26600" thì ghi với `fx_rate` 26600, nguồn `operator`; nhờ sửa số tiền mà không nêu tỷ giá thì `portfolio_update` từ chối và model hỏi lại.
- Token kênh (ngoài mục N): Zalo, `pair approve` trên kênh thật, `/brief enable` trong kênh, `zalo login`, `/agent` trong nhóm, lệnh chỉ dành cho terminal gõ trong kênh ("Câu lệnh này chỉ dùng được trong terminal.").
- Đăng nhập nhà cung cấp: `auth login/logout`. Mạng xã hội agent: `social add/join/...`.
- Máy khác: Windows (`install.ps1` trên x64 và trên ARM/Windows 11; job CI `windows` và `windows-arm` chỉ kiểm cú pháp `install.ps1` và vòng bật/tắt daemon của từng bản, còn bước chọn đúng bản theo loại máy phải thử tay; `setx`), Ollama/vLLM.
