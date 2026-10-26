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
4. **Mở trang văn phòng.** Chạy `openalpha web` trên máy chủ (daemon phải đang chạy). Trên chính màn hình của
   máy chủ, nó mở trình duyệt cho bạn. Qua SSH, nó in hai thứ thay vào đó: một lệnh đường hầm để chạy trên máy của
   bạn, chẳng hạn `ssh -N -o ExitOnForwardFailure=yes -L 18765:127.0.0.1:8765 user@server`, và một liên kết
   (`http://127.0.0.1:18765/#code=...`) để mở khi đường hầm đã lên. Cổng đầu máy bạn của đường hầm là cổng của
   máy chủ cộng 10000, nên không đụng daemon đang chạy trên máy bạn, và nếu cổng đó đã bận thì `ssh` dừng với
   lỗi. Liên kết chỉ dùng được một lần, trong 5 phút; cần liên kết mới thì chạy lại `openalpha web`. Với ứng dụng
   desktop, chạy `openalpha connect`: nó in một dòng gồm địa chỉ và mã API. Hãy đưa cho ứng dụng địa chỉ và mã
   đó, và giữ kín dòng này.
5. **Nối từ bên ngoài.** API chỉ nghe trên `127.0.0.1` của máy chủ, nên đường hầm SSH ở trên không cần gì thêm.
   Muốn nối mà không qua đường hầm, chọn một cách theo thứ tự này:
   - **SSH**, không cần tên miền: không phải cài gì. `openalpha web` in sẵn đường hầm.
   - **Tailscale**: chạy `tailscale serve --bg 8765` trên máy chủ, rồi đặt `[api] public_url` là địa chỉ
     `https://<máy>.<tailnet>.ts.net` mà nó hiện ra và khởi động lại daemon.
   - **Caddy** với tên miền: `alpha.example.com { reverse_proxy 127.0.0.1:8765 }`, rồi đặt
     `[api] public_url = "https://alpha.example.com"` và khởi động lại daemon.

   Phía sau bất kỳ proxy nào đều phải có `public_url`. Thiếu nó, daemon từ chối mọi yêu cầu đi qua proxy, kèm
   một câu nêu tên `public_url`; tự nó không phân biệt được khách qua proxy với người dùng ngay trên máy. Ngoài
   ra daemon chỉ trả lời yêu cầu gửi tới `127.0.0.1`, `localhost` hoặc `[::1]` (cổng nào cũng được, nên đường
   hầm SSH dùng như cũ), để chặn trang web giở trò DNS rebinding. Khi đã đặt `public_url`, `openalpha web` in
   liên kết `https://` thay vì đường hầm. Mọi yêu cầu qua proxy đều đến daemon từ `127.0.0.1`, nên năm lần sai
   mã API hoặc mã đăng nhập sẽ tạm dừng đăng nhập của mọi người trong 30 giây, tăng gấp đôi mỗi lần, tối đa một
   giờ. Mã đúng không bao giờ bị khoảng dừng đó chặn và còn xóa nó.
6. **Nối ứng dụng khách.** Đưa cho ứng dụng địa chỉ và mã API; mọi yêu cầu gửi kèm mã dưới dạng
   `Authorization: Bearer <mã>`. Tối đa 8 luồng ứng dụng (`/v1/ws`) mở cùng lúc; lần bắt tay thứ chín bị từ
   chối với 503 `too_many_streams`.

**`public_url` thay đổi điều gì.** Khi daemon đã với tới được từ bên ngoài, ứng dụng được tin ít hơn, nên đặt
`public_url` còn:

- tắt việc đặt lệnh: các đường đặt lệnh của API và `/trade` từ ứng dụng bị từ chối (tắt chức năng mua từ ứng
  dụng cũng đi kèm) cho tới khi bạn đặt `[api] orders = true`. Telegram và dòng lệnh vẫn tắt chức năng mua được;
- giữ câu lệnh, việc ghi tệp, công cụ MCP đã kết nối và công cụ mạng xã hội ra khỏi các chat từ ứng dụng và từ
  trang;
- cho ứng dụng tạo công việc chỉ trả lời trong ứng dụng; công việc cho chat khác thì tạo trên máy chủ
  (`openalpha schedule add ... --to`);
- để việc duyệt ghép nối và các khóa truy cập của từng kênh chỉ làm được trên máy chủ: duyệt bằng
  `openalpha pair approve <mã>` và đổi `allowed_ids` cùng các khóa tương tự trong tệp cấu hình.

Khóa sàn cũng nên cẩn thận như vậy: chỉ cấp quyền giao dịch, không bao giờ cho rút tiền, và gắn với địa chỉ
IP của máy chủ trên sàn, để khóa lộ ra cũng không rút được tiền đi.

**Nâng cấp.** Nếu bạn đang chạy Caddy với `header_up Host`, hãy xóa dòng đó và đặt `public_url`: proxy giờ chuyển
đúng tên công khai như mặc định. Sau đó ai cũng chạy `openalpha api rotate` một lần rồi khởi động lại daemon,
để mã mà trang cũ đã lưu trong trình duyệt trở nên vô dụng. Sau khi khởi động lại, `openalpha web` đăng nhập lại
từng trình duyệt.

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

Chạy `openalpha web` (xem [Chạy API trên máy chủ](#chạy-api-trên-máy-chủ)). Lệnh in một liên kết dùng một lần và, trên máy để bàn, tự mở trình duyệt cho bạn. Trang đổi mã trong liên kết lấy một lần đăng nhập cho trình duyệt đó và xóa mã khỏi thanh địa chỉ. Không có liên kết thì trang hiện lệnh cần chạy thay vì hỏi mã.

- Liên kết chỉ dùng một lần và hết hạn sau 5 phút. Liên kết đã dùng hay đã hết hạn cho một dòng nhắc bạn chạy lại lệnh, và vài lần sai liên tiếp khiến daemon tạm dừng đăng nhập một lúc.
- Một lần đăng nhập kéo dài 30 ngày kể từ lần dùng cuối, và mỗi lần ghé thăm lại gia hạn nó. Trình duyệt chỉ giữ một cookie đăng nhập mà mã trong trang không đọc được; mã API không bao giờ tới nó.
- Cài đặt > Hiển thị, mục "Kết nối của trang này", liệt kê các trình duyệt đang đăng nhập, lúc đăng nhập và lần cuối thấy, cùng nút đăng xuất từng cái, kể cả cái đang dùng. Trình duyệt bị đăng xuất theo cách này rời khỏi trang ngay.
- `openalpha api rotate` đăng xuất mọi trình duyệt. Hãy khởi động lại daemon sau đó để mã cũ cũng hết dùng được, rồi chạy `openalpha web` lại.
- Trang từ chối chạy bên trong một khung (frame), và không gửi gì tới địa chỉ nào ngoài daemon.
- Daemon chỉ trả lời địa chỉ trên chính máy này (`127.0.0.1`, `localhost` hoặc `[::1]`) hoặc `public_url` của bạn, từ chối lời gọi API do trang web khác khởi phát, và chỉ mở luồng trực tiếp cho đúng trang nó phục vụ, nên một ứng dụng web khác trên máy không dùng ké được.
- Safari trước 16.4 không gửi tiêu đề mà daemon dựa vào, nên trang báo "cookie bị chặn" dù bạn đã cho phép. Hãy cập nhật Safari.
- Nếu không nối được daemon, trang nói thẳng bằng một dòng. Nếu đang đăng nhập mà mất kết nối, một thanh hiện đồng hồ đếm lùi lần thử lại, nút "Thử ngay" và dòng báo các phiên chạy vẫn tiếp tục ở daemon. Khi nối lại, trang hỏi lại bức tranh hiện tại rồi theo dõi tiếp. Trang cũ hơn daemon thì nhắc bạn tải lại. Khối nào làm mới không được vẫn giữ số liệu tốt gần nhất và ghi rõ lúc nào đọc.

### Trên màn hình có gì

- **Đầu trang.** Chip việc đang chạy (cái gì đang chạy và cái gì tiếp theo: dừng một phiên chạy, hoặc chạy lại một việc theo lịch), công tắc 2D | 3D, nút Tập trung (ẩn văn phòng, chỉ còn thông tin; không hiện trên màn hình hẹp), chip chi phí AI, đồng hồ văn phòng, chuông thông báo, nút "?" liệt kê các phím tắt và Cài đặt.
- **Dải giá.** Ngay dưới đầu trang, danh sách theo dõi và các mã bạn đang giữ chạy ngang qua. Mã thủng cắt lỗ và đề xuất mua mới được đánh dấu.
- **Văn phòng.** Khung cảnh bên trái, mô tả ở dưới.
- **Bảng thông tin.** Ba thẻ. *Hôm nay* mở đầu bằng những gì cần bạn (việc chờ duyệt, mã thủng cắt lỗ), rồi tới những gì đáng xem, thị trường Việt Nam và các thị trường khác, sự kiện sắp tới, tin nổi bật, và hôm nay agent đã làm gì, gồm cả việc chạy khi bạn không mở trang. *Danh mục* gồm tổng quan, hiệu quả, lịch sử, cân bằng lại và danh sách theo dõi cùng cảnh báo giá; giao dịch được ghi, sửa, xóa ngay tại đây và có hoàn tác. *Đề xuất* gồm các kế hoạch đang mở, màn hình cơ hội, thành tích và kết quả nghiên cứu, kèm số đề xuất mới bạn chưa xem. Bấm một mã ở bất cứ đâu thì thẻ của mã đó mở ra: giá và các mức của kế hoạch, mã bạn đang giữ, "Vì sao?" để xem lý lẽ sau một đề xuất, các đề xuất trước đây và các agent của bạn nghĩ gì. Bấm một agent của bạn trong văn phòng thì thẻ của nó mở ra (xem [Agent](tro-ly.md#từ-trang-văn-phòng)). Hàng quay lại đưa bạn về chỗ vừa xem, và bảng thu gọn được thành một dải biểu tượng.
- **Trò chuyện.** Cuộc trò chuyện với trợ lý, nằm bên phải. Các phiên chat trước, kể cả của Telegram, tìm được và chỉ đọc; chỉ những cuộc chat do trang mở mới nói tiếp được.
- **Ô câu lệnh.** Ở cuối trang: ai nhận câu bạn gõ, ô nhập và nút Gửi. Xem [Lệnh](lenh.md#ô-câu-lệnh-trên-trang-văn-phòng).
- **Chuông và việc đang chạy.** Chuông liệt kê thông báo và các yêu cầu đang chờ bạn. Yêu cầu duyệt hỏi từ trang này được trả lời ngay trong chuông: duyệt một lần, ghi nhớ hoặc từ chối. Đồng hồ đếm lùi cho biết khi nào hết hạn, và yêu cầu hết giờ mà chưa trả lời thì bị từ chối. Mỗi yêu cầu chỉ được trả lời một lần: nếu nó hiện ở cả chuông lẫn khung chat thì chỉ một câu trả lời được gửi đi, và thẻ còn lại hiện đúng câu trả lời đó, kèm dòng "đã được trả lời" nếu bạn chọn khác ở thẻ này. Yêu cầu hỏi trên Telegram hay kênh khác vẫn được liệt kê nhưng trả lời ở nơi nó được hỏi. Danh sách việc cho thấy cái đang chạy (dừng được, sau một bước xác nhận), cái sắp chạy, cái đang chờ một sự kiện (kiểm tra theo chu kỳ, không tốn AI) và các việc bảo trì tự chạy, kèm cách sửa việc nào đang lỗi.
- **Chi phí.** Chip cho thấy hôm nay đã tiêu bao nhiêu so với mức trần ngày; bấm để xem cả tháng, chi phí theo từng việc và dòng ngân sách. Xem [Ngân sách](ngan-sach.md#trên-trang-văn-phòng).
- **Cài đặt.** Biểu tượng bánh răng: lịch và theo dõi, agent và AI, kênh nhắn tin, dữ liệu và kết nối, hiển thị, và ô sửa `config.toml` thô. Ô sửa hiện mọi giá trị bí mật (giá trị `env` của máy chủ MCP, mọi token, secret, mật khẩu hay khóa API ghi thẳng trong file) là `********`; cứ để nguyên thì giá trị đã lưu được giữ. Những mục quyết định daemon chạy gì, dùng file nào hay gửi khóa đi đâu chỉ đổi được bằng câu lệnh hoặc sửa thẳng trong `config.toml`: plugin, câu lệnh khởi chạy, tham số, `env` và cách kết nối của máy chủ MCP, mọi khóa `*_env`, `base_url` và `fallback_base_url`, `[paths]`, `[log] file`, `[storage]`, `[api]`, `[update]` và `[trading.orders] allow_unattended`. Khi đã đặt `[api] public_url`, `allowed_ids`, `operator_user_ids`, `pairing` và `dm_policy` của từng kênh cũng chỉ đổi được trên máy chủ. Khi kiểm tra hay lưu một thay đổi ở những mục như vậy, trang sẽ từ chối và nêu tên từng mục; ô chọn mô hình vẫn đổi được nhà cung cấp, khi đó nó đặt biến chứa khóa của chính nhà cung cấp đó và bỏ địa chỉ cũ. Mỗi dòng nói rõ lưu xong có hiệu lực ngay hay cần khởi động lại; bánh răng đếm các thay đổi đang chờ khởi động lại, và trang khởi động lại được một daemon bật bằng `--background` (xem ở trên). Khóa API, mã truy cập và thông tin đăng nhập sàn không bao giờ nhập trên trang này.

### Văn phòng

Hai tầng, chuyển ở đầu khung cảnh. Tầng **Văn phòng** là đội có sẵn trong các phòng của họ: Kho dữ liệu (Thủ kho làm mới dữ liệu), Thư viện (nhóm tìm tin, lập kế hoạch, tổng hợp, rà soát và phân tích chủ đề làm nghiên cứu), Phòng họp (bàn tranh luận sau `/suggest`), Sảnh (lịch hôm nay và bản tin trong ngày), Quầy cảnh báo (người trực theo dõi cảnh báo giá và mức cắt lỗ), Phòng trợ lý và Bàn của bạn. Tầng **Agent của bạn** là tầng đội riêng: mỗi agent của bạn một bàn, kèm thẻ cho biết nó đang chạy, tạm dừng hay rảnh, lịch của nó, đề xuất gần nhất và hôm nay nó đã tiêu bao nhiêu. Chưa có agent nào thì tầng này gợi ý ba cách bắt đầu và một mẫu trống, còn bàn trống kế tiếp mang nút "+ Thêm agent".

Cách đọc khung cảnh:

- Một người chỉ di chuyển khi daemon nói vậy. Một phiên chạy bắt đầu thì đúng người đi tới đúng phòng; các bước và công cụ của nó quyết định họ làm gì ở đó; phiên chạy xong thì họ về chỗ. Phiên chạy nào trang không gắn được vào khung cảnh thì ngồi ở bàn gõ máy, kèm tên phiên chạy; trang không bao giờ bịa thêm bước.
- Dấu "!" màu hổ phách trên đầu một người nghĩa là họ mang tới cho bạn một yêu cầu duyệt; bấm vào để mở chuông. Dấu "!" đỏ trên đầu người trực cảnh báo nghĩa là một mức cắt lỗ đã bị thủng; bấm vào để mở thẻ của mã đó.
- Bong bóng thoại mang những câu có thật: việc nào cần bạn duyệt, một vai trong cuộc tranh luận vừa nói gì, một đề xuất cũ mà ai đó còn nhớ. Màn hình sáng cho thấy người tìm tin đang đọc trang nào hay giá đóng cửa mà nhà phân tích đang xem; bấm vào để xem lớn hơn.
- Các bảng cho thấy tiến độ (vòng tranh luận, câu hỏi nghiên cứu, số giá đã làm mới) và bảng đề xuất đếm các đề xuất mới. Máy in, kệ nguồn, đồng hồ và quầy cảnh báo hiện một chú thích khi bạn trỏ vào, kèm liên kết tới nơi liên quan.
- Bấm vào một chiếc đèn để bật hoặc tắt đèn phòng đó, hoặc bấm công tắc trên tường (hay nút đèn trên thanh công cụ) để bật tắt tất cả. Mặc định ánh sáng văn phòng đi theo đồng hồ văn phòng; Cài đặt > Hiển thị tắt được việc này.
- Mèo ngủ khi không có gì cần bạn, và thức dậy khi có việc cần duyệt, mã bạn giữ thủng cắt lỗ hoặc chạm chốt lời, lệnh khớp ở sàn, cảnh báo giá bạn đặt, hoặc hết ngân sách AI trong ngày. Corgi và bể cá chỉ là cảnh, không báo gì cả.
- Kéo để di chuyển, cuộn hoặc dùng nút phóng to để zoom, phím mũi tên lên xuống để di chuyển bằng bàn phím (mũi tên trái phải đi qua từng người, ở dưới), Esc hoặc "Xem cả tầng" để lùi lại. Từ góc nhìn cả tầng, bấm vào một phòng thì zoom vào phòng đó.

**Đồng hồ văn phòng.** Đồng hồ trên đầu trang cho biết giờ trong văn phòng. Bấm vào để xem văn phòng ở một giờ khác: giờ thật, hoặc một mốc có sẵn (sáng sớm, sáng, trưa, chiều, tối, đêm) ở tốc độ thường, x10 hoặc x60. Chỉ cảnh văn phòng đổi; số liệu, thông báo và giờ chạy việc vẫn theo giờ thật. Giờ thử không được lưu, nên tải lại trang là về giờ thật. Khi bạn đang giảm chuyển động, giờ thử chạy ở tốc độ thường. Khi văn phòng chạy theo giờ của một thị trường chứ không phải giờ của bạn, đồng hồ hiện cả hai.

**Bảng hiệu năng.** Thêm `?perf=1` vào địa chỉ trang để xem chi phí mỗi khung hình và tốc độ vẽ của khung cảnh so với mức cho phép. Dùng để tìm hiểu một máy chậm, không đổi gì khác.

### Đời sống văn phòng

Khi chưa ai giao việc gì, văn phòng không đứng im, nhưng cũng không giả vờ làm việc. Những người đang rảnh làm vài việc nhỏ: nghỉ trưa, cà phê buổi chiều, trò chuyện bên bình nước, chiều thứ Sáu thong thả, hoặc họp nhanh trong lúc bản tin sáng chạy. Chỉ người đang rảnh mới làm vậy. Ai mà một phiên chạy cần tới, hoặc còn nợ một lần giao hay một câu trả lời, thì bỏ dở mọi thứ và đi làm việc. Không điều nào trong đó đụng tới dữ liệu của bạn hay tốn một xu.

- Trợ lý đi một vòng các phòng sau khi rảnh một lúc ngắn, dừng ở từng cửa, và cứ ba vòng thì một vòng đi thang lên ngó bàn các agent của bạn. Có việc, câu hỏi hay yêu cầu duyệt cho nó thì vòng đi dừng ngay.
- Khi không có gì đang chạy, không có gì chờ bạn và không ai đang gõ trong khoảng 15 phút, văn phòng chìm vào yên lặng: mọi người ngả người ra ghế, màn hình tối đi, các cử động vặt dừng và trang gần như không làm gì. Trong một văn phòng yên lặng, một vòng đi chỉ diễn ra tối đa 25 phút rảnh một lần.
- Thẻ trình duyệt bạn không nhìn tới thì dừng hẳn mọi chuyển động và bắt kịp khi bạn quay lại.

### Trò chuyện với một người

Trỏ vào một người để thấy tên và một dòng trạng thái trực tiếp: họ đang chạy gì và từ đâu, đang ở bước nào, đang chờ bạn hay chờ tới lượt, đang tạm dừng, hay đang rảnh. Tới được ai bằng bàn phím thì nhãn đó cũng hiện. Bấm vào họ thì họ phản ứng (vẫy tay khi rảnh, ngước nhìn khi đang bận), nói một câu ngắn từ trạng thái thật, rồi một vòng tròn hành động nhỏ mở ra, chỉ có những gì làm được lúc này. Bấm chuột phải, nhấn Enter hoặc Space khi bàn phím đang ở trên một người, hoặc nhấn giữ trên màn hình cảm ứng, cũng mở vòng này và đưa tiêu điểm vào hành động đầu tiên.

- *Trò chuyện*, cho agent của bạn và trợ lý: chọn họ ở ô câu lệnh và mở khung chat.
- *Giao việc*, cho cùng những người đó, trừ agent đang tạm dừng: chọn họ làm người nhận và đưa con trỏ vào ô câu lệnh. Không gửi gì cả.
- *Đang làm gì*: thẻ Tiến độ của họ. Người phụ việc mà một agent giao việc cho thì mở thẻ của agent cha; trợ lý và người trực cảnh báo có thẻ riêng.
- *Việc*: thẻ Việc của agent của bạn và của trợ lý.
- *Dừng việc*, chỉ khi phiên chạy của họ đang chạy: dừng phiên chạy sau một bước xác nhận.
- *Hồ sơ*: hồ sơ của agent riêng của bạn.
- *Đi theo*, cho mọi người: camera đi theo họ (bên dưới).

Phím mũi tên đi quanh vòng tròn, Esc đóng lại, và chuyển tiêu điểm đi chỗ khác cũng đóng lại. Bấm vào người đang chờ ở bàn của bạn thì mở yêu cầu duyệt trong chuông.

**Đi theo một người.** Bấm đúp bằng chuột vào một người, hoặc chọn "Đi theo" trong vòng hành động của họ, camera giữ họ ở giữa, qua các tầng và thang máy, cho tới khi bạn tự dời camera (kéo, cuộn, zoom hoặc phím mũi tên), nhấn Esc, bấm vào sàn trống, dùng bàn phím sang người khác, hoặc chuyển giữa 2D và 3D.

**Duyệt từng người.** Nhấn Tab để vào khung cảnh thì tiêu điểm dừng ở người đầu tiên. Tab và Shift+Tab đi qua từng người trên tầng đang xem theo một thứ tự cố định: đội có sẵn trước, rồi agent của bạn theo bàn, rồi những người phụ việc của họ. Mũi tên trái phải đi cùng cách đó và quay vòng. Mỗi bước đặt camera vào người đó và đọc to tên cùng trạng thái; Enter hoặc Space mở vòng hành động của người đang được chọn. Tab thoát khỏi khung cảnh ở cả hai đầu.

**Gọi họp.** Ở tầng Văn phòng, Shift-click vào các thành viên của đội có sẵn, hoặc dùng chuột Shift-kéo một khung quanh họ, để chọn; một thanh hiện nút "Gọi họp" và "Bỏ chọn" (Esc hay bấm vào sàn trống cũng bỏ chọn). Nó hỏi mã nào, rồi điền `/suggest <mã>` vào ô câu lệnh kèm chi phí ước tính. Không gửi gì: bạn xem chi phí rồi tự nhấn Enter. Lệnh `/suggest` đầu tiên bạn gửi sau đó chính là cuộc họp. Khi phiên chạy của nó bắt đầu, những người được chọn mà đang rảnh (tối đa sáu người) sẽ đi vào phòng họp làm khán giả, ai đang bận thì được nêu tên và ở lại bàn, và tất cả quay về khi phiên chạy kết thúc. Nếu bạn sửa ô thành một câu lệnh khác thì không ai đi vào. Khi giảm chuyển động, họ được đặt thẳng vào chỗ.

### Hai cách xem cùng một văn phòng

Một công tắc "2D | 3D" trên đầu trang, đứng trước nút Tập trung, đổi cách vẽ văn phòng. Mặc định là 2D. 3D được tải lần đầu bạn chọn, và lựa chọn của bạn được giữ trong trình duyệt này. Vẫn là một văn phòng: vị trí, camera, lựa chọn, bong bóng và mọi thứ ở trên đều dùng được ở cả hai, chỉ khác là chuyển chế độ thì dừng việc đi theo một người và đóng vòng hành động đang mở. Hiện 3D thể hiện ít chi tiết hơn 2D: màn hình và bảng chỉ là những tấm phẳng một màu, không có hình và chữ nhỏ mà 2D vẽ lên đó, và còn thiếu vài chi tiết tinh hơn. Nếu thiết bị không vẽ được 3D thì nút bị khóa và nói rõ lý do; nếu 3D tải không được hoặc mất ngữ cảnh đồ họa, trang quay về 2D và báo cho bạn.

### Phím tắt, trình đọc màn hình và mức báo

Phím đơn dùng được khi con trỏ không nằm trong ô nhập, không có hộp thoại nào đang mở và không giữ phím bổ trợ: `/` hoặc Cmd/Ctrl+K vào ô câu lệnh (Cmd/Ctrl+K dùng được cả khi đang gõ trong một ô); `1`, `2`, `3` mở Hôm nay, Danh mục, Đề xuất; `4` quay lại agent hoặc mã bạn đang xem; `B` chuông; `J` việc đang chạy; `C` khung chat; `F` chế độ tập trung; `[` và `]` agent trước và sau; `?`, hoặc nút "?" trên đầu trang, liệt kê tất cả; Esc đóng thứ đang mở hoặc thôi đi theo một người. Khi khung cảnh đang giữ bàn phím thì mũi tên, Tab, Enter, Space và Esc là của khung cảnh (ở trên), còn các phím chữ vẫn dùng được. Khi chuông đang mở, mũi tên lên xuống chọn một yêu cầu, rồi `Y` duyệt một lần hoặc `N` từ chối, chỉ trên yêu cầu đang được viền, và nút của nó in sẵn phím. "Ghi nhớ" không có phím, thẻ duyệt nằm trong khung chat không nhận các phím này, và một phím gõ nhầm ở bất cứ chỗ nào khác không duyệt gì cả.

Trang được làm để dùng được không cần chuột: mọi nút đều hiện viền khi được chọn bằng phím, một liên kết nhảy sẽ đưa thẳng tới bảng thông tin, khung cảnh là một ứng dụng dùng bàn phím với danh sách chữ về ai đang làm gì (nó hiện ra khi bạn nhấn Tab vào, và mỗi dòng mở việc người đó đang làm hoặc thứ đang cần bạn), và việc đi theo hay bước sang ai đó được đọc to. Một yêu cầu duyệt mới hay một mức cắt lỗ bị thủng cũng được đọc to cho trình đọc màn hình. Hộp thoại giữ tiêu điểm trong nó rồi trả lại.

Trang báo to hay nhỏ tùy trọng lượng daemon gán cho sự kiện. Sự kiện nhẹ chỉ làm khung cảnh chuyển động. Mức cao hơn một chút làm bong bóng của người đó sáng lên vài giây. Mức kế tiếp thêm chấm trên chuông và, khi khung chat đang đóng, cả trên khung chat; lúc đó chấm nghĩa là "có gì mới", không chỉ là tin nhắn chưa đọc. Những sự kiện to nhất còn gửi được thông báo của trình duyệt, nếu bạn bật trong Cài đặt > Hiển thị (trình duyệt chỉ hỏi quyền khi bạn bật). Một tiếng chuông nhẹ hai nốt, nếu bạn bật, chỉ vang lên cho một yêu cầu duyệt mới hay một mức cắt lỗ bị thủng: mỗi việc một lần, và không bao giờ quá một lần trong 10 giây. Tiêu đề thẻ có số đếm và biểu tượng thẻ có một chấm khi có gì đó cần bạn, tức là một yêu cầu duyệt đang chờ hoặc một mức cắt lỗ bị thủng mà bạn chưa xem. Một câu hỏi làm rõ, một yêu cầu ghép nối hay ngân sách hết thì có thông báo và các chấm, nhưng không đổi tiêu đề hay biểu tượng. Tiếng chuông và thông báo đều tắt sẵn và lưu trên trình duyệt này.

### Màn hình hẹp và cảm ứng

Dưới 900 px chiều ngang, trang chỉ hiện một khung mỗi lần, chuyển bằng một thanh dưới đầu trang: Văn phòng, Thông tin, Trò chuyện. Màn hình rộng hơn thì khung chat vẫn nằm cạnh các khung còn lại. Mở một thẻ (một mã, một agent, một thẻ tab) thì đưa khung thông tin lên trước; "Xem" một phiên chạy thì đưa văn phòng lên trước và zoom vào phòng của phiên chạy đó; gửi tin nhắn hoặc chọn Trò chuyện thì đưa khung chat lên trước, và nút đóng của nó quay về khung bạn vừa ở. Không có gì tự chuyển khung, nên một sự kiện trực tiếp không bao giờ kéo bạn đi chỗ khác. Chế độ tập trung và nút của nó tắt ở độ rộng này. Dưới 600 px, tức trên điện thoại, đầu trang rút gọn cho vừa (bỏ chữ thương hiệu và biểu tượng trên chip, chip việc đang chạy ngắn lại, đồng hồ còn dưới dạng một nút nhỏ), cửa sổ nổi phủ hết chiều ngang, Cài đặt thành toàn màn hình và trình đọc bỏ cột mục lục. Trên mọi màn hình hẹp, sàn không bao giờ được vẽ nhỏ hơn một điểm ảnh màn hình cho mỗi điểm của thế giới, nên phần còn lại xem bằng cách di chuyển, và có một dòng gợi ý nói vậy.

Cảm ứng dùng như chuột: một ngón kéo để di chuyển, hai ngón chụm để zoom. Chạm lần đầu vào một người, thẻ tên của họ hay thứ có chú thích thì hiện thứ mà trỏ chuột sẽ hiện, và người đó chào; chạm lần hai vào cùng thứ đó, hoặc nhấn giữ trên một người, mở vòng hành động. Chạm vào sàn trống thì đóng nhãn, vòng hành động và việc đi theo. Đi theo một người thì chọn trong vòng hành động; chọn người để họp cần chuột; mọi thứ bạn đọc được khi trỏ chuột đều có cách chạm.

### Tùy chọn hiển thị

Giao diện (sáng, tối hoặc theo hệ thống), cặp màu tăng giảm (xanh tăng hay đỏ tăng), chuyển động (đầy đủ, giảm hoặc theo hệ thống) và ánh sáng văn phòng được lưu trong trình duyệt này và có hiệu lực ngay. Giảm chuyển động làm nhân vật và thú cưng đứng yên, trừ chớp mắt, dừng dải giá chạy, các hiệu ứng báo và nhấp nháy giá, và cho giờ thử của đồng hồ chạy ở tốc độ thường; bong bóng vẫn cập nhật. Ngôn ngữ và múi giờ là thiết lập của chính daemon (chúng cũng đổi bản tin và Telegram) và cần khởi động lại. Trình duyệt còn nhớ những đèn bạn đã tắt, lựa chọn 2D hay 3D, lựa chọn tiếng chuông và thông báo; không thứ nào được gửi cho daemon.

Bên trong: [dev/van-hanh.md](dev/van-hanh.md).

Xem thêm [an toàn và phê duyệt](an-toan.md), [ngân sách](ngan-sach.md), [giao dịch](giao-dich.md),
cùng các tham chiếu [`config.toml`](cau-hinh.md) và [lệnh](lenh.md).
