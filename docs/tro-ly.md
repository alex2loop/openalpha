# Agent, đội và mô hình

Một agent là một tệp TOML, không phải mã: gồm một prompt, các công cụ nó được dùng, và có thể thêm một mô hình.
Mọi trường trong phần giới hạn chỉ **thu hẹp** quyền. Schema không có trường nào nới quyền ra, nên gõ sai một
khóa cũng không bao giờ cấp nhiều hơn bạn định.

Trang này nói về việc viết một agent, ghép nhiều agent thành một đội, cho chúng kỹ năng, và chọn mô hình.

---

## Viết một agent

Bắt đầu từ mẫu có chú thích đầy đủ, [agent.sample.toml](../agent.sample.toml).

Agent có sẵn và agent của plugin đi kèm là agent đáng tin. Agent bạn tự viết, đặt ở
`<data_dir>/agents/<id>/agent.toml`, thì không. Agent của bạn đặt được `model_tier` nhưng không đặt được `reasoning`,
và `system_prompt` của nó bị quét, bị từ chối nếu khớp một mẫu chỉ dẫn bị chặn.

### Dựng khung một agent

```bash
openalpha agent add web-researcher   # ghi <data_dir>/agents/web-researcher/agent.toml
openalpha agent edit web-researcher  # mở bằng $EDITOR
```

Chưa có thư mục `agents/` là chuyện bình thường, không phải lỗi.

`openalpha agent list` và `show <id>` để xem; `show` còn in công cụ, danh sách ủy quyền, trần số lượt và số agent con
mà agent được phép gọi. `remove <id>` xóa một agent của bạn, tạm dừng các lịch chạy đang bật của nó và không chạm được vào agent có
sẵn. `agent bind`, `unbind` và `bindings` gắn một chat của kênh vào một agent - xem [Lệnh](lenh.md).

### Từ trang văn phòng

Khi API bật, trang văn phòng tạo, sửa và xóa được agent của bạn mà không cần chạm vào tệp nào. Trang ghi đúng tệp
`agent.toml` vào thư mục agent của bạn, nên `agent list` và `agent show` vẫn thấy agent, và sau này bạn sửa tay vẫn
được.

- Agent mới hay vừa sửa được kiểm tra như daemon kiểm tra một tệp lúc khởi động: dạng tệp, mã, phạm vi, mức trần
  ngân sách, bước quét prompt và bậc mô hình. Bị từ chối thì lý do hiện bằng lời thường và không có gì được ghi.
- Trang tạo tối đa 50 agent của riêng bạn; quá mức đó nó yêu cầu bạn xóa bớt một agent trước.
- Agent trả lời ở tin nhắn kế tiếp, không cần khởi động lại. Phiên chạy đang diễn ra giữ nguyên định nghĩa lúc bắt
  đầu.
- Công cụ của nó là một bộ cố định: tìm kiếm web, bộ nhớ, đồng hồ và máy tính, cùng các công cụ chỉ đọc về thị trường
  và đề xuất. Không bao giờ có shell hay ghi tệp. Đặt `max_spawn` thì thêm `spawn` vào bộ đó.
- Trang sở hữu tên, mô tả, prompt, phạm vi, mức trần theo ngày, bậc mô hình, diện mạo, công cụ và `max_spawn`: một lần
  sửa thay từng thứ đó, hoặc bỏ nó đi khi trang không gửi lên. Mọi thứ còn lại trong tệp được giữ nguyên, như trần số
  lượt, token và thời gian, `hosts`, `skills`, `delegates` và `reasoning`. Agent có sẵn và agent của plugin đọc được ở
  đó nhưng không sửa hay xóa được.
- Xóa một agent là gỡ thư mục của nó và tạm dừng mọi lịch đang bật của nó, để không lịch nào còn bắn vào một cái tên
  không còn tồn tại; chuông báo đã tạm dừng bao nhiêu. Bộ nhớ, phiên chat, chi tiêu và bảng thành tích của nó vẫn còn.
  Agent đang tham gia một mạng xã hội thì bị từ chối cho đến khi nó rời đi.
- Tệp bạn sửa tay khi daemon đang chạy được nhận lại khi trang đọc lại thư mục. Tệp nạp lỗi bị bỏ qua kèm lý do và nằm
  ngoài danh sách đang chạy cho đến khi bạn sửa xong và đọc lại. Nếu không đọc được cả thư mục, các agent đang chạy
  giữ nguyên như cũ.

### Nội dung tệp

Một agent chạy được chỉ cần ngần này:

```toml
id = "web-researcher"
name = "Web Researcher"
description = "Read-only web research assistant"

system_prompt = """
You are a focused research assistant. Use web tools to gather sources, store
findings in memory, and produce a concise summary. Do not write to disk.
"""

[capabilities]
tools = ["web_search", "web_fetch", "memory_store", "memory_recall"]
```

### Các trường

Schema rất nghiêm: một khóa lạ làm hỏng cả tệp. Một khóa năng lực gõ sai mà bị lặng lẽ bỏ qua sẽ bị đọc như một
quyền bạn đã cấp.

| Trường | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `system_prompt` | chuỗi | - | **Bắt buộc**, không được rỗng. |
| `id` | chuỗi | tên thư mục | Khi khai, phải trùng tên thư mục. |
| `name` | chuỗi | `id` | Tên hiển thị. |
| `description` | chuỗi | không có | Hiện ra khi chọn đích ủy quyền. |
| `max_turns` | số nguyên dương | `[loop].max_turns` từ config | Trần số lượt mỗi phiên chạy. Hạ được giá trị `[loop]`, không nâng được. |
| `max_tokens` | số nguyên dương | trần của phiên chạy: 8.192 cộng phần dư cho `reasoning` | Trần token đầu ra mỗi lời gọi. Chỉ hạ được trần đó. |
| `max_duration_ms` | số nguyên dương | `[loop].max_duration_ms` từ config | Trần thời gian thực mỗi phiên chạy. Hạ được giá trị `[loop]`, không nâng được. |
| `max_daily_usd` | số | không có | Phần của hôm nay dưới `[budget] max_daily_usd`. Xem [Phạm vi, ngân sách và tạm dừng](#phạm-vi-ngân-sách-và-tạm-dừng). |
| `[focus]` | bảng | không có | Agent nhìn vào đâu. Xem [Phạm vi, ngân sách và tạm dừng](#phạm-vi-ngân-sách-và-tạm-dừng). |
| `[look]` | bảng | không có | Diện mạo nhân vật của agent trên trang văn phòng: vài phần ngắn, mỗi phần là một từ viết thường (hoặc nối bằng gạch ngang) (`hair = "short"`). Daemon chỉ lưu lại và từ chối phần nào không có dạng đó; trang quyết định giá trị nào vẽ được và tự chọn phần bạn bỏ trống theo mã của agent. |
| `model_tier` | chuỗi | không có | Một nhóm trong `[model_tiers]` mà mọi mục đều hỗ trợ công cụ. Agent của bạn đặt được; agent plugin không đáng tin thì không. |
| `reasoning` | enum | `'default'` | **Chỉ agent đáng tin:** agent có sẵn và agent của plugin đi kèm. |
| `[capabilities]` | bảng | xem dưới | Trần bảo mật; mọi trường chỉ thu hẹp quyền. |

Mã định danh (`id`) bắt đầu bằng chữ thường hoặc chữ số, chỉ chứa chữ thường, chữ số, gạch dưới, gạch nối hoặc dấu
chấm, tối đa 64 ký tự. `default` là tên dành riêng. Bạn không dùng lại được mã của agent có sẵn hay của plugin đáng
tin: tệp bị bỏ qua kèm cảnh báo `agents.user_id_reserved`.

### Năng lực

Một agent chỉ có đúng những gì nó khai tên. Bỏ hẳn `[capabilities]` thì nó không gọi được gì. Đặt `tools = "*"` thì
nó được mọi công cụ đã đăng ký.

| Trường | Bỏ trống | Rỗng | Có khai |
|---|---|---|---|
| `tools` | Cấm tất cả | Cấm tất cả | Danh sách cho phép, hoặc `"*"` cho mọi công cụ đã đăng ký. Tên công cụ lạ làm hỏng tệp. |
| `delegates` | Không ủy quyền | Không ủy quyền | Các mã agent gọi được qua `delegate`. Nhớ khai cả `delegate` trong `tools`. |
| `hosts` | Mọi host mà chính sách SSRF cho phép | - | Các tên miền `web_fetch` và phần đọc trang của `research` được với tới. `*.` khớp cả tên miền gốc lẫn các tên miền con. |
| `skills` | Mọi kỹ năng | - | Các tên SKILL.md agent này được liệt kê và đọc. |

Bỏ trống `tools` là cấm tất cả, còn bỏ trống `hosts` là cho phép mọi thứ chính sách SSRF cho qua. Đó là chủ ý:
công cụ là trục nguy hiểm nên im lặng nghĩa là không. Danh sách host chỉ thu hẹp thêm một chính sách vốn đã được áp.

### Chọn mô hình

Agent của bạn chạy chuỗi `[[models]]` chính, trừ khi nó đặt `model_tier`. Không có khóa `model` riêng cho từng agent,
nên một tệp thả vào chỉ chọn được nhóm mà chính bạn đã cấu hình.

Agent của bạn có thể đặt `model_tier` trỏ tới một chuỗi dưới `[model_tiers]`. Nhóm đó phải tồn tại và không rỗng,
và mọi mục trong nó phải hỗ trợ gọi công cụ khi agent có công cụ. Agent plugin không đáng tin không đặt được `model_tier`, còn
`reasoning` vẫn chỉ dành cho agent đáng tin. Một `model_tier` mâu thuẫn với nhóm mà phần ghép
(composition) ưu tiên thì bị từ chối, không bị bỏ qua.

`/model` trong kênh có phạm vi một phiên chat: nó đổi mô hình cho đúng phiên đó, chọn từ chuỗi `[[models]]` toàn
cục, giữ các mục còn lại làm dự phòng, không chọn được nhóm, và không lưu lại. `openalpha provider list` và
`openalpha provider models` cho biết đang có những gì.

### Khi nạp tệp thất bại

Một agent lỗi không bao giờ chặn daemon khởi động. Mỗi tệp hỏng riêng và bị bỏ qua:

- TOML sai cú pháp, vi phạm schema, `id` lệch tên thư mục, công cụ lạ trong `tools`, `reasoning` trên agent của
  bạn, `model_tier` trỏ tới nhóm không có hoặc có mục không hỗ trợ công cụ, `max_daily_usd` cao hơn mức trần `[budget]` của bạn, hoặc `system_prompt` bị bộ quét chặn -
  ghi log `agents.user_load_failed`;
- trùng mã dành riêng - ghi log `agents.user_id_reserved`.

### Ranh giới lúc chạy

Mỗi agent chạy với các công cụ tệp đặt gốc tại `<data_dir>/workspaces/<id>/` và phạm vi bộ nhớ riêng. Một shell đã
được duyệt bắt đầu ở thư mục đó, nhưng đó là thư mục làm việc, không phải sandbox của hệ điều hành.

### Phạm vi, ngân sách và tạm dừng

Ba phần tùy chọn nói agent đứng cạnh cuốn sổ của bạn ra sao. `[focus]` và `max_daily_usd` là khóa TOML và phải nằm
**trên** `[capabilities]`. Viết sau nó thì TOML nhét chúng vào trong và tệp bị từ chối.

**`[focus]` - nó nhìn vào đâu.** Bỏ trống thì agent dùng chung phạm vi của chính bạn: đề xuất của nó điều khiển
danh mục của bạn, y như `/suggest`. Đặt nó thì agent trở thành *ý kiến thứ hai*:

```toml
[focus]
markets = ["equity-vn"]   # thị trường danh mục của bạn có giao dịch
sectors = ["banks"]       # slug ngành của thị trường: banks, oil-gas, ...
horizon = "long"          # short | long: khung thời gian chấm điểm đề xuất của nó
```

Phạm vi chỉ thu hẹp:

- `markets` phải là thị trường danh mục của bạn có giao dịch.
- `sectors` cần một thị trường có dữ liệu ngành (hiện là `equity-vn`). Tên là slug của chính thị trường, do
  `market_sector_strength` liệt kê. Chúng được kiểm khi chạy vì danh sách ngành là dữ liệu được làm mới: một tên
  nằm ngoài phạm vi sẽ bị từ chối, kèm tên phạm vi.
- `[focus]` rỗng không thu hẹp gì và bị từ chối.
- Bảng bị từ chối thì agent đó bị bỏ qua lúc khởi động (`agents.focus_invalid`).

Đề xuất của agent có phạm vi được lưu dưới `focus_key` riêng, được chấm và báo cáo tách biệt. Chúng không bao giờ
dời một mức cắt lỗ đang giữ, nâng nó hay kích hoạt cảnh báo, và không vào bản tin sáng. Chúng hiển thị là "ý
kiến thứ hai từ <phạm vi>", không kèm tỷ trọng, số lượng hay khối lệnh - một cuốn sổ, một kế hoạch. `/suggest <mã>`
luôn là đề xuất điều khiển danh mục. Một agent được ủy quyền giữ nguyên phạm vi của agent gốc, nên đề xuất của nó
không bao giờ vô tình thành đề xuất của danh mục. Chi tiết: [giao dịch](giao-dich.md).

Agent chỉ đặt `horizon` trong `[focus]` có khóa riêng và chạy trên mọi thị trường bạn có. Hai agent có cùng phạm vi
giống hệt dùng chung một khóa, nên chung một hồ sơ.

**Độ trùng.** `agent list` và `agent show` in dưới mỗi agent của bạn: phạm vi, chi phí hôm nay so với mức trần khi nó
có mức trần, thành tích đề xuất của nó trên mọi phạm vi từng dùng, và tần suất nó chọn hành động mà các agent *khác*
chọn trên cùng mã, cùng ngày. Quy tắc, cùng cỡ mẫu tối thiểu để có tỉ lệ, nằm ở [giao dịch](giao-dich.md).

**`max_daily_usd` - phần của hôm nay.** Dưới `[budget] max_daily_usd`, mỗi agent có thể có mức trần riêng. Xem
[mức trần theo agent](ngan-sach.md#mức-trần-theo-agent).

**Tạm dừng.** `openalpha agent pause <id>` tắt một agent của bạn và `agent resume` bật lại ([Lệnh](lenh.md)). Persona
tranh luận không tạm dừng được: làm vậy sẽ hỏng mọi đề xuất.

- Việc tạm dừng được đọc ở mỗi phiên chạy, nên nó tới một daemon đang chạy ngay lập tức, không cần khởi động lại.
- Phiên chạy đang diễn ra vẫn xong. Sau đó tin nhắn chat kế tiếp, heartbeat và tác vụ theo lịch của agent bị từ chối
  bằng câu "agent này đang tạm dừng", và CLI thoát với mã `16`.
- Tác vụ theo lịch bị bỏ qua mà không tính là một lần lỗi. Tác vụ chạy một lần chờ đến khi `resume`.
- Nếu không đọc được trạng thái tạm dừng thì agent coi như đang tạm dừng: công tắc an toàn nghiêng về phía không chạy.
- `/agent <id>` trên agent đang tạm dừng vẫn chọn nó và báo rằng nó sẽ không trả lời cho tới khi được bật lại.

Agent có `[focus]` riêng và chỉ giữ công cụ được phép mới tham gia được một mạng xã hội như Moltbook; xem
[mạng xã hội](mang-xa-hoi.md).

---

## Đội và ủy quyền

Một **đội** là một agent điều phối cộng với các agent vai nó được gọi. Không có gì để tạo: danh sách
`[capabilities] delegates` của agent điều phối cộng với các công cụ ủy quyền là toàn bộ hợp đồng. Đội không gắn với
lĩnh vực nào - review mã, nội dung, quy trình vận hành, việc gì đọc dễ hơn khi chia cho vài chuyên gia hẹp thay vì
một cuộc chat vạn năng.

### Các thành phần

| Thành phần | Làm gì |
|---|---|
| Công cụ `delegate` | Gọi một agent con trong danh sách cho một việc khép kín và chờ kết quả. |
| Công cụ `delegate_parallel` | Một lần gọi cho từ hai việc độc lập trở lên; chờ tất cả kết quả. |
| `[capabilities] delegates` | Danh sách mã agent con mà agent này được gọi. Rỗng là không ủy quyền. |
| `[loop] delegation_depth` | Số tầng con tối đa từ phiên chạy gốc. Mặc định `3` cho phép độ sâu 1, 2 và 3. |
| `[loop] max_delegations` | Tổng số con một phiên chạy được khởi động, tính chung cả hai công cụ. |
| `[loop] max_parallel_delegations` | Số mục tối đa trong một lời gọi `delegate_parallel`. |
| Công cụ `spawn` | Tạo các agent con ngắn hạn, chỉ đọc, do chính agent mô tả; xem [Agent con tự tạo](#agent-con-tự-tạo). |
| `[capabilities] max_spawn` | Số agent con tự tạo mà một lời gọi `spawn` được khởi động, từ 1 đến 4. Bỏ trống hoặc `0` là agent không tự tạo được. |
| `[loop] max_spawn_duration_ms`, `max_spawn_turns` | Thời gian (mặc định 10 phút) và số lượt mô hình (mặc định `12`) mỗi agent con tự tạo có. |

Agent con dùng đúng danh sách công cụ của chính nó: nó có thể dùng công cụ mà cha không gọi trực tiếp được, và công
cụ vắng mặt ở con thì bị chặn, trước cả khâu phê duyệt.

Phiên chạy con dùng chung tín hiệu hủy và ngân sách của cha. Phiên chat của con là mới, riêng tư, tạm thời và không
bao giờ ghi vào bản ghi hội thoại bền vững. Con không thấy bản ghi của cha, không nói chuyện với nhau, và không chia
sẻ trạng thái tranh luận. Chỉ agent điều phối ghép kết quả lại. Về tiền, xem
[ngân sách trên một cây phiên chạy](ngan-sach.md#ngân-sách-trên-một-cây-phiên-chạy).

### Chọn thứ nhỏ nhất đủ dùng

Nhiều con hơn không có nghĩa là kỹ hơn. Mô hình chọn cách nhỏ nhất đủ dùng:

| Nhu cầu | Cách làm |
|---|---|
| Suy luận ổn định, đơn giản, hoặc tuần tự | Trả lời thẳng. |
| Thiếu một ràng buộc có thể đổi câu trả lời | Hỏi lại đúng một câu. |
| Khẳng định thời sự hoặc từ bên ngoài cần bằng chứng nhiều nguồn | Gọi `research`. Đầu ra của một con chung chung không tính là bằng chứng. |
| Một việc chuyên môn khép kín, không phải thu thập bằng chứng | Gọi `delegate`. |
| Từ hai việc chuyên môn độc lập trở lên | Một lần `delegate_parallel`. |
| Các việc chuyên môn phụ thuộc nhau | Giữ tuần tự; đưa kết quả trước vào phần mô tả việc sau. |

Agent điều phối viết đúng một câu trả lời và nêu rõ phần việc con nào đã hỏng, bị từ chối hay không chạy được. Nó
không thử lại bằng cách phình đội ra hay lặp lại một lời gọi y nguyên. Mã, chứ không phải mô hình, giữ quyền quyết định
danh sách con, quyền dùng công cụ, phê duyệt, hạn ngạch, độ sâu, vòng lặp, số nhánh, ngân sách, thời lượng và việc hủy.
Một prompt thuyết phục không nới được cái nào trong số đó.

Mọi thứ chạy ở tiền cảnh. **Không có tác vụ nền, không có mã nghiên cứu, không có lệnh điều khiển bất đồng bộ, và
không có khôi phục bền vững.** Hủy phiên chạy (Ctrl+C, `/stop`, hoặc lệnh hủy từ kênh) thì mọi con đang chạy dừng
theo. Một lượt nghiên cứu không bao giờ lưu kế hoạch, trạng thái làm việc hay bằng chứng, và không khôi phục lại được.

### `delegate` - một vai trong danh sách

Agent phải nằm trong danh sách của người gọi. Kết quả mang `agent_id` của con, lý do dừng `reason` và văn bản cuối
`text`. Gọi lại khi một việc sau phụ thuộc kết quả trước; với việc độc lập thì dùng một lời gọi `delegate_parallel`.

Các lỗi:

- mã agent không tồn tại - `invalid_input`;
- agent không nằm trong danh sách của người gọi - `unauthorized`;
- tự ủy quyền, vòng lặp tổ tiên, hoặc vượt giới hạn lồng nhau - `depth_limit`;
- cạn hạn ngạch nhánh (`[loop] max_delegations`) - `delegate_full`.

### `delegate_parallel` - nhiều con cùng lúc

Đưa từ hai mục độc lập trở lên, mỗi mục gồm `agent_id` và `prompt`, mọi đích đều phải nằm trong danh sách của người
gọi. Nhiều mục hơn `[loop] max_parallel_delegations` thì bị từ chối với `delegate_full`, và cả phiên chạy vẫn bị chặn
bởi `[loop] max_delegations` tính trên mọi lời gọi ủy quyền.

Kết quả có một mục cho mỗi việc, mỗi mục có `agent_id`, `reason` và `text`. Lỗi ngân sách, phê duyệt và runner vẫn hiện
ra, còn một lỗi ngoài dự tính chỉ gói gọn trong mục của nó chứ không làm hỏng cả lô.

### Agent con tự tạo

Agent có `spawn` trong danh sách công cụ và `max_spawn` lớn hơn `0` có thể tách một câu hỏi thành những phần đọc độc lập,
ví dụ cổ tức của một công ty và báo cáo quý của nó, rồi tạo mỗi phần một agent con ngắn hạn. Trợ lý chat được tạo tối đa
`2` agent con trong một lời gọi. Truyền `goal` cho một agent con, hoặc `items` cho mỗi phần một agent con, kèm nhãn `role` và
`context` mà các agent con cần: chúng không thấy cuộc trò chuyện. Truyền `output_schema`, một JSON Schema dài tối đa 4.000
ký tự, khi bạn muốn mỗi câu trả lời về dưới dạng JSON đã kiểm tra thay vì văn xuôi.

- Agent con là chính agent cha nhưng bị thu hẹp: chỉ đọc web, thị trường, tin tức và nhớ lại bộ nhớ. Nó không giao dịch,
  không ghi sổ, không đặt lịch, không gửi tin, không ghi đề xuất, không tạo thêm agent con và không ủy quyền.
- Nó chạy trên nhóm `delegate` của `[model_tiers]` nếu bạn khai báo, không thì dùng mô hình của agent cha.
- Nó có `[loop] max_spawn_duration_ms` và `max_spawn_turns`. Agent con hết thời gian, hết lượt hoặc hết ngân sách sẽ mang
  về phần đã đọc, đánh dấu là dở dang kèm lý do (thời gian, lượt hoặc ngân sách); agent con lỗi trước khi đọc được gì thì
  đánh dấu là thất bại. Agent con bị dừng cùng agent cha thì thất bại và không có lý do.
- Với `output_schema`, mỗi agent con được dặn kết thúc bằng đúng một tài liệu JSON khớp schema. Agent con đã xong mà câu trả lời
  đọc được và khớp thì trả về chính JSON đó; câu trả lời không khớp thì agent con thất bại, kèm chỗ lệch đầu tiên. Agent con bị
  cắt giữa chừng vẫn mang về bản tóm tắt thường, không kiểm tra. Một schema mà daemon không dùng được sẽ từ chối cả lời gọi
  trước khi có agent con nào chạy.
- Các agent con dùng chung phần ngân sách, hạn ngạch `[loop] max_delegations` và `[loop] delegation_depth` của agent cha,
  chi phí tính vào agent cha. Dừng agent cha là dừng mọi agent con.
- Một lời gọi xin nhiều agent con hơn `max_spawn` thì `max_spawn` agent con đầu tiên khởi động, phần còn lại bị trả về cho
  mô hình là chưa bắt đầu, không xếp hàng, và màn hình nói rằng lời gọi xin nhiều hơn mức được khởi động cùng lúc.
- Với agent có `max_spawn` là `0`, `spawn` bị bỏ khỏi `tools = "*"`.
- Kênh chat và terminal chỉ hiện một dòng cho cả nhóm (`N agent con đang đọc, k/N xong`); bảng trực tiếp liệt kê từng agent
  con dưới agent cha, còn nhật ký hoạt động giữ phần đầu câu trả lời của nó.

### Phê duyệt không bao giờ di truyền

Không gì được mang sang cho con: không phải chế độ bypass của cha, không phải một phê duyệt đã nhớ trong phiên chat của
cha, không phải phê duyệt của một client MCP trực tiếp. Một lời gọi con được duyệt không cấp phép cho lời gọi kế tiếp.
Quy tắc: [an toàn](an-toan.md).

Một lời gọi nguy hiểm của con được duyệt thế nào tùy cách bạn khởi động phiên chạy:

- Một lượt REPL tương tác luôn tới ô hỏi từ chối/cho một lần, cho từng lời gọi nguy hiểm.
- `chat --message` tương tác (có terminal ở stdin) cũng vậy, khi ô phê duyệt đã mở cho lượt đó.
- Chạy một phát với stdin là pipe hoặc rỗng thì không có ai để hỏi, nên lời gọi nguy hiểm được ủy quyền hỏng vì không có
  ai phê duyệt **ngay cả khi cha chạy `--mode bypass`**.

Đừng đưa `delegate` hay `delegate_parallel` vào công cụ của một agent con, trừ khi bạn muốn nó điều phối tiếp. Các giới
hạn `[loop]` chặn đệ quy, nhưng một danh sách bạn không chủ ý tạo ra thì vẫn là một danh sách.

### Viết một đội

1. **Agent vai.** Mỗi vai có một `system_prompt` hẹp và danh sách `[capabilities] tools` hẹp. Agent vai chỉ cần
   `delegate` khi nó điều phối tiếp.
2. **Agent điều phối.** Thêm các công cụ ủy quyền vào `[capabilities] tools` và khai mã các agent con trong
   `[capabilities] delegates`.
3. **Giới hạn.** Đặt `[loop] delegation_depth`, `max_delegations` và `max_parallel_delegations` trong `config.toml`.
   Với `spawn`, đặt thêm `[loop] max_spawn_duration_ms` và `max_spawn_turns`.
4. **Mô hình.** Agent bạn viết dùng chuỗi `[[models]]` toàn cục, trừ khi nó đặt `model_tier` trỏ tới một
   `[model_tiers]` của bạn. Agent plugin không đáng tin thì không.

Kết thúc `system_prompt` của mọi agent con bằng đoạn này, để nó thôi viết cho một người không hề đọc:

```text
You are a sub-agent: the parent agent (not the end user) reads your output. Return only the result -- no preamble, no restating the task.
```

Prompt của agent điều phối không cần tự liệt kê các vai. Runtime chèn một khối `<delegates>` dựng từ `description` của
từng agent trong danh sách, nên hãy viết trường đó cẩn thận: nó là thứ duy nhất agent điều phối đọc trước khi chọn.
Mỗi mô tả bị cắt ở 200 ký tự và cả khối ở 4.096, dòng vai đầu tiên luôn được giữ. Agent có danh sách rỗng hoặc không
phân giải được thì không nhận khối nào.

### Các agent có sẵn

| Agent | Vai trò |
|---|---|
| `chat` | Agent vạn năng mặc định, có `reviewer` trong danh sách ủy quyền. |
| `deep-researcher` | Agent cửa vào cho nghiên cứu sâu. Công cụ duy nhất của nó là `research`. |
| `reviewer` | Vai phản biện chỉ đọc văn bản, không gắn lĩnh vực. Trả `APPROVE` hoặc một danh sách sửa đánh số. |
| `research-planner` | Nội bộ, không có công cụ. Sinh ra các câu hỏi nghiên cứu khác biệt nhau. |
| `research-crawler` | Nội bộ, không có công cụ. Rút bằng chứng từ tài liệu khâu điều phối đưa cho. |
| `research-synthesizer` | Nội bộ, không có công cụ. Viết báo cáo có trích nguồn trong giới hạn. |
| `research-reviewer` | Nội bộ, không có công cụ. Chấm điểm báo cáo dựa trên bằng chứng của nó. |

Các worker `research-*` do khâu điều phối nghiên cứu chạy, với hồ sơ cố định, chỉ đúng những công cụ vai đó cần và
danh sách ủy quyền rỗng.

Phần giao dịch thêm các persona đáng tin: các vai tranh luận `bull-researcher`, `bear-researcher`,
`portfolio-manager`, `trader`, `risk-analyst`, `claim-verifier` và `market-analyst`, cộng với `theme-analyst` đứng sau
`/themes`, có công cụ duy nhất là `research`.

Chúng **không** phải một đội: không agent nào có chúng trong danh sách và bạn không chọn chúng bằng `/agent`. Quy trình
đề xuất lập lịch cho các vai tranh luận trực tiếp, mỗi vai một lát ngân sách. Chế độ `full` chạy mọi vai trừ
`market-analyst`; `lean` chạy `market-analyst` cộng `claim-verifier`. Xem [giao dịch](giao-dich.md).

### Nghiên cứu như một năng lực

`research` chỉ đọc và không kích hoạt phê duyệt công cụ nguy hiểm. Việc một agent có thấy nó hay không vẫn do danh sách
công cụ của agent đó quyết định.

```text
/research Compare two approaches with current sources
/research thorough Compare two approaches with current sources
openalpha chat --agent deep-researcher
```

`/research` không đụng tới ràng buộc `/agent` của bạn ([Lệnh](lenh.md)). `openalpha chat --agent deep-researcher` là cửa
vào tiền cảnh rõ ràng.

Gọi `research` trực tiếp bất cứ khi nào các khẳng định thời sự hoặc từ bên ngoài cần bằng chứng nhiều nguồn. Một con
chung chung có thể phản biện hay viết lại bản nháp, nhưng đầu ra của nó là nội dung công cụ không đáng tin và không bao
giờ được nhận làm bằng chứng nghiên cứu. Muốn một lượt soát chất lượng, hãy đưa bản nháp hoàn chỉnh cho `reviewer` ở
lượt kế tiếp.

### Vài công thức

**Phản biện song song.** Một lời gọi `delegate_parallel` với hai mục: một vai dựng lập luận **ủng hộ**, vai kia dựng
lập luận **phản đối** cùng một mệnh đề. Agent điều phối đọc cả hai rồi viết một câu trả lời cân bằng. Nó chính là quan
tòa; không có trạng thái tranh luận chung nào để phân xử.

**Phân tích nhiều lăng kính.** Một lời gọi, N mục, mỗi vai nhìn cùng một đối tượng qua một lăng kính khác. Kết quả trả
về gắn nhãn theo agent và cha ghép lại.

**Tinh chỉnh nhiều vòng.** Mỗi vòng là một lời gọi `delegate` hoặc `delegate_parallel` mới, với phát hiện của vòng
trước viết vào prompt mới. Giới hạn số lượt, thời lượng, ngân sách và `max_delegations` chặn toàn bộ.

**Tự soát.** Ủy quyền bản nháp cho `reviewer`, rồi chấp nhận hoặc sửa:

```toml
[capabilities]
tools     = ["delegate"]
delegates = ["reviewer"]
```

```text
After producing your draft answer, ALWAYS delegate to `reviewer` with:
  "Original task: <restate>. Draft: <paste full draft>."
If reviewer returns "APPROVE", return the draft.
If reviewer returns a numbered list, address each item and revise.
On round 2+: "Revision round 2. Original task: <restate>. Prior revisions addressed: <one-line list>. Draft: <paste>."
```

Nêu tên những sửa đổi vòng trước là thứ ngăn vòng lặp xoáy vào mấy chi tiết vụn trong ba vòng liền. Tự soát là một vai
chứ không phải hook tự động, vì nó đáng trả tiền theo từng việc chứ không theo từng lượt: một bản tóm tắt đầy số liệu
thì có lợi, câu "mấy giờ thị trường mở cửa" thì không. Để agent điều phối tự chọn nghĩa là chuyện phiếm tốn một lời gọi
thay vì hai.

**Một agent điều phối chung**, để bắt đầu:

```toml
id   = "lead"
name = "Lead"
system_prompt = """
Coordinate a team. Direct-first:
- Answer directly if you can -- no delegation for small talk or facts you already hold.
- Use research, not a generic delegate, when current or external claims need evidence.
- Delegate ONLY non-evidence specialized work, to the narrowest role that fits.
- Pass each sub-agent a self-contained task slice -- never the whole conversation.
- Run two or more independent sub-tasks in ONE delegate_parallel call; keep dependent work sequential.
- Scale the roster to the work: one child for a self-contained task, two to four for genuinely independent parts. More children is not more thorough.
- Synthesize ONE answer and label unavailable child work. Never retry by adding agents or repeating an unchanged call.

You are a sub-agent: the parent agent (not the end user) reads your output. Return only the result -- no preamble, no restating the task.
"""

[capabilities]
tools     = ["research", "delegate", "delegate_parallel", "web_search", "memory_recall", "memory_store"]
delegates = ["role_a", "role_b"]
```

### Trỏ một chat vào một đội

Kênh dùng agent cửa vào đã cấu hình, mặc định về `chat`. `/agent` là chỉ-đọc với thành viên; operator đổi ràng buộc
theo từng chat, và nó sống qua khởi động lại:

```text
/agent                 # xem agent cửa vào hiện tại
/agent lead            # gắn chat này vào agent điều phối `lead`
/agent default         # quay về mặc định của kênh
```

Đổi ràng buộc sẽ hủy phần việc đang chờ và đang chạy của phiên chat cũ rồi mở phiên chat mới cho agent mới, nên đổi
giữa chừng không để lại một phiên chạy mồ côi vẫn đang tiêu ngân sách của bạn.

### Agent của plugin nằm ở đâu

Lúc khởi động, các agent hợp lệ trong `<data_dir>/agents/` được thêm **sau** agent có sẵn và agent plugin. Mã đã tồn
tại là mã dành riêng và không bị che. Nguồn `agents/<id>/agent.toml` của plugin mở rộng cùng sổ đăng ký theo cùng quy
tắc, và một agent plugin không đáng tin đặt `model_tier` hay `reasoning` thì bị từ chối.

Công cụ có sẵn đăng ký trước, công cụ của plugin mở rộng thêm, và công cụ MCP đã kết nối được thêm sau cùng mà không
thay thế một cái tên đã có. Xem [Plugin](dev/mo-rong.md).

---

## Kỹ năng

Một kỹ năng là một gói hướng dẫn: nội dung, không phải mã. Kỹ năng được tìm thấy từ các thư mục, đưa cho agent dưới
dạng một mục lục gọn, và chỉ được nạp đầy đủ khi agent hỏi tới bằng `skill_view`.

### Bố cục

```text
<skills-dir>/
  <skill-name>/
    SKILL.md
```

`SKILL.md` là phần frontmatter kiểu YAML rồi tới Markdown:

```markdown
---
name: market-brief
description: Builds a source-backed market brief for one region. Use when the operator asks for a morning brief or a session recap.
metadata:
  version: "1.0.0"
  requires_tools: web_fetch
  platforms:
    - macos
    - linux
---

Instructions for the agent.
```

Tên viết thường kiểu kebab-case, tối đa 64 ký tự, và phải trùng tên thư mục: một kỹ năng đặt dưới tên khác bị bỏ qua.
Mô tả tối đa 1.024 ký tự. Siêu dữ liệu tùy chọn: `version`, `author`, `license`, `category`, `tags`, cùng các khóa
hiển thị `requires_tools`, `fallback_for_tools` và `platforms`, mỗi cái nhận dạng danh sách phẩy, danh sách trong ngoặc
vuông, hoặc danh sách khối YAML.

### Viết mô tả cho mục lục

Mô tả là thứ **duy nhất** mô hình thấy trước khi quyết định có nạp kỹ năng hay không. Viết ở ngôi thứ ba: kỹ năng làm
gì, rồi "Use when" kèm những yêu cầu nên kích hoạt nó, bằng đúng những chữ một operator sẽ gõ.

Mục lục chỉ hiện 200 ký tự đầu, nên mệnh đề "Use when" phải kết thúc bên trong khoảng đó. Một mô tả có điều kiện kích
hoạt rơi vào ký tự thứ 240 thì với mô hình là một kỹ năng không có điều kiện kích hoạt nào.

### Kỹ năng đến từ đâu

**Kỹ năng nhúng** được đóng sẵn trong binary. Phần giao dịch mang theo: `behavioral-finance`, `capital-allocation`,
`correlation-analysis`, `crowding-and-unwind`, `crypto-analysis`, `crypto-execution`, `drawdown-response`,
`exit-management`, `gold-analysis`, `intrinsic-value`, `inversion`, `macro-liquidity-analysis`, `moat-analysis`,
`portfolio-risk-analysis`, `profit-taking`, `quality-screen`, `recover`, `research-scoping`, `technical-analysis`,
`track-record-reading`, `vn-daily-buy`, `vn-deep-dive`, `vn-dividend-analysis`, `vn-earnings-playbook`,
`vn-execution`, `vn-market-rules`, `vn-sector-rotation`, `vn-valuation`.

Các tên đó là **tên dành riêng**. Một kỹ năng thư mục dùng lại một trong số đó bị từ chối chứ không lặng lẽ bị che, nên
không ai thay được `vn-execution` bằng cách thả một thư mục vào.

**Kỹ năng thư mục** đến từ một danh sách có thứ tự:

1. thư mục kỹ năng được quản lý nằm dưới thư mục dữ liệu của bạn;
2. `[paths].skills_dirs` trong cấu hình của bạn;
3. các thư mục kỹ năng do plugin đã nạp đóng góp.

Thư mục được khử trùng lặp mà không đổi thứ tự. Khi trùng tên, cái đầu tiên thắng, nên kỹ năng của bạn được ưu tiên hơn
kỹ năng của plugin. Thư mục không tồn tại thì không đóng góp gì và không gây lỗi.

### Nội dung kỹ năng là không đáng tin

Một kỹ năng là hướng dẫn đến từ nơi khác, và nó được đối xử đúng như vậy. Trước khi lập mục lục hay nạp, runtime từ chối
việc đi ngược thư mục và thoát qua symlink, kiểm tên, thay một mô tả bị gắn cờ tiêm prompt bằng văn bản trung tính, cắt
các dòng giả làm ranh giới vai chat khỏi phần thân được nạp, và áp các quy tắc hiển thị theo nền tảng và theo công cụ
sẵn có. Chỉ kỹ năng mà hồ sơ agent đang chạy cho phép mới được đưa vào.

Không điều nào trong số đó khiến nội dung trở nên đáng tin. Một kỹ năng không vượt qua được chính sách phân quyền công
cụ, phê duyệt, đường dẫn, mạng, chi phí hay lọc đầu ra. Nó là lời khuyên mô hình có thể đọc, không phải quyền mô hình
được cấp.

### Mục lục và `skill_view`

Phần thân không bao giờ được chèn tự động. Agent thấy một mục lục gọn và kéo về đúng thứ nó cần. Danh sách `skills` của
agent thu hẹp tập đó; không khai thì không có bộ lọc tên nào thêm, và các quy tắc hiển thị vẫn áp. Mục lục chỉ hiện khi
công cụ của agent có `skill_view`. Nó bị chặn ở 8 KiB: kỹ năng nào không còn vừa thì chỉ liệt kê tên, quá nữa thì bị bỏ.

`skill_view` chỉ nhận `name` và không đi theo liên kết tới tệp con. Một tên agent không được thấy, và một kỹ năng không
tồn tại hoặc không an toàn, đều trả `file_not_found`. Hết ngân sách xem kỹ năng của phiên chạy thì trả
`payload_too_large`; phiên chạy con bắt đầu với ngân sách riêng. Một `SKILL.md` quá 1 MiB không bao giờ được nạp.

### Cài kỹ năng

Việc cài đặt thuộc về CLI, không thuộc về bất kỳ công cụ nào của agent:

```bash
openalpha skill list
openalpha skill install <source> [--force]
```

`<source>` là một đường dẫn cục bộ (một `SKILL.md` hoặc thư mục chứa nó), một URL `https://`, hoặc
`gh:owner/repo/path` (không có đoạn `.`, `..`, rỗng hay dấu gạch chéo ngược). Nội dung được quét trước khi ghi bất cứ
gì, và kết quả quét có sức nặng tới đâu tùy vào nội dung đến từ đâu:

- nguồn cục bộ luôn cài được;
- nguồn `gh:` từ chủ sở hữu đáng tin cài được trừ khi quét báo `dangerous`;
- mọi nguồn từ xa khác chỉ cài khi quét báo `safe`.

`--force` bỏ qua kết quả quét và thay một kỹ năng cùng tên đã cài. Tên đã được một kỹ năng nhúng sẵn dành riêng bị từ chối
trước khi ghi bất cứ gì. Các bản cài được ghi vào tệp khóa kỹ năng dưới thư mục dữ liệu của bạn.

Agent không có công cụ quản lý kỹ năng: chúng đọc được những gì được phép đọc và không cài, cập nhật hay xóa được gì.
Thư mục `skills/` của plugin đi qua đúng cùng quy tắc tìm kiếm, an toàn, hiển thị và ngân sách - gốc gác plugin không
cấp thêm thẩm quyền nào.

---

## Mô hình và nhà cung cấp

OpenAlpha dựng đúng một chuỗi mô hình có thứ tự lúc khởi động. Mục đầu là mô hình chính. Các mục sau là dự phòng
**hạ tầng**, không phải dự phòng chất lượng.

### Cấu hình một chuỗi mô hình

```toml
[model_defaults]
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY"
reasoning = "default"
provider_sort = "throughput"

[[models]]
alias = "primary"
model = "claude-sonnet-4-6"

[[models]]
alias = "fallback"
provider = "openrouter"
model = "anthropic/claude-sonnet-4.6"
api_key_env = "OPENROUTER_API_KEY"
```

`[model_defaults]` giữ các khóa mà mọi mục dùng chung, và giá trị của chính mục thắng. Mỗi mục `[[models]]` bắt buộc
phải khai một mô hình. [Cấu hình](cau-hinh.md) liệt kê mọi khóa, kể cả các khóa thử lại, nghỉ và tần suất dưới `[llm]`.

Bộ chọn của một mục là `alias` của nó, hoặc `<provider>:<model>` khi không có alias. Các bộ chọn phải duy nhất. Biến môi
trường nêu trong `api_key_env` chứa khóa (chưa đặt thì mục đó đứng ngoài: daemon vẫn chạy và cảnh báo, còn việc nào
cần mô hình sẽ nói rõ phải đặt biến nào; xem [Cấu hình](cau-hinh.md)); khóa dạng văn bản thuần không được chấp nhận
trong cấu hình mô hình. Một server chạy trên chính máy này (`base_url` loopback, như Ollama hay LM Studio) không cần
`api_key_env`.

Mức suy luận nhận `default`, `off`, `low`, `medium` hoặc `high`. Phần suy luận bị ẩn, nên bạn trả tiền cho nó bằng độ
trễ và token mà không bao giờ đọc được. Ở `high`, một mô hình dùng hết ngân sách của nó tiêu khoảng 20k token suy nghĩ và
hai phút cho mỗi lời gọi; `medium` chặn đầu ra một lời gọi ở 12.288 token. Với Opus 5.5 và Fable 5, vốn không ngừng suy
nghĩ được, `off` chạy ở `low` (ghi log `ai.reasoning_downgraded`).

#### `provider_sort`

`provider_sort` chỉ được đọc bởi các router phục vụ một mô hình từ nhiều endpoint, hiện nay là OpenRouter. Mọi nhà cung
cấp khác bỏ qua nó.

Hãy đặt nó ở `[model_defaults]` bất cứ khi nào cả chuỗi chạy qua một router. Endpoint mà một mục rơi vào có thể chênh với
endpoint bên cạnh cả một bậc độ lớn về token mỗi giây - mức chênh lớn hơn bất kỳ khóa nào khác tạo ra được. Các lựa chọn
là `price`, `throughput` và `latency`; bỏ trống thì để router tự chọn.

Một lần sắp xếp **xếp thứ tự** các endpoint chứ không ghim lấy một cái, và mỗi lời gọi được xếp chỗ từ đầu: sáu lời gọi
trong một cuộc tranh luận có thể rơi vào sáu endpoint. Muốn siết lại:

- `provider_only` nêu tên các endpoint được phép phục vụ một mô hình;
- `provider_order` nêu thứ tự thử;
- `provider_allow_fallbacks = false` làm hỏng yêu cầu thay vì để router đi ra ngoài danh sách đó.

Các slug là nhãn chữ thường của chính router (`"deepseek"`, `"fireworks"`), không phải tên hiển thị.

#### Dưới `mcp serve`

Không điều gì ở trên áp cho `[[models]]` khi bạn chạy `openalpha mcp serve`: mô hình của client đã kết nối trả lời cho mọi
agent, nên không khóa nào được đọc hay cần tới. Chỉ các nhóm được tra theo tên, như `decisions`, mới còn đọc cấu hình, và
một nhóm thiếu khóa thì bị bỏ qua thay vì làm hỏng khởi động.

### Đăng nhập theo gói thuê bao (web auth)

Một số nhà cung cấp xác thực bằng gói thuê bao tiêu dùng thay vì khóa API. Các mục đó không có `api_key_env`; thông tin
đăng nhập đến từ một lần đăng nhập qua trình duyệt, lưu dưới thư mục dữ liệu của bạn.

```toml
[[models]]
provider = "openai-chatgpt"
model    = "gpt-5.6-terra"
```

```bash
openalpha auth login chatgpt      # mở trình duyệt, lắng nghe ở 127.0.0.1:1455 (hoặc :1457)
openalpha auth status             # trạng thái đăng nhập và hạn dùng theo từng nhà cung cấp
openalpha auth logout chatgpt     # xóa token đã lưu
```

Lần đăng nhập lưu `<data_dir>/auth/<provider-id>.json`, chỉ mình bạn đọc được: access token, refresh token, hạn dùng, cùng
mã tài khoản và thông tin gói đọc từ chính token. Token tự làm mới trong im lặng năm phút trước khi hết hạn. Làm mới hỏng
được tính là lỗi xác thực: nhà cung cấp đó tạm ngưng 15 phút và chuỗi mô hình rơi xuống mục kế tiếp.

Các lệnh `auth` không khởi động runtime và không cần tệp cấu hình. Không có cấu hình thì token nằm ở thư mục dữ liệu mặc
định; dùng `--data-dir` để đặt chỗ khác.

Phiên chạy theo thuê bao được tính giá `$0`, với `pricing_subscription` làm nguồn giá. Số token vẫn được ghi và các giới
hạn lượt, thời lượng vẫn áp, nhưng khoản chi đó không bao giờ tính vào hạn mức ngày, tháng hay mỗi phiên chạy.

Hai ràng buộc đến từ chính endpoint ChatGPT, không phải từ OpenAlpha:

- Nó từ chối một trần đầu ra, nên đặt `max_tokens` trên một mục như vậy (hoặc trong `[model_defaults]`) là lỗi cấu hình,
  và một câu trả lời có thể dài lê thê.
- Gói đang đăng nhập quyết định mô hình nào dùng được, nên một mô hình có trong danh mục vẫn có thể bị từ chối với tài
  khoản của bạn.

`openalpha doctor --online` báo trạng thái đăng nhập và chạy một lần thăm dò thật mô hình đã cấu hình.

### Nhóm mô hình (tùy chọn)

Một agent chọn một chuỗi dự phòng có tên bằng `model_tier`, nếu nó là agent có sẵn, của plugin đi kèm hoặc do bạn viết. Khi nhóm vắng mặt, agent hay tác vụ cần tới nó rơi về
chuỗi `[[models]]` toàn cục, và mọi mục trong một nhóm phải hỗ trợ gọi công cụ. Các tên nhóm, vai nào ưu tiên nhóm nào, và
việc chuỗi nhóm kết thúc ở mục chính của `[[models]]` nằm ở [Cấu hình](cau-hinh.md). Các vai tranh luận giao dịch ưu tiên
nhóm `debate` khi `[[model_tiers.debate]]` được cấu hình, và chạy trên chuỗi chính nếu không.

### Khi một mô hình hỏng

Với mỗi lời gọi, mô hình ưu tiên đi trước, rồi tới các mục còn lại theo thứ tự bạn khai.

- Lỗi tạm thời (5xx, hết giờ, đứt kết nối, phản hồi rỗng) được thử lại trên cùng mục tối đa 2 lần, khoảng chờ bắt đầu từ
  500 ms, rồi mới sang mục kế.
- Chạm giới hạn tần suất, cạn trần đầu ra, hoặc không tìm thấy mô hình thì sang thẳng mục kế.
- Khóa sai hoặc lỗi thanh toán làm nhà cung cấp đó và mọi mô hình sau nó tạm ngưng 15 phút.
- Một mục vừa hỏng được cho nghỉ 1 phút trước khi thử lại (lâu hơn nếu nhà cung cấp nói vậy).
- **Thử lại và dự phòng chỉ xảy ra trước khi có nội dung hiện ra hoặc phát sinh tiền.** Sau đó lời gọi không được phát
  lại: phương án còn lại là trả tiền hai lần cho hai câu trả lời của cùng một câu hỏi.
- Một lần Claude từ chối vì bộ phân loại an toàn là một lần dừng bình thường (`content_filter`), không phải lỗi, và chuỗi
  không rơi xuống mục kế.

Mọi bề mặt đều báo lần đổi: kênh đăng một thông báo, nghiên cứu sâu nêu một cảnh báo, và CLI in một dòng cho mỗi lần đổi
khác biệt, ngay trên dòng cuối của phiên chạy.

Bảng đầy đủ: [dev/tro-ly.md](dev/tro-ly.md#thử-lại-dự-phòng-và-thời-gian-nghỉ).

### Cache prompt

Không có gì để cấu hình. Các nhà cung cấp tự cache (OpenAI, DeepSeek, Gemini, Grok) tự động dùng lại phần đầu dùng chung
của một prompt, và OpenAlpha đánh dấu một điểm dùng lại cho Claude trên kênh Anthropic trực tiếp lẫn trên OpenRouter.

- **Cái gì được dùng lại.** Trong chat là danh sách công cụ và phần hướng dẫn, khoảng 15k token mỗi lượt. Trong cuộc
  tranh luận là sổ tay và các quy tắc cố định của từng vai, giống hệt nhau cho mọi mã trên cùng một thị trường.
- **Khi nào nó sinh lời.** Một cache sống khoảng năm phút và chỉ được đọc bởi chính endpoint đã ghi nó. Một lượt chat vài
  phút sau đọc được. Các mã sau trong một bản tin sáng đọc được thứ các mã trước đã ghi, còn những mã được tranh luận
  cùng lúc thì mỗi mã tự trả tiền. OpenRouter giữ một vai tranh luận ở một endpoint tới mười phút yên ắng. Khi các
  endpoint của một mô hình chênh nhau nhiều về tốc độ, hãy ghim cái bạn muốn bằng `provider_only` hoặc `provider_order`.
- **Nó tốn gì.** Claude và các mô hình OpenAI mới hơn tính một lần ghi cache cao hơn giá đầu vào và một lần đọc ở khoảng
  một phần mười, nên một prompt không ai dùng lại đắt hơn một chút so với khi không cache. Một prompt dưới mức tối thiểu
  của mô hình thì không bao giờ được cache: 1.024 token với Sonnet và OpenAI, 4.096 với Opus 4.5+ và Haiku 4.5.
  `anthropic/claude-3-haiku` chỉ được phục vụ qua Amazon Bedrock trên OpenRouter và ở đó không cache gì cả.
- **Làm sao thấy được.** `openalpha cost --breakdown` in ra, theo từng trợ lý và mô hình, bao nhiêu token đến từ cache.

### Giá và giới hạn

Chi phí lấy con số do nhà cung cấp báo khi có, rồi tới giá bạn khai cho mô hình, rồi giá trong danh mục, rồi một mức dự
phòng thận trọng. Một mô hình mới chưa có trong danh mục bị tính theo mức dự phòng đó kèm cảnh báo `pricing.unknown_model`,
cho tới khi bạn khai `cost_input_per_m` và `cost_output_per_m` trên mục đó.

Trước lượt gọi đầu tiên, một phiên chạy chờ tối đa 5 giây cho bảng giá của OpenRouter, nên một lệnh `chat --message` chạy
một lần không bị tính theo mức dự phòng rồi bị trần chi tiêu ngày nhỏ chặn oan. Mô hình nào bảng giá không công bố giá,
như `openrouter/auto`, thì vẫn dùng mức dự phòng.

Một giới hạn tần suất theo phút áp cho cả tiến trình, kèm phần công bằng cho mỗi cặp agent và người dùng. Khi nó đầy,
phiên chạy dừng với lý do `rate` trước khi gọi nhà cung cấp.

### Hành vi khi hỏng

| Điều kiện | Kết quả |
| --- | --- |
| Chuỗi mô hình rỗng hoặc mơ hồ | Khởi động hỏng với lỗi cấu hình. |
| Chưa đặt biến môi trường chứa khóa của một mô hình | Daemon và lệnh CLI vẫn chạy, `start` in một dòng cảnh báo. Chuỗi bỏ qua mô hình đó, và khi không còn mô hình nào thì lúc gọi AI (chat, `/suggest`, bản tin sáng, công việc định kỳ cần AI) sẽ báo cần đặt biến nào; việc không cần AI vẫn chạy. |
| Bộ chọn ưu tiên chưa được cấu hình | Khâu kiểm agent hỏng; không lặng lẽ thay bằng mô hình khác. |
| Giới hạn tần suất đầy | Phiên chạy dừng với lý do `rate` trước khi gọi nhà cung cấp. |
| Lỗi thử lại được xảy ra trước khi có đầu ra | Thử lại cùng mục, rồi thử các mục dự phòng đủ điều kiện. |
| Lỗi xác thực hoặc thanh toán | Nhà cung cấp bị bỏ qua 15 phút; các mục sau vẫn chạy được. |
| Lỗi xảy ra sau khi đã có nội dung hoặc phát sinh lượng dùng | Không phát lại; chi phí đã phát sinh vẫn được giữ. |
| Mọi mục đủ điều kiện đều hỏng | Trả về lỗi đã chuẩn hóa cuối cùng. |
| Mục trong nhóm nghiên cứu hoặc mục dự phòng toàn cục không hỗ trợ công cụ | Nghiên cứu báo `model_incompatible`; cấu hình một mục `model_tiers.research` hỗ trợ công cụ. |
| Nghiên cứu liên tục nhận tham số công cụ web sai định dạng | Nghiên cứu báo `invalid_tool_arguments`, không khẳng định rằng nhà cung cấp thiếu hỗ trợ công cụ. |

---

Bên trong: [dev/tro-ly.md](dev/tro-ly.md).
