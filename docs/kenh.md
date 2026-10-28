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

Kênh chỉ chạy khi đã có đủ cấu hình và thông tin đăng nhập, và nó chạy trong dịch vụ nền (daemon).

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
- Đăng nhập lại trong lúc dịch vụ nền đang chạy thì lần thử kế tiếp sẽ nhận, không cần khởi động lại.
- `openalpha doctor channels` cho biết kênh còn thiếu thứ nào trong ba thứ: lời chấp nhận rủi ro, một id
  được phép, hay lần đăng nhập đã cất.

Trong nhóm, bot Zalo trả lời mọi tin đến được với nó. Zalo chỉ giao tin nhóm cho bot khi bot được @nhắc
tên, và khâu xét duyệt vẫn quyết định nhóm nào được dùng.

## Cấu hình một kênh

Mỗi kênh là một bảng `[channels.<id>]` trong `config.toml`. Bản chú thích đầy đủ nằm ở
`config.sample.toml`.

Với Telegram, bạn không cần tự sửa tệp: `openalpha onboard` hỏi tên biến chứa token của bot rồi ghi bảng
này, để chế độ ghép nối bật sẵn. Chạy dịch vụ nền, nhắn bất kỳ tin nào cho bot, rồi duyệt mã nó trả về
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
| `operator_user_ids` | tất cả | Ai là người vận hành: người được chạy mọi lệnh đọc hoặc đổi sổ của bạn (`/trade`, `/record`, `/portfolio`, `/suggest`, `/alert`, `/brief`, `/themes` và các lệnh giao dịch còn lại), cùng `/config`, `/new`, `/social`, `/upgrade` và các lệnh ghép nối ngay trong chat (`/pair`, `/approve`, `/deny`). Người khác được bot cho vào chỉ dùng các lệnh công khai, như `/price`. Lệnh ghép nối chỉ chạy từ một chat có trong `allowed_ids`; với chat nhóm, hãy thêm cả id của nhóm vào đó. Bỏ trống thì mọi người bot cho vào đều là người vận hành trong chat riêng của chính họ, nên hãy đặt khi bạn dùng chung bot |
| `pairing` | `telegram` | Ép bật hoặc tắt ghép nối |
| `dm_policy` | `zalo` | `pairing`, `allowlist`, hoặc `disabled`. Mặc định là `pairing`, hoặc `allowlist` khi đã đặt `allowed_ids`, giống Telegram |
| `i_accept_ban_risk`, `profile` | `zalo_personal` | Lời chấp nhận bắt buộc, và kênh dùng lần đăng nhập QR đã lưu nào |
| `agent` | tất cả | Gắn kênh vào một agent thay vì agent mặc định |
| `require_mention`, `slash_commands` | tất cả | Quy tắc nhắc tên trong nhóm, và có chặn lệnh gạch chéo hay không |
| `fallback_chat_id` | tất cả | Nơi một việc theo lịch không có `--to` sẽ gửi tới. Chỉ có đúng một id được phép, hoặc đúng một chat đã ghép nối, thì dùng chat đó |

Các khóa còn lại tinh chỉnh việc gửi: `markdown`, `mid_stream_updates`, `typing_indicator`,
`use_reactions`, `notify_max_per_minute`, `gap_note_ms`. Nhịp gom tin, nhịp sửa tin trực tiếp và hàng đợi gửi đi là cố
định. Một khóa lạ sẽ làm hỏng khâu kiểm tra, nên gõ sai là biết ngay lúc khởi động, thay vì biết lúc 9
giờ sáng.

Một kênh chưa có token (biến trong `token_env` chưa đặt, hoặc `token_file` trống), hay có token mà chính
nhà cung cấp từ chối (HTTP 401 hoặc 403 từ Telegram, 401 từ Zalo), thì không được mở. Dịch vụ nền vẫn khởi
động: `start` in một dòng cảnh báo cho kênh đó, các kênh khác và mọi việc còn lại chạy bình thường, và kênh
không có token hợp lệ không nhận tin của ai. Đặt lại token rồi `restart --background` để mở kênh. Token Telegram bị thu hồi
khi dịch vụ nền đang chạy cũng được xử lý như vậy: sau ba lần bị từ chối liên tiếp, kênh dừng, `/health` báo kênh ngừng, và thông báo kênh
ngừng gửi qua kênh khác sẽ nói rõ là token bị từ chối. Một giá trị cấu hình sai
(sai kiểu, sai tên khóa) vẫn làm `start` dừng và báo lỗi. Mọi lỗi khác khi kiểm
tra token được coi là lỗi đường truyền: hệ thống thử bốn lần, khoảng chờ tăng dần, và nếu mạng vẫn chưa
lên thì kênh vẫn được giữ, hiện ở trạng thái suy giảm và tiếp tục thử lại ở nền với khoảng chờ có trần,
cho tới khi kết nối được hoặc dịch vụ nền dừng. Zalo Personal không có token để bị từ chối: nó cũng cứ thử đăng
nhập lại ở nền. Nếu không kênh nào chạy, dùng riêng CLI vẫn được.

## Ai được vào

Có hai chế độ và không có chế độ mở. Một kênh hoặc nhận theo danh sách, hoặc ghép nối.

| Chế độ | Chuyện gì xảy ra |
|---|---|
| `allowlist` | Chỉ các chat hoặc người dùng trong `allowed_ids` được vào |
| `pairing` | Id trong danh sách được vào. Chat lạ nhận một mã dùng một lần để đưa cho operator |

- **Telegram** ghép nối khi `pairing = true`. Bỏ trống `pairing` thì nó chỉ bật mặc định khi bạn không
  khai `allowed_ids`. Ghép nối mà không có id được phép thì bất kỳ người dùng Telegram nào cũng xin được
  mã, và dịch vụ nền ghi một cảnh báo (`telegram.pairing_open`).
- **Zalo** theo `dm_policy`, mặc định là `pairing`, hoặc `allowlist` khi đã đặt `allowed_ids`, giống Telegram.
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

Cách này chỉ dùng được với dịch vụ nền bật bằng `start --background`, và chỉ khi không còn việc gì đang dở: câu trả lời, lượt nghiên cứu, phê duyệt, bản tin hay lượt nạp dữ liệu. Nếu còn, bot nhờ bạn thử lại sau.

Chỉ người vận hành dùng được, giống `/trade`. Không đặt `operator_user_ids` thì mọi người bot cho vào đều là người vận hành trong chat riêng của chính họ, nên nếu bạn dùng chung bot với người khác, hãy đặt khóa này.

## Phê duyệt và duyệt kế hoạch trên Zalo

Zalo không có nút bấm, nên một ô xin phê duyệt hay một kế hoạch `/research thorough` đến kèm các mã ngắn
như `/4821` cho từng lựa chọn. Gõ lại một mã trong cùng chat để trả lời. Mỗi mã dùng một lần, chỉ dành
cho operator, và chỉ tới khi câu hỏi hết hạn; gõ lại lần nữa, hoặc sau khi hết giờ, sẽ nhận câu trả lời
rằng câu đó đã được trả lời hoặc đã hết hạn. Hai câu hỏi mở cùng lúc nhận hai bộ mã khác nhau, và trả
lời một câu không làm mất mã của câu kia. Bấm một nút sau khi câu hỏi đã được trả lời hoặc hết giờ cũng nhận đúng câu trả lời đó.

`fallback_chat_id` cũng quyết định cảnh báo hay bản tin sáng đặt từ terminal sẽ gửi đi đâu: kênh được
cấu hình đầu tiên (Telegram, Zalo, Zalo Personal) có chat dự phòng, hoặc một id được phép duy nhất, hoặc
một chat ghép nối duy nhất.

- **Ghép nối** xong thì không cần đặt gì thêm. Dịch vụ nền nhận ra chat đó ở tin nhắn đầu tiên bạn gửi
  sau khi ghép nối.
- **Bỏ ghép nối** bằng `pair revoke` thì dịch vụ nền thôi gửi mọi thứ tới chat đó, ngay từ tin kế tiếp
  và cả sau khi khởi động lại. Cảnh báo và bản tin sáng đặt ở chat ấy tự tắt ở lần gửi kế tiếp, nên ghép
  nối lại cũng không bật chúng lên: chạy lại `/brief enable` và đặt lại cảnh báo.
- **Một nhóm** được nhận qua tài khoản của bạn không có ghép nối riêng, nên `pair revoke` không chạm tới
  nó. Muốn ngừng, tắt cảnh báo và bản tin trong nhóm, hoặc gỡ bot khỏi nhóm.
- **Ứng dụng** liệt kê các chat đã ghép nối trên từng kênh và bỏ ghép nối được một chat, kết quả giống
  `pair revoke`.

Kênh mất kết nối và không có lại sẽ được báo trên một kênh khác, và `status` liệt kê nó; xem [Vận hành](van-hanh.md#khi-dịch-vụ-nền-dừng-hoặc-lỡ-bản-tin).

## Một tin nhắn đi qua những bước nào

1. **Lưu trước.** Tin được ghi vào hộp nhận bền vững trước khi ứng dụng chat được báo là đã nhận. Sập
   giữa hai bước thì tin được phát lại; làm ngược thứ tự sẽ mất tin. Ở chế độ `allowlist`, tin của người
   không bao giờ vào được thì không được lưu, nên người lạ không làm phình hộp nhận. Ở chế độ `pairing`
   thì mọi thứ đều được lưu, vì chat lạ sẽ được cấp một mã.
2. **Kiểm tra.** Lệnh dừng và lệnh ghép nối được xử lý trước. Lệnh gạch chéo đi qua bộ điều phối lệnh
   chuẩn. Văn bản thường được gom nhịp một lúc rồi chuyển tới agent và cuộc trò chuyện đang mở của chat đó.
3. **Xếp hàng.** Mỗi cuộc trò chuyện xử lý tuần tự từng việc, và các cổng ngân sách ngày/tháng chạy trước khi
   bất cứ gì mới bắt đầu. Các câu lệnh tự chạy được (như `/suggest`, `/screen`, `/refresh`) là ngoại lệ: chúng
   chạy bên cạnh lượt của phiên, tối đa ba câu lệnh cùng lúc mỗi cuộc chat. Câu lệnh phải chờ sẽ báo đã xếp hàng
   và đứng thứ mấy, còn `/stop` hoặc `/new` thì bỏ nó, và dừng cả những câu lệnh đang chạy.
4. **Bạn thấy tiến độ.** Khi `mid_stream_updates = true` trên kênh sửa được tin (Telegram), một tin cập
   nhật trực tiếp công cụ đang dùng và thời gian đã trôi. Ở kênh khác bạn nhận câu trả lời cuối. Chỉ báo
   "đang gõ" và cảm xúc chỉ hiện ở nơi kênh và cấu hình của bạn cùng cho phép.
5. **Câu trả lời đến**, được cắt khúc và thoát ký tự cho vừa ứng dụng chat, kèm dòng chi phí, và một
   ghi chú đã bản địa hóa nếu phiên chạy dừng sớm.

Nếu dịch vụ nền chết giữa chừng, tin được thử lại sau, tối đa 3 lần, rồi bỏ và ghi log. Nếu việc gửi thất bại (mạng chập chờn chẳng hạn), mỗi lần thử lại chờ lâu hơn lần trước, khoảng 10 giây rồi 20 giây. Nếu phiên chạy đã xong
nhưng gửi câu trả lời thất bại, chỉ tin cuối được gửi lại; agent không chạy lần hai. Điều này đúng với
mọi phần của một câu trả lời dài: nếu mất một phần, cả câu trả lời được gửi lại từ đầu, nên phần đã đến
có thể hiện hai lần. Có hai trường hợp
vẫn chạy lại: dịch vụ nền chết đúng lúc đang ghi lần cuối, và câu trả lời quá 256 KiB nên không được giữ. Các
tin được gộp chung vào một câu trả lời thì nhận câu trả lời đó một lần.

Vài điều nên biết:

- **Tin chuyển tiếp là dữ liệu.** Nội dung của chúng được bọc như nội dung dán vào và không bao giờ bắt
  đầu bằng `/`, nên một lệnh được chuyển tiếp sẽ không chạy, và agent không hành động theo nó trừ khi
  chính lời của bạn yêu cầu.
- **Cuộc trò chuyện giữ nguyên cho tới khi bạn gõ /new.** Nếu bạn quay lại sau một lúc lâu, OpenAlpha sẽ
  xem lại giá mới chứ không dùng lại con số đã nói trước đó.
- **Trả lời đúng tin.** Trong chat riêng Telegram hay Zalo Personal, bạn cứ bấm trả lời vào một câu trả lời của OpenAlpha,
  nó sẽ biết bạn đang hỏi tiếp câu nào. Với cảnh báo giá và bản tin sáng, nó chỉ biết đó là loại tin gì, không bao giờ
  thấy số tiền của bạn. Bot Zalo (Bot API) không gửi kèm tin được trích nên không nằm trong phạm vi này.
- **Nút bấm là lệnh.** Bấm một nút y như gõ lệnh đó: cùng khâu xét duyệt, cùng cổng quyền, cùng giới hạn
  tần suất, và chạy trên dữ liệu của hôm nay.
- **Các chat tách biệt.** Mỗi kênh và mỗi chat có cuộc hội thoại riêng; hai ứng dụng chat không bao giờ
  dùng chung một cuộc.
- **Trợ lý không bao giờ hiện tham số thô của công cụ.** Kênh chỉ thấy những gì engine đánh dấu là an
  toàn để hiển thị.

Bên trong: [dev/kenh.md](dev/kenh.md).
