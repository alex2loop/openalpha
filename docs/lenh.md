# Lệnh

Hai cách dùng, một danh mục lệnh. `openalpha <lệnh>` là CLI. `/lệnh` chạy trong chat terminal và trong
mọi kênh đã cấu hình. Phần giao dịch chỉ có lệnh gạch chéo, không có lệnh CLI riêng.

Trang này là tấm bản đồ. Muốn biết chính xác cú pháp của bản bạn đang cài, chạy `openalpha --help` hoặc
`openalpha <lệnh> --help`.

## Hành vi chung

- Thành công thì thoát `0`. Lệnh lạ và lỗi thông thường thoát `1`.
- Cờ sai, thiếu giá trị, lựa chọn không hợp lệ, lỗi cấu hình hoặc lỗi kiểm tra đầu vào đều thoát `2`
  **trước khi** lệnh làm bất cứ điều gì. Lệnh sai cú pháp không bao giờ chạy dở.
- Cờ chung đặt trước hay sau lệnh đều được, trừ sau dấu `--`.
- `--` kết thúc phần phân tích cờ: mọi thứ sau nó là đối số vị trí. Số âm (`-5`, `-3.2`, `-5%`) là giá
  trị, không bao giờ bị coi là cờ lạ.
- Đầu ra ở terminal đã được lọc bỏ thông tin đăng nhập. `--verbose` thêm chi tiết chẩn đoán (có giới
  hạn).
- `--quiet` và `--verbose` loại trừ nhau.

| Cờ | Mục đích |
|---|---|
| `-q`, `--quiet` | Ẩn thông báo thành công và thông tin thường lệ |
| `--verbose` | Thêm chi tiết stack và nguyên nhân, đã lọc |
| `--config <đường dẫn>` | Dùng đúng tệp cấu hình này |
| `--data-dir <đường dẫn>` | Đổi thư mục dữ liệu gốc và vị trí cấu hình mặc định |
| `--log-level <mức>` | `debug`, `info`, `warn`, `error` hoặc `fatal` |
| `--no-color` | Tắt màu ANSI |

Mức log lấy theo thứ tự: cờ, `OPENALPHA_LOG_LEVEL`, TOML, rồi mặc định. `NO_COLOR` tắt hẳn màu;
`FORCE_COLOR` chỉ có tác dụng khi bạn chưa chủ động tắt màu.

### Mã thoát

Nếu bạn viết script: mã thoát cho biết **lý do** một phiên chạy dừng, không chỉ là nó đã dừng.

| Mã | Lý do |
|---:|---|
| `0` | `completed` |
| `1` | `error` |
| `3` | `budget` |
| `6` | `turn_limit` |
| `12` | `timeout` |
| `15` | `loop` |
| `16` | `agent_paused` |
| `130` | `aborted` |

Các lỗi khác: `2` cho lỗi cách dùng, cấu hình và kiểm tra; `5` khi LLM lỗi hẳn; `11` cho lưu trữ; `13`
cho kênh; `14` cho công cụ; `15` khi một lần ghi bị xung đột với lần sửa khác. Các lý do dừng khác dùng
mã liệt kê ở [An toàn](an-toan.md), nên `11` cũng là `hook_failed` và `12` cũng là `session_busy`.
`doctor` thoát `1` khi có phép kiểm nào hỏng.

REPL tương tác là ngoại lệ: nó in lỗi của từng lượt ngay tại chỗ và thoát bình thường khi bạn rời đi,
vì một lượt hỏng không phải một phiên chat hỏng.

## Danh mục lệnh

| Lệnh | Mục đích | Lệnh con |
|---|---|---|
| `chat` | Chat với agent, tương tác hoặc một phát | không có |
| `start` | Chạy kênh và bộ lập lịch | không có; `--background`/`-b` để tách nền |
| `stop` | Dừng daemon | không có |
| `restart` | Dừng rồi chạy lại | không có; `--background`/`-b` để tách nền |
| `status` | Tổng quan daemon, kênh và chi tiêu | không có |
| `version` | In phiên bản và báo nếu đã có bản mới | không có |
| `upgrade` | Cài bản phát hành mới nhất | không có; `--check` chỉ báo |
| `doctor` | Kiểm cấu hình, thông tin đăng nhập, lưu trữ | không có; kèm tên phép kiểm (`config`, `models`, `data-dir`, `logging`, `database`, `daemon`, `channels`, `delivery`, `sources`, `trading`, `venues`, `web-search`, `providers`, `telegram`, `zalo`, `version`) và `--online` |
| `onboard` | Thiết lập lần đầu, hoặc đổi mô hình, bot Telegram, mức chi hay ngôn ngữ | không có |
| `setup` | Chỉ dành cho ứng dụng desktop. Lần chạy đầu của một ứng dụng khách: danh mục nhà cung cấp, và tệp cấu hình khởi điểm có bật API (một dòng JSON) | `catalog`, `write <nhà cung cấp> <mô hình>` |
| `api` | Mã API (bearer token) của `/v1` | `token`, `rotate` |
| `agent` | Agent và ràng buộc chat | `list`, `show`, `add`, `edit`, `remove`, `pause`, `resume`, `bind`, `unbind`, `bindings` |
| `social` | Agent của bạn trên mạng xã hội của agent | `list`, `add`, `update`, `rollback`, `remove`, `pause`, `resume`, `join`, `leave`, `rekey`, `review`, `drafts`, `approve`, `discard`, `log` |
| `config` | Cấu hình đã phân giải | `show`, `get`, `path`, `validate`, `edit` |
| `provider` | Danh mục nhà cung cấp và mô hình | `list`, `models` |
| `auth` | Đăng nhập cho nhà cung cấp theo thuê bao | `login`, `status`, `logout` |
| `plugin` | Plugin đã cài | `list`, `install` (`--yes`), `update`, `uninstall` |
| `skill` | Kỹ năng đã tìm thấy | `list`, `install` (`--force`) |
| `memory` | Bộ nhớ của agent | `store`, `recall`, `search`, `list`, `remove` |
| `history` | Lịch sử phiên chat | `list`, `show`, `delete`, `clear` |
| `cost` | Chi tiêu trong một khoảng | không có; cờ chu kỳ hoặc ngày, `--breakdown` |
| `pair` | Ghép nối kênh | `list`, `approve`, `deny`, `revoke` |
| `schedule` | Việc theo lịch | `list`, `show`, `add`, `edit`, `remove`, `pause`, `resume`, `run-now` |
| `workflow` | Workflow đã đăng ký | `list`, `run` |
| `db` | Bảo trì cơ sở dữ liệu | `migrate` (`up`, `down`), `integrity`, `cleanup`, `stats`, `backup`, `export`, `import`, `restore`, `reset` |
| `logs` | Đọc, theo dõi hoặc xóa log chung và log agent | `tail` (mặc định, nên `logs` trần là đọc), `clear` |
| `mcp` | Server MCP và bề mặt công bố | `serve`, `surface`, `install` |
| `workspace` | Dọn thư mục nháp của agent | `cleanup` |
| `zalo` | Liên kết tài khoản Zalo cá nhân cho `zalo_personal` | `login` (`--profile`) |

## Chat

```text
openalpha chat [-m <nội dung>] [-a <agent>] [--mode manual|bypass]
             [-c] [--max-turns <n>] [--max-cost-usd <usd>]
```

Bỏ `--message` thì vào REPL. Có `--message` thì chạy một phát. Một phát chỉ hỏi phê duyệt được khi stdin
là terminal. Với stdin qua pipe hoặc rỗng thì không có ai để hỏi, nên ở chế độ thủ công, một lời gọi
nguy hiểm bị chặn do không có ai phê duyệt, chứ không được duyệt ngầm. `--mode bypass` luôn phải tự gõ.

`--continue` tiếp tục phiên chat trước của CLI, và từ chối một `--agent` khác với agent của phiên đó.
Các cờ giới hạn lượt và chi phí chỉ **thu hẹp** được một phiên chạy, không nới ra; hạn mức theo ngày và
tháng vẫn luôn áp dụng.

### Lệnh gạch chéo

Một danh mục duy nhất quyết định phần trợ giúp, phân quyền, thời gian chờ, nơi nào chạy được lệnh nào và
menu Telegram, nên một lệnh hành xử giống hệt nhau trong REPL và trong nhóm chat.

| Lệnh | Mục đích |
|---|---|
| `/agent` | Xem agent cửa vào; operator kênh có quyền thì đổi được |
| `/model` | Xem hoặc chọn một bộ chọn mô hình đã cấu hình |
| `/research` | Chạy nghiên cứu có giới hạn và trích nguồn, không đổi agent đang chọn |
| `/health` | Xem các mã sức khỏe của runtime và kênh |
| `/memory` | Liệt kê, gọi lại, tìm, ghi hoặc xóa bộ nhớ |
| `/cost` | Xem lượng dùng của phiên chat này và chi tiêu hôm nay so với hạn mức |
| `/schedule` | Liệt kê, xem, tạm dừng, chạy lại hoặc chạy ngay một việc của bạn |
| `/config` | Xem ngôn ngữ, mô hình, ngân sách và kênh đang chạy |
| `/new` | Chuyển sang một phiên chat mới |
| `/continue` | Chạy tiếp một lượt dừng giữa chừng, không phải gõ lại yêu cầu |
| `/social` | `/social drafts` xem những gì agent đang chờ đăng; `/social approve <id>` gửi một bản nháp, `/social discard <id>` bỏ nó. Chỉ operator dùng được. Xem [Mạng xã hội](mang-xa-hoi.md) |

Kênh có thêm `/stop` và các lệnh ghép nối. `/stop` và `/help` cũng nhận dạng gọi kèm tên bot như
`/stop@MyBot`, đúng cách nhóm Telegram gửi lệnh. REPL có `/help`, `/exit` và `/quit`, và Ctrl+D cũng
thoát được. Dòng gõ trong lúc một lượt còn chạy không được gửi, kể cả sau đó, để nó không vô tình trả lời
một câu hỏi phê duyệt; REPL báo ngay để bạn gõ lại.

Hai quy ước giải thích đầu ra bạn thấy:

- Lệnh nào phải chờ mạng thì hiện một dòng tiến độ khi chạy và một dòng cuối khi xong. Lệnh trả lời từ
  dữ liệu cục bộ (`/watchlist`, `/profile`, `/alert`, `/sources`) không có cả hai.
- Nếu phiên chạy phải đổi nhà cung cấp, một dòng ngay phía trên dòng cuối nói rõ chuyển từ đâu, sang
  đâu, vì sao - mỗi lần đổi một dòng. Dòng này giải thích vì sao dòng cuối không nêu tên mô hình, và
  tính cả các phiên chạy con của lệnh gạch chéo lẫn các lời gọi của chính lượt chat.

Phần giao dịch thêm `/setup`, `/record`, `/update`, `/delete`, `/transactions`, `/portfolio`,
`/profile`, `/watchlist`, `/price`, `/market`, `/overview`, `/screen`, `/sources`, `/suggest`,
`/themes`, `/rebalance`, `/reconcile`, `/reflect`, `/alert`, `/brief` và `/refresh`, cộng `/trade`,
lệnh đặt được lệnh khi có sàn đã khai khóa giao dịch. Chúng nằm ở [Chat giao dịch](#chat-giao-dịch)
bên dưới, và ở [Cẩm nang sử dụng](cam-nang.md) theo góc nhìn người dùng.

## Nghiên cứu

Không có lệnh nghiên cứu riêng. Nghiên cứu chạy bên trong các lượt `chat` bình thường - một phát, REPL
hay kênh - bất cứ khi nào agent thấy cần bằng chứng mới từ nhiều nguồn bên ngoài. `/research` buộc một
lượt như vậy chạy ở tiền cảnh, qua agent nghiên cứu sâu, mà không đổi ràng buộc `/agent` của bạn.

```text
/research <câu hỏi>
/research quick <câu hỏi>
/research standard <câu hỏi>
/research thorough <câu hỏi>
```

Bỏ trống mức thì được `standard`. Dòng tiêu đề gọi ba mức là `light` (quick), `medium` (standard) và
`deep` (thorough).

Nghiên cứu **chỉ chạy ở tiền cảnh, ngay trong phiên chạy đã gọi nó**. Nó dùng chung tín hiệu hủy, ngân
sách và hạn chót của lượt đó, và không để lại tác vụ nền, mã nghiên cứu hay trạng thái nào được lưu. Hủy
phiên chạy (Ctrl+C hoặc `/stop`) thì nó dừng gọn. Không có lệnh điều khiển bất đồng bộ, và không chạy
tiếp được ở lượt sau.

### Bạn thấy gì trong lúc nó chạy

CLI hiện dòng tiêu đề độ sâu. Với các độ sâu có lập kế hoạch, tiếp theo là kế hoạch dưới dạng các câu hỏi
đánh số. Mỗi câu hỏi đang chạy có một dòng trực tiếp (`q N/M · câu hỏi · thời gian`), với lần tìm kiếm
hay tải trang hiện tại thụt vào bên dưới. Khi xong, mỗi câu hỏi để lại một dòng: số lần thử, thời gian,
số phát hiện, số nguồn, hoặc mã lỗi. Phần tổng khép lại phiên chạy: số lần tìm, số lần tải, số nguồn,
thời gian, và chi tiêu thật của phiên chạy.

`--verbose` thêm các dòng hoàn tất tìm kiếm và tải trang, cùng chi tiết truy hồi. Đầu ra qua pipe chỉ
giữ các dòng mốc và không bao giờ hỏi hay chạy hoạt ảnh.

### Duyệt kế hoạch

Một phiên chạy `thorough` cấp cao nhất không bao giờ tự khởi động mà chưa được duyệt. Nó cho bạn xem kế
hoạch trước khi tiêu đồng nào: mục tiêu gốc và mục tiêu đã chuẩn hóa, các khía cạnh, giả định, độ mới,
độ phức tạp, các câu hỏi đánh số, và giới hạn thật của phiên chạy - thời lượng tối đa, số câu hỏi tối
đa, số vòng soát, ngân sách còn lại và tỷ trọng ngân sách nhánh. Rồi nó chờ đúng một quyết định:

| Phím | Quyết định |
|---|---|
| Enter | Chạy với đúng kế hoạch đang hiện |
| `e` | Sửa: đưa một chỉ dẫn chỉnh sửa; kế hoạch được dựng lại và hiện lại |
| `q` hoặc Escape | Hủy phiên chạy |

Bạn được **đúng một** lần sửa. Sau đó kế hoạch chỉ còn chạy hoặc hủy. Khi không có ai để hỏi (stdin là
pipe hoặc không có terminal), một phiên chạy `thorough` bị hủy trước khi tiêu đồng nào. `quick` và
`standard` không hiện ô duyệt kế hoạch, còn nghiên cứu được ủy quyền thì không bao giờ hỏi.

Trên kênh, kế hoạch đến dưới dạng một tin nhắn có hai nút Bắt đầu và Hủy, không có nút sửa. Chỉ một lần
bấm của operator mới có hiệu lực. Ba phút không ai bấm thì phiên chạy bị hủy, và kênh không có nút bấm
trong tin nhắn cũng vậy.

Sau đó agent viết đúng một câu trả lời cuối trong cùng luồng chat, mở đầu bằng kết luận, mức bằng chứng,
các khoảng trống và phần tóm tắt nguồn, với URL hiện đầy đủ. Kênh sửa được tin nhắn thì gom các mốc tiến
độ vào một dòng trạng thái trực tiếp; kênh khác nhận vài tin nhắn mốc. Câu trả lời cuối đến như một câu
trả lời thường.

## Daemon và chẩn đoán

```text
openalpha start [--background]
openalpha stop
openalpha restart [--background]
openalpha status
openalpha doctor [--online]
```

`start` trần chạy ở tiền cảnh, và Ctrl-C sẽ dừng nó. `--background`/`-b` chạy lại đúng dòng lệnh đó ở
nền, rồi in pid và đường dẫn đầu ra khi daemon đã ghi tệp pid. Daemon chết giữa chừng khi khởi động thì
được báo ngay kèm mã thoát. Daemon vẫn đang khởi động có 90 giây (lần chạy đầu phải tạo cơ sở dữ liệu).
Cả hai trường hợp lệnh đều thoát với mã khác 0 và kèm đường dẫn đầu ra. `stop` và `status` hoạt động như
nhau ở cả hai chế độ. Khi chạy ở tiền cảnh, `start` còn in mô hình, các kênh nó mở, cổng API khi bật
`[api]`, và tệp nhật ký. `restart` nhận cùng cờ `--background`.

`doctor` luôn chỉ đọc. Chạy offline thì nó chỉ kiểm phần nhìn được ở máy; `--online` thêm các phép thử
thật tới PostgreSQL, nhà cung cấp, token kênh, tìm kiếm web và khóa sàn. Phép thử nhà cung cấp gửi cho
mô hình đầu tiên của mỗi nhà cung cấp một tin ngắn, và nói rõ khi máy chủ chạy trên máy bạn chưa bật. `doctor models` còn nêu tên
các biến tài khoản đám mây mà một mục Vertex hay Azure không có khóa vẫn cần. `doctor trading` dựng thử hệ
thống y như `chat` nhưng không khởi chạy hay migrate gì, nên khu vực chính không sàn nào giao dịch hay
`default_for` trỏ nhầm sàn sẽ lộ ra ngay ở đây. Nó chờ tới khi đã có cơ sở dữ liệu.

`doctor version` đọc câu trả lời gần nhất từ GitHub (cũ nhất một ngày); `doctor version --online` hỏi
lại ngay. Chậm phiên bản chỉ là cảnh báo, không bao giờ là lỗi.

Hãy chạy `doctor venues --online` một lần sau khi thêm khóa sàn. Nó đọc xem khóa Binance thật được phép
làm gì, và cảnh báo khi khóa còn rút được tiền, còn dùng được từ mọi IP, hoặc đang tắt giao dịch spot.
Khóa demo thì không bị kiểm.

### Luôn dùng bản mới

Khi có bản mới, CLI báo mỗi ngày một lần, ngay dưới kết quả lệnh. `upgrade` tải tệp chạy của bản mới cho
đúng máy bạn về cạnh bản đang cài và đối chiếu với SHA256SUMS của bản phát hành. Xong bước đó nó mới tạm
dừng daemon (nếu đang chạy), thay tệp bằng một lần đổi tên, rồi nhắc bạn cách bật lại daemon. Thư mục dữ
liệu và cấu hình không bị đụng tới. Nếu bước thay tệp lỗi, bản cũ vẫn nguyên và thông báo cho bạn biết
daemon đang dừng cùng cách bật lại. Tải đứt giữa chừng, sai mã kiểm tra hay bấm Ctrl-C đều dừng trước
bước đổi tên, nên bản cũ vẫn nguyên và daemon vẫn chạy. Windows không cho thay một `openalpha.exe` đang
chạy, nên ở đó bản cũ được đổi tên thành `openalpha.exe.old` trước; lần nâng cấp sau sẽ ghi đè lên nó.
`upgrade --check` chỉ báo, không cài. Bản chạy từ mã nguồn thì cập nhật bằng `git pull`.

## Cấu hình và khởi tạo

```text
openalpha onboard
openalpha config show
openalpha config get <đường-dẫn-chấm>
openalpha config path
openalpha config validate
openalpha config edit
```

`show` che thông tin bí mật, và `get` từ chối mọi đường dẫn đi qua một khóa bí mật. `validate` chạy đủ
các bước kiểm tra lúc khởi động, kể cả `[trading]`, nên một cấu hình nó chấp nhận là một cấu hình khởi
động được; nếu không, nó thoát `1` kèm lý do. `config get` nhận đường dẫn vào cấu hình đã phân giải, viết
kiểu camelCase (`budget.maxDailyUsd`). `edit` dùng `VISUAL`, không có thì `EDITOR`, rồi đến `nano`; giá
trị trống coi như chưa đặt. Giá trị được đọc như git đọc, nên có thể kèm cờ hoặc đường dẫn đặt trong
dấu nháy (`"/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl" -w`).

`onboard` dẫn bạn qua lần thiết lập đầu: ngôn ngữ, nhà cung cấp AI và mô hình, URL endpoint nếu nhà cung
cấp cần, tên biến môi trường chứa key, mức chi tối đa mỗi ngày ($2 nếu bạn không đổi) và, nếu muốn, một bot
Telegram. Trả lời sai thì nó hỏi lại chứ không dừng cả quá trình. Nếu key đã được đặt, nó gửi thử một tin
ngắn tới mô hình; nếu bạn chọn gói ChatGPT, nó mời bạn đăng nhập ngay; cuối cùng nó in danh sách đánh số
những việc còn lại.

Chạy lại khi đã có cấu hình để đổi một phần: mô hình, bot Telegram, mức chi hoặc ngôn ngữ. Lần ghi lại này
làm mất các dòng chú thích trong tệp, nên tệp cũ được sao lưu trước, nằm cạnh nó với tên
`config.toml.<thời-điểm>.bak`. Mỗi lần đổi để lại một bản sao lưu riêng; bản nào không cần nữa thì bạn cứ
xóa. Khi chưa có cấu hình, gõ `openalpha` trần hoặc bất kỳ lệnh nào cần cấu hình
đều sẽ mời bạn bắt đầu thiết lập.

`setup write` ghi cùng tệp khởi điểm cho ứng dụng desktop, bật thêm `[api]`, và không ghi đè cấu hình đã có.

```text
openalpha api token
openalpha api rotate
```

`api token` in mã API mà app và các ứng dụng `/v1` khác gửi kèm. `api rotate` thay mã mới, và daemon cần
khởi động lại để dùng mã mới. Khi đặt `[api] token_env`, mã là giá trị của biến đó và `rotate` không đụng
tới nó.

## Đăng nhập nhà cung cấp

```text
openalpha auth login <nhà cung cấp> [--paste] [--device]
openalpha auth status [nhà cung cấp]
openalpha auth logout <nhà cung cấp>
```

Dành cho các nhà cung cấp xác thực bằng gói thuê bao thay vì khóa API. `login` mặc định đăng nhập qua
trình duyệt: nó in URL ủy quyền, chờ ở một listener loopback tại `127.0.0.1:1455` (nếu cổng đó bận thì
dùng `:1457`), và đối chiếu đúng `state` nó đã phát. `--paste` bỏ listener và đọc mã bạn dán vào, mã trần
hoặc cả URL chuyển hướng. `--device` dùng luồng device-code ở nhà cung cấp có hỗ trợ: in một mã người
dùng và một URL để bạn mở ở thiết bị khác. Cả ba đều hết hạn sau 15 phút.

`status` không kèm tham số sẽ báo mọi nhà cung cấp hỗ trợ đăng nhập. Các lệnh này không khởi động runtime
và chạy được trước khi có tệp cấu hình. Cách lưu token, làm mới và tính chi phí nằm ở [Agent](tro-ly.md).

## Agent, plugin, kỹ năng

Agent của bạn nằm trong thư mục dữ liệu đang dùng. Agent có sẵn và agent đi kèm thì không sửa hay xóa
được. Lệnh ràng buộc nhận một mã kênh và gắn một cặp kênh/chat vào một agent; ràng buộc được lưu lại và
có hiệu lực từ tin nhắn kế tiếp.

```text
openalpha plugin list
openalpha plugin install <nguồn>
openalpha plugin update <id>
openalpha plugin uninstall <id>

openalpha skill list
openalpha skill install <nguồn>
```

Việc cài plugin và kỹ năng đều kiểm mã, đường dẫn và mức tin cậy của nguồn. Một phiên chạy agent chỉ
thấy công cụ chỉ-đọc `skill_view`; việc quản lý gói nằm trên CLI.

### Tạm dừng agent

```text
openalpha agent pause <id> | --all     # tắt một agent của chính bạn
openalpha agent resume <id> | --all    # và bật lại, không cần khởi động lại
```

Chỉ agent nằm trong thư mục dữ liệu của bạn mới tạm dừng được. Agent đang tạm dừng từ chối mọi phiên chạy
của nó với mã thoát `16` (xem [Mã thoát](#mã-thoát)), và `agent list` đánh dấu nó.

### Mạng xã hội

```text
openalpha social add <địa chỉ skill.md>          # ghim một mạng sau khi bạn đọc nó cho phép gì
openalpha social update <mạng>                   # xem skill đã đổi; rollback để quay lại
openalpha social join <agent> <mạng>             # đưa một agent của bạn lên đó
openalpha social drafts                          # những gì đang chờ bạn duyệt; approve hoặc discard theo id
openalpha social log <agent> [<mạng>]            # agent đã đăng gì
openalpha social pause|resume <mạng> [<agent>]
```

Agent cần `[focus]` riêng và chỉ công cụ được phép mới tham gia được, và `agent remove` từ chối một agent
còn giữ tư cách thành viên. Chi tiết ở [Mạng xã hội](mang-xa-hoi.md).

## Bộ nhớ, lịch sử, chi phí

Mọi thao tác với bộ nhớ đều qua các kiểm tra về bí mật, tiêm prompt, kích thước, phạm vi và thời gian
sống. Tìm kiếm dùng chỉ mục toàn văn.

`history clear` xóa mọi phiên chat, hoặc mọi phiên chat của một agent. Hãy đọc phần trợ giúp và câu hỏi
xác nhận trước khi chạy.

`cost` nhận `--period day|week|month`, hoặc một khoảng ngày ISO `--from`/`--to` (gồm cả hai đầu). Nó đọc
số liệu từng lần gọi đã lưu thay vì ước lượng từ nội dung hội thoại, nên khớp với hóa đơn của nhà cung
cấp. `--breakdown` tách đúng khoảng đó theo trợ lý và mô hình - số lời gọi, số lần hỏng, thời gian trả
lời điển hình, token đến từ cache, token tiêu cho suy nghĩ - đắt nhất trước.

## Ghép nối

```text
openalpha pair list --channel <id>
openalpha pair approve <mã>
openalpha pair deny <mã>
openalpha pair revoke <chat-id> --channel <id>
```

Dành cho các kênh dùng chế độ ghép nối: Telegram và Zalo khi được cấu hình như vậy. Chỉ các operator đã
cấu hình mới chạy được lệnh ghép nối trong kênh, và một chat đã ghép nối không duyệt được cho chat khác.

## Đăng nhập Zalo Personal

```text
openalpha zalo login [--profile <tên>]
```

Liên kết tài khoản Zalo cá nhân cho kênh `zalo_personal`. Lệnh lưu một ảnh mã QR và in ra đường dẫn. Bạn
quét bằng ứng dụng Zalo rồi xác nhận trên điện thoại. Cứ khoảng hai phút có mã mới thay thế, và sau năm
phút lệnh thôi chờ. Lần đăng nhập được cất theo `--profile`, hoặc theo `profile` của kênh khi bạn bỏ
trống, và ảnh QR bị xóa khi xong. Daemon đang chạy sẽ nhận đăng nhập mới ở lần nối lại kế tiếp.

## Lịch chạy và workflow

Lịch chạy hỗ trợ cron hoặc chu kỳ cố định, đích gửi do bạn chỉ định, tạm dừng và chạy lại, chạy ngay, và
giới hạn công cụ cho từng việc qua `--allow-tools`. `--agent` mặc định là `chat`. Việc theo cron lưu kèm
một múi giờ IANA; việc theo chu kỳ thì không nhận múi giờ. Khi một việc theo lịch gọi công cụ nguy hiểm,
yêu cầu phê duyệt đi qua kênh nếu đích của việc đó có người duyệt; nếu không thì lời gọi bị từ chối.

```text
openalpha workflow list
openalpha workflow run <id>
```

`workflow run` chạy một workflow đã đăng ký, dừng khi CLI nhận tín hiệu tắt, và báo lại các bước cùng chi
phí. Chưa có workflow nào là bình thường, không phải lỗi.

## Bảo trì cơ sở dữ liệu và thư mục làm việc

Các lệnh ghi vào cơ sở dữ liệu (`db migrate`, `cleanup`, `import`, `restore`, `reset`) chỉ chạy khi
daemon đã dừng. `restore`, `reset` và việc lùi một migration sẽ hỏi xác nhận, trừ khi bạn đưa `--yes`.
`db cleanup` cần `--older-than` (tối thiểu `1d`); `--dry-run` cho xem trước những gì nó sẽ dọn.

`db integrity`, `db stats`, `db export` và `db backup` chỉ khởi động tầng lưu trữ, nên chạy được khi chưa
cấu hình khóa mô hình nào. Sao lưu và khôi phục, xuất và nhập, cùng việc mỗi cách giữ được gì qua một
lần `db reset`, nằm ở [Lưu trữ](luu-tru.md).

`workspace cleanup` chỉ chạm tới `run/` và `tmp/` bên trong các thư mục làm việc của agent bạn chọn bằng
`--agent <id>` hoặc `--all` (bắt buộc chọn đúng một). `--older-than`, `--dry-run` và `--yes` dùng như ở
các lệnh khác, và daemon phải đã dừng. Lệnh này không xóa tệp bền vững ở gốc thư mục làm việc hay log của
agent. Như mọi khi: thư mục làm việc chỉ là nơi xuất phát an toàn, không phải vùng cách ly của hệ điều
hành.

## Log

```text
openalpha logs [--lines <n>] [-f] [--agent <id>] [--since <mốc|khoảng>]
openalpha logs clear [--agent <id> | --daemon] [--older-than <khoảng>] [--dry-run] [--yes]
```

Dạng đọc là mặc định, nên `logs` trần là đọc. Bạn chọn được số dòng cuối, chế độ theo dõi, log riêng của
một agent, và mốc bắt đầu (mốc ISO hoặc khoảng thời gian). Đầu ra vẫn được lọc bỏ thông tin đăng nhập.

`logs clear` xóa các thư mục log theo agent dưới `<data_dir>/logs/agents/`:

- `--agent` giới hạn vào một agent.
- `--older-than` chặn theo tuổi (bỏ trống để xóa bất kể tuổi; tối thiểu `1d` khi khai).
- `--dry-run` xem trước số lượng và dung lượng mà không xóa.
- `--daemon` chuyển đích sang log chung của daemon cùng các tệp đã xoay vòng, chặn theo tuổi của tệp mới
  nhất. Không dùng chung được với `--agent`.

Lệnh cần daemon đã dừng và sẽ hỏi lại trừ khi bạn đưa `--yes`.

Lệnh này khác với khâu quét tự động của daemon, vốn chỉ xóa log của những agent không còn trong cấu hình
(xem [`[retention]`](cau-hinh.md#retention)). Khi không có `--daemon`, `logs clear` xóa mọi thứ khớp
phạm vi, kể cả log của agent đang cấu hình (bộ ghi log sẽ tạo lại chúng ở lần chạy sau), và không bao giờ
chạm tới log chung đang hoạt động, vốn bị giới hạn bởi `[log].max_file_mb` và `[log].max_files`. Thư mục
nháp của agent (`run/`, `tmp/`) vẫn là việc của `workspace cleanup`.

## Chat giao dịch

Phần giao dịch không có cây lệnh CLI riêng. Chat terminal và mọi kênh đã cấu hình dùng chung một bộ lệnh
gạch chéo (đã dịch sang ngôn ngữ của bạn), nên thứ bạn học trong REPL dùng được luôn từ điện thoại.

Ba lệnh có đủ cú pháp để đáng có phần riêng bên dưới: `/record`, `/suggest` và `/trade`. Những lệnh còn
lại gói gọn trong một dòng. Cách nhìn theo người dùng nằm ở [Cẩm nang sử dụng](cam-nang.md), gồm cả phần
ghi sổ và `/trade`.

| Lệnh | Cú pháp và ghi chú |
|---|---|
| `/setup` | `/setup` - trợ lý làm gì và cách thiết lập |
| `/record` | Ghi một dòng vào sổ. Xem [Sổ lệnh](#sổ-lệnh) |
| `/update` | `/update <mã bút toán> <các trường như /record>` - sửa trực tiếp một mục, kể cả sàn. Khi sửa phải tự ghi rõ khối lượng và phí: chỉ `/record` mới ghi `all` hoặc để phí tính theo tỷ lệ, vì tính lại một trong hai theo một cuốn sổ về sau hay một tỷ lệ đã đổi sẽ làm xê dịch một con số đã chốt mà không ai nhắc lại |
| `/delete` | `/delete <mã bút toán>` - xóa một mục |
| `/transactions` | `/transactions [số dòng] [khoảng ngày] [mã bút toán]` - các giao dịch đã ghi, mới nhất trước, mỗi dòng kèm mã bút toán mà `/update` và `/delete` nhận. Khoảng ngày là `a..b`, `a..`, `..b`, một ngày, `today`, `week`, `month`, hoặc `7d`/`30d`; đưa một mã bút toán để đọc tiếp lùi từ đó |
| `/portfolio` | `/portfolio` - giá trị và phân bổ, mỗi dòng nói rõ vị thế đang cách mức dừng bao xa. Xem [Mức dừng dự kiến không phải một lệnh đang treo](#mức-dừng-dự-kiến-không-phải-một-lệnh-đang-treo) |
| `/portfolio nav [1m\|3m\|6m\|1y\|all]` | `/portfolio nav 3m` - danh mục đã đi thế nào: lợi nhuận đã loại tiền nạp và rút, mức sụt sâu nhất từ đỉnh, và thước đo từ tỷ trọng mục tiêu của bạn. Mặc định `3m` |
| `/profile` | `/profile show`; `/profile set <trường> <giá trị>`; `/profile enable\|disable <nhóm>`; `/profile reset` |
| `/watchlist` | `/watchlist` - giá trực tiếp của những gì bạn theo dõi và đang nắm, tối đa mười hai mã (danh sách dài hơn bị cắt và có nói rõ); `/watchlist add <mã>...`; `/watchlist remove <mã>...` |
| `/price` | `/price <mã>`, hoặc `thị-trường:mã` khi một tên trần mơ hồ. Thị trường niêm yết bảng hai chiều của đại lý (vàng VN) in cả hai chiều và chênh lệch giữa chúng, chứ không in cặp đóng cửa/trực tiếp: một bảng không nêu giá khớp cuối, và không giữ chuỗi ngày nào để đối chiếu giá đóng |
| `/market` | `/market` - một thị trường đang ở đâu ngay lúc này, đặt cạnh phiên gần nhất đã chốt; `/market enable\|disable` - bật hoặc tắt các lần gửi theo lịch (chúng đi tới chat mặc định, không nhất thiết là chat này) |
| `/overview` | `/overview` - mọi thị trường đang thế nào, kèm khối vĩ mô |
| `/screen` | `/screen [thị-trường] [số lượng] [loại]`, thứ tự tùy ý. Thị trường mặc định là thị trường mà lịch của `[locale] region` nêu tên; `loại` thu hẹp về một loại công cụ mà thị trường đó niêm yết. Mã nằm trong danh sách loại trừ của bạn vẫn được xếp hạng và được đánh dấu, không bị ẩn |
| `/suggest` | Tiêu ngân sách LLM cho một mã. Xem [Đề xuất](#đề-xuất) |
| `/themes` | `/themes` - tìm các chủ đề đầu tư đang hình thành ở Việt Nam và tiêu ngân sách LLM; `/themes run <id>` - kiểm lại một chủ đề đang theo dõi và không tìm chủ đề mới, với một phần nhỏ chi phí; `/themes show` - đọc báo cáo đã lưu, không gọi mô hình; `/themes approve\|reject\|retire <id>` - chuyển trạng thái một chủ đề. Chỉ operator dùng được |
| `/rebalance` | `/rebalance`; `/rebalance <mã>...` - tính khoảng cách tới mục tiêu, không cân nhắc bằng chứng và không gọi mô hình. Xem [`/rebalance` tính những gì](#rebalance-tính-những-gì) |
| `/reflect` | `/reflect` - các đề xuất trước đây thực tế chạy ra sao |
| `/alert` | `/alert list [số lượng]`; `/alert create <mã> above\|below <ngưỡng>`, hoặc `thị-trường:mã` khi một tên trần mơ hồ; `/alert disable <id-cảnh-báo>`. Danh sách gồm cả các dòng cảnh báo thoát và sàng lọc do hệ thống đặt, bên cạnh dòng của bạn |
| `/brief` | `/brief`; `/brief force`; `/brief enable [HH:mm]`; `/brief disable`. `force` dựng lại bất chấp bản chụp đã lưu của hôm nay. Xem [Bản tin khi chưa có danh sách theo dõi](#bản-tin-khi-chưa-có-danh-sách-theo-dõi) |
| `/refresh` | `/refresh [thị-trường] [force]`, thứ tự tùy ý. Không nêu thị trường thì chỉ làm mới các thị trường bạn còn dùng: nhóm đang bật trong hồ sơ, hoặc nơi bạn đang giữ mã, theo dõi mã hay còn gợi ý chờ chấm điểm. Thị trường còn lại được liệt kê là bỏ qua; gõ thẳng tên thì vẫn nạp. `force` tải lại bất kể dữ liệu nào đang mới. Vàng thế giới đọc giá trực tiếp nên không có gì để nạp, và lệnh nói rõ điều đó. Một loại dữ liệu trải ra nhiều công cụ sẽ báo đã tới đâu |
| `/sources` | `/sources` - nhà cung cấp nào đã ngừng trả lời, hoặc một dòng duy nhất nếu không có. Trạng thái cầu dao là bộ nhớ của chính tiến trình này, nên một lần gọi CLI mới báo rằng chưa gọi nhà cung cấp nào, chứ không khẳng định mọi thứ khỏe |
| `/reconcile` | `/reconcile` - đối chiếu sổ với những gì sàn báo; sàn chưa có khóa API thì được nêu tên kèm các biến còn thiếu |
| `/trade` | Dàn, xác nhận và hủy lệnh thật. Xem [Đặt lệnh](#đặt-lệnh) |

#### Mức dừng dự kiến không phải một lệnh đang treo

Mức dừng mà một dòng `/portfolio` nêu là mức kế hoạch mới nhất đặt ra, **không phải** một lệnh ai đó đã
đặt. Khi có mức dừng dự kiến mà không có gì đang treo ở sàn, dòng đó ghi `chưa đặt lệnh cắt lỗ`. Khi
không sàn nào giữ mã đó có thể mang một lệnh như vậy thì nó không nói gì cả. `/trade` là nơi các lệnh
thoát đang treo được nêu chính xác.

#### `/rebalance` tính những gì

Các mã đưa vào `/rebalance` thay cho danh sách theo dõi đã lưu trong lần chạy đó và không bao giờ được
lưu lại. Thứ bạn đang nắm luôn được tính. Không có mã nào thì dùng các vị thế đang nắm cộng danh sách
theo dõi đã lưu. Viết `thị-trường:mã` khi một tên trần mơ hồ.

Các dòng được tính để thu hẹp khoảng cách tới mục tiêu trong ngân sách của nhóm, mức trần mỗi mã và lô
chẵn. Không cân nhắc bằng chứng nào và không gọi mô hình, nên một khối có lệnh mua kết thúc bằng việc nêu
`/suggest <mã>` - lệnh nhân cùng mức trần đó theo mức tin tưởng và có thể từ chối một mã mà kế hoạch liệt
kê.

#### Bản tin khi chưa có danh sách theo dõi

Các khối dẫn đầu và bị loại bao quát danh sách theo dõi của bạn, và vắng mặt khi nó rỗng. Các khối lịch,
sự kiện doanh nghiệp và tiêu đề tin vẫn bao quát các mã giao dịch nhiều nhất của thị trường, nên một bản
tin không có danh sách theo dõi chỉ ngắn hơn chứ không trống hơn.

#### Về tên trong `/watchlist`

Viết `thị-trường:mã` khi một tên trần mơ hồ. Một tên trần ở `remove` bỏ nó khỏi mọi thị trường đang giữ
nó.

```text
openalpha chat --message "/setup"
openalpha chat --message "/record deposit vps 100000000 VND 2026-08-03"
openalpha chat --message "/profile set risk-level balanced"
openalpha chat --message "/suggest FPT"
```

`/alert create` và `/brief enable` cần một kênh nhận tin như Telegram hay Zalo, nên terminal từ chối hai
lệnh này. Hãy gõ chúng trong kênh đã kết nối.

Với bất cứ thứ gì chưa có lệnh riêng - nến, tin tức, sức mạnh ngành, dòng tiền ngoại, soát danh mục,
bảng thành tích - cứ hỏi bằng lời. Agent sẽ gọi đúng các công cụ giao dịch tương ứng.

Chỉ `/price`, `/overview`, `/screen` và `/themes` ghi câu trả lời vào phiên chat, nên tin nhắn kế tiếp
hỏi về chúng được. Câu trả lời của `/portfolio`, `/rebalance`, `/transactions`, `/market`, `/brief`,
`/suggest` và `/reflect` chỉ được hiển thị, phiên chat không nhớ.

Lệnh gạch chéo lấy đích gửi từ chính chat terminal hay kênh mà nó chạy. Một lần ghi hồ sơ không kèm số
phiên bản. Nếu hai chat sửa cùng lúc thì lần sửa sau thắng, không bên nào bị từ chối; với một operator
duy nhất, "áp dụng đúng sửa đổi của tôi" là câu trả lời hợp lý.

### Sổ lệnh

Mỗi dòng nêu tên một công cụ cũng nêu tên sàn đang giữ nó: cùng một đồng coin ở hai nơi giữ là hai vị
thế với hai giá vốn. Dòng đó cũng nêu thị trường ngay trong cùng token với mã (`equity-vn:FPT`) thay vì
để hệ thống đoán, vì một dòng sổ làm đổi gốc của mọi số đọc sau đó từ sổ.

```text
/record deposit|withdrawal|fee|loss <sàn> <số tiền> <tiền tệ> <ngày>
/record buy|sell <sàn> <thị-trường:mã> <số lượng|all> <đơn giá> <tiền tệ> [phí] <ngày>
/record rights <sàn> <thị-trường:mã> <số lượng> <đơn giá> <tiền tệ> <phí> <ngày>
/record dividend <sàn> <thị-trường:mã> <số tiền> <tiền tệ> <ngày>
/record split|distribution <sàn> <thị-trường:mã> <thay-đổi-số-lượng> <ngày>
/record transfer <từ-sàn> <đến-sàn> <số tiền> <tiền tệ> <phí> <ngày>
/record sync <sàn>
```

**Mua và bán.** Lệnh bán có thể ghi `all` thay cho một con số, và sổ tính thành khối lượng đã thanh toán
đang nắm *ở sàn đó* vào ngày đó. Có thể bỏ trống phí, khi đó tỷ lệ `fees` của sàn trong
`[trading.venues.<id>]` sẽ tính giá. Một khoản phí bạn đã nêu thì không bao giờ bị thay.

**Khối lượng được lưu đúng như bạn gõ**, nên hãy nhập con số sàn đã ghi có, không phải con số bạn đã đặt.
Một sàn mang khóa giao dịch thì lấy dòng từ lệnh khớp duy nhất phù hợp. Lý do, và cách khớp lệnh đó, nằm
ở [Giao dịch](giao-dich.md).

**Các loại dòng khác.** Phát hành quyền mua không được môi giới theo mức phí chuẩn, nên nó luôn tự nêu
phí. `transfer` chuyển tiền giữa hai sàn của chính bạn mà không đụng tới tiền nạp ròng. Một lần chia tách
2:1 của mã nắm ở hai công ty môi giới là hai dòng, không phải một dòng áp theo tỷ lệ.

**`/record sync <sàn>`** ghi mọi lệnh khớp mà sàn báo còn sổ của bạn chưa có dòng, dùng khối lượng, giá và
phí của chính sàn.

- Binance liệt kê giao dịch theo từng coin, nên lần đồng bộ của nó đọc các coin có trong sổ cùng các coin
  bạn đang nắm, và nói rõ điều đó.
- Nó lùi tới dòng đầu tiên của sổ (bản chụp mở đầu đã tính phần trước nó) và lật trang sàn tới hết khoảng
  đó.
- Sàn chưa có khóa API thì câu trả lời nêu tên các biến còn thiếu. Sàn bạn tự đặt lệnh không gửi lệnh
  khớp về, nên câu trả lời nhắc bạn ghi tay bằng `/record buy` hoặc `/record sell`.
- Mỗi lệnh khớp được khóa theo mã lệnh của chính sàn, và một lệnh khớp có số liệu trùng với dòng bạn gõ
  tay thì được bỏ qua. Chạy hai lần thì lần hai không ghi gì, và câu trả lời cho biết đã nhận ra bao
  nhiêu.
- Một lệnh khớp trùng một dòng của bạn ở *mọi thứ trừ* ngày thì được báo chứ không ghi. Sửa ngày ở dòng
  đó rồi chạy lại.
- Nếu một lệnh khớp nào của một mã không ghi được thì không lệnh nào của mã đó được ghi. Lịch sử nửa chừng
  của một mã là một vị thế chưa từng tồn tại và một giá vốn không gì sau này sửa được, nên lần chạy báo
  tên mã và để sổ của bạn nguyên như cũ.

### Đề xuất

```text
/suggest <mã> [full|lean] [force]
/suggest stops [full|lean] [force]
```

Tùy chọn đứng theo thứ tự bất kỳ sau mã; dùng `thị-trường:mã` khi một tên trần mơ hồ. Lệnh này tiêu ngân
sách LLM, nên được dựng để khỏi tiêu hai lần.

Câu trả lời hôm nay được dùng lại miễn phí - ở thị trường chạy liên tục, là mọi câu trả lời trong 4 giờ
gần nhất. `force` chạy lại bất chấp cửa sổ đó và cả thời gian nghỉ, ở độ sâu đầy đủ trừ khi bạn gõ một
chế độ. Một mã mà sổ đang nắm ở đúng mức mục tiêu mặc định chạy `lean`, vì câu hỏi tốn kém ở đó đã có
lời đáp.

`/suggest stops` bao quát mọi vị thế đang nắm mà kế hoạch mới nhất thiếu mức dừng hoặc mục tiêu, cộng mọi
vị thế đã qua cửa sổ đo kết cục mà không nhúc nhích. Nó mặc định chạy `lean` và báo khi chẳng có gì cần
đọc lại.

### Đặt lệnh

```text
/trade
/trade spot <[sàn:]mã> buy|sell <số lượng> [limit <giá>] [tp <giá>] [sl <giá>]
/trade exit <[sàn:]mã> [qty <số lượng>] [tp <giá>] [sl <giá>]
/trade halt|resume
/trade confirm [token]
/trade cancel <[sàn:]mã>
/trade reconcile [token]
```

Mặc định lệnh mua phải có `sl`. Đặt `require_stop_loss = false` trong `[trading.orders]` nếu muốn mua không
kèm cắt lỗ.

`/trade` trần cho biết đang có gì chờ: các lệnh đã dàn kèm token, các lệnh thoát đang treo, các vị thế
không ai canh, và những gì sàn đã nhận mà sổ của bạn còn thiếu. Nó không với tới sàn nào.

- **`spot`** dàn lệnh và in một token xác nhận. Không gì đi ra cho tới khi bạn gõ `/trade confirm`.
- **`exit`** đặt hoặc dời chốt lời và cắt lỗ đang treo trên một vị thế mà sổ đã nắm, phủ toàn bộ trừ khi
  `qty` nêu ít hơn. Nó được đặt không cần token vì không bao giờ làm giảm mức bảo vệ. Binance không dời
  được một lệnh thoát đang treo, nên ở đó lần `/trade exit` thứ hai bị từ chối và nêu `/trade cancel`.
- **`halt`** tắt mọi lệnh mua mới cho tới khi bạn `resume`, và còn nguyên sau khi khởi động lại. Lệnh bán,
  thoát và hủy vẫn đi, và không lệnh thoát đang treo nào bị đụng tới.
- **`confirm`** đặt một lệnh đã dàn; để trần khi chỉ có đúng một lệnh đang chờ.
- **`cancel`** hủy một lệnh chốt lời hoặc cắt lỗ đang treo.
- **`reconcile`** liệt kê các lệnh sàn đã nhận mà sổ chưa có, và dọn những lệnh sổ đã lấy lại được.

Mã là riêng tài sản gốc và khối lượng luôn tính theo đơn vị gốc. `tp` và `sl` chỉ đi kèm lệnh mua - lệnh
bán đã chính là đường ra.

Tiền tố `sàn:` là tùy chọn và chỉ cần khi có nhiều hơn một sàn có thể khớp. Một lệnh mơ hồ bị từ chối kèm
các ứng viên được nêu tên, không bao giờ bị định tuyến theo cách đoán.

`/trade` chỉ đặt được lệnh khi một sàn đã đăng ký mang khóa giao dịch. Trước đó nó trả lời bằng tên các
biến mà từng sàn còn chờ và nhắc bạn ghi sổ bằng `/record`. Cách định tuyến, thiết lập và lần chạy đầu
nằm ở [Giao dịch](giao-dich.md).

## MCP

```text
openalpha mcp surface
openalpha mcp serve
openalpha mcp install
```

`surface` xem trước các công cụ được công bố. `serve` chạy một server MCP qua stdio. Server không phục vụ
prompt MCP nào: mô hình đã kết nối tự nạp một kỹ năng nghiên cứu bằng `skill_view` từ danh sách kỹ năng
nó được đưa. Công cụ MCP bên ngoài vẫn bị cổng phê duyệt chặn ở tầng gốc và không dùng được trong các
phiên chạy con được ủy quyền.

### Server công bố gì, giữ lại gì

Bề mặt được phục vụ có bộ hướng dẫn riêng - kỷ luật bằng chứng, chỉ gợi ý chứ không bao giờ đặt lệnh, và
nơi cảnh báo cùng bản tin thật sự được gửi tới - thay vì system prompt của agent chat, vốn nhắc tới những
công cụ bề mặt này giữ lại và những quy tắc chỉ áp dụng cho phiên chat tương tác.

Các công cụ sau bị giữ lại, kèm lý do:

| Công cụ | Vì sao |
|---|---|
| `shell_exec` | Chạy mã mà người gọi tự chạy được |
| `delegate`, `delegate_parallel`, `research` | Tiêu ngân sách mô hình của operator này để chạy một vòng lặp cho một host vốn đã có vòng lặp riêng |
| `schedule_add`, `schedule_list`, `schedule_remove` | Việc khi kích hoạt gửi tới kênh mặc định của operator, không phải người gọi |
| `ask_clarification`, `todo_write` | Cần vòng lặp chat tương tác |
| `file_read`, `file_list`, `file_search`, `file_write`, `file_edit` | Chỉ với tới thư mục nháp của agent, và phê duyệt sẽ đến từ một chương trình chứ không phải con người; host đã có công cụ tệp riêng |
| `memory_store`, `memory_remove` | Viết đè lên bộ nhớ bền vững của operator |
| `social_request`, `social_skill` | Sẽ lên tiếng như một agent của chính bạn trên mạng công khai; một chương trình client không bao giờ được làm thế |
| `order_place` | Không hoàn tác được ở một sàn thật; một chương trình trả lời ô phê duyệt không phải con người mà cái cổng đó tồn tại vì họ |
| `web_search`, `web_fetch` | Host tự mang bộ tìm kiếm; `mcp serve` không đọc cấu hình tìm kiếm nào |

Công cụ do plugin và MCP khác đóng góp cũng bị giữ lại: quảng bá lại chúng là đặt công cụ của một server
khác dưới cái tên của server này, trong khi host hoàn toàn kết nối thẳng tới server kia được. Các thao tác
ghi thuộc lĩnh vực giao dịch vẫn được công bố, vì chính server này kiểm tra chúng. Các lệnh gạch chéo như
`/refresh` và `/trade` không phải công cụ, nên không có bản MCP tương ứng.

Các công cụ được công bố:

| Nhóm | Công cụ |
|---|---|
| Dữ liệu thị trường | `market_price`, `market_bars`, `market_overview`, `market_screen`, `market_sector_strength`, `market_sentiment`, `market_funding`, `market_accounts`, `market_events`, `market_news`, `macro_risk`, `vn_foreign_flow`, `vn_futures_basis` |
| Đề xuất và chủ đề | `suggestion_run`, `suggestion_batch`, `suggestion_track_record`, `themes_view`, `order_exits` |
| Danh mục và sổ lệnh | `portfolio_view`, `portfolio_history`, `portfolio_review`, `portfolio_rebalance`, `portfolio_record`, `portfolio_update`, `portfolio_remove` |
| Hồ sơ và danh sách theo dõi | `profile_view`, `profile_update`, `profile_segment`, `watchlist_update` |
| Bản tin và cảnh báo | `brief_build`, `brief_manage`, `alert_manage` |
| Bộ nhớ và tiện ích | `memory_recall`, `memory_fts_recall`, `skill_view`, `calc`, `now` |
| Yêu cầu mô hình | `model_request_view`, `model_answer`, `model_resume` |

**Độ sâu và độ tươi.** `suggestion_run` và `brief_build` nhận `force: true` để chạy mới và thay thế đề xuất
hay bản tin của hôm nay, không cần phê duyệt (không có tiền nào chuyển đi, và phần lớn client không trả
lời được một lời nhắc phê duyệt). Mô hình truyền cờ này khi bạn yêu cầu chạy mới, và với `suggestion_run`
thì còn truyền khi bạn yêu cầu phân tích sâu, kỹ hay chi tiết, bằng bất kỳ ngôn ngữ nào bạn viết.
`suggestion_run` mặc định chạy cả cuộc tranh luận đầy đủ. Mô hình chỉ truyền `mode: "lean"` - một vai
phân tích cộng một lượt đối chiếu, chờ khoảng một nửa - khi bạn yêu cầu một phân tích nhanh hay ngắn.

**Mô hình của client được phép thấy gì.** Các công cụ được phục vụ trả về số liệu tương đối - tỷ trọng,
kết cục đề xuất, `sizePctNav` - cộng đúng **một** con số tuyệt đối: khối lượng lệnh (`units`) trên một đề
xuất và trên mỗi dòng `portfolio_rebalance`, thứ bạn cần để đặt lệnh. NAV, tiền mặt, chi phí, lãi lỗ và
số tiền giao dịch không bao giờ được phục vụ:

- cảnh báo bình quân giá xuống và cảnh báo vừa thoát của một đề xuất tới được mô hình mà không mang theo
  con số chi phí và lỗ;
- `portfolio_view` không mang lợi nhuận;
- phần lợi nhuận của các vị thế đang lỗ trong bản tin ở lại trên màn hình của bạn;
- một lần ghi sổ trả lời bằng định danh dòng cùng kết quả kiểm phí, không bao giờ trả về khối lượng, giá,
  phí hay số tiền.

Nên nhà cung cấp AI của client thấy nhiều nhất là những gì một khối lượng lệnh suy ra được.

Một kết luận "giữ nguyên" không đặt lệnh nào và mang theo `holdReasons` - các mã lý do bằng ngôn ngữ của
bạn - nên mô hình giải thích vì sao thay vì đọc các mức giá của một lần giữ nguyên như một lệnh.

**Thao tác ghi và phê duyệt.** Các nhánh ghi của `alert_manage` và `brief_manage` cần phê duyệt, nên một
client không hỗ trợ elicitation chỉ liệt kê và xem được.

**Yêu cầu mô hình.** Các công cụ này nằm **bên cạnh** bề mặt: mô hình của client đã kết nối trả lời mọi
lời gọi mô hình, mỗi lần một vòng tranh luận. `mcp install --host claude-code` còn ghi
`~/.claude/agents/openalpha-analyst.md`, một subagent chỉ có các công cụ yêu cầu và không có CLAUDE.md,
nên mỗi vai được trả lời trong một ngữ cảnh nhỏ của riêng nó và câu trả lời cuối của một vòng trao lại
vòng kế tiếp. Một host không có subagent - hoặc có mô hình từ chối gọi subagent, như gói miễn phí của
opencode - trả lời nội tuyến: một lời gọi `model_answer` mỗi vòng mang mọi câu trả lời và nhận về trọn
vòng kế tiếp.

Các câu trả lời được gửi theo lô, hoặc tất cả hoặc không gì cả. Khi vòng còn yêu cầu đang mở,
`model_answer` trả về `answered`. Lời gọi trả lời yêu cầu cuối cùng thì chờ bước kế tiếp và trả về nó:
vòng kế tiếp, `working` hay `finished`. Một subagent trao lại `finished` và kết quả khi đó chờ ở
`model_resume`; ở chế độ nội tuyến (`inline: true` trên mỗi lời gọi), câu trả lời đóng vòng trả về chính
kết quả.

Không lời gọi nào được phục vụ chờ quá 45 giây. Quá mức đó nó trả về `working` và client gọi
`model_resume` để chờ tiếp; một lời gọi đã trả về không bao giờ hủy công việc của nó. Một công việc hết
hạn khi một yêu cầu không được trả lời quá giới hạn đặt ở [`[loop]`](cau-hinh.md#loop). Một cuộc tranh
luận do client viết ghi mô hình của nó là `client:<mô hình>`, nên các lời gọi đó nằm riêng trong bảng
thành tích so với cùng mô hình ấy khi đi qua một nhà cung cấp đã cấu hình.

### Các câu trả lời được viết thế nào

Mọi câu trả lời của công cụ đọc y như cách CLI in ra. Tiền và giá đến bằng ngôn ngữ của bạn, một giá theo
bảng điện kèm thang bên cạnh (`43,00 (giá bảng điện, ×1.000 VND)`). Trường kết thúc bằng `Pct` là điểm
phần trăm; mọi tỷ phần, tỷ lệ, suất, lợi nhuận hay tỷ trọng khác đều là phân số của một. Điểm số đến dưới
dạng nhóm của nó, và các chữ số thập phân thừa được làm tròn đi. `market_bars` là chuỗi số duy nhất, tính
bằng đơn vị tiền tệ nguyên.

Một mức giá mà mô hình gõ **ngược lại** vào một công cụ - ngưỡng cảnh báo, giá ghi sổ, mức giá đặt lệnh -
cũng tính bằng đơn vị tiền tệ nguyên, và mỗi đầu vào đó đều nói rõ như vậy.

Với một mã đã nắm, `heldTakeProfit` cho biết phần tỷ lệ của vị thế cần bán ở mức chốt lời, làm tròn theo
lô chẵn đúng như `/suggest` làm tròn, không kèm số đơn vị.

`suggestion_run` và `suggestion_batch` còn trả về một `report`: chính đoạn văn bản gọn `/suggest` in ra,
dưới dạng tiêu đề và gạch đầu dòng markdown, không có phần chi tiết gập lại. Phần nắm giữ được viết theo
tỷ trọng - không có số đơn vị đang nắm, không có giá vốn, không có lợi nhuận trên vốn, và các mức thoát
được đo từ giá hôm nay thay vì từ giá vốn. Khối lượng lệnh chỉ xuất hiện ở nơi chính `units` được phục
vụ. Server yêu cầu host hiển thị report nguyên văn, và chào một công cụ tương ứng ở bất cứ chỗ nào nó nêu
tên một lệnh gạch chéo.

### Nối vào một ứng dụng trợ lý

```text
openalpha mcp install
```

Lệnh này in ra lệnh thêm server của chính ứng dụng đó (nếu ứng dụng có), cộng với mục server theo đúng
định dạng cấu hình của ứng dụng, trỏ đúng tới binary và tệp cấu hình mà server này thật sự chạy. Sau đó
nó ghi tệp kỹ năng để ứng dụng đọc.

`--host` chọn ứng dụng: `claude-code` (mặc định), `claude-desktop`, `codex`, `cursor`, `gemini`,
`kilo-code`, `opencode`, `vscode`, `windsurf`, `zed`, hoặc `agents` cho vị trí Agent Skills trung tính
(`~/.agents/skills`). Một thân kỹ năng phục vụ mọi ứng dụng. Claude Desktop, Windsurf và Zed không có thư
mục kỹ năng, nên không có gì được ghi cho chúng trừ khi bạn đưa `--skill-dir`; chúng đọc các quy tắc từ
server khi kết nối.

opencode và Kilo Code mặc định cắt một server cục bộ sau 5-10 giây, nên với chúng mục cấu hình còn đặt
`timeout` của server và `experimental.mcp_timeout` thành gấp đôi mức 45 giây mà một lời gọi được phục vụ
chờ trước khi trả lời `working`. `--skill-dir` đổi thư mục kỹ năng.
