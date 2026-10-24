# Bên trong

Dành cho lập trình viên sửa OpenAlpha: vì sao mã nguồn có hình dạng này, runtime gồm những gì, và mỗi bề
mặt phải làm gì khi trình bày một kết quả. Chỉ cần dùng? Bắt đầu từ [mục lục tài liệu](../README.md).

---

## Các quyết định kiến trúc

[AGENTS.md](../../AGENTS.md) là bộ quy tắc chuẩn, còn `scripts/check-dag.ts` là cổng kiểm tra ranh giới
module chạy được. Nếu hai bên mâu thuẫn, cổng kiểm tra thắng. Mọi quyết định dưới đây đang có hiệu lực.

### AD-1: Một DAG runtime không có chu trình

Mọi phụ thuộc đều trỏ về phía `core`. `app` là gốc composition duy nhất.

```text
core        -> không gì
i18n        -> không gì
ai          -> core
engine      -> core, ai
tools       -> core, engine
persistence -> core
memory      -> core
scheduler   -> core, engine
commands    -> core, engine, scheduler
plugins     -> core, engine
social      -> core, engine, i18n
trading     -> core, engine, persistence, i18n
channels    -> core, engine, commands, i18n
cli         -> mọi module runtime trừ app
app         -> mọi module runtime
```

API HTTP/WS nằm trong `app` ([src/app/server/](../../src/app/server/)): route, hợp đồng wire, mapper và
socket. Nó chỉ chạm tới trading qua trading host ([src/trading/wiring/host/](../../src/trading/wiring/host/)).

*Vì sao:* chu trình làm mờ việc ai sở hữu cái gì. Một DAG được kiểm tra thì các phụ thuộc review được, và
các module nghiệp vụ không bị buộc vào các bề mặt phân phối.

### AD-2: API công khai của module là tường minh

Import giữa các module dùng `@/<module>/api`. Có ba ngoại lệ:

- `core` không có barrel. Các tệp công khai của nó được liệt kê trong `CORE_PUBLIC` ở
  `scripts/check-dag.ts` và được import trực tiếp. Thêm một tệp vào đó là thao tác review được để mở rộng
  kernel.
- `i18n` là module lá chỉ có một đầu vào, `@/i18n`.
- Barrel SDK ở tầng gói là [src/index.ts](../../src/index.ts).

Không module nào dùng `export *`.

*Vì sao:* bề mặt có tên rõ ràng ngăn việc ghép nối vô tình và tránh nạp các phụ thuộc kernel không liên
quan.

### AD-3: Interface thuộc về bên tiêu thụ

Module nào cần một dịch vụ thay thế được thì sở hữu interface **nhỏ nhất** mà chính nó dùng. Provider
hiện thực interface đó; `app` bind phần hiện thực. Các module luôn có mặt cùng nhau thì được phụ thuộc
trực tiếp.

- `memory` dùng `FtsSearch` mà không phụ thuộc vào persistence.
- `channels` dùng `ChatBindingStore` mà không import persistence.
- Tools, scheduler, commands, plugins, social và channels phụ thuộc trực tiếp vào engine.

*Vì sao:* lớp do bên dùng sở hữu tách đúng các ranh giới độc lập **thật**, mà không tạo ra những lớp trừu
tượng đoán trước.

### AD-4: Trạng thái phiên chạy do chính phiên chạy sở hữu

Không có túi dịch vụ `RunContext`. Mỗi phiên chạy sở hữu trạng thái có thể sửa của nó và nhận các dịch vụ
một cách rõ ràng. Trạng thái của từng phiên chạy không bao giờ nằm ở phạm vi module. Vòng lặp bị giới hạn
theo số lượt, thời lượng, phát hiện lặp, ủy quyền, byte đầu ra và chi phí. Thứ gì có thể sống lâu hơn bên
gọi nó đều nhận và truyền tiếp một `AbortSignal`.

*Vì sao:* các phiên chạy song song không làm hỏng trạng thái dùng chung, và các đường dọn dẹp lộ rõ.

### AD-5: Phần giao dịch là một bounded context

`trading` sở hữu các thị trường, hợp đồng nguồn dữ liệu, giai đoạn, đề xuất, các phép gập danh mục, khóa
ngôn ngữ riêng và hợp đồng lưu trữ của nó. Không module nghiệp vụ nào import nó; chỉ `app`, `cli` và SDK
được dùng API công khai của nó.

Nó đăng ký ở bước provider số 9: sau `commands` (nó mở rộng sổ đăng ký của `commands`) và trước `plugins`
(vốn không bao giờ được thấy một sổ đăng ký còn sửa được). Nó không phải plugin. Khi đăng ký, nó dựng các
sổ đăng ký thị trường, nguồn, giai đoạn và sàn, đóng chúng lại, rồi chạy một phép kiểm tra nhất quán
trước lần ràng buộc đầu tiên.

Ba lỗi sau làm hỏng composition ngay tại đó, thay vì đợi đến lần dùng đầu tiên:

- một giá trị cấu hình nêu tên thị trường, khu vực hay sàn chưa đăng ký (kể cả sàn mặc định không giữ thị
  trường của nó);
- một sàn nhận một thị trường chưa ai dựng;
- một mã bị thiếu ở một trong hai danh mục ngôn ngữ.

SDK export **hợp đồng và kết quả** của phần giao dịch, không bao giờ export sổ đăng ký, kho, bộ nối, thị
trường, nguồn, giai đoạn hay hàm dựng tác vụ.

*Vì sao:* thuật ngữ thị trường và danh mục nằm ngoài kernel chung, và mọi quy tắc bất biến của phần giao
dịch có đúng một chủ sở hữu.

### AD-6: Sổ lệnh là sự thật của danh mục

Vị thế là các phép gập **thuần** trên các dòng sổ. Không có số dư được lưu hay ảnh chụp vị thế sửa được
nào được phép trở thành nguồn sự thật thứ hai. Các trường ngày là chuỗi ngày ISO; mã bút toán là UUIDv7
và cho thứ tự trong ngày. Mỗi lần ghi đều kiểm tra cả cuốn sổ **ở trạng thái nó sẽ có sau lần ghi đó**,
vì một lần sửa có thể làm một dòng mà nó chưa hề chạm tới trở nên không hợp lệ.

Các dòng sổ được sửa và xóa ngay tại chỗ, nên một giao dịch gõ sai ngày được sửa như mọi trường khác. Cái
giá được chấp nhận: cuốn sổ không có dấu vết kiểm toán, và vì các đề xuất cũ trích dẫn **cuốn sổ** chứ
không phải một ảnh chụp của nó, sửa một bút toán sẽ re-base chúng. `/reflect` báo một bảng thành tích mà
operator có thể thay đổi hồi tố.

*Vì sao:* chỉ có một đường suy ra duy nhất nên hạch toán tái lập được.

### AD-7: Sản phẩm gợi ý; chỉ có một đường đặt lệnh hẹp, có người duyệt

Công cụ giao dịch nghiên cứu, chấm điểm, định cỡ, tranh luận, lưu đề xuất và xem sổ của operator.
[src/trading/features/order/](../../src/trading/features/order/) giữ **một** đường đặt lệnh, nằm sau
`/trade` và `order_place`, làm việc với bất kỳ sàn nào đã đăng ký một `SpotAdapter` (OKX và Binance). Quy
tắc bất biến nêu tên **điểm nối**, không nêu tên sàn.

- Mỗi lệnh được định tuyến tới đúng một sàn và bị từ chối nếu có hơn một sàn có thể khớp, nên thêm một
  sàn khác là thêm một hiện thực, không phải thêm một nhánh.
- Các trần được kiểm tra trước khi hỏi người dùng. Công cụ từ chối phê duyệt đã ghi nhớ, để một quyết định
  không bao giờ phủ sang lần kế tiếp.
- Mọi lần khớp đều được ghi vào sổ qua đúng đường `portfolio.record` mà `/record` thủ công dùng.
- Một lệnh vào đã được duyệt có thể để lại lệnh chốt lời/cắt lỗ đang treo ở sàn, và lệnh này có thể khớp
  **sau khi** phiên chạy đã kết thúc. Không đoạn mã nào chọn mức giá hay thời điểm của nó, và một vòng lặp
  daemon có giới hạn sẽ đối chiếu lần khớp đó vào sổ.
- Khi chưa có khóa sàn, sàn vẫn được đăng ký như một nơi giữ tài sản mà operator ghi sổ vào, nhưng không
  có client. `order_place` không được đăng ký và `/trade` chỉ nêu tên các khóa cần đặt.
- Binance không dời được lệnh thoát đang treo. Nó khai `amend: false` chứ không mô phỏng việc dời bằng
  cách hủy rồi đặt lại, vì nếu lần đặt thứ hai hỏng thì vị thế không còn lớp bảo vệ nào. `/trade exit` trên
  sàn như vậy bị từ chối và nhắc tới `/trade cancel`, để việc gỡ lớp bảo vệ vẫn là một bước chủ động.

*Vì sao:* giữ con người trong vòng lặp là một ranh giới được dựng vào cấu trúc, không phải một quy ước
trong prompt.

### AD-8: Plugin là dữ liệu trước, và mức tin cậy mang tính cấu trúc

Việc khám phá và trộn plugin vẫn mang tính chung. Các thành phần có sẵn đáng tin được đóng góp công cụ và
hook thực thi được. Plugin không đáng tin trong hệ thống tệp chỉ được đóng góp nội dung khai báo đã qua
kiểm tra; loại thực thi được bị **cấm** hẳn, chứ không chỉ bị bỏ qua lúc chạy. Trùng ở sổ đăng ký thì đường
trộn chuẩn từ chối hoặc bỏ qua; plugin không lặng lẽ ghi đè lên thứ có sẵn. Xem
[Mở rộng](./mo-rong.md#plugin).

*Vì sao:* mã nhạy cảm về mức tin cậy phải **không thể** được đóng góp qua một dạng không đáng tin.

### AD-9: Bề mặt dựng hiển thị; lĩnh vực nghiệp vụ trả về kết quả có cấu trúc

CLI và kênh sở hữu việc bản địa hóa, định dạng, hành vi terminal và năng lực kênh truyền. Các module
nghiệp vụ trả về giá trị có cấu trúc và lỗi có kiểu. Các bề mặt không bao giờ import `app`. Engine phân
giải siêu dữ liệu hiển thị của công cụ đúng một lần thành các sự kiện luồng, và các bề mặt dùng sự kiện đó
thay vì tự đọc tham số thô của công cụ.

*Vì sao:* chính sách được định ra một lần và dùng chung, trong khi mỗi bề mặt vẫn tự quyết phần trình bày.

### AD-10: Cấu hình được phân giải một lần lúc khởi động

Các tầng cấu hình được phân tích, kiểm tra, trộn và đóng băng **trước** khi các provider khởi động. Module
runtime dùng `ResolvedConfig`; chúng không đọc biến môi trường và không áp lại giá trị mặc định. Thứ tự
provider trong [src/app/providers.ts](../../src/app/providers.ts) là cố định; đừng đổi nó khi chưa kiểm
lại các ràng buộc đã ghi.

Tìm kiếm web là tùy chọn, nên biến khóa của `[web_search]` được nêu tên mà rỗng thì không làm hỏng cấu
hình. `ResolvedWebSearch` mang nó dưới dạng `missingEnv` (bên chính) hoặc `fallbackMissingEnv`
(bên dự phòng, bị bỏ). `defaultSearchProvider` trong `src/tools/web/retrieval-request.ts` là nơi từ chối
duy nhất: mọi lời gọi tìm kiếm và lấy nội dung đều lấy bên chính qua nó, nên không lời gọi nào rơi về một
nhà cung cấp không khóa. `doctor`, `config validate` và phần tóm tắt của `start` đọc cùng trường đó qua
`toMissingSearchKeyError`; lúc khởi động hệ thống ghi `web_search.key_missing` và
`web_search.fallback_key_missing`.

*Vì sao:* chỉ một bên sở hữu cấu hình lúc khởi động, nên cấu hình không bị lệch và hành vi runtime không
phụ thuộc thứ tự.

### Kiểm chứng

```bash
bun scripts/check-dag.ts
```

Cổng này kiểm tra các cạnh module được phép, các import API công khai, bề mặt core đã liệt kê, và các
điểm vào của bối cảnh giới hạn `engine/research`.

---

## Runtime gồm những gì

Chỉ gồm hành vi **đã làm xong và dùng được**; mục tiêu thiết kế không được tính là tính năng. Nơi nào trang
khác sở hữu chi tiết, mục này dẫn sang đó.

**Chat và phiên chat.** `chat` chạy một tin nhắn truyền luồng hoặc một REPL tương tác. Phiên chat được lưu,
xử lý tuần tự từng việc, giữ ngữ cảnh có giới hạn và được nén, và các tin nhắn công cụ cũ được sửa trước
lần gọi mô hình kế tiếp. Engine kiểm tra trích nguồn, rút ra các sở thích lâu dài mà người dùng nói rõ,
truyền tín hiệu hủy, và báo lý do kết thúc có kiểu. Cấu hình và các sổ đăng ký đóng băng lúc khởi động.

**Luồng trực tiếp và làn câu lệnh.** Engine và bộ điều phối câu lệnh đưa vòng đời của phiên chạy lên bus
(`run_started`, `run_progress`, `run_thinking`, `run_finished`, và `command_started`, `command_progress`,
`command_finished` cho câu lệnh gạch chéo chạy lâu); app thêm `order_filled` và `alerts_checked`, engine thêm
`budget_exhausted`. [app/server/feed/](../../src/app/server/feed/) gộp chúng thành sổ các phiên chạy phía sau
`GET /v1/live` và phát từng sự kiện tới các socket đang mở; `approval_requested` và `clarification_requested`
mang id và `askedAt` để danh sách đang chờ giữ được chúng. Hình dạng trên dây:
[CONTRACT.md](../../src/app/server/CONTRACT.md). Các câu lệnh tự chạy được đi qua một làn riêng cho từng cuộc chat
([core/command-lane.ts](../../src/core/command-lane.ts)), ba câu chạy và mười câu chờ mỗi cuộc chat, dùng chung cho
mọi bề mặt tới được cuộc chat đó; `/new`, `/stop` và khung `cancel` của socket bỏ những câu đang chờ và dừng những câu đang chạy, còn `drop`
bỏ đúng một câu đang chờ. Mỗi định danh và độ sâu chỉ chạy một `/suggest`: lượt thứ hai tìm lượt đang chạy trong bảng các
lượt của dịch vụ đề xuất rồi chờ nó, và chỉ lượt khởi đầu bị tính phí.

**Agent và đội.** Các agent có sẵn: `chat`, `deep-researcher` cùng các worker nội bộ của nó
(`research-crawler`, `research-planner`, `research-reviewer`, `research-synthesizer`), và `reviewer`. Phần
giao dịch thêm các vai tranh luận (`bull-researcher`, `bear-researcher`, `portfolio-manager`, `trader`,
`risk-analyst`, `claim-verifier`, `market-analyst`), do quy trình đề xuất lập lịch chứ không do người dùng
chọn, cùng `theme-analyst` do `/themes` chạy. Agent của người dùng và của plugin không thay được các mã
được bảo vệ.

Một [đội](../tro-ly.md#đội-và-ủy-quyền) được suy ra từ cấu hình: một agent điều phối có danh sách
`delegates` và dùng `delegate` hoặc `delegate_parallel`. Không có thực thể Đội nào được lưu. Phiên chạy
con thừa hưởng tín hiệu hủy và ngân sách của phiên chạy cha, có một phiên chat tạm thời riêng, và ghi các
lần gọi tính tiền kèm `parentRunId`. Phiên chạy con có tuyến có thể xin đúng một lần phê duyệt công cụ nguy
hiểm qua chat của phiên chạy cha; phiên chạy con không có tuyến vẫn không thể phê duyệt. Phiên chạy con
không bao giờ thừa hưởng bypass hay phê duyệt đã ghi nhớ của phiên chạy cha. Danh sách của phiên chạy cha
cho phép **chọn** phiên chạy con, còn danh sách công cụ của chính phiên chạy con mới cho phép **các lời gọi
của nó**; danh sách công cụ cha dùng trực tiếp không phải trần cho việc ủy quyền. Các giới hạn: danh sách
cho phép, độ sâu, tổng số nhánh, số nhánh song song, tự ủy quyền, vòng lặp tổ tiên.

**Nghiên cứu.** Chỉ chạy ở tiền cảnh và gắn với phiên chạy: không có tác vụ nền, mã nghiên cứu, lệnh điều
khiển bất đồng bộ hay khả năng khôi phục lâu dài. Nó dùng chung tín hiệu hủy và ngân sách của phiên chạy và
kết thúc cùng nó; Ctrl+C, `/stop` hoặc lệnh hủy từ kênh sẽ dừng lần lượt, theo thứ tự. Agent `chat` gốc
chọn năng lực nhỏ nhất đủ dùng ngay trong vòng lặp dùng công cụ bình thường (trả lời thẳng, hỏi lại một
câu, `research`, `delegate`, hoặc một lần `delegate_parallel`); `/research` khởi động đúng đường đó qua
agent cửa vào nghiên cứu sâu mà không đổi agent đang được gắn. Quy trình, các độ sâu, việc nhận bằng chứng,
kết cục, mã lỗi và giới hạn: [Nghiên cứu](../nghien-cuu.md).

Truy hồi ưu tiên nhà cung cấp mặc định đã cấu hình: nhà cung cấp mặc định **luôn** chạy trước mọi bên dự
phòng, và Exa chỉ chạy khi được cấu hình làm nhà cung cấp mặc định hoặc dự phòng (chỉ có thông tin đăng
nhập thì không bao giờ chọn nó). Mỗi lần truy hồi là một bản ghi có kiểu. Siêu dữ liệu Exa Search (mã yêu
cầu, loại tìm kiếm được yêu cầu và được phân giải, các engine) được giữ; các mục Contents và lỗi có kiểu
(`errorTag`, `httpStatus`) được giữ theo từng URL; một lần gọi Contents hỏng một phần được đánh dấu
`partial`. Một phản hồi nhà cung cấp có tính tiền được ghi vào chi phí và sổ ngân sách **đúng một lần**;
lần trúng cache có chi phí 0.

**Trình bày kết quả nghiên cứu.** CLI và REPL dựng báo cáo đặt kết luận lên đầu (kết cục, mức bằng chứng,
số khoảng trống và số nguồn, các mục luận điểm, phần suy luận có gắn nhãn, các xung đột, ghi chú về độ mới,
các lần truy hồi, các hành động kế tiếp), kèm màu, siêu liên kết và phân trang trên TTY. Telegram dựng
MarkdownV2 và sửa tin tiến độ ngay tại chỗ; Zalo (văn bản thuần, không sửa được) gửi từng khúc.

**Các công cụ có sẵn.** Khai báo trong `BUILT_IN_TOOLS` tại
[src/tools/registry.ts](../../src/tools/registry.ts).

| Nhóm | Công cụ |
|---|---|
| Hệ thống | `ask_clarification`, `now`, `todo_write` |
| Tính toán | `calc` |
| Tệp | `file_read`, `file_write`, `file_edit`, `file_list`, `file_search` |
| Bộ nhớ | `memory_store`, `memory_recall`, `memory_remove`, `memory_fts_recall` |
| Shell | `shell_exec` |
| Web | `web_fetch`, `web_search` |
| Lập lịch | `schedule_add`, `schedule_list`, `schedule_remove` |
| Kỹ năng | `skill_view` |
| Ủy quyền | `delegate`, `delegate_parallel` |
| Nghiên cứu | `research` |

Phần giao dịch đăng ký công cụ riêng của nó qua đúng sổ đăng ký đó, cộng `order_place` và `order_exits` khi
một sàn có khóa giao dịch; phần mạng xã hội thêm `social_request` và `social_skill`. Công cụ còn có thể
khai báo `inputExamples`: các đầu vào mẫu viết sẵn, được kiểm tra lúc khởi động, gửi nguyên dạng tới
Anthropic và nối vào phần mô tả trên mọi giao thức khác. Chỉ dùng khi thiếu nó thì mô hình hay gõ sai dạng
đầu vào (một nhánh union, một chuỗi giờ theo đồng hồ, một đối tượng lồng nhau).

Mỗi công cụ kiểm tra schema của mình, đi qua các cổng năng lực và phê duyệt, rồi đưa kết quả qua đường ống
chung: lọc thông tin đăng nhập, quét đầu ra không đáng tin, và giới hạn độ dài đầu ra. `todo_write` giữ
một danh sách việc có giới hạn chỉ của phiên chạy hiện tại; phiên chạy giữ bản sao riêng của nó để
[khâu nén](../luu-tru.md#giới-hạn-ngữ-cảnh-và-khâu-nén) không tóm tắt mất nó. Các công cụ tệp làm việc
trong thư mục làm việc của agent. Shell phải qua chính sách và phê duyệt, đầu ra có giới hạn, và bị dừng
khi hết giờ hoặc bị hủy. Tải web có biện pháp chống SSRF.

**Bộ nhớ.** Dữ liệu khóa-giá trị theo phạm vi agent và người dùng, hỗ trợ gọi lại chính xác, liệt kê theo
tiền tố, tìm toàn văn, xóa mềm và TTL. Giá trị trông như bí mật hoặc như prompt injection bị từ chối trước
khi lưu. Các phiên chạy con tách khóa riêng qua vùng tên của phiên chat tạm thời. Engine còn rút ra các
sở thích mà người dùng nói rõ từ những cuộc hội thoại đã xong, và lưu chúng qua đúng đường có kiểm soát đó.
Một sở thích đã lưu không bao giờ bị ghi đè khi trích xuất: thay đổi được hỏi lại người dùng một lần, ở đầu
câu trả lời kế tiếp, và chỉ được lưu khi tin nhắn sau đó của họ đồng ý. Lượt chạy theo lịch hoặc chạy qua
pipe không có ai để hỏi, nên không bao giờ đề xuất thay đổi.

**Kỹ năng.** Các thư mục chứa `SKILL.md`, cộng với các kỹ năng giao dịch được nhúng vào binary. Mô hình nhận
một mục lục gọn và chỉ nạp phần thân qua `skill_view`. Tên các kỹ năng nhúng là tên dành riêng: một kỹ
năng thư mục dùng lại một trong số đó sẽ làm composition thất bại chứ không che mất nó. Kỹ năng là kiến
thức, không phải mã: chúng không thêm gì thực thi được và không lách chính sách công cụ. Xem
[Agent](../tro-ly.md#kỹ-năng).

**Plugin và workflow.** Plugin đóng góp được agent, kỹ năng, workflow, lệnh gạch chéo khai báo, các ghi đè
cấu hình kênh an toàn, và mô tả công cụ MCP bên ngoài. Các phần đóng góp được trộn qua các sổ đăng ký có
thứ tự; trùng thì bị từ chối hoặc bỏ qua. Workflow là các phiên chạy tuần tự, có thể kèm lịch, số bước và
số lần thử lại có giới hạn, gom chi phí, cô lập các định nghĩa không hợp lệ và truyền tín hiệu hủy. Một
bước không được thử lại nếu nó kết thúc vì hết ngân sách, hoặc bị dừng bởi `length_limit`, `hook_failed`,
`content_filter`, `rate` hay `agent_paused`: cùng một yêu cầu sẽ kết thúc y như cũ.

**Lập lịch.** Việc theo chu kỳ và theo cron, lưu múi giờ, lịch sử chạy, thử lại với khoảng chờ tăng dần, và
tự tắt các việc hỏng liên tiếp. `--agent` mặc định là `chat`; `--allow-tools` giới hạn một việc trong một
tập con các công cụ của agent. Thông báo lỗi gửi được qua một đường riêng. Heartbeat là việc theo lịch lặp
lại. Các phiên chạy của bộ lập lịch không chồng nhau, dùng chế độ phê duyệt đã cấu hình, và giữ đúng các
ranh giới về phiên chạy, ngân sách và tín hiệu hủy như mọi phiên chạy khác.

**Kênh.** Telegram, Zalo và Zalo Personal; adapter chỉ dùng được khi đã có cấu hình và thông tin đăng nhập
của nó. Chỉ nhận theo danh sách cho phép hoặc theo ghép nối, không bao giờ mở tự do, và áp **trước** khi
một phiên chạy bắt đầu. Hộp thư đến và offset polling được lưu lâu dài, và mọi adapter dùng chung một đường
ống gửi tin. Xem [Kênh](./kenh.md).

**Lệnh gạch chéo.** Kênh và REPL cung cấp một danh mục lọc theo bề mặt và có giới hạn tần suất.

| Nhóm | Lệnh |
|---|---|
| Định tuyến agent | `/agent [id\|default]` |
| Chọn mô hình | `/model [selector]` |
| Nghiên cứu | `/research [quick\|standard\|thorough] <câu hỏi>` |
| Trạng thái và chi phí | `/health`, `/cost`, `/config` |
| Bộ nhớ | `/memory` |
| Lập lịch | `/schedule [show\|pause\|resume\|run\|remove] <id>` |
| Phiên chat | `/new`, `/continue` |

Phần giao dịch thêm các lệnh riêng, cộng `/trade` khi một sàn có khóa giao dịch (chính khóa đó cũng mở
nhánh `sync <venue>` của `/record`). Phần mạng xã hội thêm `/social`. `/stop` cùng các lệnh ghép nối thuộc
về kênh. Vai trò của kênh và giới hạn theo bề mặt quyết định lệnh nào được hiện và hành động nào cần phê
duyệt. Xem [Lệnh](../lenh.md#chat-giao-dịch) và [Giao dịch](../giao-dich.md#chủ-đề).

**Mô hình, lượng dùng và chi phí.** Chuỗi `[[models]]` chọn một mô hình chính và các mô hình dự phòng tùy
chọn. Các kênh truyền: chat tương thích OpenAI, OpenAI Responses, Anthropic Messages, Gemini Generate. Mỗi
lần gọi truyền luồng an toàn, thử lại và chuyển sang dự phòng trong các giới hạn, và chuẩn hóa dữ liệu suy
luận cùng lượng dùng. Mỗi lần gọi được quyết toán đúng một lần; bản ghi lưu lâu dài gồm nhà cung cấp và mô
hình, token đầu vào, đầu ra, cache và suy luận, độ trễ, nguồn giá, chi phí, và phiên chạy cha. Ngân sách áp
các trần theo ngày, theo tháng và theo phiên chạy, phát cảnh báo mềm, và chia phần ngân sách còn lại cho
các phiên chạy con song song. `cost` báo chi tiêu so với các trần; `provider` hiện thông tin giá đã cấu
hình.

**Lưu trữ.** SQLite là mặc định; PostgreSQL cũng được hỗ trợ. Ranh giới là `Storage` và `Dialect`, với
migration được sinh tự động, truy vấn do kho sở hữu, và tìm toàn văn theo từng dialect. `db` báo trạng thái
migration, tính toàn vẹn và thống kê, áp migration, dọn theo chính sách lưu giữ và reset dữ liệu. SQLite
còn có sao lưu và khôi phục có kiểm chứng; PostgreSQL không có sao lưu, khôi phục hay kiểm tra toàn vẹn
sâu dành riêng cho SQLite. Chính sách lưu giữ phủ các phiên chat cũ, các tuyến, bộ nhớ, các phiên chạy của
bộ lập lịch, các mục trong hộp thư đến của kênh và các ghép nối. `workspace cleanup` thu hồi dữ liệu trong
thư mục làm việc của agent và đòi xác nhận rõ ràng.

**An toàn và phê duyệt.** Công cụ nguy hiểm dùng duyệt thủ công, bypass chọn rõ ràng, hoặc không khả dụng.
Quyết định đã ghi nhớ chỉ áp dụng trong phiên chat. Một phiên chạy con có tuyến (REPL tương tác,
`chat --message` tương tác, phiên chạy từ kênh, việc theo lịch có đích, workflow được gọi từ kênh) có thể
xin đúng một lần phê duyệt công cụ nguy hiểm qua chat của phiên chạy cha. Phiên chạy con không có tuyến
(CLI một phát không tương tác, bộ lập lịch không có đích, heartbeat, workflow chạy theo lịch hay từ CLI,
lời gọi MCP trực tiếp) vẫn không thể phê duyệt. Runtime còn giữ mọi thao tác trong thư mục làm việc và từ
chối các tệp riêng tư, kiểm tra SSRF và tải có ghim địa chỉ, lọc thông tin đăng nhập, quét đầu ra không
đáng tin, áp chính sách shell, giới hạn kết quả, và dọn dẹp khi có tín hiệu hủy. Agent gọi công cụ; công
cụ sở hữu việc truy cập cơ sở dữ liệu.

**Log.** Log chính và log agent đều có cấu trúc và lọc dữ liệu nhạy cảm, có xoay vòng và lưu giữ, qua một
hàng đợi bất đồng bộ có giới hạn. `logs` lọc, theo dõi hoặc dọn log của từng agent. Log phiên chạy theo
từng agent nằm riêng khỏi dữ liệu nháp trong thư mục làm việc, nên `workspace cleanup` không xóa chúng;
`logs clear` xóa chúng theo tuổi hoặc theo phạm vi.

**Chẩn đoán và vòng đời.** `doctor` kiểm tra cấu hình, mô hình, thư mục dữ liệu, log, cơ sở dữ liệu,
daemon, kênh, khâu gửi tin, nguồn dữ liệu, sàn, tìm kiếm web và các nhà cung cấp; các bước kiểm tra online
tùy chọn của nó thăm dò các tích hợp từ xa mà không đổi trạng thái cục bộ. `status` tóm tắt daemon, kênh,
phiên chat và chi tiêu. Daemon giữ một tệp PID, phục hồi các phiên chạy dở dang lúc khởi động, và tắt theo
thứ tự: ngừng nhận việc mới, chờ việc đang chạy xong, rồi đóng các dịch vụ. Lệnh hủy từ CLI lan vào các
phiên chạy đang hoạt động và thoát sạch. Các lệnh CLI tầng cao là `BUILT_IN_COMMANDS` trong
[src/cli/registry.ts](../../src/cli/registry.ts); phần giao dịch không đóng góp lệnh CLI nào. Về bề mặt lập
trình, xem [Mở rộng](./mo-rong.md#bề-mặt-sdk).

**Tệp khóa được nạp trước.** `main()` đọc `<thư mục dữ liệu>/env` (`src/cli/env-file.ts`) ngay sau các cờ
toàn cục và trước bước thăm dò cấu hình, vì cấu hình đọc khóa từ `process.env`. Đây là lần ghi duy nhất vào
`process.env` lúc khởi động: nó chỉ đặt tên mà môi trường để trống, bỏ qua các tên điều khiển chính
chương trình (`BRAND.controlEnv`: thư mục dữ liệu, dấu chạy nền, mức log, tệp của trình sửa) và các tên điều khiển cách chương trình khởi động (`PATH`, `HOME`, `SHELL`, `TMPDIR`, `TZ`, `LD_*`,
`DYLD_*`, `NODE_*`, `BUN_*`), và để nguyên tệp mà người khác đọc được hoặc người dùng này không mở được (`CliApp.keyFile` cho biết những tên nó đã đặt). Thư mục dữ liệu là
bản bootstrap (`--data-dir`, biến thư mục dữ liệu, mặc định) nên `[paths] data_dir` không dời được nó.

**Khóa không bao giờ chặn lúc khởi động.** Boot resolve với `deferMissingKeys`: một mô hình có biến khóa
chưa đặt giữ `missingEnv` (chuỗi bỏ qua nó, và khi không còn mô hình nào thì mọi lời gọi bị từ chối
bằng `MissingEnvError` đã bản địa hóa), còn máy chủ MCP nêu `${VAR}` chưa đặt thì vào `ResolvedMcp.unset`
thay vì làm hỏng bước resolve. `doctor` và `probeConfig` resolve chặt nên vẫn báo lỗi. Mỗi bộ phát hiện ghi
log một lần ở nơi nó thấy chỗ thiếu (`llm.key_missing` lúc dựng registry chuỗi, `web_search.key_missing`,
`mcp.env_missing`), và `toMissingKeyErrors` trong `src/cli/missing-keys.ts` là danh sách duy nhất mà
terminal in ra và `config validate` báo. Kênh có `start()` ném `OperatorConfigError` (token thiếu hoặc bị
từ chối) thì được đóng và ghi `channel.start_skipped`; `startChannels` trả nó trong `skipped`, nên kênh chưa
từng lắng nghe thì không cho ai vào. `ApiTokenError` từ bộ khởi động API được xử lý giống vậy
(`api.token_unusable`). Tác vụ daemon đưa cả hai danh sách cho `onReady` (`DaemonStartOptions.onReady`); `start`
tiền cảnh in chúng ra stderr, còn log stderr của tiến trình nền được chuyển tiếp dưới dòng thành công của
tiến trình cha. Sau đó handler ghi tệp sẵn sàng (`BRAND.readyFile`, ghi nguyên khối, `{ pid, degraded }`) mà
lần khởi động nền chờ, còn `status` và `/v1/state` đọc lại; mỗi lần khởi động xóa tệp này ngay khi giữ được
tệp pid, nên tệp do một daemon chết đột ngột để lại không bao giờ bị coi là sẵn sàng khi pid được dùng lại. Tệp pid còn ghi `startedAt`. Lần khởi động giành lại một tệp pid cũ (`PidFileClaim` `reclaimed`) truyền
`DaemonStartOptions.previousRun`, nên daemon nhắn chat mặc định một lần (`cli.daemonStoppedUnexpectedly`), và
`status` đọc cùng tệp qua `readStalePid`. Một nhịp vòng lặp lỗi với `MissingEnvError` là lỗi biên (`trading.tick_key_missing` một lần
mỗi vòng cho tới khi có lỗi khác được ghi, thử lại ở khoảng sau), không bao giờ vào cách ly.

**Khởi động lại từ API.** `POST /v1/restart` gọi `SelfUpgrade.restart` ([app/update/install.ts](../../src/app/update/install.ts)), từ chối daemon không chạy bằng `--background`, daemon đang dừng, và daemon đang có một lần cập nhật hoặc khởi động lại chưa xong; nhận thì trả 202. `when: 'idle'` sau đó kiểm tra `isWorking` (lượt chạy, câu lệnh chạy lâu, tin đang gửi, tác vụ giao dịch) đến khi không còn gì chạy hoặc hết `RESTART_IDLE_WAIT_MS`, bằng một `sleep` hủy được mà lúc dừng sẽ hủy; `now` bỏ qua phần chờ. [app/update/restart.ts](../../src/app/update/restart.ts) ghi `<data_dir>/restart.json` (`{ requestedAt }`) rồi chạy `restart --background` như một tiến trình phụ tách rời (`spawnRestartProcess`, log `restart.stdout.log` / `restart.stderr.log`). Tiến trình phụ dừng daemon này theo đúng thứ tự dừng thường (`SHUTDOWN_DRAIN_MS` là khoảng chờ các lượt chạy được hoàn tất trước khi bị ngắt, hiện là `restartDrainMs` trên `/v1/state`; đó không phải thời gian ngừng, nên trang nhận ra khởi động lại khi health xuống rồi lên lại với pid mới), nên các yêu cầu phê duyệt còn chờ bị từ chối. Daemon mới lấy marker khi đã sẵn sàng (`takeRestartMarker` trong `markReady`, không bao giờ trong `boot`, vì tiến trình phụ và tiến trình cha `--background` cũng chạy `boot`) và, khi marker còn trẻ hơn `RESTART_MARKER_MAX_AGE_MS`, ghi `ui.restartDone` vào chuông như một `daemon_notice`. Marker không đi qua thông báo cập nhật, nên một lần khởi động lại không bao giờ đọc thành cập nhật thất bại. Tiến trình phụ thoát trong khi daemon này vẫn chạy thì marker bị xóa và cho phép khởi động lại lần nữa.

**Giới hạn của việc thực thi lệnh.** `/trade` và `order_place` đặt lệnh spot trên một sàn đã đăng ký, và
không có gì khác trong mã nguồn gửi được lệnh: một sàn mới chỉ là thêm một `SpotAdapter` phía sau cùng tính
năng đó. Cho tới khi có một sàn có khóa giao dịch, `order_place` không được đăng ký. `/trade halt` tắt mọi
lệnh mua mới cho tới khi `/trade resume`, lưu lâu dài và không đụng tới lệnh thoát đang treo. Không có gì
bịa ra một lần khớp: `[trading.venues.<id>] simulated` vẫn ký, vẫn gửi và vẫn hỏi một API thật, trên sổ
demo của sàn. Tài sản không chuyển được giữa các sàn.

### MCP

`mcp serve` mở các công cụ runtime được phép qua MCP, kèm lời dặn của máy chủ chỉ cho model của host cách
dùng chúng. Khi client hỗ trợ elicitation, việc phê duyệt công cụ được xin ngay trong tương tác đó. Danh
sách các công cụ được mở và bị giữ lại nằm ở [Lệnh](../lenh.md#mcp).

Dưới `mcp serve`, mô hình của client đã kết nối đứng thay chuỗi nhà cung cấp:

- Lệnh khai báo `Needs.modelSource: 'client'`. Khi khởi động, hệ thống dựng một mô hình `client` thay thế
  làm chuỗi chính, không đọc `[[models]]` hay `[web_search]`, và chạy mọi agent trên nó.
- `[model_tiers]` vẫn được đọc cho một lần tra cứu nêu tên một tầng, không có phương án lùi về chuỗi chính
  và không cần khóa lúc khởi động. Một tầng được dựng ở lần tra cứu đầu tiên và bị bỏ qua
  (`llm.tier_skipped`) nếu không dựng được.
- [src/ai/client-model/](../../src/ai/client-model/) đăng mỗi yêu cầu lên broker
  ([src/engine/mcp/jobs/broker.ts](../../src/engine/mcp/jobs/broker.ts)) dưới mã công việc mà
  `AsyncLocalStorage` mang theo. Mỗi lời gọi được phục vụ là một công việc trên phiên riêng của nó
  ([src/engine/mcp/jobs/jobs.ts](../../src/engine/mcp/jobs/jobs.ts)); các yêu cầu đang chờ của một vòng
  được liệt kê thành `model_requests`.
- Cả hai nửa của thời gian chờ một yêu cầu đều được ghi log (`mcp.request_viewed`,
  `mcp.request_answered`). `serveMcp` xả hết các công việc trước khi kho lưu trữ đóng.

Mọi lượt chạy MCP mang `audience: 'operator'` (`RunOptions` sang `ToolInvocationContext`); các lượt chạy
khác là `agent`. Dưới `operator`, các công cụ đề xuất giữ `units` và `portfolio_rebalance` đọc
`rebalanceWithUnits`, còn `held`, `policyUnits`, tiền mặt, chi phí và NAV vẫn bị giữ lại.
`check-feature-isolation` làm hỏng mọi công cụ nêu một lần đọc tuyệt đối. `report` mà các công cụ đề xuất
trả về được dựng với `operatorFigures: 'withheld'`: một dòng dựng nêu cỡ hay chi phí của một vị thế có một
bản song sinh `Withheld` trong catalog do `withheldSuffix` chọn, một cảnh báo mang tiền của chính bạn
đọc từ câu `<code>Withheld` của nó (hoặc bị bỏ), và `scripts/check-report-figures.ts` làm
hỏng một báo cáo in chi phí hay cỡ chính sách, hoặc đổi khi chỉ chúng đổi.

Runtime cũng kết nối tới các server MCP bên ngoài qua stdio hoặc Streamable HTTP. Việc khám phá và các lời
gọi đều có giới hạn. Công cụ bên ngoài nằm trong vùng tên riêng, được coi là bên ngoài và phải qua cổng
phê duyệt; agent con không gọi được chúng. Lệnh stdio và endpoint HTTP lấy từ cấu hình đều qua các bước
kiểm tra an toàn riêng.

### Các giới hạn trong một bảng

Các giá trị mặc định sau khi phân giải cấu hình. Dòng nào có khóa cấu hình thì đổi được trong
`config.toml`; `Cố định` thì không có khóa.

| Giới hạn | Mặc định | Khóa cấu hình |
|---|---|---|
| Trần chi tiêu ngày | Tắt | `[budget] max_daily_usd` (`0` là tắt) |
| Trần chi tiêu tháng | Tắt | `[budget] max_monthly_usd` (`0` là tắt) |
| Trần chi tiêu mỗi phiên chạy | Tắt | `[budget] max_per_run_usd` (`0` là tắt) |
| Cảnh báo ngân sách mềm | 80% của một trần đang bật | `[budget] soft_warn_ratio` |
| Số lượt mỗi phiên chạy | 40 | `[loop] max_turns` |
| Số lời gọi công cụ mỗi phiên chạy | 120 | `[loop] max_tool_calls` |
| Thời lượng phiên chạy | 15 phút | `[loop] max_duration_ms` |
| Thời gian chờ phê duyệt | 2 phút | `[loop] approval_timeout_ms` |
| Số tin nhắn mỗi phiên chat | 500 | Cố định |
| Độ sâu ủy quyền | 3 | `[loop] delegation_depth` |
| Tổng số lần ủy quyền | 32 | `[loop] max_delegations` |
| Số ủy quyền song song | 5 | `[loop] max_parallel_delegations` |
| Số câu hỏi nghiên cứu | 7 | Cố định |
| Số vòng rà soát nghiên cứu | 2 | Cố định |
| Số ký tự mỗi đoạn trích nghiên cứu | 4000 | Cố định |
| Số đoạn trích mỗi nguồn | 8 | Cố định |
| Dung lượng tệp trung gian của nghiên cứu | 128 KiB | Cố định |
| Toàn văn tối đa mỗi nguồn | 64 KiB | Cố định |
| Nhịp bộ lập lịch | 30 giây | Cố định |
| Số việc bắt đầu mỗi nhịp | 5 | Cố định |
| Số việc theo lịch chạy cùng lúc | 50 | Cố định |
| Số lời gọi LLM mỗi phút | 60 | `[llm] max_calls_per_minute` |
| Số lần thử lại LLM | 2 | Cố định |
| Xoay vòng log | 50 MB, 7 tệp | `[log] max_file_mb`, `[log] max_files` |

---

## Hợp đồng trải nghiệm của bề mặt

CLI và kênh dùng chung chính sách thực thi và sở hữu riêng phần trình bày. Engine phát ra các sự kiện có
cấu trúc và các kết quả có kiểu; mỗi bề mặt dựng chúng theo ngôn ngữ đang chọn và theo năng lực của kênh
truyền.

### Các chế độ đầu ra của CLI

Hai cờ chung `--quiet` và `--verbose` loại trừ nhau, và trạng thái của chúng chỉ nằm trong tiến trình CLI
(không được ghi ra biến môi trường). Màu tôn trọng khả năng của TTY, `NO_COLOR` và `FORCE_COLOR`. Đầu ra
bình thường đi tới bộ ghi (writer) được truyền vào, lỗi đi tới bộ ghi lỗi. Các module ngoài `cli` không
dùng `console.*`.

Khi không bật `--verbose`, lỗi ở terminal hiện bản tóm tắt đã lọc kèm gợi ý chạy lại với cờ đó. Verbose
thêm một stack đã lọc thông tin đăng nhập, có giới hạn độ dài, và tối đa bốn nguyên nhân.

### Trình bày công cụ

Nguồn: [core/tool.ts](../../src/core/tool.ts),
[engine/loop/tools/presentation.ts](../../src/engine/loop/tools/presentation.ts),
[core/stream-events.ts](../../src/core/stream-events.ts).

```ts
interface ToolPresentation<I> {
  readonly label?: string
  readonly emoji?: string
  readonly detailKeys?: readonly string[]
  detail?(input: I, locale: Locale): string | undefined
  readonly lifecycleOwner?: ToolLifecycleOwner
}
```

`lifecycleOwner` là `'tool'` (mặc định) hoặc `'progress'`. Công cụ `'progress'` (hiện chỉ có `research`)
tắt phần dựng start và result của chính bề mặt và điều khiển toàn bộ phần hiển thị qua `tool_progress`, để
khung nhìn trực tiếp của nó không bị bao thêm bởi một dòng công cụ chung thứ hai.

Phần trình bày chỉ mang tính mô tả. Việc phê duyệt phụ thuộc vào năng lực, `requiresApproval` và nguồn gốc
bên ngoài. Engine phân giải nó đúng một lần:

1. dùng nhãn và emoji đã khai, nếu không thì chuyển tên công cụ thành dạng dễ đọc;
2. lấy chi tiết từ `detail(input, locale)` của chính công cụ, nếu không thì chỉ từ `detailKeys` đã khai.
   Một công cụ MCP bên ngoài không khai cái nào thì được tóm tắt tham số dạng `key=value`, để ô hỏi phê
   duyệt không bao giờ mù;
3. lọc thông tin đăng nhập và ký tự điều khiển;
4. chặn độ dài của nhãn và phần chi tiết.

Các bề mặt dùng `tool_execution_start` và `tool_progress`. Chúng không bao giờ đọc tham số thô của công cụ
hay tự dựng lại chính sách hiển thị. Một tham số của `tool_progress` có thể chính là một thông điệp có
khóa (`{ market: { key: 'trading.market.crypto' } }`) mà bề mặt phân giải theo ngôn ngữ của người xem, nên
bộ báo cáo nằm sâu trong một thị trường không bao giờ phải giữ một `Locale`.

### Dựng trực tiếp ở CLI

Chat tương tác chỉ hiện trạng thái **thưa**, không hiện từng mẩu dữ liệu của kênh truyền: spinner khi mô
hình hoặc công cụ đang chạy; nhãn công cụ an toàn, phần chi tiết và các mốc tiến độ; phần tóm tắt thành
công hoặc thất bại từ các sự kiện kết quả công cụ; mô hình, độ trễ và các chỉ số ngữ cảnh khi có; văn bản
cuối và lượng dùng sau khi lượt đã xong. Ký tự điều khiển và thông tin đăng nhập được lọc trước.

Một lệnh slash khai báo `execution` hiện tiến độ qua một trong hai bộ dựng, chọn bằng `isInteractiveStdout`: spinner
trên terminal, còn ở nơi khác (pipe, log, `CI`) là bộ ghi dòng thuần ra stderr, chỉ in nhãn đã đổi tối đa một lần mỗi
`LINE_PROGRESS_INTERVAL_MS`. Cả hai nhận cùng nhãn từ bộ báo cáo của lệnh, nên các dòng `/refresh` vẫn dựng ở một nơi,
và bộ ghi dòng không giữ timer hay listener. Stdout vẫn chỉ chứa câu trả lời.

### Bảng trực tiếp trên kênh

Khi `mid_stream_updates = true` và adapter sửa được tin nhắn, khâu gửi giữ một bảng trực tiếp:

```text
Elapsed: <giây>s
<glyph trạng thái> <emoji> <nhãn công cụ an toàn>: <chi tiết hoặc tiến độ>
<các mốc nghiên cứu, khi một lượt nghiên cứu đang chạy>
```

Nhãn `Elapsed` được bản địa hóa. Danh sách việc hay các dòng tiến độ phụ của một công cụ được thụt vào dưới
dòng của công cụ đó, và các mốc nghiên cứu (bắt đầu, kế hoạch, câu hỏi, giai đoạn, cảnh báo, tổng kết) nằm
sau các dòng công cụ. Hai lần sửa tin cách nhau tối thiểu 1,5 giây. Kênh truyền không hỗ trợ sửa tin thì
nhận các lần gửi thường và kết quả cuối. Chỉ báo "đang gõ" và cảm xúc chỉ được bật khi cả cấu hình lẫn
năng lực của adapter cùng cho phép.

### Kết quả phiên chạy và lỗi dừng

Các phiên chạy engine kết thúc với một `RunResultReason`:

```text
completed, aborted, budget, error, turn_limit, loop, timeout
```

Khi một phiên chạy dừng sớm, kênh giữ lại phần văn bản dở dang còn dùng được và thêm một lý do đã bản địa
hóa. Phiên chạy hoàn tất mà không có văn bản thì dùng câu "không có nội dung" đã bản địa hóa. Một
`RunHalted` được ném ra đi qua `HALT_SPEC` trong `core/errors.ts`; mã thoát CLI, emoji và khóa bản địa hóa
đều lấy từ bảng đó, không từ một bảng câu chữ riêng của từng bề mặt. Một lần dừng `budget` còn kèm chi
tiết nêu tên trần đã từ chối nó, và `failureSpecOf` chọn văn bản của chi tiết. Lỗi kết thúc bất ngờ đều
được lọc thông tin đăng nhập: người dùng kênh nhận câu chữ chung đã bản địa hóa, người dùng terminal chỉ
thấy chi tiết nội bộ khi có `--verbose`.

### Hiển thị chi phí

Các bề mặt định dạng đúng cùng một tập dữ kiện `LLMUsageTotals` bằng bộ định dạng chi phí chung: token đầu
vào, đầu ra và cache, chi phí, mức dùng ngữ cảnh, và các mức ngân sách theo phiên chạy, ngày, tháng đã cấu
hình. Chúng không bao giờ tính lại giá hay trần chi phí.

### Ô hỏi phê duyệt

| Chế độ | Hành vi |
|---|---|
| `manual` | Lời gọi an toàn đi qua; lời gọi nguy hiểm hoặc từ bên ngoài cần một quyết định của operator. Mặc định |
| `bypass` | Lời gọi đi qua mà không hỏi. Phải được chọn rõ ràng |
| `unavailable` | Một lời gọi nguy hiểm bị chặn vì không gửi được ô hỏi tới ai |

Không có chế độ `safe`. Các lựa chọn là `deny`, `once`, và `remember` khi phạm vi hỗ trợ ghi nhớ. Phê duyệt
đã ghi nhớ nằm trong bộ nhớ phiên chat và bị xóa cùng phiên; ở phạm vi bộ lập lịch và ủy quyền chỉ có
quyết định một lần. Hai lời gọi đang chờ giống hệt nhau trong một phiên chạy dùng chung một ô hỏi. Hết giờ
và hủy đều kết thúc bên đang chờ và dọn các listener và timer. Bên gọi không hỏi được thì phải dùng
`unavailable`, không được chờ vô hạn. Chat CLI tương tác hiện ô hỏi ngay trong terminal; phiên chạy một
phát không tương tác thì bị ép `unavailable`, trừ khi operator chủ động chọn `--mode bypass`. Telegram dùng
được nút bấm; các adapter khác có thể gửi văn bản phê duyệt nhưng phải tôn trọng đúng năng lực chúng đã khai
và đúng hợp đồng quyết định của engine.

### Bản địa hóa

Module bản địa hóa hỗ trợ `en` và `vi`. Ngôn ngữ là giá trị riêng của từng phiên chạy, nên các phiên chạy
song song hiển thị được các ngôn ngữ khác nhau mà không cần trạng thái dùng chung có thể sửa.
`t(locale, key, params)` tra trong danh mục được yêu cầu, rồi quay về tiếng Anh, rồi trả về chính khóa. Chỗ
giữ chỗ dùng tham số có tên như `{brand}`. Câu chữ của CLI và kênh đều lấy từ các danh mục, và thương hiệu
được đưa vào như một tham số chứ không viết cứng trong các giá trị.

### Năng lực của kênh

Việc phân phối chỉ rẽ nhánh theo các năng lực mà kênh khai (`inlineButtons`, `markdown`, `typing`,
`reactions`, `canEdit`, `maxTextLen`), không bao giờ theo tên kênh. Interface nằm ở
[Kênh](./kenh.md#hợp-đồng-adapter).

### Bề rộng dòng theo từng đích

Bộ dựng không bao giờ tự giả định bề rộng. `resolveRenderContext(timezone, surface)` trả về một bề rộng cho
mỗi đích:

| Đích | Bố cục | Bề rộng |
|---|---|---|
| repl | `table` | 90 |
| kênh (telegram, zalo) | `lines` | 45 |

`toFactLines` ghép càng nhiều dữ kiện lên một dòng càng tốt trong hạn mức đó rồi xuống dòng mới, chứ không
cắt đôi một dữ kiện, vì cắt giữa chừng sẽ tách con số khỏi nhãn gọi tên nó.

### Cùng một cách đọc trên mọi kênh

Mọi đích đều nêu cùng các dữ kiện, bằng cùng chữ và cùng glyph; chỉ hình dạng đổi.

- **Số không bao giờ chỉ nằm trong biểu đồ.** Một biểu đồ nằm cạnh chính các con số nó vẽ.
- **Một glyph, một nghĩa.** `●` là giá trị hôm nay trên một thang, `○` là mục tiêu hoặc trần trên một
  thanh. `check-display-contract` làm build thất bại khi một glyph bị gán nghĩa thứ hai.
- **Hình dạng theo màn hình.** REPL so sánh các dòng trên một lưới thẳng hàng, nên bỏ biểu đồ chỉ nhắc lại
  một cột (thanh phân bổ). Điện thoại xếp các dòng chồng lên nhau, và ở đó chính thanh này giúp so sánh
  chúng. Thang thì hiện ở cả hai.
- **Biểu đồ không bao giờ phải thẳng hàng giữa các dòng.** Telegram và Zalo dùng phông tỷ lệ, nên không
  biểu đồ nào phụ thuộc vào cột do dòng khác đặt ra.
- **Không có biểu đồ ở nơi mô hình chuyển tiếp văn bản.** `RenderContext.charts` là false trên
  `TOOL_SURFACE`: mô hình chép nguyên văn văn bản đó, và các con số bên cạnh biểu đồ vốn đã đủ để đọc.

Biểu đồ do `render/chart.ts` vẽ (`renderLadder`, `renderBar`); biểu đồ mới lấy glyph từ đó.

### Gợi ý hành động

Một lệnh có thể trả lại các lệnh mà người đọc có thể chạy tiếp, mỗi cái là một nhãn và một lệnh gạch chéo.
Kênh có `inlineButtons` dựng chúng thành bàn phím nút bấm trên khúc cuối của tin nhắn. Kênh không có nút
bấm, và CLI, in mỗi gợi ý một dòng, nêu tên lệnh. Payload vượt giới hạn 64 byte của `callback_data` trên
Telegram thì chuyển thành một dòng. Không gì chỉ tồn tại dưới dạng một cái nút, và một lần bấm mang theo
**lệnh** chứ không mang một ảnh chụp, nên một cái nút bấm ngày mai sẽ chạy lại trên dữ liệu của ngày mai.

### Trải nghiệm ghép nối

Người lạ trên một kênh ghép nối nhận một mã dùng một lần đã bản địa hóa và hướng dẫn liên hệ một operator.
Các tin nhắn lặp lại không có tác dụng gì cho tới khi yêu cầu được duyệt, bị từ chối, hoặc hết hạn. Chỉ các
định danh operator đã cấu hình mới chạy được các lệnh điều khiển ghép nối, nên một người dùng đã ghép nối
không tự động là một operator. Các quy tắc xét duyệt, gồm cả việc từ chối khi lưu trữ lỗi (fail closed),
nằm ở [Kênh](./kenh.md#xét-duyệt).

### An toàn văn bản

Mọi nhãn do người dùng kiểm soát, mô tả lệnh, chi tiết công cụ, bản xem trước lỗi của nhà cung cấp và
payload của kênh đều có giới hạn độ dài và được lọc trước khi hiển thị. Bộ dựng Markdown thoát cú pháp của
kênh truyền và cắt khúc theo code point, để các cặp surrogate không bị chẻ đôi. Không bề mặt nào được hiển
thị bí mật thô, văn bản plugin chưa làm sạch, hay tham số công cụ tùy ý.

---

## Bản đồ mã nguồn

- [AGENTS.md](../../AGENTS.md): module DAG, quy tắc ranh giới, các quy tắc bất biến nghiệp vụ
- [scripts/check-dag.ts](../../scripts/check-dag.ts): cổng kiểm tra kiến trúc (`CORE_PUBLIC`)
- [src/app/providers.ts](../../src/app/providers.ts): thứ tự provider
- [src/tools/registry.ts](../../src/tools/registry.ts): `BUILT_IN_TOOLS`
- [src/cli/registry.ts](../../src/cli/registry.ts): `BUILT_IN_COMMANDS`
- [src/core/tool.ts](../../src/core/tool.ts), [src/core/stream-events.ts](../../src/core/stream-events.ts): trình bày công cụ
- [src/core/errors.ts](../../src/core/errors.ts): `HALT_SPEC`, `failureSpecOf`
- [src/trading/render/format.ts](../../src/trading/render/format.ts): `resolveRenderContext`
- [src/engine/mcp/jobs/](../../src/engine/mcp/jobs/), [src/ai/client-model/](../../src/ai/client-model/): mô hình client dưới `mcp serve`
- [Mở rộng](./mo-rong.md), [Kênh](./kenh.md)
