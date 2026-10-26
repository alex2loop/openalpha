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
| `trading.macro-extract` | 12 giờ | Đọc báo cáo của cơ quan thống kê Việt Nam cùng báo chí tương ứng vào các chuỗi vĩ mô đã lưu, ưu tiên tháng mới chưa đọc, lùi tối đa 24 tháng. Mỗi lượt tối đa 3 báo cáo và 3 bài báo. Tháng chưa công bố tốn một lượt gọi mạng, không tốn lượt gọi mô hình. Tài liệu mô hình không đọc được thì được đánh dấu đã đọc và không giữ số nào, để không tốn tiền đọc lại. |
| `trading.theme-outcomes` | 12 giờ | Đo các nhận định cổ phiếu của `/themes` đã tới mốc 3, 6 hay 12 tháng so với VN-Index. Không gọi mô hình. |
| `trading.briefs` | 60 giây | Gửi các bản tin sáng đã đến hạn. Đây chỉ là nhịp kiểm tra; giờ gửi thật là `[trading.briefs] send_time`. |
| `trading.exits` | 60 giây | Đối chiếu lệnh chốt lời và cắt lỗ đang treo ở sàn với sổ, và ghi các lần khớp. Lệnh thoát mà sàn phủ nhận suốt năm phút liền thì bị coi là đã mất. Chỉ chạy với sàn đã khai khóa API. |
| `trading.intents` | 5 phút | Quyết toán các lệnh mà sổ đã nắm; phần còn lại chờ `/trade reconcile`. Cùng điều kiện với `trading.exits`. |
| `trading.refresh` | sau giờ đóng cửa từng thị trường, tối đa 12 giờ | Làm mới dữ liệu cho mọi thị trường bạn còn dùng và ghi log phần suy giảm. Sau đó chụp bảng yếu tố của từng thị trường khi phiên chốt, và chấm điểm các bảng cũ đã tới cuối cửa sổ. Nó cũng ghi ảnh chụp danh mục trong ngày (giá trị, tiền mặt, tiền nạp ròng). Nếu một mã đang nắm chưa có giá thì bỏ qua ảnh chụp ngày đó và log `trading.nav_snapshot_skipped` kèm tên các mã; lỗi khác log `trading.nav_snapshot_failed`. Không gọi mô hình. |
| `trading.intraday` | các mốc giờ bạn khai | Gửi báo cáo trong phiên. **Tắt cho tới khi `[trading.intraday] send_times` nêu một mốc giờ.** |
| quét lưu giữ | 6 giờ | Xóa các dòng quá `[retention] days` / `inbox_days`, tệp tạm trong thư mục làm việc, và thư mục log của agent không còn được cấu hình. Sao lưu SQLite hằng ngày vào `backups/daily/` khi bản mới nhất đã gần một ngày tuổi (`daily_backups`; bỏ qua PostgreSQL). Cũng chạy một lần lúc khởi động. |
| nhịp workflow | 30 giây | Kích hoạt các workflow có cron trigger. Lượt hỏng sẽ phát lại cửa sổ của nó, nên không mất lần kích hoạt nào. |
| nhịp heartbeat | 30 giây | Quét `HEARTBEAT.md` của từng thư mục làm việc. |
| nhịp lập lịch | 30 giây | Tìm các việc theo lịch đã đến hạn. |

Khi API bật, ứng dụng liệt kê các vòng này, cùng vòng nào plugin thêm, thành một bảng việc daemon đang làm ngầm: tên
vòng bằng lời thường, bao lâu chạy một lần nếu nó có nhịp cố định, lần chạy gần nhất bắt đầu lúc nào, lỗi cuối cùng
nếu lần đó hỏng (lần chạy tốt kế tiếp xóa lỗi), lần chạy tới là khi nào và nó có đang làm việc không. Bản tin sáng
và báo cáo trong ngày cho biết khi nào đến hạn lần kế. Bảng này nằm trong bộ nhớ, nên sau khi khởi động lại mỗi vòng
chưa hiện gì cho đến lượt chạy kế tiếp của nó.

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
mới dữ liệu, cảnh báo giá, sổ lệnh và mọi vòng không cần AI vẫn chạy. Việc cần mô hình thì chờ:
vòng đọc số liệu vĩ mô ghi `trading.tick_key_missing` (warn) một lần rồi vẫn thử ở mỗi lượt; bản tin sáng
vẫn gửi các mục không cần AI, còn hôm nào không dựng được thì bạn nhận một tin nêu tên biến và cách đặt;
một công việc theo lịch cần AI thì bỏ qua lượt đó mà không tính là lỗi, nên không bao giờ bị tắt vì thiếu
khóa. `status` liệt kê những gì đang chờ khóa. Lưu khóa bằng `openalpha key set <NAME>` rồi `restart --background` là mọi thứ chạy lại.

### Khi daemon dừng hoặc lỡ bản tin

Daemon chết mà chưa dừng đàng hoàng (sập, `kill -9`, mất điện) để lại tệp pid, và `status` khi đó in
`daemon: đã dừng đột ngột (khởi động lúc <giờ>)` kèm gợi ý xem `openalpha logs`, thay vì dòng "chưa chạy"
trơn. Lần khởi động kế tiếp cũng nhắn chat của bạn một lần, nói cảnh báo và bản tin đã tạm ngưng tới giờ.
Nếu bản tin không gửi được trước giờ mở cửa (daemon tắt, hoặc mọi lần gửi đều hỏng), bản tin hôm đó bị
bỏ và chat nhận một dòng báo điều này; bản tin sau vẫn theo lịch. Bản tin bắt đầu dựng trước giờ mở cửa
nhưng xong sau đó vẫn được gửi, kèm một dòng đầu báo giá đã chạy từ lúc viết.

Kênh chat mất kết nối lâu cũng được báo. Cứ năm phút daemon xem từng kênh một lần, kênh nào mất kết nối đã 15
phút thì được báo đúng một lần, trên một kênh khác đang chạy, kèm lý do: token bot bị từ chối, đăng nhập Zalo hết
hạn, tài khoản đang mở ở nơi khác, hoặc kết nối liên tục bị ngắt. Có lại thì bạn nhận một dòng "đã kết nối lại".
`status` ghi kênh đó là `mất kết nối: <lý do>` trong lúc ấy. Không có kênh nào khác để báo thì chỉ ghi log
(`channel.watch_no_route`). Khởi động lại thì quên hết, nên kênh còn mất kết nối sau đó sẽ được báo thêm một lần.

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

Một việc có thể chờ một cảnh báo thay vì chờ giờ; gọi đó là việc theo sự kiện. Trang văn phòng tạo loại này: việc chạy khi mã bạn đang
giữ thủng mức cắt lỗ hoặc chạm mức chốt lời, khi một mã biến động mạnh trong phiên, hay khi giá bạn
đặt được chạm. Việc chạy tối đa một lần mỗi khoảng chờ, quãng nghỉ mà việc mang theo để một mã ồn ào không kích nó chạy liên tục, và vẫn bật sau khi chạy,
trừ việc theo giá: một lần chạm là hết. `schedule list` ghi nó là `khi FPT chạm mức giá bạn đặt`
thay cho giờ, `schedule edit` không đặt giờ cho nó được, `schedule remove` gỡ luôn cảnh báo giá nó
đã đặt, còn `schedule resume` từ chối việc theo giá mà cảnh báo đã chạm. Một lần chạy hỏng của việc theo sự kiện không tính vào việc tự tắt, nên việc cứ hỏng mãi vẫn bật và báo lỗi ở mỗi lần cảnh báo chạm, tối đa một lần mỗi khoảng chờ.

Cron nhận năm trường, hỗ trợ ký tự đại diện, khoảng, bước (`*/15`, `1-5/2`) và danh sách ngăn bằng dấu
phẩy. Khi cả ngày-trong-tháng lẫn thứ-trong-tuần đều bị giới hạn, khớp **một trong hai** là đủ; trường
ngày bắt đầu bằng `*` (như `*/2`) được coi là không giới hạn, nên phải khớp cùng trường kia. Cron dùng
múi giờ IANA (`--tz`, mặc định lấy múi giờ đã cấu hình); chạy theo chu kỳ thì không.

Khi đồng hồ đổi giờ, việc ghim vào giờ cụ thể (không có `*` ở trường phút hay giờ) chạy một lần trong
giờ bị lặp lại, và chạy ở phút đầu tiên còn tồn tại sau giờ bị nhảy qua. Việc có `*` ở một trong hai
trường thì cứ chạy theo đồng hồ.

### Một lần chạy cư xử thế nào

- Một việc không bao giờ chạy hai lần cùng lúc, và không chạy hai lần cho cùng một mốc đã lên lịch.
- `run-now` ghi lại một lần chạy nhưng không đẩy lịch tới và không chạm vào bộ đếm lỗi. Ngoại lệ duy nhất là việc chạy một lần: `run-now` thành công chính là lần chạy của nó, nên sau đó việc ấy xong và bị tắt. Nó bị từ chối
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
cảnh báo trong nhật ký, việc vẫn bật và chạy lại ở lần tới, nên lưu khóa bằng `openalpha key set <NAME>` rồi `restart --background` là xong, không cần
`schedule resume`. Bản tin sáng cũng vậy: hôm đó bạn nhận một tin nói thiếu biến nào và cách đặt, thay cho
câu "gửi không được sau nhiều lần thử".

Hết ngân sách cũng không tính. Khi hạn mức ngày, tháng hay hạn mức riêng của agent chặn một lần chạy,
việc nhảy sang lần kế tiếp theo lịch, còn việc chạy một lần thì được hỏi lại sau 30 phút. Lần chạy bị
giới hạn tần suất chặn cũng được hỏi lại sau 30 phút. Nhờ vậy một ngày tiêu nhiều không làm việc tắt hẳn.

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

## Tự chạy khi đăng nhập

Trên máy để bàn, `openalpha autostart enable` đăng ký `start --background` chạy mỗi lần đăng nhập, nên bản
tin sáng và cảnh báo vẫn đến sau khi khởi động lại máy: một launchd agent trên macOS, một unit người dùng
của systemd trên Linux (trên máy chủ không ai đăng nhập, chạy thêm `loginctl enable-linger $USER`) và một
mục trong khóa Run trên Windows. `openalpha autostart` cho biết đã bật chưa, và `autostart disable` gỡ nó
(daemon đang chạy vẫn tiếp tục). Lệnh cần bản cài đặt, không dùng được với bản chạy từ mã nguồn, và có hiệu
lực từ lần đăng nhập tới. Lần chạy lúc đăng nhập không thấy biến chỉ export trong shell, nên hãy lưu khóa
bằng `openalpha key set`; `enable` nêu tên những khóa nó thấy còn thiếu. Unit nó ghi tên là
`openalpha-autostart`, tách khỏi dịch vụ viết tay bên dưới, vốn vẫn là cách chạy một máy chủ API.

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
   # Tùy chọn: daemon cũng tự đọc khóa lưu bằng `openalpha key set` trong ~/.openalpha/env.
   EnvironmentFile=-%h/.openalpha/env
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Chạy `systemctl --user enable --now openalpha`, rồi `loginctl enable-linger $USER` để nó vẫn chạy
   khi bạn đăng xuất. Để nâng cấp, chạy `systemctl --user stop openalpha; openalpha upgrade; systemctl --user start openalpha`:
   daemon do dịch vụ quản lý thì `upgrade` không tự khởi động lại.
4. **Lấy mã API.** `openalpha api token` in mã ra (mã được tạo ở lần chạy đầu). `openalpha api link` in liên kết
   mở trang văn phòng với mã đã nằm sẵn trong đó; giữ kín như giữ mã.
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

Khi đã nối, trang văn phòng được cho thấy daemon đang làm gì ngay lúc nó diễn ra: từng câu trả lời và câu lệnh chạy
lâu đang chạy cùng bước mới nhất của nó, mọi yêu cầu phê duyệt và câu hỏi còn chờ trên bất kỳ kênh nào, một
lần khớp lệnh (lệnh cắt lỗ hoặc chốt lời đang treo được bán, hoặc một lần khớp của `/trade`), từng công cụ mà một phiên chạy bắt đầu và kết thúc, lời của từng vai trong cuộc tranh biện sau khi một `/suggest` được kiểm chứng (chỉ hiện trong trang văn phòng, không bao giờ gửi tới chat), một agent mới gia nhập, lúc chạm hạn mức chi tiêu, và lần cuối kiểm tra cảnh
báo. Những tin này vào chuông mà không tới chat nào trừ khi `[notices] chat` liệt kê: một đề xuất đã có kết quả, tin về mã bạn đang giữ, và chỉ số giảm mạnh trong phiên. Tin về mã đang giữ chỉ gồm những mã daemon đã đọc, vì không có gì đi lấy tin cho các mã bạn giữ theo lịch. Trang văn phòng nối muộn thì hỏi bức tranh hiện tại trước, rồi theo dõi luồng. Yêu cầu hỏi trên Telegram hay kênh
khác vẫn hiện trong trang văn phòng nhưng được trả lời ở nơi nó được hỏi; trang văn phòng nói rõ điều đó thay vì trả lời hộ. Trang văn phòng dừng được mọi phiên chạy bạn thấy, kể cả phiên bắt đầu từ Telegram: dừng chỉ là báo cho nó dừng, và nó kết thúc ở trạng thái đã dừng, dù là một câu trả lời đang chạy hay một câu lệnh. Phiên chạy đã xong thì được báo là không còn nữa. Trang văn phòng cũng liệt kê các chat đã ghép nối trên từng kênh và bỏ ghép nối được một chat, kết quả giống `pair revoke`: tin kế tiếp của chat đó lại bị hỏi mã ghép nối.

Trang văn phòng còn đọc được những gì daemon biết mà không cần câu lệnh nào: lịch sử mọi cuộc chat, kể cả Telegram, tìm kiếm được nhưng chỉ nói tiếp được ở những chat do chính trang văn phòng mở; từng nguồn dữ liệu và lần gần nhất nó trả lời; các máy chủ daemon có thể gọi tới và thứ gì được gửi tới từng nơi; các mô hình đang dùng cùng giá và chi phí thường lệ của một phiên chạy trên mỗi mô hình; sức mạnh ngành theo thị trường; và danh sách theo dõi của bạn, mà trang văn phòng sửa được.

Khi daemon dừng, API ngừng nhận kết nối và yêu cầu trước tiên, trước khi các lượt chạy được chờ xong; yêu
cầu đang chạy vẫn hoàn tất. Chat hay lệnh gửi qua một luồng đang mở được trả lời bằng lỗi `unavailable`,
lượt chạy đang diễn ra vẫn hoàn tất trong khoảng chờ, và các luồng đóng sau đó.

Trang văn phòng cũng khởi động lại được một daemon đã bật bằng `--background`: chọn khởi động lại khi không còn gì đang chạy (chờ tối đa khoảng hai phút, hết hạn thì vẫn khởi động lại) hoặc ngay lập tức. Daemon dừng theo cách thông thường, nên yêu cầu phê duyệt còn chờ bị từ chối và lượt chạy nào không xong trong khoảng ân hạn lúc dừng thì bị ngắt; trang văn phòng báo các yêu cầu phê duyệt đó trước. Khi daemon chạy lại, chuông hiện "Đã khởi động lại daemon." và không có gì gửi tới chat. Nếu một lần khởi động lại đã được nhận mà thất bại, daemon vẫn chạy như cũ và chuông báo điều đó, kèm chỉ dẫn xem nhật ký restart trong thư mục dữ liệu. Daemon chạy trong cửa sổ terminal hoặc do một dịch vụ quản lý thì trang văn phòng không khởi động lại thay bạn được: dừng bằng Ctrl+C hoặc trình quản lý dịch vụ rồi bật lại. Đang có một lần khởi động lại hoặc cập nhật, hay daemon đang dừng, thì yêu cầu mới bị từ chối.

## Trang văn phòng

Khi API bật, daemon còn phục vụ một trang web ngay tại địa chỉ của nó, `http://127.0.0.1:<cổng>/` (cổng 8765 nếu bạn không đổi). Cứ hình dung đó là một bức tường kính nhìn vào daemon: một văn phòng nhỏ nơi trợ lý, nhóm nghiên cứu và các agent của bạn làm việc cùng lúc với daemon. Mọi chuyển động bạn thấy đều là một phiên chạy, một bước hay một câu hỏi đang chờ bạn có thật; không có gì được dựng sẵn cho có vẻ bận rộn. Trang không bao giờ đặt lệnh và không tự khởi động một phiên chạy AI nào. Một nút hoặc mở ra một thứ gì đó, hoặc điền chữ vào ô câu lệnh để bạn đọc rồi tự gửi.

### Mở trang

`openalpha api link` in ra một liên kết đã kèm sẵn mã truy cập. Mở nó ngay trên máy chạy daemon, hoặc qua đường hầm SSH hay địa chỉ HTTPS ở mục [Chạy API trên máy chủ](#chạy-api-trên-máy-chủ). Không có liên kết thì trang hỏi mã truy cập (`openalpha api token`) và hỏi bạn có muốn nhớ lại không.

- Trang lấy mã ra khỏi địa chỉ ngay khi tải, nên mã không nằm lại trên thanh địa chỉ hay trong lịch sử.
- Mã mở từ liên kết chỉ sống trong thẻ đó và mất khi bạn đóng thẻ. Dán mã vào ô đăng nhập cũng giữ cho thẻ đó, còn "Nhớ trên trình duyệt này" (mặc định đã tick) giữ thêm trong trình duyệt này, để lần sau khỏi đăng nhập. Đăng xuất, trong Cài đặt > Hiển thị, xóa cả hai.
- Trang không bao giờ in mã ra, không ghi mã vào nhật ký và chỉ gửi mã cho daemon. Trang từ chối chạy bên trong một khung (frame).
- Nếu không nối được daemon, trang nói thẳng bằng một dòng. Nếu đang đăng nhập mà mất kết nối, một thanh hiện đồng hồ đếm lùi lần thử lại, nút "Thử ngay" và dòng báo các phiên chạy vẫn tiếp tục ở daemon. Khi nối lại, trang hỏi lại bức tranh hiện tại rồi theo dõi tiếp. Trang cũ hơn daemon thì nhắc bạn tải lại. Khối nào làm mới không được vẫn giữ số liệu tốt gần nhất và ghi rõ lúc nào đọc.

### Trên màn hình có gì

- **Đầu trang.** Chip việc đang chạy (cái gì đang chạy và cái gì tiếp theo: dừng một phiên chạy, hoặc chạy lại một việc theo lịch), nút Tập trung (ẩn văn phòng, chỉ còn thông tin), chip chi phí AI, đồng hồ văn phòng, chuông thông báo và Cài đặt.
- **Dải giá.** Ngay dưới đầu trang, danh sách theo dõi và các mã bạn đang giữ chạy ngang qua. Mã thủng cắt lỗ và đề xuất mua mới được đánh dấu.
- **Văn phòng.** Khung cảnh bên trái, mô tả ở dưới.
- **Bảng thông tin.** Ba thẻ. *Hôm nay* mở đầu bằng những gì cần bạn (việc chờ duyệt, mã thủng cắt lỗ), rồi tới những gì đáng xem, thị trường Việt Nam và các thị trường khác, sự kiện sắp tới, tin nổi bật, và hôm nay agent đã làm gì, gồm cả việc chạy khi bạn không mở trang. *Danh mục* gồm tổng quan, hiệu quả, lịch sử, cân bằng lại và danh sách theo dõi cùng cảnh báo giá; giao dịch được ghi, sửa, xóa ngay tại đây và có hoàn tác. *Đề xuất* gồm các kế hoạch đang mở, màn hình cơ hội, thành tích và kết quả nghiên cứu, kèm số đề xuất mới bạn chưa xem. Bấm một mã ở bất cứ đâu thì thẻ của mã đó mở ra: giá và các mức của kế hoạch, mã bạn đang giữ, "Vì sao?" để xem lý lẽ sau một đề xuất, các đề xuất trước đây và các agent của bạn nghĩ gì. Bấm một agent của bạn trong văn phòng thì thẻ của nó mở ra (xem [Agent](tro-ly.md#từ-trang-văn-phòng)). Hàng quay lại đưa bạn về chỗ vừa xem, và bảng thu gọn được thành một dải biểu tượng.
- **Trò chuyện.** Cuộc trò chuyện với trợ lý, nằm bên phải. Các phiên chat trước, kể cả của Telegram, tìm được và chỉ đọc; chỉ những cuộc chat do trang mở mới nói tiếp được.
- **Ô câu lệnh.** Ở cuối trang: ai nhận câu bạn gõ, ô nhập và nút Gửi. Xem [Lệnh](lenh.md#ô-câu-lệnh-trên-trang-văn-phòng).
- **Chuông và việc đang chạy.** Chuông liệt kê thông báo và các yêu cầu đang chờ bạn. Yêu cầu duyệt hỏi từ trang này được trả lời ngay trong chuông: duyệt một lần, ghi nhớ hoặc từ chối. Đồng hồ đếm lùi cho biết khi nào hết hạn, và yêu cầu hết giờ mà chưa trả lời thì bị từ chối. Yêu cầu hỏi trên Telegram hay kênh khác vẫn được liệt kê nhưng trả lời ở nơi nó được hỏi. Danh sách việc cho thấy cái đang chạy (dừng được, sau một bước xác nhận), cái sắp chạy, cái đang chờ một sự kiện (kiểm tra theo chu kỳ, không tốn AI) và các việc bảo trì tự chạy, kèm cách sửa việc nào đang lỗi.
- **Chi phí.** Chip cho thấy hôm nay đã tiêu bao nhiêu so với mức trần ngày; bấm để xem cả tháng, chi phí theo từng việc và dòng ngân sách. Xem [Ngân sách](ngan-sach.md#trên-trang-văn-phòng).
- **Cài đặt.** Biểu tượng bánh răng: lịch và theo dõi, agent và AI, kênh nhắn tin, dữ liệu và kết nối, hiển thị, và ô sửa `config.toml` thô. Mỗi dòng nói rõ lưu xong có hiệu lực ngay hay cần khởi động lại; bánh răng đếm các thay đổi đang chờ khởi động lại, và trang khởi động lại được một daemon bật bằng `--background` (xem ở trên). Khóa API, mã truy cập và thông tin đăng nhập sàn không bao giờ nhập trên trang này.

### Văn phòng

Hai tầng, chuyển ở đầu khung cảnh. Tầng **Văn phòng** là đội có sẵn trong các phòng của họ: Kho dữ liệu (Thủ kho làm mới dữ liệu), Thư viện (nhóm tìm tin, lập kế hoạch, tổng hợp, rà soát và phân tích chủ đề làm nghiên cứu), Phòng họp (bàn tranh luận sau `/suggest`), Sảnh (lịch hôm nay và bản tin trong ngày), Quầy cảnh báo (người trực theo dõi cảnh báo giá và mức cắt lỗ), Phòng trợ lý và Bàn của bạn. Tầng **Agent của bạn** là tầng đội riêng: mỗi agent của bạn một bàn, kèm thẻ cho biết nó đang chạy, tạm dừng hay rảnh, lịch của nó, đề xuất gần nhất và hôm nay nó đã tiêu bao nhiêu. Chưa có agent nào thì tầng này gợi ý ba cách bắt đầu và một mẫu trống, còn bàn trống kế tiếp mang nút "+ Thêm agent".

Cách đọc khung cảnh:

- Một người chỉ di chuyển khi daemon nói vậy. Một phiên chạy bắt đầu thì đúng người đi tới đúng phòng; các bước và công cụ của nó quyết định họ làm gì ở đó; phiên chạy xong thì họ về chỗ. Phiên chạy nào trang không gắn được vào khung cảnh thì ngồi ở bàn gõ máy, kèm tên phiên chạy; trang không bao giờ bịa thêm bước.
- Dấu "!" màu hổ phách trên đầu một người nghĩa là họ mang tới cho bạn một yêu cầu duyệt; bấm vào để mở chuông. Dấu "!" đỏ trên đầu người trực cảnh báo nghĩa là một mức cắt lỗ đã bị thủng; bấm vào để mở thẻ của mã đó.
- Bong bóng thoại mang những câu có thật: việc nào cần bạn duyệt, một vai trong cuộc tranh luận vừa nói gì, một đề xuất cũ mà ai đó còn nhớ. Màn hình sáng cho thấy người tìm tin đang đọc trang nào hay giá đóng cửa mà nhà phân tích đang xem; bấm vào để xem lớn hơn.
- Các bảng cho thấy tiến độ (vòng tranh luận, câu hỏi nghiên cứu, số giá đã làm mới) và bảng đề xuất đếm các đề xuất mới. Máy in, kệ nguồn, đồng hồ và quầy cảnh báo hiện một chú thích khi bạn trỏ vào, kèm liên kết tới nơi liên quan.
- Bấm vào một chiếc đèn để bật hoặc tắt đèn phòng đó, hoặc bấm công tắc trên tường (hay nút đèn trên thanh công cụ) để bật tắt tất cả. Mặc định ánh sáng văn phòng đi theo đồng hồ văn phòng; Cài đặt > Hiển thị tắt được việc này.
- Mèo ngủ khi không có gì cần bạn, và thức dậy khi có việc cần duyệt, mã bạn giữ thủng cắt lỗ hoặc chạm chốt lời, lệnh khớp ở sàn, cảnh báo giá bạn đặt, hoặc hết ngân sách AI trong ngày. Corgi và bể cá chỉ là cảnh, không báo gì cả.
- Kéo để di chuyển, cuộn hoặc dùng nút phóng to để zoom, phím mũi tên để di chuyển, Esc hoặc "Xem cả tầng" để lùi lại. Từ góc nhìn cả tầng, bấm vào một phòng thì zoom vào phòng đó.

**Đồng hồ văn phòng.** Đồng hồ trên đầu trang cho biết giờ trong văn phòng. Bấm vào để xem văn phòng ở một giờ khác: giờ thật, hoặc một mốc có sẵn (sáng sớm, sáng, trưa, chiều, tối, đêm) ở tốc độ thường, x10 hoặc x60. Chỉ cảnh văn phòng đổi; số liệu, thông báo và giờ chạy việc vẫn theo giờ thật. Giờ thử không được lưu, nên tải lại trang là về giờ thật. Khi bạn đang giảm chuyển động, giờ thử chạy ở tốc độ thường. Khi văn phòng chạy theo giờ của một thị trường chứ không phải giờ của bạn, đồng hồ hiện cả hai.

**Bảng hiệu năng.** Thêm `?perf=1` vào địa chỉ trang để xem chi phí mỗi khung hình và tốc độ vẽ của khung cảnh so với mức cho phép. Dùng để tìm hiểu một máy chậm, không đổi gì khác.

### Đời sống văn phòng

Khi chưa ai giao việc gì, văn phòng không đứng im, nhưng cũng không giả vờ làm việc. Những người đang rảnh làm vài việc nhỏ: nghỉ trưa, cà phê buổi chiều, trò chuyện bên bình nước, chiều thứ Sáu thong thả, hoặc họp nhanh trong lúc bản tin sáng chạy. Chỉ người đang rảnh mới làm vậy. Ai mà một phiên chạy cần tới, hoặc còn nợ một lần giao hay một câu trả lời, thì bỏ dở mọi thứ và đi làm việc. Không điều nào trong đó đụng tới dữ liệu của bạn hay tốn một xu.

- Trợ lý đi một vòng các phòng sau khi rảnh một lúc ngắn, dừng ở từng cửa, và cứ ba vòng thì một vòng đi thang lên ngó bàn các agent của bạn. Có việc, câu hỏi hay yêu cầu duyệt cho nó thì vòng đi dừng ngay.
- Khi không có gì đang chạy, không có gì chờ bạn và không ai đang gõ trong một lúc lâu, văn phòng chìm vào yên lặng: màn hình tối đi, các cử động vặt dừng và trang gần như không làm gì. Trong một văn phòng yên lặng, một vòng đi chỉ diễn ra tối đa 25 phút rảnh một lần.
- Thẻ trình duyệt bạn không nhìn tới thì dừng hẳn mọi chuyển động và bắt kịp khi bạn quay lại.

### Trò chuyện với một người

Trỏ vào một người để thấy tên và một dòng trạng thái trực tiếp: họ đang chạy gì và từ đâu, đang ở bước nào, đang chờ bạn hay chờ tới lượt, hay đang rảnh. Bấm vào họ (bấm chuột phải, nhấn Enter khi đang chọn, hoặc nhấn giữ trên màn hình cảm ứng) thì họ phản ứng, nói một câu ngắn từ trạng thái thật, rồi một vòng tròn hành động nhỏ mở ra, chỉ có những gì làm được lúc này:

- *Trò chuyện*, cho agent của bạn và trợ lý: chọn họ ở ô câu lệnh và mở khung chat.
- *Giao việc*: chọn họ làm người nhận và đưa con trỏ vào ô câu lệnh. Không gửi gì cả.
- *Đang làm gì* và *Việc*: thẻ Tiến độ và thẻ Việc của họ.
- *Dừng việc*, chỉ khi họ đang chạy: dừng phiên chạy sau một bước xác nhận.
- *Hồ sơ*: hồ sơ của agent riêng của bạn.

Phím mũi tên đi quanh vòng tròn và Esc đóng lại. Bấm vào người đang chờ ở bàn của bạn thì mở yêu cầu duyệt trong chuông.

**Đi theo một người.** Bấm đúp vào một người, camera giữ họ ở giữa, qua các tầng và thang máy, cho tới khi bạn kéo, cuộn, zoom, nhấn Esc hoặc bấm vào sàn trống.

**Duyệt từng người.** Khi khung cảnh đang được chọn, Tab và Shift+Tab (hoặc mũi tên trái phải) đi qua từng người trên tầng, đặt camera vào họ và đọc to tên cùng trạng thái. Tab thoát khỏi khung cảnh ở cả hai đầu.

**Gọi họp.** Shift-click vào các người, hoặc Shift-kéo một khung, để chọn họ; một thanh hiện nút "Gọi họp". Nó hỏi mã nào, rồi điền `/suggest <mã>` vào ô câu lệnh kèm chi phí ước tính. Không gửi gì: bạn xem chi phí rồi tự nhấn Enter. Khi bạn gửi và phiên chạy bắt đầu, những người được chọn mà đang rảnh sẽ đi vào phòng họp làm khán giả, ai đang bận thì được nêu tên và ở lại bàn, và tất cả quay về khi phiên chạy kết thúc. Khi giảm chuyển động, họ được đặt thẳng vào chỗ.

### Hai cách xem cùng một văn phòng

Một công tắc "2D | 3D" trên đầu trang, đứng trước nút Tập trung, đổi cách vẽ văn phòng. Mặc định là 2D. 3D được tải lần đầu bạn chọn, và lựa chọn của bạn được giữ trong trình duyệt này. Vẫn là một văn phòng: vị trí, camera, lựa chọn, bong bóng và mọi thứ ở trên đều dùng được ở cả hai. Nếu thiết bị không vẽ được 3D thì nút bị khóa và nói rõ lý do; nếu 3D tải không được hoặc mất ngữ cảnh đồ họa, trang quay về 2D và báo cho bạn.

### Phím tắt, trình đọc màn hình và mức báo

Phím đơn dùng được khi con trỏ không nằm trong ô nhập và không giữ phím bổ trợ: `/` hoặc Cmd/Ctrl+K vào ô câu lệnh; `1`, `2`, `3` mở Hôm nay, Danh mục, Đề xuất; `4` quay lại người hoặc mã bạn đang xem; `B` chuông; `J` việc đang chạy; `C` khung chat; `F` chế độ tập trung; `[` và `]` agent trước và sau; `?` liệt kê tất cả; Esc đóng thứ đang mở. Khi chuông đang mở, mũi tên lên xuống chọn một yêu cầu, rồi `Y` duyệt một lần hoặc `N` từ chối, chỉ trên yêu cầu đang được viền. "Ghi nhớ" không có phím, và một phím gõ nhầm ở bất cứ chỗ nào khác không duyệt gì cả.

Trang được làm để dùng được không cần chuột: mọi nút đều hiện viền khi được chọn bằng phím, một liên kết nhảy sẽ đưa thẳng tới bảng thông tin, khung cảnh có danh sách chữ về ai đang làm gì (mỗi dòng mở người đó), và một yêu cầu duyệt mới hay một mức cắt lỗ bị thủng được đọc to cho trình đọc màn hình. Hộp thoại giữ tiêu điểm trong nó rồi trả lại.

Trang báo to hay nhỏ tùy trọng lượng daemon gán cho sự kiện: sự kiện nhẹ chỉ làm khung cảnh chuyển động; mức cao hơn một chút làm bong bóng của người đó sáng lên; mức kế tiếp thêm chấm trên chuông và khung chat; mức cao nhất còn đặt số đếm lên tiêu đề thẻ, một chấm lên biểu tượng thẻ và, nếu bạn bật trong Cài đặt > Hiển thị, phát một tiếng chuông nhẹ hai nốt (không bao giờ hai lần trong vài giây, chỉ cho một yêu cầu duyệt hay một mức cắt lỗ bị thủng) và gửi thông báo của trình duyệt (trình duyệt chỉ hỏi quyền khi bạn bật). Cả hai đều tắt sẵn và lưu trên trình duyệt này.

### Màn hình hẹp và cảm ứng

Dưới độ rộng cỡ máy tính bảng, trang chỉ hiện một khung mỗi lần, chuyển bằng một thanh dưới đầu trang: Văn phòng, Thông tin, Trò chuyện. Mở một người, phòng, bảng hay thẻ thì đưa khung thông tin lên trước; không có gì tự chuyển khung. Trên điện thoại, đầu trang rút gọn cho vừa (đồng hồ vẫn còn dưới dạng một nút nhỏ), cửa sổ nổi phủ hết chiều ngang, Cài đặt thành toàn màn hình và trình đọc bỏ cột mục lục. Cảm ứng dùng như chuột: kéo để di chuyển, chụm hai ngón để zoom, chạm lần đầu hiện thứ mà trỏ chuột sẽ hiện, chạm lần hai hoặc nhấn giữ mở vòng hành động. Không có gì chỉ dùng được khi trỏ chuột.

### Tùy chọn hiển thị

Giao diện (sáng, tối hoặc theo hệ thống), cặp màu tăng giảm (xanh tăng hay đỏ tăng), chuyển động (đầy đủ, giảm hoặc theo hệ thống) và ánh sáng văn phòng được lưu trong trình duyệt này và có hiệu lực ngay. Giảm chuyển động làm nhân vật và thú cưng đứng yên, trừ chớp mắt, dừng dải giá chạy, các hiệu ứng báo và nhấp nháy giá, và cho giờ thử của đồng hồ chạy ở tốc độ thường; bong bóng vẫn cập nhật. Ngôn ngữ và múi giờ là thiết lập của chính daemon (chúng cũng đổi bản tin và Telegram) và cần khởi động lại. Trình duyệt còn nhớ những đèn bạn đã tắt, lựa chọn 2D hay 3D, lựa chọn tiếng chuông và thông báo; không thứ nào được gửi cho daemon.

Bên trong: [dev/van-hanh.md](dev/van-hanh.md).

Xem thêm [an toàn và phê duyệt](an-toan.md), [ngân sách](ngan-sach.md), [giao dịch](giao-dich.md),
cùng các tham chiếu [`config.toml`](cau-hinh.md) và [lệnh](lenh.md).
