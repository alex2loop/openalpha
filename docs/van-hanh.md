# Việc lặp lại

Có ba loại việc tự lặp lại. Khi một việc chạy hay không chạy, trước hết hãy xem nó thuộc loại nào.
Câu trả lời thường nằm ngay đó.

| Loại | Ai tạo | Nằm ở đâu |
|---|---|---|
| **Vòng lặp có sẵn** | Dịch vụ nền (daemon), luôn luôn | Cố định. Chỉ chỉnh được một nhịp |
| **Việc theo lịch** | Bạn, bằng `schedule add` | Cơ sở dữ liệu, nên còn nguyên sau khi khởi động lại |
| **Heartbeat** | Tệp `HEARTBEAT.md` trong thư mục làm việc của agent | Một tệp dịch vụ nền quét |

Cả ba chạy qua engine agent thông thường, cùng ngân sách, giới hạn mô hình và công cụ. Chỗ khác
nhau là phê duyệt. Việc theo lịch có đích là một kênh thì dừng lại hỏi bạn được. Heartbeat thì không
bao giờ hỏi, vì không có ai đang ngồi xem.

---

## Vòng lặp có sẵn

Chúng chạy khi `openalpha start` dựng dịch vụ nền và dừng khi `openalpha stop` tắt nó. Mỗi vòng chờ,
chạy, rồi mới tính lần chờ kế tiếp. Nhờ vậy một lượt chậm không bao giờ chồng lên chính nó. Lượt nào
không có việc thì thoát ngay.

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
| quét lưu giữ | 6 giờ | Xóa các dòng quá `[retention] days` / `history_days` / `inbox_days`, tệp tạm trong thư mục làm việc, cache cũ trong thư mục nhà shell của mỗi agent (`run/.cache`, `run/.npm`, `run/.bun/install/cache`, `run/.local/share/Trash`; `doctor` cảnh báo khi `run/` của một agent vượt 2 GB), và thư mục log của agent không còn được cấu hình. Sao lưu SQLite hằng ngày vào `backups/daily/` khi bản mới nhất đã gần một ngày tuổi (`daily_backups`; bỏ qua PostgreSQL). Cũng chạy một lần lúc khởi động. |
| nhịp workflow | 30 giây | Kích hoạt các workflow có cron trigger. Lượt hỏng sẽ phát lại cửa sổ của nó, nên không mất lần kích hoạt nào. |
| nhịp heartbeat | 30 giây | Quét `HEARTBEAT.md` của từng thư mục làm việc. |
| nhịp lập lịch | 30 giây | Tìm các việc theo lịch đã đến hạn. |

Khi API bật, ứng dụng gom các vòng này, cùng vòng nào plugin thêm, vào một bảng việc chạy ngầm. Với
mỗi vòng bạn thấy:

- tên vòng bằng lời thường;
- bao lâu chạy một lần, nếu nó có nhịp cố định;
- phiên chạy gần nhất bắt đầu lúc nào, và lỗi cuối cùng nếu lần đó hỏng (phiên chạy tốt kế tiếp xóa lỗi);
- phiên chạy tới là khi nào, và lúc này nó có đang làm việc không.

Bản tin sáng và báo cáo trong ngày cho biết khi nào đến hạn lần kế. Bảng này nằm trong bộ nhớ, nên
sau khi khởi động lại mỗi vòng chưa hiện gì cho đến phiên chạy kế tiếp của nó.

### Dữ liệu thị trường được làm mới khi nào

`trading.refresh` không chạy theo đồng hồ đều đặn. Nó chạy ở mốc **sớm nhất** trong:

- ngay sau khi phiên của từng thị trường đóng và bảng giá đã chốt;
- 60 phút trước giờ mở của từng thị trường, để bản tin và bảng lọc đọc dữ liệu đã làm ấm sẵn (bản
  tin sớm nhất gửi 08:15 cho giờ mở 09:00);
- chu kỳ đã cấu hình, chỉ là một cái trần.

Thị trường không bao giờ đóng cửa như crypto thì làm mới lúc sang ngày UTC. Hai mốc cách nhau dưới 60
giây thì gộp làm một lượt.

Lúc khởi động, lần làm mới đầu tiên chạy trước các phần khác:

- Nó chờ tối đa 60 giây, rồi hoàn tất ở chế độ nền kèm một cảnh báo.
- Khởi động mà không có mạng thì vòng lặp chờ có mạng.
- Lần làm mới đầu mà gặp lỗi nhà cung cấp, lưu trữ hay kênh thì chỉ là một cảnh báo
  (`daemon.boot_refresh_failed`), dù lỗi đến trong 60 giây hay sau đó. Dịch vụ nền vẫn khởi động.
  Lỗi nào khác thì dừng khởi động.

Mỗi lượt như vậy, kể cả lượt lúc khởi động, hiện trên trang văn phòng y như khi bạn gõ `/refresh`.
Thủ kho vào Kho dữ liệu làm việc, tiến độ hiện trên màn hình tường. Đầu trang đếm nó vào số việc đang
chạy. Khi xong, mục Hoạt động ghi "Làm mới dữ liệu", nguồn "lịch" (kèm "dừng" hoặc "lỗi" nếu lượt đó
không xong). Lượt này không gọi mô hình, nên dòng của nó không ghi chi phí và không có lệnh gọi AI.

Một lượt chỉ hiện từ lần tải đầu tiên. Vì vậy lượt không có thị trường nào đang dùng, hay lượt thấy
dữ liệu mọi thị trường vẫn mới, thì không hiện gì cả.

Nếu một lượt để bất kỳ loại dữ liệu nào ở trạng thái `unavailable` (không lấy được gì), nó thử lại
sau 2, 4, 8 và 16 phút, không bao giờ quá mốc kế tiếp. Lần hỏng thứ năm trả việc về cho mốc, và chuỗi
thử lại bắt đầu lại. Lượt chỉ thiếu một phần (`partial`) thì cứ chờ mốc kế tiếp. Các mã bị sót được
vá lại theo thời gian chờ riêng.

Mỗi lượt ghi một dòng log `trading.market_data_refreshed` cho biết từng thị trường mất bao lâu. Thị
trường tải nhiều loại dữ liệu còn ghi thời gian của từng loại, nên một lượt chậm tự chỉ ra chỗ chậm.

### Bạn chỉnh được gì

- Một nhịp: `[trading.refresh] interval_ms`, mặc định là trần 12 giờ ở trên.
- Thời hạn lưu giữ: `days`, `history_days` và `inbox_days` trong `[retention]`.

Mọi thứ khác là cố định. Khóa và giá trị mặc định ở [Cấu hình](cau-hinh.md#trading). Mỗi lượt xử lý
50 dòng, riêng `trading.macro-extract` là 3 vì mỗi mục ở đó là một lời gọi mô hình. Đổi gì ở đây cũng
cần khởi động lại dịch vụ nền.

### Khi một phiên chạy báo lỗi

| Lỗi | Kết quả |
| --- | --- |
| Lỗi lưu trữ, kênh hay LLM, hoặc lệnh dừng vì ngân sách/tần suất | Ghi log `trading.tick_failed` (warn) và thử lại ở lượt sau. Thế giới bên ngoài không với tới được chính là lý do có lượt sau. |
| Chưa đặt khóa của mô hình | Ghi log `trading.tick_key_missing` (warn) một lần, chỉ ghi lại sau khi có lỗi khác, và thử lại ở lượt sau. |
| Mọi lỗi khác: lỗi kiểm tra, bất biến bị phá, cấu hình sai | Vòng đó bị cách ly, các vòng khác vẫn chạy. Log `trading.loop_quarantined` (error) và bạn nhận thông báo gọi tên vòng đó bằng lời thường. Một giờ sau vòng chạy lại, tối đa ba lần; lỗi kế tiếp thì nó dừng hẳn đến khi dịch vụ nền khởi động lại, và thông báo nói rõ điều này. Vòng nào chạy trọn một ngày rồi mới lỗi lại thì được cấp lại đủ ba lần. |
| Hủy | Bạn đã tắt dịch vụ nền, hoặc dừng phiên chạy của lượt đó trên trang. Không phải lỗi. Dừng một phiên chạy chỉ kết thúc lượt đó; lượt sau vẫn chạy đúng lịch. |
| Mất mạng (máy gập nắp tự thức dậy chạy nền) | Lượt đó bị bỏ qua, không tính là lỗi. `trading.tick_offline` (warn) ghi một lần cho mỗi đợt mất mạng, rồi kiểm tra lại mỗi phút. Không lần gửi nào bị trừ lượt thử, không nguồn nào bị ngắt; lượt quá hạn chạy ngay khi có mạng lại. |
| Lượt quét lưu giữ hỏng | Ghi log cảnh báo; lượt quét sau thử lại. |

Các vòng giao dịch khởi động sau khi khâu gửi của kênh đã gắn vào, nên cảnh báo ở lượt đầu tiên vẫn có
nơi để gửi tới.

### Khi thiếu khóa

`openalpha start` vẫn khởi động khi thiếu khóa AI, khóa tìm kiếm web, biến của máy chủ MCP, token API
hay bot token của kênh. Mỗi mục thiếu được in một dòng cảnh báo (xem
[Lệnh](lenh.md#dịch-vụ-nền-và-chẩn-đoán)).

Làm mới dữ liệu, cảnh báo giá, sổ lệnh và mọi vòng không cần AI vẫn chạy. Việc cần mô hình thì chờ:

- Vòng đọc số liệu vĩ mô ghi `trading.tick_key_missing` (warn) một lần rồi vẫn thử ở mỗi lượt.
- Bản tin sáng vẫn gửi các mục không cần AI. Hôm nào không dựng được, bạn nhận một tin nêu tên biến
  và cách đặt.
- Việc theo lịch cần AI thì bỏ qua lượt đó mà không tính là lỗi. Nhờ vậy nó không bao giờ bị tắt vì
  thiếu khóa.

`status` liệt kê những gì đang chờ khóa. Lưu khóa bằng `openalpha key set <NAME>`, chạy
`restart --background`, và mọi thứ chạy lại.

### Khi dịch vụ nền dừng hoặc lỡ bản tin

Đôi khi dịch vụ nền chết mà chưa kịp dừng đàng hoàng: sập, `kill -9`, mất điện. Khi đó nó để lại tệp
pid. `status` in `daemon: đã dừng đột ngột (khởi động lúc <giờ>)` kèm gợi ý xem `openalpha logs`, thay
vì dòng "chưa chạy" trơn. Lần khởi động kế tiếp cũng nhắn vào cuộc trò chuyện của bạn một lần, báo
cảnh báo và bản tin đã tạm ngưng tới giờ.

Bản tin sáng phải đi trước giờ mở cửa:

- Nếu không gửi được (dịch vụ nền tắt, hoặc mọi lần gửi đều hỏng), bản tin hôm đó bị bỏ và cuộc trò
  chuyện nhận một dòng báo điều này. Bản tin sau vẫn theo lịch.
- Bản tin bắt đầu dựng trước giờ mở cửa nhưng xong sau đó vẫn được gửi. Dòng đầu báo giá đã chạy từ
  lúc viết.

Kênh chat mất kết nối lâu cũng được báo. Cứ năm phút dịch vụ nền xem từng kênh một lần. Kênh nào mất
kết nối (hoặc vẫn nối mà liên tục lỗi) đã 15 phút thì được báo đúng một lần, trên một kênh khác đang
chạy, kèm lý do:

- token bot bị từ chối;
- đăng nhập Zalo hết hạn;
- tài khoản đang mở ở nơi khác;
- kết nối liên tục bị ngắt.

Có lại thì bạn nhận một dòng "đã kết nối lại". Trong lúc mất kết nối, `status` ghi kênh đó là
`mất kết nối: <lý do>`. Không có kênh nào khác để báo thì chỉ ghi log (`channel.watch_no_route`).
Khởi động lại thì quên hết, nên kênh còn mất kết nối sau đó sẽ được báo thêm một lần.

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
Lệnh chạy được cả khi dịch vụ nền đang chạy và chỉ ghi các trường bạn đổi, nên phiên chạy đến hạn hay đang
thử lại không bị ảnh hưởng.

Prompt bắt đầu bằng `/` là một lệnh. Nó chạy như khi bạn gõ, không dùng mô hình trừ khi chính lệnh
đó cần (`/suggest`, `/research`). Vì vậy `--prompt "/health"` không tốn gì.

- Chỉ dòng đầu là lệnh.
- Kết quả được gửi như mọi câu trả lời khác. Khi không có trang nào đang mở, nó vào chuông để trang
  mở sau đó đọc được.
- Mỗi phiên chạy như vậy để lại một dòng trong nhật ký hoạt động.

Lệnh thay đổi cài đặt, lệnh đặt hoặc sổ của bạn (như `/trade`, `/record sync` hay `/refresh`) cần
bạn duyệt. Vì vậy `schedule add` và `schedule edit` từ chối, trang văn phòng và công cụ lập lịch của
agent cũng vậy. Từ sau dấu `/` mà không phải lệnh nào cũng bị từ chối như thế. Một việc đã lưu mà giờ
sẽ bị từ chối thì cũng bị từ chối khi đến hạn chạy.

`--allow-tools` giới hạn việc đó vào những công cụ có ở **cả hai** danh sách: công cụ agent được phép
và công cụ của việc. `schedule show` in tập hiệu lực kèm `(restricted)` hoặc `(all)`.

Một việc có thể chờ một cảnh báo thay vì chờ giờ. Gọi đó là việc theo sự kiện. Trang văn phòng tạo
loại này. Việc chạy khi:

- mã bạn đang giữ thủng mức cắt lỗ hoặc chạm mức chốt lời;
- một mã biến động mạnh trong phiên;
- giá bạn đặt được chạm.

Việc chạy tối đa một lần mỗi khoảng chờ. Khoảng chờ là quãng nghỉ việc mang theo, để một mã ồn ào
không kích nó chạy liên tục. Việc vẫn bật sau khi chạy, trừ việc theo giá: một lần chạm là hết. Tự
bấm chạy ngay thì chưa chạm gì, nên việc vẫn chờ.

- `schedule list` ghi nó là `khi FPT chạm mức giá bạn đặt` thay cho giờ.
- `schedule edit` không đặt giờ cho nó được.
- `schedule remove` gỡ luôn cảnh báo giá nó đã đặt.
- `schedule resume` từ chối việc theo giá mà cảnh báo đã chạm.

Một phiên chạy hỏng của việc theo sự kiện không tính vào việc tự tắt. Vì vậy việc cứ hỏng mãi vẫn
bật, và báo lỗi ở mỗi lần cảnh báo chạm, tối đa một lần mỗi khoảng chờ.

Cron nhận năm trường, hỗ trợ ký tự đại diện, khoảng, bước (`*/15`, `1-5/2`) và danh sách ngăn bằng dấu
phẩy. Khi cả ngày-trong-tháng lẫn thứ-trong-tuần đều bị giới hạn, khớp **một trong hai** là đủ; trường
ngày bắt đầu bằng `*` (như `*/2`) được coi là không giới hạn, nên phải khớp cùng trường kia. Cron dùng
múi giờ IANA (`--tz`, mặc định lấy múi giờ đã cấu hình); chạy theo chu kỳ thì không.

Khi đồng hồ đổi giờ, việc ghim vào giờ cụ thể (không có `*` ở trường phút hay giờ) chạy một lần trong
giờ bị lặp lại, và chạy ở phút đầu tiên còn tồn tại sau giờ bị nhảy qua. Việc có `*` ở một trong hai
trường thì cứ chạy theo đồng hồ.

### Một phiên chạy cư xử thế nào

- Một việc không bao giờ chạy hai lần cùng lúc, và không chạy hai lần cho cùng một mốc đã lên lịch.
- `run-now` ghi lại một phiên chạy nhưng không đẩy lịch tới và không chạm vào bộ đếm lỗi. Ngoại lệ
  duy nhất là việc chạy một lần: `run-now` thành công chính là phiên chạy của nó, nên sau đó việc ấy
  xong và bị tắt. `run-now` bị từ chối khi một phiên chạy theo lịch của cùng việc vẫn đang chạy, dù gọi
  từ CLI hay từ dịch vụ nền.
- Phiên chạy chết giữa chừng (ví dụ dịch vụ nền bị kill) được đóng lại ở trạng thái hỏng và lịch đi tiếp,
  không chạy lại lần đã tiêu. Việc chạy một lần không có lần kế tiếp, nên một lần mất được tính là lỗi:
  nó đến hạn lại sau khoảng chờ thử lại bên dưới, và bị tắt kèm thông báo ở lần thứ ba.

### Thử lại và gửi đi

Việc cron hay theo chu kỳ chạy thành công thì lần kế tiếp tính từ lúc nó xong; việc chạy một lần thì
tự tắt. Phiên chạy hỏng được thử lại với khoảng chờ tăng gấp đôi, `60 giây x 2^(số lần hỏng - 1)`, tối
đa 30 phút: một phút sau lần hỏng đầu, hai phút sau lần thứ hai, rồi **tắt hẳn ở lần hỏng liên tiếp
thứ ba**. Một lần thành công đặt lại bộ đếm.

Thiếu khóa cũng không tính. Một phiên chạy hỏng vì biến môi trường của khóa AI chưa đặt được bỏ qua,
kèm một cảnh báo trong nhật ký. Việc vẫn bật và chạy lại ở lần tới. Nên lưu khóa bằng
`openalpha key set <NAME>` rồi `restart --background` là xong, không cần `schedule resume`. Bản tin sáng
cũng vậy: hôm đó bạn nhận một tin nói thiếu biến nào và cách đặt, thay cho câu
"gửi không được sau nhiều lần thử".

Hết ngân sách cũng không tính. Khi hạn mức ngày, tháng hay hạn mức riêng của agent chặn một phiên chạy,
việc nhảy sang lần kế tiếp theo lịch, còn việc chạy một lần thì được hỏi lại sau 30 phút. Phiên chạy bị
giới hạn tần suất chặn cũng được hỏi lại sau 30 phút. Nhờ vậy một ngày tiêu nhiều không làm việc tắt hẳn.

Tắt máy không bao giờ tính vào việc tự tắt. Việc chạy một lần bị cắt ngang vì tắt máy vẫn đến hạn và
chạy ở lần khởi động sau. Còn phê duyệt bị từ chối hay quá hạn thì việc vẫn kết thúc, vì chạy lại chỉ
lặp lại câu hỏi. Sau khi khởi động lại, những phiên chạy còn đang đánh dấu là chạy sẽ chuyển thành hỏng
với lý do dịch vụ nền khởi động lại.

Việc gửi diễn ra sau khi phiên chạy tốn tiền đã xong, nên gửi hỏng không biến phiên chạy thành thất bại và
không kích hoạt thêm một phiên chạy tốn tiền. Việc không có `--to` thì dùng đích mặc định nếu có, nếu
không thì đầu ra bị bỏ kèm một cảnh báo. Thông báo tự tắt đi tới `failure_target`, không tới đích của
chính việc đó (có thể đang hỏng).

### Phê duyệt

Việc có đích là kênh thì hỏi được kênh đó và chờ tối đa `approval_timeout_ms`. Việc không có đích thì
không có ai duyệt, nên công cụ cần phê duyệt đơn giản là không dùng được. Bị từ chối thì phiên chạy kết
thúc và không thử lại hành động bị từ chối. Quyết định chỉ có hiệu lực trong việc đó, không bao giờ
được dùng lại như trạng thái của cuộc trò chuyện.

### Hành vi khi hỏng

| Điều kiện | Kết quả |
| --- | --- |
| Số việc đến hạn nhiều hơn sức chứa | Phần còn lại vẫn đến hạn, chờ lượt rà sau |
| Phiên chạy agent hỏng | Được ghi lại; áp chính sách thử lại |
| Gửi hỏng sau khi chạy thành công | Phiên chạy vẫn là thành công; lỗi gửi được ghi lại |
| Lần hỏng liên tiếp thứ ba | Việc bị tắt; thông báo tùy chọn được gửi |
| Một phiên chạy vẫn đang diễn ra | Lượt rà này bỏ qua; lịch không đổi |
| Bộ thực thi của phiên chạy đã biến mất | Đóng lại ở trạng thái hỏng; lịch đi tiếp |
| Dịch vụ nền dừng | Ngừng nhận việc mới, việc đang chạy bị hủy, khâu tắt chờ tối đa năm giây |

---

## Heartbeat

Heartbeat là việc lặp lại thuộc về thư mục làm việc của một agent, không thuộc về một lịch. Dịch vụ nền quét
`HEARTBEAT.md` của từng agent mỗi 30 giây và chạy các tác vụ đã đến hạn. Tối đa ba agent chạy cùng lúc;
trong một agent, các tác vụ chạy tuần tự. Một tác vụ không bao giờ chồng lên chính nó.

Agent tham gia mạng xã hội còn có thêm một tác vụ cho mỗi mạng, tên `social:<network>`, do runtime
thêm vào chứ không viết trong tệp. Nó chạy cả khi không có `HEARTBEAT.md`, không nhận ngữ cảnh dùng
chung của tệp, và có nhịp cùng khung giờ hoạt động riêng. Xem
[mạng xã hội](mang-xa-hoi.md#một-lượt-ghé-diễn-ra-thế-nào). Tác vụ của agent đang tạm dừng được bỏ
qua, không tính là thất bại; phiên chạy bị cắt ngang vì tắt máy cũng vậy: tác vụ vẫn đến hạn và chạy lại ở lần khởi động sau.

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

### Một phiên chạy làm được gì

Cuối mỗi phiên chạy, agent hoặc im lặng, hoặc gửi bạn một bản tóm tắt. Nó cũng có thể xin xem lại một
việc ở lần đến hạn kế tiếp của chính tác vụ đó (một cam kết): tối đa 5 cam kết mỗi lần, mỗi cam kết
dài tối đa 500 ký tự, đến hạn sau một phút tới ba mươi ngày. Phản hồi sai định dạng thì không gửi gì
và không tạo cam kết nào, nhưng phiên chạy vẫn tính là xong, nên một mô hình cứ trả lời sai không bị thử
lại mỗi 30 giây. Nội dung cam kết quay lại agent dưới dạng ngữ cảnh không đáng tin: nó không ghi đè
được tác vụ hay các quy tắc. Định dạng phản hồi và quy tắc lưu: [Bên trong](dev/van-hanh.md#giao-thức-phản-hồi).

### Chặn trùng

`duplicate_window` chặn một thông báo lặp lại đúng nội dung tới đúng đích đó trong cửa sổ. Nó chỉ làm
hết sức và chỉ nằm trong bộ nhớ, trong một danh sách giới hạn 200 mục, nên khởi động lại hay danh sách
đầy đều làm nó quên mục cũ, và một thông báo trùng có thể quay lại. Thông báo bị từ chối không bao giờ
được nhớ, nên phiên chạy đủ điều kiện kế tiếp sẽ thử lại.

### Khoảng chờ tăng dần

Phiên chạy không bao giờ xong (bị hủy, lỗi hay bị dừng) làm phiên chạy kế tiếp của tác vụ bị hoãn thêm
`60 giây x 2^(số lần hỏng - 1)`, tối đa 30 phút - cùng khoảng chờ với việc theo lịch. Một phiên chạy
xong xóa nó. Cùng khoảng chờ áp dụng cho phiên chạy đã xong nhưng không lưu được kết quả (lỗi lưu trữ) và lần
chạy ném lỗi: cả hai không được lặp lại mỗi 30 giây. Tác vụ đang chờ đơn giản là không được chọn: nó không bao giờ bị tắt, và không có gì
được gửi đi trong lúc chờ.

### Hành vi khi hỏng

| Điều kiện | Kết quả |
| --- | --- |
| Tệp không đọc được hoặc quá cỡ | Không chạy |
| Tác vụ sai định dạng hoặc chưa tới hạn | Bỏ hoặc bỏ qua |
| Engine hủy hoặc lỗi | Không thông báo; bộ đếm lỗi tăng và phiên chạy kế tiếp bị hoãn |
| Không lưu được kết quả | Phiên chạy tính là hỏng: bộ đếm lỗi tăng và phiên chạy kế tiếp bị hoãn |
| Phản hồi không hợp lệ | Vẫn tính là xong; không gửi gì |
| Đích gửi không hợp lệ | Cảnh báo; các đích khác vẫn tiếp tục |
| Bộ thông báo từ chối một đích | Cảnh báo; thông báo đó không được nhớ |
| Chạm trần cam kết | Giữ các cam kết hiện có; số lượng được ghi log |

## Khi không ghi được tệp log

Đĩa đầy hay hỏng không làm dịch vụ nền câm mãi mãi. Sau năm lần ghi liên tiếp thất bại, việc ghi log ra tệp
tạm dừng 30 giây (một dòng trên stderr báo điều đó) rồi thử lại bằng một đoạn mới; khi một lần ghi
thành công trở lại, một dòng stderr khác báo đã phục hồi. Bản ghi đến trong lúc tạm dừng bị bỏ, và dòng
log `fatal` của một lần sập được ghi ra terminal thay vào đó.

## Tự chạy khi đăng nhập

Trên máy để bàn, `openalpha autostart enable` đăng ký `start --background` chạy mỗi lần đăng nhập. Nhờ
vậy bản tin sáng và cảnh báo vẫn đến sau khi khởi động lại máy. Thứ được đăng ký tùy hệ điều hành:

- macOS: một launchd agent.
- Linux: một unit người dùng của systemd. Trên máy chủ không ai đăng nhập, chạy thêm
  `loginctl enable-linger $USER`.
- Windows: một mục trong khóa Run.

`openalpha autostart` cho biết đã bật chưa, và `autostart disable` gỡ nó (dịch vụ nền đang chạy vẫn tiếp
tục). Lệnh cần bản cài đặt, không dùng được với bản chạy từ mã nguồn, và có hiệu lực từ lần đăng nhập
tới.

Phiên chạy lúc đăng nhập không thấy biến chỉ export trong shell, nên hãy lưu khóa bằng
`openalpha key set`. `enable` nêu tên mọi khóa mà cấu hình của bạn đọc nhưng chỉ đặt trong shell, kể cả
khóa nguồn dữ liệu như `FRED_API_KEY`. Unit nó ghi tên là `openalpha-autostart`. Unit này tách khỏi dịch
vụ viết tay bên dưới, vốn vẫn là cách chạy một máy chủ API.

## Chạy API trên máy chủ

Chạy dịch vụ nền trên máy chủ của bạn rồi cho một ứng dụng khách nối vào.

1. **Cài đặt.** Trên Linux hoặc macOS, chạy script cài đặt trong
   [README](../README.md#bắt-đầu-nhanh) với `OPENALPHA_NO_ONBOARD=1`. Lệnh được cài nằm ở đường
   dẫn mà `command -v openalpha` in ra (mặc định `~/.local/bin/openalpha`); unit bên dưới phải dùng
   đường dẫn đó.
2. **Cấu hình.** `openalpha setup write <nhà cung cấp> <mô hình>` ghi `~/.openalpha/config.toml` với
   một mô hình (`openalpha setup catalog` liệt kê các nhà cung cấp). Hoặc
   tải [config.sample.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.sample.toml)
   vào đó rồi tự đặt chuỗi mô hình (API bật sẵn). Mỗi mô hình ghi tên biến môi trường chứa
   khóa của nó (`api_key_env`); đặt biến đó trên máy chủ.
3. **Giữ cho chạy liên tục.** Một unit systemd cho người dùng, khóa nằm trong `~/.openalpha/env` (mỗi
   dòng một `TÊN=giá-trị`, quyền 0600):

   ```ini
   [Unit]
   Description=OpenAlpha
   After=network-online.target

   [Service]
   ExecStart=%h/.local/bin/openalpha start
   # Tùy chọn: dịch vụ nền cũng tự đọc khóa lưu bằng `openalpha key set` trong ~/.openalpha/env.
   EnvironmentFile=-%h/.openalpha/env
   ExecReload=/bin/kill -USR2 $MAINPID
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Chạy `systemctl --user enable --now openalpha`, rồi `loginctl enable-linger $USER` để nó vẫn chạy
   khi bạn đăng xuất. `systemctl --user reload openalpha` khởi động lại dịch vụ nền tại chỗ, giữ nguyên
   pid. Khởi động lại từ trang văn phòng cũng làm như vậy. Để nâng cấp, chạy
   `systemctl --user stop openalpha; openalpha upgrade; systemctl --user start openalpha`. Dịch vụ nền
   do dịch vụ quản lý thì `upgrade` không tự khởi động lại.
4. **Mở trang văn phòng.** Chạy `openalpha web` trên máy chủ (dịch vụ nền phải đang chạy). Trên chính màn hình của
   máy chủ, nó mở trình duyệt cho bạn. Qua SSH, nó in hai thứ thay vào đó: một lệnh đường hầm để chạy trên máy của
   bạn, chẳng hạn `ssh -N -o ExitOnForwardFailure=yes -L 18765:127.0.0.1:8765 user@server`, và một liên kết
   (`http://127.0.0.1:18765/#code=...`) để mở khi đường hầm đã lên. Cổng đầu máy bạn của đường hầm là
   cổng của máy chủ cộng 10000 (trừ đi, nếu vượt cổng 55535). Nhờ vậy nó không đụng dịch vụ nền đang chạy
   trên máy bạn, và nếu cổng đó đã bận thì `ssh` dừng với lỗi. Liên kết chỉ dùng được một lần, trong 5
   phút; cần liên kết mới thì chạy lại `openalpha web`.

   Với ứng dụng desktop, chạy `openalpha connect`. Nó in địa chỉ và token trên hai dòng riêng. Hãy đưa
   cho ứng dụng địa chỉ và token đó, đừng dán vào trình duyệt, và giữ kín token.
5. **Nối từ bên ngoài.** API chỉ nghe trên `127.0.0.1` của máy chủ, nên đường hầm SSH ở trên không cần gì thêm.
   Muốn nối mà không qua đường hầm, chọn một cách theo thứ tự này:
   - **SSH**, không cần tên miền: không phải cài gì. `openalpha web` in sẵn đường hầm.
   - **Tailscale**: chạy `tailscale serve --bg 8765` trên máy chủ, rồi đặt `[api] public_url` là địa chỉ
     `https://<máy>.<tailnet>.ts.net` mà nó hiện ra và khởi động lại dịch vụ nền.
   - **Caddy** với tên miền: `alpha.example.com { reverse_proxy 127.0.0.1:8765 }`, rồi đặt
     `[api] public_url = "https://alpha.example.com"` và khởi động lại dịch vụ nền.

   Bất cứ thứ gì đứng trước dịch vụ nền (proxy, đường hầm, tên miền) đều cần `public_url`. Chính nó bật
   các giới hạn bên dưới và cookie đăng nhập `__Host-`.

   Khi chưa đặt, dịch vụ nền chỉ bắt được proxy gửi `X-Forwarded-For` hoặc `Forwarded`, hay một `Host`
   không phải tên cục bộ. Nó từ chối chúng kèm một câu nêu tên `public_url`. Proxy không gửi cả hai thì
   trông như yêu cầu cục bộ. Một `proxy_pass` nginx trần là trường hợp đó: nó gửi
   `Host: 127.0.0.1:<cổng>` và không có tiêu đề chuyển tiếp nào. Vì vậy hãy đặt `public_url` trước khi
   mở dịch vụ nền ra ngoài, và cho nginx gửi `proxy_set_header Host $host;` cùng
   `proxy_set_header X-Forwarded-For $remote_addr;`.

   Ngoài ra, dịch vụ nền chỉ trả lời yêu cầu gửi tới `127.0.0.1`, `localhost` hoặc `[::1]` (cổng nào cũng
   được, nên đường hầm SSH dùng như cũ). Điều này chặn trang web giở trò DNS rebinding. Khi đã đặt
   `public_url`, `openalpha web` in liên kết `https://` thay vì đường hầm.

   Đoán sai sẽ bị làm chậm lại:

   - Năm lần sai mã API hoặc mã đăng nhập sẽ tạm dừng nơi gửi đó trong 30 giây. Mỗi lần dừng sau tăng
     gấp đôi, tối đa một giờ. Một giờ không sai lần nào thì tính lại từ đầu.
   - Yêu cầu qua `public_url` được phân biệt theo địa chỉ cuối cùng trong `X-Forwarded-For` (địa chỉ do
     proxy của bạn thêm vào). Nên người đoán mã trên internet không bao giờ làm dừng terminal hay CLI của
     bạn trên cùng máy.
   - Trong khoảng dừng, mọi mã từ nơi gửi đó đều bị từ chối, đúng hay sai, nên không lần đoán nào được
     kiểm. Trình duyệt đã đăng nhập vẫn dùng bình thường.
   - Hết khoảng dừng, một mã đúng sẽ xóa số lần sai.
6. **Nối ứng dụng khách.** Đưa cho ứng dụng địa chỉ và mã API; mọi yêu cầu gửi kèm mã dưới dạng
   `Authorization: Bearer <mã>`. Tối đa 8 luồng ứng dụng (`/v1/ws`) mở cùng lúc; lần bắt tay thứ chín bị từ
   chối với 503 `too_many_streams`.

**`public_url` thay đổi điều gì.** Khi dịch vụ nền đã với tới được từ bên ngoài, ứng dụng được tin ít hơn, nên đặt
`public_url` còn:

- tắt việc đặt lệnh: các đường đặt lệnh của API và `/trade` từ ứng dụng bị từ chối (tắt chức năng mua từ ứng
  dụng cũng đi kèm) cho tới khi bạn đặt `[api] orders = true`. Telegram và dòng lệnh vẫn tắt chức năng mua được;
- giữ lệnh shell, việc ghi tệp, công cụ của máy chủ MCP hay plugin và công cụ mạng xã hội ra khỏi các chat từ
  ứng dụng và từ trang;
- cho ứng dụng tạo công việc chỉ trả lời trong ứng dụng; công việc cho chat khác thì tạo trên máy chủ
  (`openalpha schedule add ... --to`);
- để việc duyệt ghép nối và các khóa truy cập của từng kênh chỉ làm được trên máy chủ: duyệt bằng
  `openalpha pair approve <mã>` và đổi `allowed_ids` cùng các khóa tương tự trong tệp cấu hình.

Khóa sàn cũng nên cẩn thận như vậy: chỉ cấp quyền giao dịch, không bao giờ cho rút tiền, và gắn với địa chỉ
IP của máy chủ trên sàn, để khóa lộ ra cũng không rút được tiền đi.

**Nâng cấp.** Nếu bạn đang chạy Caddy với `header_up Host`, hãy xóa dòng đó và đặt `public_url`. Proxy giờ
chuyển đúng tên công khai, như mặc định. Sau đó ai cũng chạy `openalpha api rotate` một lần. Lệnh này khởi
động lại dịch vụ nền, để mã mà trang cũ đã lưu trong trình duyệt hết dùng được. Sau khi khởi động lại,
`openalpha web` đăng nhập lại từng trình duyệt.

Khi đã nối, trang văn phòng cho bạn thấy dịch vụ nền đang làm gì ngay lúc nó diễn ra:

- từng câu trả lời và câu lệnh chạy lâu đang chạy, cùng bước mới nhất của nó;
- mọi yêu cầu phê duyệt và câu hỏi còn chờ trên bất kỳ kênh nào;
- một lần khớp lệnh (lệnh cắt lỗ hoặc chốt lời đang treo được bán, hoặc một lần khớp của `/trade`);
- từng công cụ mà một phiên chạy bắt đầu và kết thúc;
- lời của từng vai trong cuộc tranh biện sau khi một `/suggest` được kiểm chứng (chỉ hiện trong trang
  văn phòng, không bao giờ gửi tới chat);
- một agent mới gia nhập;
- lúc chạm hạn mức chi tiêu;
- lần cuối kiểm tra cảnh báo.

Ba loại tin vào chuông mà không tới chat nào trừ khi `[notices] chat` liệt kê: một đề xuất đã có kết quả,
tin về mã bạn đang giữ, và chỉ số giảm mạnh trong phiên. Tin về mã đang giữ chỉ gồm những mã dịch vụ nền
đã đọc, vì không có gì đi lấy tin cho các mã bạn giữ theo lịch.

Trang văn phòng nối muộn thì hỏi bức tranh hiện tại trước, rồi theo dõi luồng. Yêu cầu hỏi trên Telegram
hay kênh khác vẫn hiện trong trang văn phòng, nhưng được trả lời ở nơi nó được hỏi; trang văn phòng nói rõ
điều đó thay vì trả lời hộ.

Trang văn phòng dừng được mọi phiên chạy bạn thấy, kể cả phiên bắt đầu từ Telegram. Dừng chỉ là báo cho
nó dừng, và nó kết thúc ở trạng thái đã dừng, dù là một câu trả lời đang chạy hay một câu lệnh. Phiên chạy
đã xong thì được báo là không còn nữa. Trang văn phòng cũng liệt kê các chat đã ghép nối trên từng kênh và
bỏ ghép nối được một chat. Kết quả giống `pair revoke`: tin kế tiếp của chat đó lại bị hỏi mã ghép nối.

Trang văn phòng còn đọc được những gì dịch vụ nền biết mà không cần câu lệnh nào:

- lịch sử mọi cuộc chat, kể cả Telegram, tìm kiếm được nhưng chỉ nói tiếp được ở những chat do chính
  trang văn phòng mở;
- từng nguồn dữ liệu và lần gần nhất nó trả lời;
- các máy chủ dịch vụ nền có thể gọi tới và thứ gì được gửi tới từng nơi;
- các mô hình đang dùng, cùng giá và chi phí thường lệ của một phiên chạy trên mỗi mô hình;
- sức mạnh ngành theo thị trường;
- danh sách theo dõi của bạn, mà trang văn phòng sửa được.

Khi dịch vụ nền dừng, API ngừng nhận kết nối và yêu cầu trước tiên, trước khi các phiên chạy được chờ
xong. Yêu cầu đang chạy vẫn hoàn tất. Chat hay lệnh gửi qua một luồng đang mở được trả lời bằng lỗi
`unavailable`. Phiên chạy đang diễn ra vẫn hoàn tất trong khoảng chờ, và các luồng đóng sau đó.

Trang văn phòng cũng khởi động lại được dịch vụ nền dù nó chạy ở đâu: trong cửa sổ terminal, ở nền hay
dưới một dịch vụ (macOS và Linux). Bạn chọn lúc nào:

- khi không còn gì đang chạy (chờ tối đa khoảng hai phút, hết hạn thì vẫn khởi động lại), hoặc
- ngay lập tức.

Dịch vụ nền dừng theo cách thông thường. Nên yêu cầu phê duyệt còn chờ bị từ chối, và phiên chạy nào
không xong trong khoảng ân hạn lúc dừng thì bị ngắt. Trang văn phòng báo các yêu cầu phê duyệt đó trước.

Sau đó nó chạy lại ngay trong cùng tiến trình: cùng pid, cùng cửa sổ terminal, cùng dòng lệnh và cùng môi
trường. Khóa lưu bằng `openalpha key set` được đọc lại (biến bạn export trong shell đã bật dịch vụ nền thì
giữ giá trị cũ). Ở terminal, nhật ký tiếp tục ngay trong cửa sổ đó. Khi dịch vụ nền chạy lại, chuông hiện
"Đã khởi động lại dịch vụ nền." (dòng mới thay cho các dòng cùng nội dung còn chưa đọc), và không có gì
gửi tới chat.

Nếu phiên chạy mới không khởi động được (tệp chạy bị di chuyển hoặc xóa chẳng hạn), dịch vụ nền vẫn dừng
và báo ngay trên terminal của nó, hoặc trong nhật ký lỗi nếu nó chạy nền. Bạn bật lại bằng
`openalpha start`.

Cũng có thể làm trên dòng lệnh:

- `openalpha restart` nhờ dịch vụ nền đang chạy tự khởi động lại, chờ nó chạy lại rồi in kết quả.
- `restart --now` không chờ việc đang chạy.
- Muốn nhờ được thì `[api]` phải bật và lệnh phải đọc được token. Thiếu một trong hai, `restart` dừng
  dịch vụ nền rồi chạy lại từ shell của bạn, như `--background`.
- Dù vậy `kill -USR2 <pid>` vẫn khởi động lại tại chỗ ngay, như `--now`. Unit systemd dùng được nó làm
  `ExecReload`.
- `restart --background` vẫn dừng dịch vụ nền rồi chạy lại ở nền từ shell của bạn, với các biến của
  shell đó.

Trên Windows dịch vụ nền không tự khởi động lại tại chỗ được. Trang văn phòng chỉ khởi động lại dịch vụ
nền bật bằng `--background`, qua một tiến trình phụ. Nếu thất bại, dịch vụ nền vẫn chạy như cũ và chuông
chỉ dẫn xem nhật ký restart trong thư mục dữ liệu. Dịch vụ nền chạy trong terminal thì dừng bằng Ctrl+C
rồi bật lại.

Đang có một lần khởi động lại hoặc cập nhật, hay dịch vụ nền đang dừng, thì yêu cầu mới bị từ chối.

### Lệnh chạy trong dịch vụ nền

Khi dịch vụ nền đang chạy và API bật, những lệnh đọc hoặc đổi trạng thái của nó sẽ chạy ngay bên trong nó,
thay vì dựng một bản app thứ hai bên cạnh. Gồm `chat`, `status`, `cost`, `history`, `agent`, `memory`,
`skill`, `plugin`, `workflow`, `social`, `schedule`, `pair` (`approve`, `deny`, `list`, `revoke`),
`db integrity`, `db stats` và mọi lệnh do plugin thêm. Việc chỉ chạy ở một nơi, nên một cuộc chat bạn mở
ở terminal hiện trên trang văn phòng như mọi phiên chạy khác, ở kênh `cli`. Ở dòng lệnh bạn không thấy
khác biệt: cùng đầu ra, cùng câu hỏi, trình soạn thảo của chính bạn, Ctrl+C và cùng mã thoát.

Những lệnh này vẫn chạy ngay trong terminal: `help`, `version`, `upgrade`, `doctor`, `onboard`, `start`,
`stop`, `restart`, `autostart`, `provider`, `config`, `key`, `auth`, `zalo`, `logs`, `setup`, `connect`,
`web`, `api`, `mcp`, và mọi lệnh cần dịch vụ nền đang dừng (`history clear` là một). `db backup` và các lệnh
đọc hoặc ghi tệp do bạn chỉ định cũng vậy: `db export --out`, `plugin install` và `skill install`.
Nếu không, đường dẫn tương đối sẽ được hiểu theo thư mục của dịch vụ nền, mà dịch vụ nền khởi động lúc đăng nhập
thường không ghi được vào Desktop, Documents hay Downloads.

Một lệnh chạy ngay trong terminal khi:

- bạn thêm `--local`, để bỏ qua dịch vụ nền khi nó bị treo hoặc khi cần gỡ lỗi. Thêm `--log-level` cũng có tác
  dụng tương tự, vì cờ này hỏi về chính tiến trình này;
- không có dịch vụ nền nào đang sống giữ thư mục dữ liệu này, hoặc nó nạp một tệp cấu hình khác;
- `[api] enabled` là `false`, dịch vụ nền báo API đang suy giảm, không đọc được token hoặc token không
  khớp với token của dịch vụ nền, hoặc dịch vụ nền không trả lời trong một giây;
- dịch vụ nền chạy bản khác với CLI. Chỉ trường hợp này có lên tiếng: một dòng nêu cả hai bản và bảo bạn chạy
  `openalpha restart --background`.

Lệnh được chuyển đi chạy với cấu hình, tệp khóa và biến môi trường mà dịch vụ nền đã đọc lúc khởi động, giống
như một cuộc chat từ trang văn phòng hay Telegram. Sau khi bạn sửa `config.toml` hoặc thêm khóa vào tệp
khóa, hãy chạy `openalpha restart` để thay đổi có hiệu lực. Khóa nhà cung cấp bạn xuất ở shell này thì cần
`openalpha restart --background`, vì chỉ khi khởi động từ shell này nó mới được mang theo. Môi trường của terminal chỉ đi theo để dựng màu, bề rộng và trình soạn thảo.

Nhấn Ctrl+C một lần là ngắt lệnh như khi chạy ở terminal. Nhấn lần hai trước khi lệnh trả lời sẽ đóng kết
nối, dịch vụ nền dừng mọi thứ lệnh đã bắt đầu, và CLI thoát `130`.

Nếu dịch vụ nền dừng khi một lệnh đang chạy (khởi động lại, sập, hoặc im lặng khoảng năm phút), hoặc không nhận lệnh trong vài giây sau khi kết nối mở, CLI sẽ nói rõ
và thoát `17` (`daemon_lost`). Nó không bao giờ chạy lại lệnh đó ở đây, nên không có gì bị làm hai lần.
Hãy xem nó đã làm tới đâu rồi mới thử lại: `openalpha history list` với một cuộc chat, rồi
`openalpha chat --continue` để nối tiếp; với lệnh khác thì xem lệnh liệt kê của chính nó.

Dịch vụ nền ghi log tên lệnh, mã thoát và thời gian của mỗi lệnh được chuyển đi, không bao giờ ghi đối số, câu
trả lời hay đầu ra.

## Trang văn phòng

Khi API bật, dịch vụ nền còn phục vụ một trang web ngay tại địa chỉ của nó, `http://127.0.0.1:<cổng>/` (cổng 8765 nếu bạn không đổi). Cứ hình dung đó là một bức tường kính nhìn vào dịch vụ nền: một văn phòng nhỏ nơi trợ lý, nhóm nghiên cứu và các agent của bạn làm việc cùng lúc với dịch vụ nền. Mọi chuyển động bạn thấy đều là một phiên chạy, một bước hay một câu hỏi đang chờ bạn có thật; không có gì được dựng sẵn cho có vẻ bận rộn. Trang không bao giờ đặt lệnh và không tự khởi động một phiên chạy AI nào: phiên chạy chỉ bắt đầu khi bạn gửi một câu lệnh, hoặc bấm một nút ghi rõ câu lệnh, như "/suggest VPB". Nút nào còn cần bạn nhập thêm, như Đặt cảnh báo, thì chỉ điền câu lệnh vào ô để bạn viết nốt rồi gửi.

### Mở trang

Chạy `openalpha web` (xem [Chạy API trên máy chủ](#chạy-api-trên-máy-chủ)). Lệnh in một liên kết dùng một lần và, trên máy để bàn, tự mở trình duyệt cho bạn. Trang đổi mã trong liên kết lấy một lần đăng nhập cho trình duyệt đó và xóa mã khỏi thanh địa chỉ. Không có liên kết thì trang hiện lệnh cần chạy thay vì hỏi mã.

- Liên kết chỉ dùng một lần và hết hạn sau 5 phút. Liên kết đã dùng hay đã hết hạn cho một dòng nhắc bạn chạy lại lệnh, và vài lần sai liên tiếp khiến dịch vụ nền tạm dừng đăng nhập một lúc.
- Một lần đăng nhập kéo dài 30 ngày kể từ lần dùng cuối, và mỗi lần ghé thăm lại gia hạn nó. Trình duyệt chỉ giữ một cookie đăng nhập mà mã trong trang không đọc được; mã API không bao giờ tới nó.
- Cài đặt > Hiển thị, mục "Kết nối của trang này", liệt kê các trình duyệt đang đăng nhập, lúc đăng nhập và lần cuối thấy, cùng nút đăng xuất từng cái, kể cả cái đang dùng. Trình duyệt bị đăng xuất theo cách này rời khỏi trang ngay.
- `openalpha api rotate` đăng xuất mọi trình duyệt và khởi động lại dịch vụ nền, nên mã cũ cũng hết dùng được. Sau đó chạy `openalpha web` lại.
- Trang từ chối chạy bên trong một khung (frame), và ở bản phát hành thì nó chỉ được nói chuyện với đúng dịch vụ nền đã phục vụ nó.
- Dịch vụ nền chỉ trả lời địa chỉ trên chính máy này (`127.0.0.1`, `localhost` hoặc `[::1]`) hoặc `public_url` của bạn, từ chối lời gọi API do trang web khác khởi phát, và chỉ mở luồng trực tiếp cho đúng trang nó phục vụ, nên một ứng dụng web khác trên máy không dùng ké được.
- Safari trước 16.4 không gửi tiêu đề mà dịch vụ nền dựa vào, nên trang báo trình duyệt đang chặn cookie cho địa chỉ này dù thực ra không. Hãy cập nhật Safari.
- Nếu không nối được dịch vụ nền, trang nói thẳng bằng một dòng rồi tự thử lại, và mở ra ngay khi dịch vụ nền trả lời. Nếu đang đăng nhập mà mất kết nối, một thanh hiện đồng hồ đếm lùi lần thử lại, nút "Thử ngay" và dòng báo các phiên chạy vẫn tiếp tục ở dịch vụ nền. Khi nối lại, trang hỏi lại bức tranh hiện tại rồi theo dõi tiếp. Trang cũ hơn dịch vụ nền thì nhắc bạn tải lại. Khối nào làm mới không được vẫn giữ số liệu tốt gần nhất và ghi rõ lúc nào đọc.

### Trên màn hình có gì

- **Đầu trang.** Chip việc đang chạy (cái gì đang chạy và cái gì tiếp theo: dừng một phiên chạy, hoặc chạy lại một việc theo lịch), công tắc 2D | 3D, nút Chỉ thông tin (không hiện trên màn hình hẹp), chip chi phí AI, đồng hồ văn phòng, chuông thông báo, nút "?" liệt kê các phím tắt và Cài đặt.
- **Dải giá.** Nổi trên phần đầu khung cảnh văn phòng, ngay dưới nút chuyển tầng, chỉ số chuẩn (VN-Index, BTC) của từng thị trường bạn giao dịch và danh sách theo dõi chạy ngang qua. Mã thủng cắt lỗ và đề xuất mua mới được đánh dấu.
- **Văn phòng.** Khung cảnh, chiếm cả trang với bảng thông tin nổi phía bên phải; mô tả ở dưới.
- **Bảng thông tin.** Bốn thẻ, cộng một thẻ riêng cho thứ bạn bấm vào.
  - *Hôm nay* mở đầu bằng một dòng về phiên của thị trường nhà: sàn của nó, như HOSE, đang giao dịch
    hay chưa, tới mấy giờ, và giá đọc lúc nào. Tiếp theo, theo thứ tự: những gì cần bạn (việc chờ
    duyệt, mã thủng cắt lỗ; bấm "Mở" để xem trong chuông); những gì đáng xem; danh mục của bạn với nút
    "Xem danh mục" (giá trị, đang giữ gì, mã thủng cắt lỗ và các lệnh chốt lời đang chờ ở sàn); thị
    trường Việt Nam và các thị trường khác (mỗi thị trường kèm các mã tăng mạnh nhất và giảm mạnh nhất
    của phiên, hoặc của 24 giờ qua với thị trường không đóng cửa, cùng giá trị giao dịch); sự kiện sắp
    tới; tin nổi bật; và hôm nay agent đã làm gì, gồm cả việc chạy khi bạn không mở trang. Khối vĩ mô
    và khối tin có nút "Xem đầy đủ" mở thẻ Thị trường. Những gì dịch vụ nền khởi động mà còn thiếu, ví
    dụ chưa có khóa API của sàn, nằm ở cuối thẻ.
  - *Danh mục* gồm tổng quan, hiệu quả, lịch sử, cân bằng lại và danh sách theo dõi cùng cảnh báo giá,
    thêm thẻ *Lệnh* khi có sàn đặt lệnh được. Mọi loại dòng sổ đều được ghi, sửa, xóa ngay tại đây và
    có hoàn tác, còn Lịch sử đối chiếu sổ với các sàn của bạn (xem
    [Giao dịch](giao-dich.md#trên-trang-văn-phòng)).
  - *Thị trường* gồm toàn bộ số đọc vĩ mô, phiên gần nhất đã chốt, tin tức và các chủ đề của bạn (ở
    dưới).
  - *Đề xuất* gồm các kế hoạch đang mở, màn hình cơ hội, thành tích và kết quả nghiên cứu, kèm số đề
    xuất mới bạn chưa xem.
  - Bấm một mã ở bất cứ đâu thì thẻ của mã đó mở ra: giá (kèm nút "Lấy giá mới" đọc ngay giá của riêng
    mã đó), biểu đồ các phiên gần nhất có trục giá và trục ngày cùng các mức của kế hoạch, mã bạn đang
    giữ, "Vì sao?" để xem lý lẽ sau một đề xuất, các đề xuất trước đây và các agent của bạn nghĩ gì.
  - Bấm một agent của bạn trong văn phòng thì thẻ của nó mở ra (xem
    [Agent](tro-ly.md#từ-trang-văn-phòng)).
  - Hàng quay lại đưa bạn về chỗ vừa xem, và bảng thu gọn được thành một dải biểu tượng.
- **Trò chuyện.** Cuộc trò chuyện với trợ lý, nằm bên phải. Các cuộc trò chuyện trước, kể cả của Telegram, tìm được (cuộc trò chuyện chưa có lời nào thì không được liệt kê), chia thành hôm nay, 7 ngày qua và cũ hơn (theo ngày của dịch vụ nền, không theo trình duyệt), và tải thêm cuộc trò chuyện cũ khi bạn cần; chỉ những cuộc chat do trang mở mới nói tiếp được; khi đang mở cuộc trò chuyện của kênh khác, ô gõ ở cuối trang báo điều đó và cho bạn tiếp tục trong cuộc trò chuyện mới. Menu của mỗi dòng mở cuộc trò chuyện đó ở một thẻ riêng, trong thẻ chỉ có khung chat, và xóa được cuộc trò chuyện do trang mở: dòng biến mất ngay và một thanh ở cuối trang cho bạn Hoàn tác trong vài giây (đồng hồ dừng khi thẻ bị ẩn; đóng thẻ trước thì không xóa gì). Cuộc trò chuyện còn câu trả lời đang chạy thì không xóa được, và cuộc trò chuyện Telegram không bao giờ bị xóa ở đây. Câu trả lời `/research` hiện các bước khi đang chạy và nguồn đánh số dưới câu trả lời (xem [Nghiên cứu sâu](nghien-cuu.md#trên-trang-văn-phòng)).
- **Ô câu lệnh.** Nổi trên phần chân khung cảnh văn phòng, hoặc trên ảnh văn phòng ở chế độ Chỉ thông tin; trên màn hình hẹp, ở khung Thông tin và Trò chuyện, nó nằm ở cuối trang: ai nhận câu bạn gõ và ô nhập (Enter là gửi; trên điện thoại còn có nút Gửi). Khi bạn gõ, chip agent và nút Trò chuyện thu lại chỉ còn biểu tượng; trên điện thoại chip agent và nút Gửi luôn chỉ là biểu tượng. Xem [Lệnh](lenh.md#ô-câu-lệnh-trên-trang-văn-phòng).
- **Chuông và việc đang chạy.** Chuông liệt kê thông báo và các yêu cầu đang chờ bạn. Yêu cầu duyệt hỏi từ trang này được trả lời ngay trong chuông: duyệt một lần, ghi nhớ hoặc từ chối. Đồng hồ đếm lùi cho biết khi nào hết hạn, và yêu cầu hết giờ mà chưa trả lời thì bị từ chối. Mỗi yêu cầu chỉ được trả lời một lần: nếu nó hiện ở cả chuông lẫn khung chat thì chỉ một câu trả lời được gửi đi, và thẻ còn lại hiện đúng câu trả lời đó, kèm dòng "đã được trả lời" nếu bạn chọn khác ở thẻ này. Yêu cầu hỏi trên Telegram hay kênh khác vẫn được liệt kê nhưng trả lời ở nơi nó được hỏi. Danh sách việc cho thấy cái đang chạy (dừng được, sau một bước xác nhận), cái sắp chạy, cái đang chờ một sự kiện (kiểm tra theo chu kỳ, không tốn AI) và các việc bảo trì tự chạy, kèm cách sửa việc nào đang lỗi; nút "Thêm lịch" đặt một việc cho trợ lý.
- **Chi phí.** Chip cho thấy hôm nay đã tiêu bao nhiêu so với mức trần ngày; bấm để xem cả tháng, chi phí theo từng việc và dòng ngân sách, còn "Xem đủ báo cáo" mở báo cáo cho hôm nay, 7 hoặc 30 ngày qua, hay tháng này. Xem [Ngân sách](ngan-sach.md#trên-trang-văn-phòng).
- **Cài đặt.** Biểu tượng bánh răng mở ra: hồ sơ đầu tư, bộ nhớ, lịch và theo dõi, agent và AI, kênh
  nhắn tin, nhà cung cấp, sàn giao dịch, công cụ, dữ liệu và kết nối, hiển thị, và nâng cao, nơi có ô
  sửa `config.toml` thô.
  - Ô sửa hiện mọi giá trị bí mật (giá trị `env` của máy chủ MCP, mọi token, secret, mật khẩu hay khóa
    API ghi thẳng trong file) là `********`. Cứ để nguyên thì giá trị đã lưu được giữ.
  - Một số mục chỉ đổi được bằng câu lệnh hoặc sửa thẳng trong `config.toml`, vì chúng quyết định
    dịch vụ nền chạy gì, dùng file nào hay gửi khóa đi đâu: plugin, câu lệnh khởi chạy, tham số,
    `env`, địa chỉ và cách kết nối của máy chủ MCP, mọi khóa `*_env` cùng mọi mục khác ghi tên biến
    môi trường (`[trading.sources]`, `[trading.venues.<id>] credentials`), `base_url` và
    `fallback_base_url`, `[paths]`, `[log] file`, `[storage]`, `[api]`, `[update]` và
    `[trading.orders] allow_unattended`.
  - Khi đã đặt `[api] public_url`, `allowed_ids`, `operator_user_ids`, `pairing` và `dm_policy` của
    từng kênh cũng chỉ đổi được trên máy chủ.
  - Khi kiểm tra hay lưu một thay đổi ở những mục như vậy, trang sẽ từ chối và nêu tên từng mục. Ô chọn
    mô hình vẫn đổi được nhà cung cấp: khi đó nó đặt biến chứa khóa của chính nhà cung cấp đó và bỏ
    địa chỉ cũ.
  - Mỗi dòng nói rõ lưu xong có hiệu lực ngay hay cần khởi động lại. Bánh răng đếm các thay đổi đang
    chờ khởi động lại, và chân trang Cài đặt luôn có nút "Khởi động lại dịch vụ nền" (xem ở trên), kể
    cả khi không có gì đang chờ.
  - Bản thân các khóa thì nhập ở Nhà cung cấp, Sàn giao dịch và Công cụ (ở dưới). Những mục ghi tên
    biến chứa khóa và các địa chỉ `base_url` vẫn chỉ đổi được bằng câu lệnh, như danh sách ở trên.

### Những mục cài đặt nên biết

- **Khóa.** Nhà cung cấp, Sàn giao dịch và Công cụ liệt kê các khóa dịch vụ nền đọc cho mô hình, sàn, tìm kiếm web và các nguồn dữ liệu tùy chọn, mỗi khóa ghi đã lưu hay chưa có. Đổi nhận khóa trong một ô ẩn và lưu trên máy chủ, vào đúng tệp mà `openalpha key set` ghi (`<thư mục dữ liệu>/env`, chỉ mình bạn đọc được); khóa không bao giờ hiện lại, và dịch vụ nền đọc nó sau khi khởi động lại, việc mà bánh răng sẽ gợi ý. Bỏ hỏi lại một lần. Nếu biến đó cũng được đặt trong môi trường của máy chủ, dòng sẽ báo giá trị đó thắng. Mã API, token của bot trên từng kênh và biến của máy chủ MCP không bao giờ được liệt kê: những thứ đó đặt trên máy chủ. Khi đã đặt `[api] public_url`, không khóa nào đổi được ở đây; thay vào đó mỗi dòng hiện lệnh `openalpha key set <TÊN>` để bạn sao chép.
- **Nhà cung cấp.** Mỗi nhà cung cấp mà mô hình của bạn dùng, hoặc đã có khóa lưu, là một thẻ. "+ Thêm nhà cung cấp" đưa ra vài lựa chọn phổ biến và danh sách đầy đủ; thẻ chưa mô hình nào dùng có nút "Thêm mô hình", mở Agent và AI với một dòng mới trong chuỗi mô hình. "Đăng nhập ChatGPT" dùng gói thuê bao bạn đang có: trang hiện một mã và một liên kết, chờ trong lúc bạn đăng nhập ở trang đó, và thôi chờ khi bạn bấm Hủy hoặc sau 16 phút. Đăng xuất hỏi lại một lần. Cũng như khóa, khi đã đặt `public_url` thì chỉ đăng nhập được trên máy chủ.
- **Sàn giao dịch.** Mỗi sàn một khối với các ô khóa của nó và mục "Khóa này", kiểm tra khóa mà dịch vụ nền đã dùng lúc khởi động ("Kiểm tra lại" hỏi thẳng sàn). Khóa chỉ đọc là đủ để kiểm tra số dư và đồng bộ sổ; `/trade` cần quyền giao dịch. Đừng bao giờ bật quyền rút tiền.
- **Công cụ.** Nhà cung cấp tìm kiếm web (có hiệu lực sau khi khởi động lại) và các khóa nguồn dữ liệu tùy chọn. Nhà cung cấp tìm kiếm nào cần khóa thì cũng cần tên biến của khóa đó trong `config.toml`, mà chỉ câu lệnh hoặc sửa tệp mới đặt được.
- **Sức khỏe hệ thống.** Dữ liệu và kết nối chạy cùng các bước kiểm tra như `openalpha doctor`, lỗi đứng trước, mỗi mục kèm một dòng dễ hiểu về cách sửa và một nút tới đúng mục cài đặt để sửa. Lần đọc đầu chỉ kiểm tra trên máy này; "Kiểm tra lại" hỏi thêm các dịch vụ bên ngoài nhưng không bao giờ gọi mô hình, nên dòng nhà cung cấp chỉ bạn sang Thử kết nối. Các mục chỉ có nghĩa trong terminal (`config`, `daemon`, `trading`) nhắc bạn chạy `openalpha doctor` trên máy chủ, và mục cơ sở dữ liệu ở đây là bản kiểm tra nhẹ: kiểm tra toàn vẹn đầy đủ chỉ chạy từ terminal. Cũng mục này liệt kê các nguồn dữ liệu, các máy chủ bên ngoài mà dịch vụ nền gọi cùng thứ được gửi đi, và Ghi công cho dữ liệu bản đồ, ảnh và thời tiết mà văn phòng dùng.
- **Cập nhật.** Khi có bản phát hành mới, bánh răng có một chấm và Cài đặt mở ra với một dòng nêu phiên bản mới. Phần ghi chú cho biết có gì thay đổi (bản quan trọng được đánh dấu), kèm lệnh cần chạy trên máy chủ và nút sao chép; trang không bao giờ tự cập nhật, và danh mục, sổ giao dịch cùng cài đặt của bạn giữ nguyên. "Để sau" ẩn dòng đó tới phiên bản kế tiếp. Hiển thị cho biết phiên bản bạn đang chạy, kèm nút "Có gì mới". Khi `[update] check` tắt, trang nói rõ việc kiểm tra đang tắt.
- **Bộ nhớ.** Những gì trợ lý nhớ về bạn, chia theo agent và theo người nó đang trò chuyện cùng (CLI và trang dùng chung một nhóm). "Điều bạn đã cho mình biết" giữ những sở thích nó nhận ra khi trò chuyện; ghi chú là những gì nó tự lưu, hoặc bạn thêm bằng "+ Ghi nhớ", mỗi ghi chú tự quên sau `[memory] ttl_days` ngày kể từ lần cập nhật cuối. Ô tìm kiếm lọc những gì đang hiện; Quên ẩn một dòng và cho Hoàn tác trong vài giây, rồi xóa nó khỏi mọi nơi dùng tới. Dưới một câu trả lời trong chat, một dòng báo khi một sở thích vừa được ghi nhớ hay thay đổi, và "Ghi nhớ điều này" dưới một tin bạn gửi (không phải câu lệnh gạch chéo) mở hộp thoại "+ Ghi nhớ" với nội dung đó. Khóa chỉ dùng chữ không dấu, chữ số và `_ : . @ / -`, và ghi chú trông giống một khóa bí mật sẽ bị từ chối. AI đọc các ghi chú này, nên đừng ghi số tài khoản hay số tiền vào đó.
- **Mức chi tiết.** Hiển thị cho chọn Đơn giản hoặc Nâng cao (mặc định). Đơn giản cất bớt điểm số, nguồn, thang đo vĩ mô cùng bảng thành phần và phần chi tiết của kiểm tra sức khỏe; mọi cảnh báo, giá và mức vẫn còn nguyên. Lựa chọn có hiệu lực ngay và được giữ trong trình duyệt này.

### Thị trường, tin tức và chủ đề

Thẻ Thị trường có ba phần: *Thị trường*, *Tin tức* và *Chủ đề*.

**Thị trường.** Phần này mở đầu bằng nút "Cập nhật dữ liệu" cạnh ô chọn vùng.

- Nút gửi `/refresh` cho từng thị trường của vùng đang xem mà bạn còn theo dõi, không bao giờ kèm
  `force`. Nên thị trường đã đủ dữ liệu chỉ tốn một phiên chạy nhanh.
- Một lượt có thể dùng mô hình để đọc báo cáo vĩ mô, nên có thể tốn một chút. `/cost` cho biết đã tiêu bao nhiêu.
- Phiên chạy hiện ở chip đang chạy, kho dữ liệu trong văn phòng và khung chat, như `/refresh` gõ tay.
  Nút tắt khi còn một lượt đang chạy, và các khối bên dưới đọc lại khi lượt xong.

Sau đó, với vùng bạn chọn (vùng nhà đứng đầu, lựa chọn giữ trong trình duyệt này), thẻ hiện:

- **Đầy đủ số đọc vĩ mô**: trạng thái và chiều nghiêng; một dòng lãi suất tiền gửi 12 tháng và tỷ giá
  USD/VND (phần nào chưa có số thì bỏ); những thành phần bị để ngoài vì chưa có số đọc; phần mô hình
  đã có dữ liệu; và ở mức Nâng cao thì thêm thang đo cùng bảng các thành phần tạo nên con số, lực kéo
  mạnh nhất đứng đầu.
- **Giá của vùng đó**, kèm các mã tăng mạnh nhất và giảm mạnh nhất của từng thị trường (năm biến động
  mạnh nhất trên ngưỡng thanh khoản của thị trường đó, đứng cạnh nhau khi bảng rộng).
- **Dòng tiền theo mã**: năm mã khối ngoại mua ròng và bán ròng nhiều nhất; năm mã tự doanh mua ròng
  và bán ròng nhiều nhất; và năm mã giao dịch nhiều nhất. Giá trị rút gọn (như 76,5 tỷ), và ghi rõ
  khoảng thời gian đo khi không phải một phiên. Nhà cung cấp công bố số tự doanh trễ khoảng một phiên,
  nên khi chưa có thì danh sách lấy từ phiên gần nhất đã có số liệu, kèm ngày bên cạnh tiêu đề.
- **Sức mạnh ngành** xếp các ngành từ mạnh đến yếu, kèm biến động hôm nay. Khối hiện năm ngành mạnh
  nhất và năm ngành yếu nhất, phần còn lại nằm sau "Xem tất cả" khi thị trường có hơn mười ngành (chỉ
  có cho thị trường có phân ngành). Các khối này đọc lại cùng lúc với phần còn lại, không theo chu kỳ
  riêng.
- **Với Việt Nam, một ô chọn chỉ số** VN-Index, VN30 hoặc HNX:
  - năm mã kéo lên và năm mã kéo xuống chỉ số đó trong phiên, mỗi mã kèm giá và số điểm nó góp, có
    dấu, rồi một dòng cộng tổng phần các mã trong danh sách góp (không phải toàn bộ biến động của chỉ
    số);
  - phần định giá của nó: P/E và P/B, mỗi số đặt cạnh trung bình năm năm của nó; ROE suy ra từ hai số
    đó, kèm một dòng nói cách suy; tỷ suất cổ tức; và tỷ lệ mã trong rổ chỉ số nằm trên trung bình 50
    và 200 phiên.

  Danh sách được đọc khi mở thẻ và lặp lại mỗi phút. Dịch vụ nền giữ mỗi danh sách một phút kể từ lần
  đọc, nên hỏi lại trong phút đó không tốn lượt đọc nguồn. Còn định giá là số lượt làm mới gần nhất đã
  lưu, và được đọc lại khi một lượt làm mới xong. Các khối này và Dòng tiền theo mã ghi dưới tiêu đề
  dữ liệu đến ngày nào và đọc lúc nào.
- **Phiên gần nhất đã chốt** đúng như `/market` viết (dòng về bản cập nhật định kỳ chỉ có ở vùng nhà).
  Phần này được đọc khi bạn mở và khi bấm Làm mới, không bao giờ theo chu kỳ.

Phần nào không có gì để hiện thì bị bỏ, và phần nào không đọc được thì nói rõ vì sao.

**Tin tức** liệt kê tin theo từng ngày theo múi giờ của dịch vụ nền, kèm ô lọc trên những tin đã tải.
Khi không đọc được nguồn tin, trang nói rõ thay vì hiện một danh sách trống.

**Chủ đề** (chỉ có cho Việt Nam) liệt kê những chủ đề đang chờ bạn quyết, với Theo dõi và Bỏ qua, cùng
những chủ đề bạn đang theo dõi, với Dừng theo dõi sau một bước xác nhận. "Chạy lại" gửi `/themes` ngay.

### Văn phòng

Hai tầng, chuyển ở thanh nổi trên phần đầu khung cảnh, ngay trên dải giá; khi đã phóng vào một phòng, cũng thanh đó đưa bạn về cả tầng. Tầng **Văn phòng** là đội có sẵn trong các phòng của họ: Kho dữ liệu (Thủ kho làm mới dữ liệu, cả khi bạn gõ `/refresh` lẫn các lượt tự động theo lịch của dịch vụ nền), Thư viện (nhóm tìm tin, lập kế hoạch, tổng hợp, rà soát và phân tích chủ đề làm nghiên cứu), Phòng họp (bàn tranh luận sau `/suggest`), Sảnh (lịch hôm nay và bản tin trong ngày), Quầy cảnh báo (người trực theo dõi cảnh báo giá và mức cắt lỗ), Phòng trợ lý và Bàn của bạn. Tầng **Agent của bạn** là tầng đội riêng: mỗi agent của bạn một bàn, kèm thẻ cho biết nó đang chạy, tạm dừng hay rảnh, lịch của nó, đề xuất gần nhất và hôm nay nó đã tiêu bao nhiêu. Chưa có agent nào thì tầng này gợi ý ba cách bắt đầu và một mẫu trống, còn bàn trống kế tiếp mang nút "+ Thêm agent".

Cách đọc khung cảnh:

- Một người chỉ di chuyển khi dịch vụ nền nói vậy. Một phiên chạy bắt đầu thì đúng người đi tới đúng phòng; các bước và công cụ của nó quyết định họ làm gì ở đó; phiên chạy xong thì họ về chỗ. Phiên chạy nào trang không gắn được vào khung cảnh thì ngồi ở bàn gõ máy, kèm tên phiên chạy; trang không bao giờ bịa thêm bước.
- Dấu "!" màu hổ phách trên đầu một người nghĩa là họ mang tới cho bạn một yêu cầu duyệt; bấm vào để mở chuông. Dấu "!" đỏ trên đầu người trực cảnh báo nghĩa là một mức cắt lỗ đã bị thủng; bấm vào để mở thẻ của mã đó.
- Bong bóng thoại mang những câu có thật: việc nào cần bạn duyệt, một vai trong cuộc tranh luận vừa nói gì, một đề xuất cũ mà ai đó còn nhớ. Màn hình sáng cho thấy người tìm tin đang đọc trang nào hay giá đóng cửa mà nhà phân tích đang xem; bấm vào để xem lớn hơn. Ai đang làm việc khác, kể cả ở tầng đội, thì máy tính họ ngồi trước sáng lên và gõ dần phiên chạy của chính họ như một cửa sổ terminal: lệnh, từng bước đã xong và bước đang làm, không phải của cả phòng. Nhìn từ xa, màn hình hiện các dòng đó thành những vạch màu; khi bật giảm chuyển động thì mọi dòng hiện sẵn một lúc. Máy tính hai người dùng chung chỉ sáng cho người đang ngồi trước nó. Bấm vào màn hình để mở phiên đó.
- Các bảng cho thấy tiến độ (vòng tranh luận, câu hỏi nghiên cứu, số giá đã làm mới): bảng trắng ở phòng họp và thư viện viết bằng bút dạ, nhìn từ xa thì chỉ còn số thứ tự, còn màn hình trên tường kho dữ liệu chạy một thanh tiến độ. Bảng đề xuất đếm các đề xuất mới. Trên quầy cảnh báo, bảng giá hiện bốn mã đầu tiên của dải giá (nhìn từ xa thì chỉ còn số mã tăng và giảm) và dải đèn LED chạy các thông báo chưa đọc, không có thì giữ yên thông báo mới nhất. Khi bạn bấm vào một phòng, dưới bảng thấp ở sảnh có một tờ giấy vàng ghi tóm tắt trong ngày; bấm vào để xem chi tiết. Góc nhìn cả tầng không hiện tờ giấy này. Ba đồng hồ ở sảnh chạy giờ HOSE, NYSE và UTC, trỏ chuột vào thì hiện tên và giờ. Tủ máy chủ trong kho có một đèn cho mỗi nguồn dữ liệu, xanh khi nguồn còn trả lời và vàng khi nguồn hỏng. Hết giờ làm việc, phòng nào không có phiên chạy thì thẻ phòng ghi đang nghỉ. Máy in, kệ nguồn, đồng hồ và quầy cảnh báo hiện một chú thích khi bạn trỏ vào, kèm liên kết tới nơi liên quan. Bảng trắng không có phiên nào đang đếm bước sẽ ghi kết quả cuối cùng của ngày, vào bất kỳ giờ nào: mã của phiên tranh luận xong gần nhất cùng giờ xong, và số câu hỏi mà phiên nghiên cứu xong gần nhất đã trả lời ("Câu hỏi 5/5 · xong"); nhìn từ xa thì chỉ còn số "5" hoặc hai chữ cái đầu của mã. Các nút một dòng phía trên những bảng ấy, hiện khi bạn phóng vào một phòng, nói giống hệt, và chỉ dòng đang đếm bước của một phiên đang chạy mới mở phiên đó. Tải lại trang vẫn còn vì dữ liệu lấy từ danh sách hoạt động trong ngày.
- Bấm vào một chiếc đèn để bật hoặc tắt đèn phòng đó, hoặc bấm công tắc trên tường (hay nút bóng đèn ở góc dưới bên phải khung cảnh) để bật tắt tất cả. Ban ngày mỗi đèn theo công tắc riêng của nó, được giữ trong trình duyệt này. Khi mặt trời đã lặn hẳn, và cả ngày nghỉ của thị trường, đèn chỉ sáng ở phòng có chính người của phòng đó đang làm việc (trong ca, đang có phiên chạy thật, hoặc nhân viên trực ngày nghỉ) trừ khi bạn bật tắt nó; người chỉ đi ngang qua, hay ở lại muộn mà không có việc gì, thì phòng vẫn tối, và những lần bật tắt ban đêm ấy được quên vào lúc bình minh hay hoàng hôn kế tiếp. Mặc định ánh sáng văn phòng đi theo đồng hồ văn phòng; Cài đặt > Hiển thị tắt được việc này.
- Khi một đề xuất của bạn được chấm điểm, nhà phân tích phản ứng ngay tại chỗ: giơ hai tay khi chạm mục tiêu, gãi đầu khi chạm cắt lỗ (đề xuất hết hạn thì không có gì); người trong văn phòng đứng cho các đề xuất của danh mục bạn, còn đề xuất của agent riêng hiện ở bàn của agent đó. Sau một phiên chạy dài hơn 2 phút, những người làm phiên đó vươn vai một lần sau cái gật đầu. Người rảnh ngồi ở bàn thỉnh thoảng nhấp một ngụm nước hoặc xem điện thoại. Vươn vai, nhấp nước và xem điện thoại đều dừng khi bật giảm chuyển động.
- Mèo ngủ khi không có gì cần bạn, và thức dậy khi có việc cần duyệt, mã bạn giữ thủng cắt lỗ hoặc chạm chốt lời, lệnh khớp ở sàn, cảnh báo giá bạn đặt, hoặc hết ngân sách AI trong ngày. Corgi và bể cá chỉ là cảnh, không báo gì cả; corgi chỉ đứng dậy và vẫy đuôi vài giây khi mở trang hoặc khi có agent mới vào.
- Kéo để di chuyển, cuộn hoặc chụm hai ngón để zoom. Khi khung cảnh đang được chọn, phím mũi tên lên xuống và Shift cùng mũi tên trái phải để di chuyển, + và − để zoom (mũi tên trái phải không kèm Shift đi qua từng người, ở dưới). Esc hoặc nút ⟲ ("Xem cả tầng") để lùi lại. Nút + và − ở góc dưới bên phải cũng để zoom, mỗi nút mờ đi khi đã tới giới hạn; ở chế độ 3D còn có một thanh mảnh bên cạnh cho biết bạn đang zoom gần tới đâu. Từ góc nhìn cả tầng, bấm vào một phòng thì zoom vào phòng đó.

**Đồng hồ văn phòng.** Đồng hồ trên đầu trang cho biết giờ trong văn phòng. Bấm vào để xem văn phòng ở một giờ khác: giờ thật, hoặc một mốc có sẵn (sáng sớm, sáng, trưa, chiều, tối, đêm) ở tốc độ thường, x10 hoặc x60. Chỉ cảnh văn phòng đổi; số liệu, thông báo và giờ chạy việc vẫn theo giờ thật. Giờ thử không được lưu, nên tải lại trang là về giờ thật. Khi bạn đang giảm chuyển động, giờ thử chạy ở tốc độ thường. Khi văn phòng chạy theo giờ của một thị trường chứ không phải giờ của bạn, đồng hồ hiện cả hai.

**Bảng hiệu năng.** Thêm `?perf=1` vào địa chỉ trang để xem chi phí mỗi khung hình và tốc độ vẽ của khung cảnh so với mức cho phép, số lần gọi vẽ của 3D, và hai dòng về phố: bước mô phỏng phố (một nhịp của xe cộ và người bên ngoài) và lần vẽ lại phố (khung dài nhất của lần vẽ lại lớp tĩnh, chạy tối đa mỗi phút một lần và trải ra vài khung). Dùng để tìm hiểu một máy chậm, không đổi gì khác.

### Đời sống văn phòng

Khi chưa ai giao việc gì, văn phòng không đứng im, nhưng cũng không giả vờ làm việc. Những người đang rảnh làm vài việc nhỏ: nghỉ trưa, cà phê buổi chiều, trò chuyện bên bình nước, chiều thứ Sáu thong thả, hoặc họp nhanh trong lúc bản tin sáng chạy. Chỉ người đang rảnh mới làm vậy. Ai mà một phiên chạy cần tới, hoặc còn nợ một lần giao hay một câu trả lời, thì bỏ dở mọi thứ và đi làm việc. Không điều nào trong đó đụng tới dữ liệu của bạn hay tốn một xu.

- Trong giờ làm việc, trợ lý đi một vòng các phòng sau khi rảnh một lúc ngắn, dừng ở hai hoặc ba cửa liền nhau dọc hành lang, và khi một agent của bạn vừa chạy xong trong 5 phút qua, nó đi thang lên dừng ở bàn agent đó rồi quay về. Nó chỉ bắt đầu một vòng khi đang xem tầng văn phòng, không bao giờ vào ban đêm hay khi bật giảm chuyển động. Có việc, câu hỏi hay yêu cầu duyệt cho nó thì vòng đi dừng ngay.
- Thỉnh thoảng, trong giờ làm, một người đã rảnh một lúc sẽ ghé một cửa hàng đang mở bên kia đường: ra bằng cửa phía phố, qua đường khi đèn đi bộ bật, xếp hàng, mua rồi mang về đồ uống, ít đồ hoặc hộp đồ ăn (đồ uống thì để lại trên bàn). Trong phiên, nhiều nhất khoảng hai lượt mỗi giờ; sau giờ đóng cửa của thị trường nhà vào ngày giao dịch, cho đến khi không khí sau giờ đóng cửa kết thúc, mọi người rảnh nhanh hơn và ra ngoài thường hơn (cứ 6 đến 10 phút một lượt). Mỗi lúc chỉ một người ra ngoài, không ai đi khi còn việc chờ bạn, vào ban đêm hay khi bật giảm chuyển động, và có việc mới là bạn ấy quay về ngay. Lúc ở ngoài, họ không ở trên tầng: nhãn và danh sách dạng chữ cho biết họ đang ở đâu. Ẩn trang thì họ về lại chỗ ngồi.
- Khi không có gì đang chạy, không có gì chờ bạn và không ai đang gõ trong khoảng 15 phút, văn phòng chìm vào yên lặng: mọi người ngả người ra ghế, màn hình tối đi, các cử động vặt dừng và trang gần như không làm gì. Trong một văn phòng yên lặng, một vòng đi chỉ diễn ra tối đa 25 phút rảnh một lần.
- Thẻ trình duyệt bạn không nhìn tới thì dừng hẳn mọi chuyển động và bắt kịp khi bạn quay lại.

### Trò chuyện với một người

Trỏ vào một người để thấy tên và một dòng trạng thái trực tiếp: họ đang chạy gì và từ đâu, đang ở bước nào, đang chờ bạn hay chờ tới lượt, đang tạm dừng, hay đang rảnh. Tới được ai bằng bàn phím thì nhãn đó cũng hiện. Bấm vào họ thì họ phản ứng (vẫy tay khi rảnh, ngước nhìn khi đang bận), nói một câu ngắn từ trạng thái thật (ai không phải trợ lý hay agent của bạn, khi rảnh, sẽ chỉ bạn sang trợ lý thay vì đề nghị giúp), rồi một vòng tròn hành động nhỏ mở ra, chỉ có những gì làm được lúc này. Bấm chuột phải, nhấn Enter hoặc Space khi bàn phím đang ở trên một người, hoặc nhấn giữ trên màn hình cảm ứng, cũng mở vòng này và đưa tiêu điểm vào hành động đầu tiên.

- *Trò chuyện*, cho agent của bạn và trợ lý: chọn họ ở ô câu lệnh và mở khung chat.
- *Giao việc*, cho cùng những người đó, trừ agent đang tạm dừng: chọn họ làm người nhận và đưa con trỏ vào ô câu lệnh. Không gửi gì cả.
- *Đang làm gì*: thẻ Tiến độ của họ. Người phụ việc mà một agent giao việc cho thì mở thẻ của agent cha; trợ lý và người trực cảnh báo có thẻ riêng.
- *Việc*: thẻ Việc của agent của bạn và của trợ lý.
- *Dừng việc*, chỉ khi phiên chạy của họ đang chạy: dừng phiên chạy sau một bước xác nhận.
- *Hồ sơ*: hồ sơ của agent riêng của bạn.
- *Đi theo*, cho mọi người: camera đi theo họ (bên dưới).

Câu trả lời của họ nằm sát vòng tròn mà không che nó: trên mục trên cùng, nếu không thì cạnh mục gần họ nhất, trong khung nhìn. Khi vòng tròn đang mở, thẻ tên của họ được ẩn, cùng mọi nhãn phòng, ghi chú trên bảng hay dấu hiệu mà vòng tròn hoặc câu trả lời sẽ che; chúng hiện lại khi vòng tròn đóng. Phím mũi tên đi quanh vòng tròn, Esc đóng lại, và chuyển tiêu điểm đi chỗ khác cũng đóng lại. Bấm vào người đang chờ ở bàn của bạn thì mở yêu cầu duyệt trong chuông.

**Đi theo một người.** Bấm đúp bằng chuột vào một người, hoặc chọn "Đi theo" trong vòng hành động của họ, camera giữ họ ở giữa, qua các tầng và thang máy, cho tới khi bạn tự dời camera (kéo, cuộn, zoom hoặc phím mũi tên), nhấn Esc, bấm vào sàn trống, dùng bàn phím sang người khác, hoặc chuyển giữa 2D và 3D.

**Duyệt từng người.** Nhấn Tab để vào khung cảnh thì tiêu điểm dừng ở người đầu tiên. Tab và Shift+Tab đi qua từng người trên tầng đang xem theo một thứ tự cố định: đội có sẵn trước, rồi agent của bạn theo bàn, rồi những người phụ việc của họ. Mũi tên trái phải đi cùng cách đó và quay vòng. Mỗi bước đặt camera vào người đó và đọc to tên cùng trạng thái; Enter hoặc Space mở vòng hành động của người đang được chọn. Tab thoát khỏi khung cảnh ở cả hai đầu.

### Hai cách xem cùng một văn phòng

Một công tắc "2D | 3D" trên đầu trang, đứng trước nút Chỉ thông tin, đổi cách vẽ văn phòng. Mặc định là 2D. 3D được tải lần đầu bạn chọn, và lựa chọn của bạn được giữ trong trình duyệt này. Vẫn là một văn phòng: vị trí, camera, lựa chọn, bong bóng và mọi thứ ở trên đều dùng được ở cả hai, chỉ khác là chuyển chế độ thì dừng việc đi theo một người và đóng vòng hành động đang mở. 3D thể hiện như 2D: màn hình lịch, bảng kết quả và bảng tin ghim mang cùng nội dung, điện thoại hay tờ giấy đã đóng dấu hiện trên tay, bức tường phía sau trở nên trong suốt khi che khuất người đứng sau nó, và đèn của các phòng đang bật tỏa ánh sáng ấm. Nếu thiết bị không vẽ được 3D thì nút bị khóa và nói rõ lý do; nếu 3D tải không được hoặc mất ngữ cảnh đồ họa, trang quay về 2D và báo cho bạn.

**Bàn làm việc.** Mỗi bàn trong văn phòng có đồ của người ngồi đó (báo cáo, màn hình, bảng kiểm tra, chậu cây và ảnh, tai nghe, giấy ghi chú, điện thoại và đèn của bàn cảnh báo) và bừa dần theo việc thật trong ngày: một tờ giấy cho mỗi phiên chạy của họ đã xong, một cốc sau mỗi lần nghỉ uống cà phê hay ăn tráng miệng. Mở trang muộn thì giấy của các phiên đã xong hôm nay hiện ngay; cốc chỉ đến từ những lần nghỉ diễn ra khi trang đang mở. Bàn được dọn lúc 06:00 theo đồng hồ văn phòng. Thùng rác cạnh mỗi bàn ở thư viện, và cạnh bàn của mỗi agent của bạn, có thêm một tờ giấy vo tròn cho mỗi phiên chạy làm ở bàn đó trong ngày, tối đa ba tờ; vào ngày giao dịch, nhân viên vệ sinh đổ hết các thùng khi bắt đầu ca. Khay máy in xếp một tờ cho mỗi báo cáo nghiên cứu và bản tin sáng đã giao trong ngày, tối đa sáu tờ, và được dọn khi sang ngày mới. Màn hình hiện trình bảo vệ khi người ngồi rời bàn, tắt khi văn phòng yên lặng, và chuyển xám lúc nghỉ trưa và sau giờ đóng cửa; bàn có người đang làm việc giữ màn hình công việc. Người tìm tin ngồi ở bàn mà chưa có gì để đọc thì màn hình hiện đường chỉ số của thị trường nhà dưới các thẻ trình duyệt. Ai ngồi bàn cũng quay lưng về phía bạn, nhìn vào bàn, cùng một kiểu màn hình đứng ở mép xa, mặt màn hình hướng về bạn nên đọc được chữ; quầy cảnh báo cũng có một chiếc. Đèn bàn cảnh báo sáng màu hổ phách khi còn cảnh báo giá chưa đọc. Khi người ngồi bàn đang rảnh ở đó, màn hình đọc số liệu thật thay vào: màn hình đường giá của trader và laptop của nhà phân tích lần lượt hiện từng mã trong những mã trang vốn đã lấy giá, khoảng 20 giây đổi một mã (đứng yên khi giảm chuyển động), kèm giá gần nhất, mức thay đổi và đường giá từ giá đóng cửa hôm trước qua các lần trang lấy giá từ khi mở; bảng kiểm tra của bàn rủi ro tô đỏ một ô, và khi zoom vào phòng thì ghi số, cho mỗi mã đang nắm giữ cách mức cắt lỗ trong vòng 3%; còn máy tính của người trực cảnh báo hiện số cảnh báo giá đang bật. Không có gì trong đó hỏi thêm dịch vụ nền. Trỏ vào màn hình để đọc; bấm vào thì mở thẻ của mã, hoặc thẻ Danh mục với một con số.

**Mặt trời và thời tiết.** Ánh sáng văn phòng đi theo mặt trời thật trên thành phố của vùng nhà: đêm khi mặt trời dưới -6 độ, rồi chạng vạng, giờ vàng dưới 10 độ, mây làm ngày xám đi. Ánh sáng chuyển dần trong 2 giây khi đồng hồ hay bầu trời đổi. Bóng trên phố ngả ngược phía mặt trời và tắt khi trời tối; nắng in một vệt ấm trên sàn bên trong mặt kính nó chiếu qua, mặt trời càng thấp vệt càng sâu, và rèm phía tây hoặc phía đông khép khi mặt trời thấp chiếu thẳng vào (buổi sáng ở phía đông, buổi chiều ở phía tây), mở lại khi mặt trời lặn hoặc trời nhiều mây; vệt nắng và rèm chuyển dần sang mức mới trong chưa đầy một giây (tức thì khi giảm chuyển động), còn độ sáng của đèn đổi tức thì giữa mức ban ngày và ban đêm ngay khi mặt trời qua mốc -6 độ, còn đèn mờ dần sang độ sáng dịu của giờ nghỉ trưa và sáng lại trong khoảng một giây. Tắt "Ánh sáng văn phòng theo giờ" thì mặt trời đứng ở chính ngọ, trời quang. Ở giờ thật và khi không giảm chuyển động, chính trang gọi Open-Meteo (`api.open-meteo.com`) lấy thời tiết hiện tại của thành phố mỗi 30 phút, chỉ gửi vĩ độ và kinh độ của thành phố; xem thử giờ khác, giảm chuyển động hay gọi lỗi thì văn phòng dùng thời tiết tự tạo theo ngày (0 đến 2 cơn mưa ngắn). Gọi lỗi thì số đọc gần nhất được giữ 3 giờ. Mưa mang theo ô, người trú dưới mái hiên, mặt đường ướt và vệt nước trên kính phía bắc; mưa giông thêm một chớp sáng ngắn, tối đa 20 giây một lần (không có khi giảm chuyển động, không có tiếng); sương mù làm mờ các dãy nhà xa và xe bật đèn; từ 33 độ khi còn nắng, người đi bộ đội nón và đi bên bóng râm. Thanh trên cùng hiện một ô thời tiết nhỏ cạnh đồng hồ khi có số đọc thật (không hiện trên điện thoại). Danh sách kết nối ra ngoài trong phần cài đặt có ghi lời gọi này.

**Nhịp thị trường.** Văn phòng giữ đúng lịch của thị trường nhà, không bịa lịch riêng. Cuối tuần hoặc ngày nghỉ lễ của thị trường chỉ có nhân viên cảnh báo và trợ lý ở lại, cùng các agent có trọng tâm là thị trường vẫn giao dịch (tiền mã hóa) và bất kỳ ai đang có một phiên chạy thật; mọi bàn và phòng khác tắt đèn, màn hình sảnh ghi khi nào thị trường mở lại. Ngày giao dịch, mọi người đi vào qua cửa phố từ 07:00 đến 08:15 và về nhà từ 17:00 đến 19:00, mỗi người một phút riêng; phiên chạy còn dang dở giữ người của nó ở bàn với đèn sáng, còn phiên chạy bắt đầu ngoài giờ sẽ gọi người đó vào rồi cho về khi nó xong. Những phút đầu sau giờ mở cửa không ai rời bàn. Trong phiên ATC, người rảnh đứng xem màn hình sảnh; sau giờ đóng cửa, khung cà phê chiều mở lại và các cuộc trò chuyện đến sớm hơn. Khi chỉ số nhà giảm mạnh (thông báo của chính dịch vụ nền, lúc phiên còn mở), hai ba người rảnh tụ lại ở màn hình sảnh, tối đa nửa giờ một lần, còn phiên đóng cửa tăng rõ rệt thì một người giơ hai tay. Mùa báo cáo tài chính, người ở phòng khác thỉnh thoảng ghé thư viện. Thứ Năm đáo hạn phái sinh giữ trader và người kiểm soát rủi ro ở bàn suốt phiên, còn ngày giao dịch không hưởng quyền cổ tức của một mã đang nắm giữ (đọc một lần mỗi ngày từ nguồn sự kiện) giữ agent săn cổ tức ở bàn đến trưa, với một tờ lịch khoanh tròn ngày đó trên bàn; không có agent như vậy thì nhà phân tích ở lại bàn. Mỗi người đều nói lý do trong nhãn khi rê chuột. Cả văn phòng chỉ được coi là đã đóng cửa, với sảnh mờ đi và quầy cảnh báo ghi thị trường đã đóng, khi thị trường nhà và mọi thị trường khác bạn đang bật đều đã đóng; tiền mã hóa không bao giờ đóng, nên khi nó đang bật (`/profile enable crypto`) văn phòng vẫn mở, còn khi tắt thì chỉ các thị trường bạn giữ lại mới quyết định.

### Con phố và thành phố

Văn phòng nằm trên một dãy phố có thật ở thành phố của vùng nhà. Hiện có một thành phố được vẽ: khu tài chính TP. Hồ Chí Minh, đường Hàm Nghi chạy ngang cửa trước, giữa Hồ Tùng Mậu phía tây và Hải Triều phía đông (mỗi đường có biển tên riêng), tòa tháp biểu tượng nằm sau dãy nhà mặt tiền bên kia đường một khối, và công viên Bến Bạch Đằng ở phía bên này; mọi vùng nhà mà dịch vụ nền biết hiện nay đều vẽ thành phố này. Tên đường, trạm xe buýt và công viên là tên thật của thành phố và không dịch; cửa hàng, xe cộ và đồng phục không mang thương hiệu hay logo thật nào. Kéo để xem dọc cả con phố ở mọi mức zoom: hai công viên hai bên, các dãy nhà phía xa và tòa tháp tới tận đỉnh. Ở chế độ 3D, nút − thu nhỏ quá cả tầng cho tới khi thấy trọn con phố.

Cái gì là thật và cái gì chỉ là cảnh:

- **Chỉ là cảnh.** Xe cộ (theo thói quen của thành phố: xe máy len giữa ô tô, dồn lên trước khi đèn đỏ và đi trước, giờ cao điểm thì kẹt), người trên vỉa hè, tất cả theo giờ: đông hơn vào giờ cao điểm sáng và chiều, nhiều người đi bộ hơn vào giờ ăn trưa (giờ nghỉ giữa phiên của sàn) và có hàng người xếp trước cửa các quán ăn, vắng về khuya. Khi trời tối, đèn đường, biển hiệu cửa hàng, cửa sổ thành phố, các tầng của tòa tháp và đèn xe lần lượt sáng theo mặt trời, và mỗi cửa hàng kéo cửa cuốn xuống, tắt biển hiệu đúng giờ đóng cửa của nó. Ngoài ra còn giờ đưa đón học sinh, người giao hàng, công viên cùng giờ tập thể dục, hàng rong, chim, chó và mèo, cửa hàng mở và đóng theo giờ của nó, một bảo vệ đi dọc dãy mặt tiền lúc đêm muộn, và đồ trang trí dịp Tết, Trung thu, Quốc khánh và Giáng sinh. Không thứ nào trong đó tượng trưng cho việc gì, và không thứ nào đọc dữ liệu của bạn.
- **Có thật.** Mặt trời và thời tiết (ở trên); lịch và giờ giao dịch của thị trường, thứ quyết định một ngày của văn phòng; và bảng LED văn phòng thuê trên tòa nhà bên kia đường, hiện tên sản phẩm và các dòng chỉ số trong phần tổng quan thị trường của trang, lấy từ chính lần đọc mỗi phút một lần của trang. Đường giá của nó dựng từ các lần đọc kể từ khi mở trang và ghi giờ của lần gần nhất; ngoài phiên thì ghi đóng cửa, giờ nghỉ trưa thì nói vậy, còn xem thử giờ khác thì bảng giữ nguyên. Người băng qua đường đi mua đồ (ở trên) là người thật của văn phòng, và được hiện là đang ra ngoài.
- **Đồng hồ.** Con phố theo đồng hồ văn phòng: múi giờ của thị trường nhà, nếu không có thì `[locale] timezone` của bạn. Ẩn trang thì phố dừng, và khi quay lại nó được dựng lại theo đồng hồ chứ không phát lại. Khi giảm chuyển động, phố đứng yên ở đúng chỗ đồng hồ đặt.

**Nhân viên tòa nhà.** Một lễ tân ở quầy trước vào ngày giao dịch, một nhân viên vệ sinh đổ thùng rác và lau hành lang lúc chiều muộn (biển "Sàn ướt" đi theo cây lau, và người đi bộ đi vòng qua nó), và một bảo vệ ở cổng đi một vòng tuần tra khi trời tối. Họ là cảnh, không phải agent: không có menu, không có chấm trạng thái, không bấm vào được; Tab bỏ qua họ, danh sách dạng chữ không có họ và nhãn của họ chỉ ghi vai trò.

**Thang máy.** Một buồng thang chạy giữa hai tầng. Ai đi thang thì bấm nút gọi, chờ cửa mở, và bảng số tầng chạy theo buồng thang; trợ lý lên thăm bàn một agent vừa chạy xong cũng đi theo cách này.

**Chuyện phiếm.** Hai đồng nghiệp đang rảnh ngồi ghế sofa nói vài câu hợp với lúc đó, như trời mưa, giờ nghỉ trưa, một ngày thị trường giảm, chiều thứ Sáu hay một dịp lễ. Các câu đến từ bảng câu cố định, không bao giờ từ mô hình; không lặp lại cặp câu vừa nói và không bao giờ nói một con số.

**Ghi công.** Cài đặt > Dữ liệu và kết nối > Ghi công nêu dữ liệu bản đồ (OpenStreetMap), thời tiết (Open-Meteo), bộ biểu tượng và từng tấm ảnh tham khảo đã dùng để vẽ các con phố. Trang không kèm theo tấm ảnh nào.

### Phím tắt, trình đọc màn hình và mức báo

Phím đơn dùng được khi con trỏ không nằm trong ô nhập, không có hộp thoại nào đang mở và không giữ phím bổ trợ: `/` hoặc Cmd/Ctrl+K vào ô câu lệnh (Cmd/Ctrl+K dùng được cả khi đang gõ trong một ô); `1`, `2`, `3`, `4` mở Hôm nay, Danh mục, Đề xuất, Thị trường; `R` quay lại agent hoặc mã bạn đang xem; `B` chuông; `J` việc đang chạy; `C` khung chat; `I` chỉ thông tin; `[` và `]` agent trước và sau; `?`, hoặc nút "?" trên đầu trang, liệt kê tất cả; Esc đóng thứ đang mở hoặc thôi đi theo một người. Khi khung cảnh đang giữ bàn phím thì mũi tên, Tab, Enter, Space và Esc là của khung cảnh (ở trên), còn các phím chữ vẫn dùng được. Khi chuông đang mở, mũi tên lên xuống chọn một yêu cầu, rồi `Y` duyệt một lần hoặc `N` từ chối, chỉ trên yêu cầu đang được viền, và nút của nó in sẵn phím. "Ghi nhớ" không có phím, thẻ duyệt nằm trong khung chat không nhận các phím này, và một phím gõ nhầm ở bất cứ chỗ nào khác không duyệt gì cả.

Trang được làm để dùng được không cần chuột: mọi nút đều hiện viền khi được chọn bằng phím, một liên kết nhảy sẽ đưa thẳng tới bảng thông tin, khung cảnh là một ứng dụng dùng bàn phím với danh sách chữ về ai đang làm gì (nó hiện ra khi bạn nhấn Tab vào, và mỗi dòng mở việc người đó đang làm hoặc thứ đang cần bạn), và việc đi theo hay bước sang ai đó được đọc to. Một yêu cầu duyệt mới hay một mức cắt lỗ bị thủng cũng được đọc to cho trình đọc màn hình. Hộp thoại giữ tiêu điểm trong nó rồi trả lại.

Trang báo to hay nhỏ tùy trọng lượng dịch vụ nền gán cho sự kiện. Sự kiện nhẹ chỉ làm khung cảnh chuyển động. Mức cao hơn một chút làm bong bóng của người đó sáng lên vài giây. Mức kế tiếp thêm chấm trên chuông và, khi khung chat đang đóng, cả trên nút chat ở dưới; lúc đó chấm nghĩa là "có gì mới", không chỉ là tin nhắn chưa đọc. Những sự kiện to nhất còn gửi được thông báo của trình duyệt, nếu bạn bật trong Cài đặt > Hiển thị (trình duyệt chỉ hỏi quyền khi bạn bật). Một tiếng chuông nhẹ hai nốt, nếu bạn bật, chỉ vang lên cho một yêu cầu duyệt mới hay một mức cắt lỗ bị thủng: mỗi việc một lần, và không bao giờ quá một lần trong 10 giây. Tiêu đề thẻ có số đếm và biểu tượng thẻ có một chấm khi có gì đó cần bạn, tức là một yêu cầu duyệt đang chờ hoặc một mức cắt lỗ bị thủng mà bạn chưa xem. Một câu hỏi làm rõ, một yêu cầu ghép nối hay ngân sách hết thì có thông báo và các chấm, nhưng không đổi tiêu đề hay biểu tượng. Tiếng chuông và thông báo đều tắt sẵn và lưu trên trình duyệt này.

### Màn hình hẹp và cảm ứng

Dưới 900 px chiều ngang, trang chỉ hiện một khung mỗi lần, chuyển bằng một thanh dưới đầu trang: Văn phòng, Thông tin, Trò chuyện. Màn hình rộng hơn thì khung chat vẫn nằm cạnh các khung còn lại. Mở một thẻ (một mã, một agent, một thẻ tab) thì đưa khung thông tin lên trước; "Xem" một phiên chạy thì đưa văn phòng lên trước và zoom vào phòng của phiên chạy đó; gửi tin nhắn hoặc chọn Trò chuyện thì đưa khung chat lên trước, và nút đóng của nó quay về khung bạn vừa ở. Không có gì tự chuyển khung, nên một sự kiện trực tiếp không bao giờ kéo bạn đi chỗ khác. Thông tin mở thành một tấm kính kéo từ dưới lên trên văn phòng (chạm tay cầm để ẩn); Chỉ thông tin và nút của nó tắt ở độ rộng này.

Trên màn hình rộng, văn phòng chiếm cả trang và bảng thông tin nổi phía trên như một tấm kính. Các khối
trong bảng cũng là kính.

- Trang mở ra với sàn văn phòng nằm giữa phần văn phòng mà bảng thông tin chừa ra. Sàn giữ ở giữa khi
  bạn đổi cỡ cửa sổ hay bảng thay đổi, cho tới khi bạn tự di chuyển góc nhìn.
- Mũi tên ở đầu bảng thu nó thành một dải biểu tượng ở góc, để thấy trọn khung cảnh. Mũi tên của dải mở
  lại bảng.
- Nút Chỉ thông tin (`I`) trên đầu trang ẩn hẳn văn phòng, để thông tin chiếm cả trang ở độ rộng dễ
  đọc, khung chat vẫn nằm cạnh. Khung cảnh không được tải hay chạy, nên đỡ tốn bộ xử lý và đồ họa trên
  máy nhỏ hoặc chậm. Sau lớp kính là ảnh văn phòng mờ nhẹ, đúng như lúc bạn rời đi; nếu mở trang thẳng
  vào Chỉ thông tin thì đó là sơ đồ mặt sàn trống. Ảnh này đứng yên. Công tắc 2D | 3D, đồng hồ và thời
  tiết cũng rời đầu trang. Lựa chọn được giữ trong
  trình duyệt này. Bấm lại phím hoặc nút thì văn phòng quay lại; "Xem" một phiên chạy cũng làm vậy rồi
  zoom vào phòng của nó.

Dưới 600 px, tức trên điện thoại, đầu trang rút gọn cho vừa: bỏ chữ thương hiệu và biểu tượng trên chip,
chip việc đang chạy ngắn lại, đồng hồ còn dưới dạng một nút nhỏ. Cửa sổ nổi phủ hết chiều ngang, Cài đặt
thành toàn màn hình và trình đọc bỏ cột mục lục. Trên mọi màn hình hẹp, sàn không bao giờ được vẽ nhỏ
hơn một điểm ảnh màn hình cho mỗi điểm của thế giới, nên phần còn lại xem bằng cách di chuyển, và có một
dòng gợi ý nói vậy.

Cảm ứng dùng như chuột: một ngón kéo để di chuyển, hai ngón chụm để zoom. Chạm lần đầu vào một người, thẻ tên của họ hay thứ có chú thích thì hiện thứ mà trỏ chuột sẽ hiện, và người đó chào; chạm lần hai vào cùng thứ đó, hoặc nhấn giữ trên một người, mở vòng hành động. Chạm vào sàn trống thì đóng nhãn, vòng hành động và việc đi theo. Đi theo một người thì chọn trong vòng hành động; mọi thứ bạn đọc được khi trỏ chuột đều có cách chạm.

### Tùy chọn hiển thị

Giao diện (sáng, tối hoặc theo hệ thống), cặp màu tăng giảm (xanh tăng hay đỏ tăng), chuyển động (đầy đủ, giảm hoặc theo hệ thống), mức chi tiết (ở trên) và ánh sáng văn phòng được lưu trong trình duyệt này và có hiệu lực ngay. Giảm chuyển động làm nhân vật và thú cưng đứng yên, trừ chớp mắt, giữ yên bụi nắng, ruy băng máy lạnh, dải LED, đèn tủ máy chủ, đèn chờ duyệt và bọt bể cá, dừng dải giá chạy, các hiệu ứng báo và nhấp nháy giá, và cho giờ thử của đồng hồ chạy ở tốc độ thường; bong bóng vẫn cập nhật. Ngôn ngữ và múi giờ là thiết lập của chính dịch vụ nền (chúng cũng đổi bản tin và Telegram) và cần khởi động lại. Trình duyệt còn nhớ những đèn bạn đã tắt, lựa chọn 2D hay 3D, chế độ Chỉ thông tin, vùng đã chọn ở thẻ Thị trường, bản cập nhật bạn đã để sau, lựa chọn tiếng chuông và thông báo; không thứ nào được gửi cho dịch vụ nền.

Bên trong: [dev/van-hanh.md](dev/van-hanh.md).

Xem thêm [an toàn và phê duyệt](an-toan.md), [ngân sách](ngan-sach.md), [giao dịch](giao-dich.md),
cùng các tham chiếu [`config.toml`](cau-hinh.md) và [lệnh](lenh.md).
