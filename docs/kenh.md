# Kênh

Kênh là ứng dụng chat mà bạn dùng để nói chuyện với OpenAlpha. Telegram và Zalo có sẵn.

Trợ lý đứng sau luôn là một, dùng kênh nào cũng vậy. Kênh chỉ lo bốn việc: ai được vào, lưu tin của
bạn an toàn, phân biệt lệnh với câu hỏi thường, và dựng câu trả lời sao cho ứng dụng chat hiển thị được.

## Các kênh có sẵn

| Mã kênh | Kết nối qua | Định dạng | Nút bấm | Đang gõ | Thả cảm xúc | Sửa tin trực tiếp |
|---|---|---|---:|---:|---:|---:|
| `telegram` | Telegram Bot API | MarkdownV2 | có | có | có | có |
| `zalo` | Zalo bot | văn bản thuần | không | có | không | không |
| `zalo_personal` | Tài khoản Zalo cá nhân của bạn (không chính thức) | văn bản thuần | không | có | có | không |

Kênh chỉ chạy khi đã có đủ cấu hình và thông tin đăng nhập, và nó chạy trong daemon.

### Zalo Personal

`zalo_personal` phải tự bật, vì nó chạy trên API tài khoản cá nhân không chính thức, và Zalo có thể khóa
tài khoản vì chuyện đó. Nó từ chối khởi động trừ khi bạn đặt `i_accept_ban_risk = true` và khai ít nhất
một id được phép.

Liên kết tài khoản một lần:

```bash
openalpha zalo login
```

Lệnh lưu một ảnh mã QR để bạn quét bằng ứng dụng Zalo, rồi cất lần đăng nhập đó theo `profile` của kênh.
Từ đó, mỗi lần kết nối kênh đăng nhập lại từ chỗ đã cất.

- Khi mất kết nối, kênh tự nối lại và đợi lâu hơn một chút sau mỗi lần hỏng, tối đa năm phút.
- Mở Zalo Web hoặc Zalo PC trên cùng tài khoản sẽ giành mất phiên. `openalpha logs` ghi lại thành
  `zalo_personal.session_ended` với lý do `duplicate_connection`.
- Đăng nhập lại trong lúc daemon đang chạy thì lần thử kế tiếp sẽ nhận, không cần khởi động lại.
- `openalpha doctor channels` cho biết kênh còn thiếu thứ nào trong ba thứ: lời chấp nhận rủi ro, một id
  được phép, hay lần đăng nhập đã cất.

Trong nhóm, bot Zalo trả lời mọi tin đến được với nó. Zalo chỉ giao tin nhóm cho bot khi bot được @nhắc
tên, và khâu xét duyệt vẫn quyết định nhóm nào được dùng.

## Cấu hình một kênh

Mỗi kênh là một bảng `[channels.<id>]` trong `config.toml`. Bản chú thích đầy đủ nằm ở
`config.sample.toml`.

Với Telegram, bạn không cần tự sửa tệp: `openalpha onboard` hỏi tên biến chứa token của bot rồi ghi bảng
này, để chế độ ghép nối bật sẵn. Chạy daemon, nhắn bất kỳ tin nào cho bot, rồi duyệt mã nó trả về
(`openalpha pair approve <mã>`). Lệnh `/start` mà Telegram tự gửi khi bạn mở bot lần đầu sẽ hiện danh
sách lệnh.

```toml
[channels.telegram]
token_env = "TELEGRAM_BOT_TOKEN"
allowed_ids = [123456789]
operator_user_ids = [123456789]
```

| Khóa | Áp dụng cho | Ý nghĩa |
|---|---|---|
| `enabled` | tất cả | Đặt `false` để tắt một kênh đã cấu hình |
| `token_env`, `token_file` | `telegram`, `zalo` | Token bot, đọc theo đúng thứ tự đó. `zalo_personal` không có token: nó dùng `profile` đã lưu |
| `allowed_ids` | tất cả | Các chat hoặc người dùng được nhận. Trên `telegram`, khai khóa này sẽ tắt ghép nối trừ khi `pairing = true` |
| `operator_user_ids` | tất cả | Ai được chạy các lệnh ghép nối, đáng kể nhất là trong chat nhóm, cùng `/trade` và `/upgrade`. Bỏ trống thì mọi người bot cho vào đều là người vận hành trong chat riêng của chính họ, nên hãy đặt khi bạn dùng chung bot |
| `pairing` | `telegram` | Ép bật hoặc tắt ghép nối |
| `dm_policy` | `zalo` | `pairing` (mặc định), `allowlist`, hoặc `disabled` |
| `i_accept_ban_risk`, `profile` | `zalo_personal` | Lời chấp nhận bắt buộc, và kênh dùng lần đăng nhập QR đã lưu nào |
| `agent` | tất cả | Gắn kênh vào một agent thay vì agent mặc định |
| `require_mention`, `slash_commands` | tất cả | Quy tắc nhắc tên trong nhóm, và có chặn lệnh gạch chéo hay không |
| `fallback_chat_id` | tất cả | Nơi một việc theo lịch không có `--to` sẽ gửi tới. Chỉ có đúng một id được phép thì dùng id đó |

Các khóa còn lại tinh chỉnh việc gửi: `markdown`, `mid_stream_updates`, `typing_indicator`,
`use_reactions`, `notify_max_per_minute`. Nhịp gom tin, nhịp sửa tin trực tiếp và hàng đợi gửi đi là cố
định. Một khóa lạ sẽ làm hỏng khâu kiểm tra, nên gõ sai là biết ngay lúc khởi động, thay vì biết lúc 9
giờ sáng.

Một kênh chưa có token (biến trong `token_env` chưa đặt, hoặc `token_file` trống), hay có token mà chính
nhà cung cấp từ chối (HTTP 401 hoặc 403 từ Telegram, 401 từ Zalo), thì không được mở. Daemon vẫn khởi
động: `start` in một dòng cảnh báo cho kênh đó, các kênh khác và mọi việc còn lại chạy bình thường, và kênh
không có token hợp lệ không nhận tin của ai. Đặt lại token rồi `restart` để mở kênh. Một giá trị cấu hình sai
(sai kiểu, sai tên khóa) vẫn làm `start` dừng và báo lỗi. Mọi lỗi khác khi kiểm
tra token được coi là lỗi đường truyền: hệ thống thử bốn lần, khoảng chờ tăng dần, và nếu mạng vẫn chưa
lên thì kênh vẫn được giữ, hiện ở trạng thái suy giảm và tiếp tục thử lại ở nền với khoảng chờ có trần,
cho tới khi kết nối được hoặc daemon dừng. Zalo Personal không có token để bị từ chối: nó cũng cứ thử đăng
nhập lại ở nền. Nếu không kênh nào chạy, dùng riêng CLI vẫn được.

## Ai được vào

Có hai chế độ và không có chế độ mở. Một kênh hoặc nhận theo danh sách, hoặc ghép nối.

| Chế độ | Chuyện gì xảy ra |
|---|---|
| `allowlist` | Chỉ các chat hoặc người dùng trong `allowed_ids` được vào |
| `pairing` | Id trong danh sách được vào. Chat lạ nhận một mã dùng một lần để đưa cho operator |

- **Telegram** ghép nối khi `pairing = true`. Bỏ trống `pairing` thì nó chỉ bật mặc định khi bạn không
  khai `allowed_ids`. Ghép nối mà không có id được phép thì bất kỳ người dùng Telegram nào cũng xin được
  mã, và daemon ghi một cảnh báo (`telegram.pairing_open`).
- **Zalo** theo `dm_policy`, mặc định là `pairing`.
- **Zalo Personal** luôn chỉ chạy theo danh sách cho phép.

### Ghép nối

Người lạ trên kênh ghép nối nhận một mã dùng một lần và lời nhắn liên hệ operator. Các tin tiếp theo của
họ không có tác dụng gì cho tới khi yêu cầu được duyệt, bị từ chối, hoặc hết hạn. Bạn xử lý yêu cầu từ
terminal:

```bash
openalpha pair list --channel telegram
openalpha pair approve <code>
openalpha pair deny <code>
openalpha pair revoke <chat-id> --channel telegram
```

Chi tiết ở [Lệnh](lenh.md). Ghép nối luôn chặn lại khi có sự cố, ở mọi hướng:

- chỉ operator đã cấu hình mới liệt kê, duyệt, từ chối hay thu hồi được ghép nối;
- một chat đã ghép nối không ghép nối được cho chat khác, và người dùng đã ghép nối không tự động là
  operator;
- người lạ gửi tin liên tục không sinh ra vô hạn mã;
- lưu trữ hỏng thì tin bị từ chối, chứ không cho qua;
- mã đang chờ sẽ hết hạn.

## Cập nhật từ chat

Trong chat riêng với người vận hành, bot nhắc về bản mới nhiều nhất mỗi tuần một lần (mỗi ngày khi có bản quan trọng đang chờ), không bao giờ nhắc trong nhóm, và báo một lần là đã chạy bản mới.

`/upgrade` cho biết có gì mới, còn `/upgrade confirm` (hoặc nút "Cập nhật ngay") sẽ cài bản mới. Bot im khoảng một phút để khởi động lại, rồi nhắn bạn là đã chạy bản mới. Nếu bản mới không khởi động được, bot tự quay về bản cũ và báo cho bạn.

Cách này chỉ dùng được với daemon bật bằng `start --background`, và chỉ khi bot không còn câu trả lời, lượt nghiên cứu, phê duyệt, bản tin hay lượt nạp dữ liệu nào đang dở; nếu không, bot nhờ bạn thử lại sau. Chỉ người vận hành dùng được, như `/trade`: không đặt `operator_user_ids` thì mọi người bot cho vào đều là người vận hành trong chat riêng của chính họ, nên ai dùng chung bot hãy đặt khóa này.

## Một tin nhắn đi qua những bước nào

1. **Lưu trước.** Tin được ghi vào hộp nhận bền vững trước khi ứng dụng chat được báo là đã nhận. Sập
   giữa hai bước thì tin được phát lại; làm ngược thứ tự sẽ mất tin. Ở chế độ `allowlist`, tin của người
   không bao giờ vào được thì không được lưu, nên người lạ không làm phình hộp nhận. Ở chế độ `pairing`
   thì mọi thứ đều được lưu, vì chat lạ sẽ được cấp một mã.
2. **Kiểm tra.** Lệnh dừng và lệnh ghép nối được xử lý trước. Lệnh gạch chéo đi qua bộ điều phối lệnh
   chuẩn. Văn bản thường được gom nhịp một lúc rồi chuyển tới agent và phiên chat của cuộc trò chuyện.
3. **Xếp hàng.** Mỗi phiên chat xử lý tuần tự từng việc, và các cổng ngân sách ngày/tháng chạy trước khi
   bất cứ gì mới bắt đầu.
4. **Bạn thấy tiến độ.** Khi `mid_stream_updates = true` trên kênh sửa được tin (Telegram), một tin cập
   nhật trực tiếp công cụ đang dùng và thời gian đã trôi. Ở kênh khác bạn nhận câu trả lời cuối. Chỉ báo
   "đang gõ" và cảm xúc chỉ hiện ở nơi kênh và cấu hình của bạn cùng cho phép.
5. **Câu trả lời đến**, được cắt khúc và thoát ký tự cho vừa ứng dụng chat, kèm dòng chi phí, và một
   ghi chú đã bản địa hóa nếu phiên chạy dừng sớm.

Nếu daemon chết giữa chừng, tin được thử lại sau, tối đa 3 lần, rồi bỏ và ghi log. Nếu việc gửi thất bại (mạng chập chờn chẳng hạn), mỗi lần thử lại chờ lâu hơn lần trước, khoảng 10 giây rồi 20 giây. Nếu phiên chạy đã xong
nhưng gửi câu trả lời thất bại, chỉ tin cuối được gửi lại; agent không chạy lần hai. Điều này đúng với
mọi phần của một câu trả lời dài: nếu mất một phần, cả câu trả lời được gửi lại từ đầu, nên phần đã đến
có thể hiện hai lần. Có hai trường hợp
vẫn chạy lại: daemon chết đúng lúc đang ghi lần cuối, và câu trả lời quá 256 KiB nên không được giữ. Các
tin được gộp chung vào một câu trả lời thì nhận câu trả lời đó một lần.

Vài điều nên biết:

- **Tin chuyển tiếp là dữ liệu.** Nội dung của chúng được bọc như nội dung dán vào và không bao giờ bắt
  đầu bằng `/`, nên một lệnh được chuyển tiếp sẽ không chạy, và agent không hành động theo nó trừ khi
  chính lời của bạn yêu cầu.
- **Nút bấm là lệnh.** Bấm một nút y như gõ lệnh đó: cùng khâu xét duyệt, cùng cổng quyền, cùng giới hạn
  tần suất, và chạy trên dữ liệu của hôm nay.
- **Các chat tách biệt.** Mỗi kênh và mỗi chat có cuộc hội thoại riêng; hai ứng dụng chat không bao giờ
  dùng chung một cuộc.
- **Trợ lý không bao giờ hiện tham số thô của công cụ.** Kênh chỉ thấy những gì engine đánh dấu là an
  toàn để hiển thị.

Bên trong: [dev/kenh.md](dev/kenh.md).
