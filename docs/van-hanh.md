# Việc lặp lại

Có ba loại việc tự lặp lại. Hãy biết việc nào thuộc loại nào trước khi tìm hiểu vì sao nó chạy hay
không chạy.

| Loại | Ai tạo | Nằm ở đâu |
|---|---|---|
| **Vòng lặp có sẵn** | Daemon, luôn luôn | Cố định. Chỉ chỉnh được một nhịp |
| **Việc theo lịch** | Bạn, bằng `schedule add` | Cơ sở dữ liệu, nên còn nguyên sau khi khởi động lại |
| **Heartbeat** | Tệp `HEARTBEAT.md` trong thư mục làm việc của agent | Một tệp daemon quét |

Cả ba chạy qua engine agent thông thường, cùng ngân sách, giới hạn mô hình và công cụ. Khác nhau ở
khâu phê duyệt: việc theo lịch có đích là kênh thì hỏi được bạn; heartbeat thì không bao giờ, vì
không có ai đang ngồi xem.

---

## Vòng lặp có sẵn

Chúng chạy khi `openalpha start` dựng daemon và dừng khi `openalpha stop` tắt nó. Mỗi vòng chạy xong
rồi mới tính lần chờ kế tiếp, nên một lượt chậm không bao giờ chồng lên chính nó. Lượt nào không có
việc thì thoát ngay.

| Việc | Nhịp | Làm gì |
| --- | --- | --- |
| `trading.alerts` | 60 giây | Gửi các cảnh báo đã bật, rồi bật cảnh báo thoát và cảnh báo sàng lọc dựa trên sổ của bạn. Mã đang nắm mà chưa có kế hoạch thì được ghi một kế hoạch chỉ có mức giá. Khâu gửi chạy trước, nên cảnh báo vừa bật ở lượt này sẽ đi ở lượt sau. |
| `trading.outcomes` | 12 giờ | Chốt kết cục các đề xuất đang chờ dựa trên nến đã chốt và cập nhật bảng thành tích. |
| `trading.macro-extract` | 12 giờ | Đọc báo cáo của cơ quan thống kê Việt Nam cùng báo chí tương ứng vào các chuỗi vĩ mô đã lưu, ưu tiên tháng mới chưa đọc, lùi tối đa 24 tháng. Mỗi lượt tối đa 3 báo cáo và 3 bài báo. Tháng chưa công bố tốn một lượt gọi mạng, không tốn lượt gọi mô hình. |
| `trading.theme-outcomes` | 12 giờ | Đo các nhận định cổ phiếu của `/themes` đã tới mốc 3, 6 hay 12 tháng so với VN-Index. Không gọi mô hình. |
| `trading.briefs` | 60 giây | Gửi các bản tin sáng đã đến hạn. Đây chỉ là nhịp kiểm tra; giờ gửi thật là `[trading.briefs] send_time`. |
| `trading.exits` | 60 giây | Đối chiếu lệnh chốt lời và cắt lỗ đang treo ở sàn với sổ, và ghi các lần khớp. Lệnh thoát mà sàn phủ nhận suốt năm phút liền thì bị coi là đã mất. Chỉ chạy với sàn đã khai khóa API. |
| `trading.intents` | 5 phút | Quyết toán các lệnh mà sổ đã nắm; phần còn lại chờ `/trade reconcile`. Cùng điều kiện với `trading.exits`. |
| `trading.refresh` | sau giờ đóng cửa từng thị trường, tối đa 12 giờ | Làm mới dữ liệu cho mọi thị trường bạn còn dùng và ghi log phần suy giảm. Sau đó chụp bảng yếu tố của từng thị trường khi phiên chốt, và chấm điểm các bảng cũ đã tới cuối cửa sổ. Nó cũng ghi ảnh chụp danh mục trong ngày (giá trị, tiền mặt, tiền nạp ròng). Nếu một mã đang nắm chưa có giá thì bỏ qua ảnh chụp ngày đó và log `trading.nav_snapshot_skipped` kèm tên các mã; lỗi khác log `trading.nav_snapshot_failed`. Không gọi mô hình. |
| `trading.intraday` | các mốc giờ bạn khai | Gửi báo cáo trong phiên. **Tắt cho tới khi `[trading.intraday] send_times` nêu một mốc giờ.** |
| quét lưu giữ | 6 giờ | Xóa các dòng quá `[retention] days` / `inbox_days`, tệp tạm trong thư mục làm việc, và thư mục log của agent không còn được cấu hình. Cũng chạy một lần lúc khởi động. |
| nhịp workflow | 30 giây | Kích hoạt các workflow có cron trigger. Lượt hỏng sẽ phát lại cửa sổ của nó, nên không mất lần kích hoạt nào. |
| nhịp heartbeat | 30 giây | Quét `HEARTBEAT.md` của từng thư mục làm việc. |
| nhịp lập lịch | 30 giây | Tìm các việc theo lịch đã đến hạn. |

### Dữ liệu thị trường được làm mới khi nào

`trading.refresh` không chạy theo đồng hồ đều đặn. Nó chạy ở mốc **sớm nhất** trong:

- ngay sau khi phiên của từng thị trường đóng và bảng giá đã chốt;
- 60 phút trước giờ mở của từng thị trường, để bản tin và bảng lọc đọc dữ liệu đã làm ấm sẵn (bản
  tin sớm nhất gửi 08:15 cho giờ mở 09:00);
- chu kỳ đã cấu hình, chỉ là một cái trần.

Thị trường không bao giờ đóng cửa như crypto thì làm mới lúc sang ngày UTC. Hai mốc cách nhau dưới 60
giây thì gộp làm một lượt.

Lúc khởi động, lần làm mới đầu tiên chạy trước các phần khác, chờ tối đa 60 giây rồi hoàn tất ở chế
độ nền kèm một cảnh báo. Khởi động mà không có mạng thì vòng lặp chờ có mạng. Lần làm mới đầu mà gặp
lỗi nhà cung cấp, lưu trữ hay kênh thì chỉ là một cảnh báo (`daemon.boot_refresh_failed`), dù lỗi đến
trong 60 giây hay sau đó, và daemon vẫn khởi động; lỗi nào khác thì dừng khởi động.

Lượt nào để bất kỳ loại dữ liệu nào ở trạng thái `unavailable` (không lấy được gì) sẽ thử lại sau 2,
4, 8 và 16 phút, không bao giờ quá mốc kế tiếp. Lần hỏng thứ năm trả việc về cho mốc, và chuỗi thử
lại bắt đầu lại. Lượt chỉ thiếu một phần (`partial`) thì chờ mốc kế tiếp; các mã bị sót được vá lại
theo thời gian chờ riêng.

Mỗi lượt ghi một dòng log `trading.market_data_refreshed` cho biết từng thị trường mất bao lâu. Thị
trường tải nhiều loại dữ liệu còn ghi thời gian của từng loại, nên một lượt chậm tự chỉ ra chỗ chậm.

### Bạn chỉnh được gì

Một nhịp: `[trading.refresh] interval_ms`, mặc định là trần 12 giờ ở trên. Thời hạn lưu giữ là
`days` và `inbox_days` trong `[retention]`. Mọi thứ khác là cố định. Khóa và giá trị mặc định ở
[Cấu hình](cau-hinh.md#trading). Mỗi lượt xử lý 50 dòng, riêng `trading.macro-extract` là 3 vì mỗi
mục ở đó là một lời gọi mô hình. Đổi gì ở đây cũng cần khởi động lại daemon.

### Khi một lượt chạy báo lỗi

| Lỗi | Kết quả |
| --- | --- |
| Lỗi lưu trữ, kênh hay LLM, hoặc lệnh dừng vì ngân sách/tần suất | Ghi log `trading.tick_failed` (warn) và thử lại ở lượt sau. Thế giới bên ngoài không với tới được chính là lý do có lượt sau. |
| Chưa đặt khóa của mô hình | Ghi log `trading.tick_key_missing` (warn) một lần, chỉ ghi lại sau khi có lỗi khác, và thử lại ở lượt sau. |
| Mọi lỗi khác: lỗi kiểm tra, bất biến bị phá, cấu hình sai | Vòng đó bị cách ly, các vòng khác vẫn chạy. Log `trading.loop_quarantined` (error) và bạn nhận thông báo gọi tên vòng đó bằng lời thường. Một giờ sau vòng chạy lại, tối đa ba lần; lỗi kế tiếp thì nó dừng hẳn đến khi daemon khởi động lại, và thông báo nói rõ điều này. Vòng nào chạy trọn một ngày rồi mới lỗi lại thì được cấp lại đủ ba lần. |
| Hủy | Bạn đã tắt daemon. Không phải lỗi. |
| Mất mạng (máy gập nắp tự thức dậy chạy nền) | Lượt đó bị bỏ qua, không tính là lỗi. `trading.tick_offline` (warn) ghi một lần cho mỗi đợt mất mạng, rồi kiểm tra lại mỗi phút. Không lần gửi nào bị trừ lượt thử, không nguồn nào bị ngắt; lượt quá hạn chạy ngay khi có mạng lại. |
| Lượt quét lưu giữ hỏng | Ghi log cảnh báo; lượt quét sau thử lại. |

Các vòng giao dịch khởi động sau khi khâu gửi của kênh đã gắn vào, nên cảnh báo ở lượt đầu tiên vẫn có
nơi để gửi tới.

### Khi thiếu khóa

`openalpha start` vẫn khởi động khi thiếu khóa AI, khóa tìm kiếm web, biến của máy chủ MCP, token API
hay bot token của kênh, và in mỗi mục một dòng cảnh báo (xem [Lệnh](lenh.md#daemon-và-chẩn-đoán)). Làm
mới dữ liệu, cảnh báo giá, sổ giao dịch và mọi vòng không cần AI vẫn chạy. Việc cần mô hình thì chờ:
vòng đọc số liệu vĩ mô ghi `trading.tick_key_missing` (warn) một lần rồi vẫn thử ở mỗi lượt; bản tin sáng
vẫn gửi các mục không cần AI, còn hôm nào không dựng được thì bạn nhận một tin nêu tên biến và cách đặt;
một công việc theo lịch cần AI thì bỏ qua lượt đó mà không tính là lỗi, nên không bao giờ bị tắt vì thiếu
khóa. `status` liệt kê những gì đang chờ khóa. Đặt khóa rồi `restart` là mọi thứ chạy lại.

---

## Việc theo lịch

Bộ lập lịch rà việc đến hạn mỗi 30 giây, khởi động tối đa 5 việc mỗi lần rà và chạy đồng thời tối đa
50 việc. `[schedule]` có `approval_timeout_ms` và `failure_target`; giá trị mặc định và ý nghĩa ở
[Cấu hình](cau-hinh.md#schedule).

### Quản lý

```bash
openalpha schedule add morning-brief \
  --prompt "Prepare the morning market brief" \
  --cron "0 9 * * 1-5" --tz Asia/Ho_Chi_Minh --to telegram:-1001234567

openalpha schedule add scanner --agent chat \
  --prompt "Scan news for macro risk" --every 2h --allow-tools research

openalpha schedule list | show <id> | pause <id> | resume <id> | run-now <id> | remove <id>
```

`--agent` mặc định là `chat`. Muốn chạy theo chu kỳ thì dùng `--every 30m` thay cho `--cron`.
`schedule edit` đổi được prompt, lịch, múi giờ hay đích gửi; muốn đổi agent thì xóa rồi thêm lại.

`--allow-tools` giới hạn việc đó vào những công cụ có ở **cả hai** danh sách: công cụ agent được phép
và công cụ của việc. `schedule show` in tập hiệu lực kèm `(restricted)` hoặc `(all)`.

Cron nhận năm trường, hỗ trợ ký tự đại diện, khoảng, bước (`*/15`, `1-5/2`) và danh sách ngăn bằng dấu
phẩy. Khi cả ngày-trong-tháng lẫn thứ-trong-tuần đều bị giới hạn, khớp **một trong hai** là đủ; trường
ngày bắt đầu bằng `*` (như `*/2`) được coi là không giới hạn, nên phải khớp cùng trường kia. Cron dùng
múi giờ IANA (`--tz`, mặc định lấy múi giờ đã cấu hình); chạy theo chu kỳ thì không.

Khi đồng hồ đổi giờ, việc ghim vào giờ cụ thể (không có `*` ở trường phút hay giờ) chạy một lần trong
giờ bị lặp lại, và chạy ở phút đầu tiên còn tồn tại sau giờ bị nhảy qua. Việc có `*` ở một trong hai
trường thì cứ chạy theo đồng hồ.

### Một lần chạy cư xử thế nào

- Một việc không bao giờ chạy hai lần cùng lúc, và không chạy hai lần cho cùng một mốc đã lên lịch.
- `run-now` ghi lại một lần chạy nhưng không đẩy lịch tới và không chạm vào bộ đếm lỗi. Nó bị từ chối
  khi một lần chạy theo lịch của cùng việc vẫn đang chạy, dù gọi từ CLI hay từ daemon.
- Lần chạy chết giữa chừng (ví dụ daemon bị kill) được đóng lại ở trạng thái hỏng và lịch đi tiếp,
  không chạy lại lần đã tiêu. Việc chạy một lần không có lần kế tiếp, nên một lần mất được tính là lỗi:
  nó đến hạn lại sau khoảng chờ thử lại bên dưới, và bị tắt kèm thông báo ở lần thứ ba.

### Thử lại và gửi đi

Việc cron hay theo chu kỳ chạy thành công thì lần kế tiếp tính từ lúc nó xong; việc chạy một lần thì
tự tắt. Lần chạy hỏng được thử lại với khoảng chờ tăng gấp đôi, `60 giây x 2^(số lần hỏng - 1)`, tối
đa 30 phút: một phút sau lần hỏng đầu, hai phút sau lần thứ hai, rồi **tắt hẳn ở lần hỏng liên tiếp
thứ ba**. Một lần thành công đặt lại bộ đếm.

Thiếu khóa cũng không tính: một lần chạy hỏng vì biến môi trường của khóa AI chưa đặt được bỏ qua kèm một
cảnh báo trong nhật ký, việc vẫn bật và chạy lại ở lần tới, nên đặt khóa rồi `restart` là xong, không cần
`schedule resume`. Bản tin sáng cũng vậy: hôm đó bạn nhận một tin nói thiếu biến nào và cách đặt, thay cho
câu "gửi không được sau nhiều lần thử".

Tắt máy không bao giờ tính vào việc tự tắt. Việc chạy một lần bị cắt ngang vì tắt máy vẫn đến hạn và
chạy ở lần khởi động sau. Còn phê duyệt bị từ chối hay quá hạn thì việc vẫn kết thúc, vì chạy lại chỉ
lặp lại câu hỏi. Sau khi khởi động lại, những lần chạy còn đang đánh dấu là chạy sẽ chuyển thành hỏng
với lý do daemon khởi động lại.

Việc gửi diễn ra sau khi lần chạy tốn tiền đã xong, nên gửi hỏng không biến lần chạy thành thất bại và
không kích hoạt thêm một lần chạy tốn tiền. Việc không có `--to` thì dùng đích mặc định nếu có, nếu
không thì đầu ra bị bỏ kèm một cảnh báo. Thông báo tự tắt đi tới `failure_target`, không tới đích của
chính việc đó (có thể đang hỏng).

### Phê duyệt

Việc có đích là kênh thì hỏi được kênh đó và chờ tối đa `approval_timeout_ms`. Việc không có đích thì
không có ai duyệt, nên công cụ cần phê duyệt đơn giản là không dùng được. Bị từ chối thì lần chạy kết
thúc và không thử lại hành động bị từ chối. Quyết định chỉ có hiệu lực trong việc đó, không bao giờ
được dùng lại như trạng thái của phiên chat.

### Hành vi khi hỏng

| Điều kiện | Kết quả |
| --- | --- |
| Số việc đến hạn nhiều hơn sức chứa | Phần còn lại vẫn đến hạn, chờ lượt rà sau |
| Lần chạy agent hỏng | Được ghi lại; áp chính sách thử lại |
| Gửi hỏng sau khi chạy thành công | Lần chạy vẫn là thành công; lỗi gửi được ghi lại |
| Lần hỏng liên tiếp thứ ba | Việc bị tắt; thông báo tùy chọn được gửi |
| Một lần chạy vẫn đang diễn ra | Lượt rà này bỏ qua; lịch không đổi |
| Bộ thực thi của lần chạy đã biến mất | Đóng lại ở trạng thái hỏng; lịch đi tiếp |
| Daemon dừng | Ngừng nhận việc mới, việc đang chạy bị hủy, khâu tắt chờ tối đa năm giây |

---

## Heartbeat

Heartbeat là việc lặp lại thuộc về thư mục làm việc của một agent, không thuộc về một lịch. Daemon quét
`HEARTBEAT.md` của từng agent mỗi 30 giây và chạy các tác vụ đã đến hạn. Tối đa ba agent chạy cùng lúc;
trong một agent, các tác vụ chạy tuần tự. Một tác vụ không bao giờ chồng lên chính nó.

Agent tham gia mạng xã hội còn có thêm một tác vụ cho mỗi mạng, tên `social:<network>`, do runtime
thêm vào chứ không viết trong tệp. Nó chạy cả khi không có `HEARTBEAT.md`, không nhận ngữ cảnh dùng
chung của tệp, và có nhịp cùng khung giờ hoạt động riêng. Xem
[mạng xã hội](mang-xa-hoi.md#một-lượt-ghé-diễn-ra-thế-nào). Tác vụ của agent đang tạm dừng được bỏ
qua, không tính là thất bại; lượt chạy bị cắt ngang vì tắt máy cũng vậy: tác vụ vẫn đến hạn và chạy lại ở lần khởi động sau.

### Tệp

Mọi thứ nằm trên `tasks:` là ngữ cảnh dùng chung, được thêm vào prompt của mọi tác vụ. Tệp không có
dấu `tasks:` sẽ thành một tác vụ chạy mỗi giờ, lấy cả tệp làm prompt.

```yaml
Review this context before each task.

tasks:
  - name: market-news
    interval: 1h
    prompt: Check for material market news.
    deliver: telegram:123
    session: isolated
    duplicate_window: 24h
```

| Trường | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `name` | có | Duy nhất trong tệp, tối đa 128 ký tự |
| `interval` | có | Tối thiểu `60s` |
| `prompt` | có | Phần chỉ dẫn |
| `deliver` | không | Các đích `channel:chatId`, phân cách bằng dấu phẩy |
| `session` | không | `shared` (mặc định) tiếp tục một cuộc hội thoại; `isolated` bắt đầu mới mỗi lượt |
| `duplicate_window` | không | Chặn thông báo lặp trong cửa sổ này, từ `1m` tới `30d` |

Một tệp tối đa 65.536 byte và 20 tác vụ. Dòng `session` hay `duplicate_window` mà giá trị rỗng hoặc
không hợp lệ thì **cả tác vụ bị bỏ**, không lặng lẽ quay về mặc định.

### Một lần chạy làm được gì

Cuối mỗi lần chạy, agent hoặc im lặng, hoặc gửi bạn một bản tóm tắt. Nó cũng có thể xin xem lại một
việc ở lần đến hạn kế tiếp của chính tác vụ đó (một cam kết): tối đa 5 cam kết mỗi lần, mỗi cam kết
dài tối đa 500 ký tự, đến hạn sau một phút tới ba mươi ngày. Phản hồi sai định dạng thì không gửi gì
và không tạo cam kết nào, nhưng lần chạy vẫn tính là xong, nên một mô hình cứ trả lời sai không bị thử
lại mỗi 30 giây. Nội dung cam kết quay lại agent dưới dạng ngữ cảnh không đáng tin: nó không ghi đè
được tác vụ hay các quy tắc. Định dạng phản hồi và quy tắc lưu: [Bên trong](dev/van-hanh.md#giao-thức-phản-hồi).

### Chặn trùng

`duplicate_window` chặn một thông báo lặp lại đúng nội dung tới đúng đích đó trong cửa sổ. Nó chỉ làm
hết sức và chỉ nằm trong bộ nhớ, trong một danh sách giới hạn 200 mục, nên khởi động lại hay danh sách
đầy đều làm nó quên mục cũ, và một thông báo trùng có thể quay lại. Thông báo bị từ chối không bao giờ
được nhớ, nên lần chạy đủ điều kiện kế tiếp sẽ thử lại.

### Khoảng chờ tăng dần

Lần chạy không bao giờ xong (bị hủy, lỗi hay bị dừng) làm lần chạy kế tiếp của tác vụ bị hoãn thêm
`60 giây x 2^(số lần hỏng - 1)`, tối đa 30 phút - cùng khoảng chờ với việc theo lịch. Một lần chạy
xong xóa nó. Cùng khoảng chờ áp dụng cho lần chạy đã xong nhưng không lưu được kết quả (lỗi lưu trữ) và lần
chạy ném lỗi: cả hai không được lặp lại mỗi 30 giây. Tác vụ đang chờ đơn giản là không được chọn: nó không bao giờ bị tắt, và không có gì
được gửi đi trong lúc chờ.

### Hành vi khi hỏng

| Điều kiện | Kết quả |
| --- | --- |
| Tệp không đọc được hoặc quá cỡ | Không chạy |
| Tác vụ sai định dạng hoặc chưa tới hạn | Bỏ hoặc bỏ qua |
| Engine hủy hoặc lỗi | Không thông báo; bộ đếm lỗi tăng và lần chạy kế tiếp bị hoãn |
| Không lưu được kết quả | Lần chạy tính là hỏng: bộ đếm lỗi tăng và lần chạy kế tiếp bị hoãn |
| Phản hồi không hợp lệ | Vẫn tính là xong; không gửi gì |
| Đích gửi không hợp lệ | Cảnh báo; các đích khác vẫn tiếp tục |
| Bộ thông báo từ chối một đích | Cảnh báo; thông báo đó không được nhớ |
| Chạm trần cam kết | Giữ các cam kết hiện có; số lượng được ghi log |

## Khi không ghi được tệp log

Đĩa đầy hay hỏng không làm daemon câm mãi mãi. Sau năm lần ghi liên tiếp thất bại, việc ghi log ra tệp
tạm dừng 30 giây (một dòng trên stderr báo điều đó) rồi thử lại bằng một đoạn mới; khi một lần ghi
thành công trở lại, một dòng stderr khác báo đã phục hồi. Bản ghi đến trong lúc tạm dừng bị bỏ, và dòng
log `fatal` của một lần sập được ghi ra terminal thay vào đó.

## Chạy API trên máy chủ

Chạy daemon trên máy chủ của bạn rồi cho một ứng dụng khách nối vào.

1. **Cài đặt.** Trên Linux hoặc macOS, chạy script cài đặt trong
   [README](../README.md#bắt-đầu-nhanh) với `OPENALPHA_NO_ONBOARD=1`. Lệnh được cài nằm ở đường
   dẫn mà `command -v openalpha` in ra (mặc định `~/.local/bin/openalpha`); unit bên dưới phải dùng
   đường dẫn đó.
2. **Cấu hình.** `openalpha setup write <nhà cung cấp> <mô hình>` ghi `~/.openalpha/config.toml` với
   `[api] enabled = true` và một mô hình (`openalpha setup catalog` liệt kê các nhà cung cấp). Hoặc
   tải [config.sample.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.sample.toml)
   vào đó rồi tự đặt `[api] enabled = true` và chuỗi mô hình. Mỗi mô hình ghi tên biến môi trường chứa
   khóa của nó (`api_key_env`); đặt biến đó trên máy chủ.
3. **Giữ cho chạy liên tục.** Một unit systemd cho người dùng, khóa nằm trong `~/.openalpha/env` (mỗi
   dòng một `TÊN=giá-trị`, quyền 0600):

   ```ini
   [Unit]
   Description=OpenAlpha
   After=network-online.target

   [Service]
   ExecStart=%h/.local/bin/openalpha start
   EnvironmentFile=%h/.openalpha/env
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Chạy `systemctl --user enable --now openalpha`, rồi `loginctl enable-linger $USER` để nó vẫn chạy
   khi bạn đăng xuất. Để nâng cấp, chạy `systemctl --user stop openalpha && openalpha upgrade && systemctl --user start openalpha`:
   daemon do dịch vụ quản lý thì `upgrade` không tự khởi động lại.
4. **Lấy mã API.** `openalpha api token` in mã ra (mã được tạo ở lần chạy đầu).
5. **Nối vào.** API chỉ nghe trên `127.0.0.1` của máy chủ. Chọn một cách:
   - **Đường hầm SSH**, không cần tên miền: `ssh -N -L 18765:127.0.0.1:8765 user@server`, rồi dùng
     địa chỉ `http://127.0.0.1:18765`. Dùng cổng khác 8765 ở máy bạn để không đụng daemon đang chạy
     trên chính máy đó.
   - **HTTPS qua Caddy** trên máy chủ: `alpha.example.com { reverse_proxy 127.0.0.1:8765 }`, rồi dùng
     `https://alpha.example.com`. Khi đó mọi yêu cầu đều đến từ `127.0.0.1`, nên năm lần sai mã sẽ khóa
     mọi máy gửi mã sai trong 30 giây, tăng gấp đôi mỗi lần, tối đa một giờ. Yêu cầu mang đúng mã không
     bao giờ bị khóa chặn và còn xóa khóa đó.
6. **Nối ứng dụng khách.** Nhập địa chỉ và mã API; mọi yêu cầu gửi kèm mã dưới dạng
   `Authorization: Bearer <mã>`. Tối đa 8 luồng ứng dụng (`/v1/ws`) mở cùng lúc; lần bắt tay thứ chín bị từ
   chối với 503 `too_many_streams`.

Khi daemon dừng, API ngừng nhận kết nối và yêu cầu trước tiên, trước khi các lượt chạy được chờ xong; yêu
cầu đang chạy vẫn hoàn tất. Chat hay lệnh gửi qua một luồng đang mở được trả lời bằng lỗi `unavailable`,
lượt chạy đang diễn ra vẫn hoàn tất trong khoảng chờ, và các luồng đóng sau đó.

Bên trong: [dev/van-hanh.md](dev/van-hanh.md).

Xem thêm [an toàn và phê duyệt](an-toan.md), [ngân sách](ngan-sach.md), [giao dịch](giao-dich.md),
cùng các tham chiếu [`config.toml`](cau-hinh.md) và [lệnh](lenh.md).
