# Kênh

Dành cho lập trình viên thêm hoặc sửa một kênh. Chỉ cần cài kênh với tư cách operator? Xem [Kênh](../kenh.md).

Engine không bao giờ biết tin nhắn đến từ kênh nào. Kênh trả lời bốn câu hỏi rồi đứng sang một bên:

- Người này có được vào không?
- Tin nhắn đã được ghi xuống chỗ nào bền vững chưa, trước khi ta báo với API phía trên là đã nhận?
- Đây là lệnh gạch chéo, hay là việc của một agent?
- Dựng câu trả lời thế nào để nó sống sót qua kênh truyền này?

Mọi thứ còn lại (vòng lặp agent, danh mục lệnh, sổ chi phí, lưu trữ) nằm sau
[src/channels/api.ts](../../src/channels/api.ts) và không phải việc của kênh. Ranh giới đó giữ cho thêm
kênh mới là việc rẻ, và giữ một lỗi ở tầng truyền tin không với tới được sổ sách.

## Định danh và đăng ký

`ChannelId` là chuỗi có nhãn và đã kiểm tra, không phải union đóng. Dựng nó bằng `channelId(value)`, nên
thêm một kênh không bao giờ đồng nghĩa với việc sửa một danh sách tên kênh tập trung.

[src/channels/registry.ts](../../src/channels/registry.ts) là sổ đăng ký, được `channelsProvider` bind
thành dịch vụ `channels`. Nó bắt đầu từ các kênh có sẵn (`telegram`, `zalo`, `zalo_personal`), rồi trộn
thêm:

1. các `ChannelDefinition` thực thi được, đóng góp bởi plugin đi kèm đáng tin cậy;
2. các nguồn kênh khai báo từ plugin đã cài, giới hạn trong `safeConfigOverrides` của định nghĩa gốc.

Một định nghĩa đóng góp phải có đúng mã đã đăng ký và đủ hình dạng của một định nghĩa. Định nghĩa không
hợp lệ và các override khai báo không an toàn bị bỏ qua, lý do đã lọc được ghi vào log
(`channel.definition_skipped`, `channel.declarative_skipped`). Mã thực thi trùng bị từ chối khi trộn
plugin. Người nhúng runtime cũng có thể truyền định nghĩa qua tùy chọn `channels` của `boot`
([Mở rộng](./mo-rong.md)).

## Định nghĩa kênh

```ts
interface ChannelDefinition<T extends ChannelDeliveryConfig = ChannelDeliveryConfig> {
  readonly id: ChannelId
  readonly safeConfigOverrides?: readonly string[]
  resolveConfig(raw: unknown): T
  isEnabled(config: T): boolean
  admission(config: T): ChannelAdmission
  create(config: T, context: ChannelContext): ChannelAdapter
}
```

Định nghĩa lo hai việc: cấu hình riêng của kênh truyền và việc tạo adapter. Các thiết lập gửi chung được
`resolveChannelSettings` chuẩn hóa đúng một lần. Plugin khai báo chỉ đổi được các trường trong
`safeConfigOverrides`; vắng mặt nghĩa là không trường nào. Telegram và Zalo cho phép
`SAFE_DELIVERY_OVERRIDE_FIELDS` (`markdown`, `mid_stream_updates`, `typing_indicator`, `use_reactions`,
`notify_max_per_minute`); Zalo Personal không cho trường nào.

`createChannel(def)` là hàm dựng lúc viết mã. Nó gắn nhãn cho id, từ chối khóa lạ và kiểm tra các hàm
của adapter có mặt.

`create` nhận một `ChannelContext`: `logger`, `pollOffsets`, `inbox` (hộp nhận bền vững), `env` (được
truyền vào; hãy phân giải `token_env` trên nó, không bao giờ đọc `process.env`) và `dataDir` (trạng thái
trên đĩa ghi vào đây, không bao giờ ghi dưới `$HOME`).

## Hợp đồng adapter

```ts
interface ChannelAdapter {
  readonly id: ChannelId
  readonly capabilities: ChannelCapabilities
  readonly renderer: ChannelRenderer
  start(handlers: AdapterHandlers, signal: AbortSignal): Promise<void>
  send(out: ChannelOutbound, options?: { readonly signal?: AbortSignal }): Promise<SentRef>
  dispose(): Promise<void>
  edit?(req: EditRequest): Promise<void>
  chatAction?(chatId: string, action: 'typing'): Promise<void>
  setReaction?(req: ReactionRequest): Promise<void>
}
```

- `start` hoàn tất khi kênh đã **chạy**: thông tin đăng nhập đã được kiểm, handler đã sẵn sàng. Nó không
  chờ mãi suốt đời kênh. Vòng lặp nhận tin chạy tách ra và dừng theo `signal`, nên boot hỏng nhanh khi
  token sai, còn lỗi giữa chừng chỉ đánh dấu trạng thái không khỏe.
- `dispose` an toàn khi gọi nhiều lần và dọn mọi listener, timer, lời gọi mạng còn dở mà adapter sở hữu.
- `AdapterHandlers` đưa cho bạn `onMessage`, `onCallback`, `setStatus`, và tùy chọn `canAdmit` (false với
  chat hay người dùng mà không quy tắc nhận nào cho vào được; vắng mặt nghĩa là lưu hết) và
  `commandsForMenu`.
- `renderer` sở hữu phần định dạng: `chunk` mã hóa và cắt văn bản thô (thoát ký tự trước đó sẽ mã hóa hai
  lần và hiện ra thành dấu gạch chéo ngược), `escape` chỉ dành cho đoạn không đi qua `chunk`, và
  `normalizeTables` viết lại bảng.

Kênh tự khai nó làm được gì, và tầng gửi rẽ nhánh theo khai báo đó, không bao giờ theo tên kênh:

```ts
interface ChannelCapabilities {
  readonly inlineButtons: boolean
  readonly markdown: 'none' | 'markdownv2'
  readonly typing: boolean
  readonly reactions: boolean
  readonly canEdit: boolean
  readonly maxTextLen: number
}
```

Hãy khai trung thực. Khai `canEdit` mà thực tế không sửa được, đó chính là cách một dòng tiến độ đang
chạy biến thành bốn mươi tin nhắn trùng nhau.

### Lựa chọn gõ tay

Kênh không có `inlineButtons` không hiện được bàn phím, nên `delivery/choices.ts` cấp một mã bốn chữ
số cho mỗi nút (`/4821`), khóa theo chat, và ô xin phê duyệt cùng ô duyệt kế hoạch thêm chúng vào thành các
dòng. `handleTypedChoice` chạy đầu tiên trong `route`, trước quy tắc nhắc tên, và biến một mã còn sống
thành đúng `ChannelCallbackQuery` mà một lần bấm tạo ra. Khâu xét duyệt (`gate.admitCallback`) chạy trước
khi mã bị dùng, nên một thành viên không phải operator để mã còn nguyên cho người đúng; sau đó `discard`
bỏ mã cùng các mã anh em. Mỗi mục mang `expiresAt` của chính câu hỏi và LRU chỉ chặn bộ nhớ, nên hạn
chỉ là dọn dẹp: các resolver vẫn quyết định, và một yêu cầu không biết thì trả lời "đã trả lời hoặc đã
hết hạn".

### Dữ liệu nút bấm

`callback_data` có dạng `action:rest`. Bên cạnh `abort` và các quyết định phê duyệt, kế hoạch, `cmd:`
mang theo một lệnh gạch chéo mà một tin nhắn đã mời bạn bấm. Telegram giới hạn `callback_data` ở 64 byte
(`TELEGRAM_CALLBACK_DATA_MAX_BYTES`); payload dài hơn thì chuyển thành một dòng văn bản.

Hãy coi dữ liệu `cmd:` là đầu vào thù địch: client có thể gửi bất kỳ `callback_data` nào nó muốn. Nó
không đi thẳng tới handler. Nó quay lại đúng con đường một tin nhắn gõ tay đi qua, cùng khâu xét duyệt,
cùng cổng quyền, cùng cửa sổ giới hạn tần suất và cùng phiên chat, với `query.from` là người dùng và
`query.isGroup` được mang theo. Payload không gọi tên lệnh gạch chéo nào thì chuyển sang nhánh callback
điều khiển.

## Một tin nhắn mang theo những gì

Chiều vào (`InboundMessage`): `channel`, `chatId`, `userId`, `messageId`, `text`, `receivedAt` tính bằng
epoch-ms, và tùy chọn `reactionRef`, `isGroup`, `addressedToBot`. Chiều ra (`ChannelOutbound`): `channel`,
`chatId`, `text`, và tùy chọn `replyToMessageId`, `buttons`, `useMarkup`, `silent`.

Phía trên adapter, mọi mã đều là chuỗi mờ. Mã Telegram dạng số được chuẩn hóa thành chuỗi trước mọi khâu
xét duyệt, nên `12345` và `"12345"` không bao giờ bất đồng về chuyện bạn là ai.

Tin nhắn được chuyển tiếp mang theo nội dung không phải do operator viết. Trước khi lưu, nội dung đó
được bọc trong thẻ `<pasted_content id="...">` với một id ngẫu nhiên, và prompt của agent chat coi mọi
thứ bên trong là dữ liệu, trừ khi chính lời của operator yêu cầu hành động. Nội dung đã bọc không bắt
đầu bằng `/`, nên một lệnh được chuyển tiếp sẽ không chạy.

## Xét duyệt

```ts
interface ChannelAdmission {
  readonly mode: 'allowlist' | 'pairing'
  readonly allowedIds: readonly string[]
  readonly operatorUserIds: readonly string[]
}
```

| Chế độ | Hành vi |
|---|---|
| `allowlist` | Chỉ các mã chat hoặc người dùng đã cấu hình được nhận |
| `pairing` | Mã đã cấu hình được nhận; chat lạ nhận một mã ghép nối dùng một lần |

Không có chế độ mở: mọi chat được nhận đều đóng vai operator cục bộ duy nhất, nên một kênh không giới
hạn sẽ phơi sổ lệnh, hồ sơ và bộ nhớ của operator đó cho bất kỳ ai gửi tin. Cấu hình còn có thể tắt hẳn
một kênh, trước khi chế độ xét duyệt kịp được tạo ra.

Telegram ghép nối khi `pairing = true` và chỉ bật mặc định khi không có danh sách cho phép. Zalo đọc
`dm_policy = pairing | allowlist | disabled`, mặc định ghép nối. Zalo Personal luôn chỉ chạy theo danh
sách cho phép.

Ghép nối luôn chặn lại khi có sự cố:

- một operator đã cấu hình có thể liệt kê, duyệt, từ chối, hoặc thu hồi các ghép nối;
- một chat đã ghép nối không ghép nối được cho chat khác;
- gửi tin lạ liên tục không sinh ra vô hạn mã;
- lưu trữ hỏng thì từ chối xét duyệt;
- mã đang chờ hết hạn theo chính sách của kho ghép nối.

## Từ lúc đến tới lúc trả lời

Adapter polling ghi tin nhắn hoặc callback đã chuẩn hóa vào hộp nhận (`InboundInbox`, qua
`acceptInbound`) **trước khi** đẩy offset phía trên lên. Sập giữa hai bước này thì tin nhắn được phát
lại; sập theo thứ tự ngược lại thì mất tin. Cập nhật từ chat hay người dùng mà không quy tắc nhận nào cho
vào (`canAdmit` là false) thì không được lưu, nên người lạ không làm phình hộp nhận. Ở chế độ `pairing`
thì mọi thứ đều được lưu.

Sau đó khâu rút hàng đợi xử lý hộp nhận:

- `claimPending` giữ một lease trên các dòng; `renewClaims` giữ lease của phiên chạy còn sống khi một lần
  phê duyệt tạm dừng hạn của nó.
- `recoverStalled` đưa các dòng hết lease trở lại hàng đợi (giới hạn thời lượng phiên chạy cộng 5 phút),
  nên việc dở của một daemon đã chết được nhặt lại.
- Một lần thử hỏng sẽ được thử lại cho tới `inboxMaxAttempts` (3), rồi dòng đó bị đưa vào dead-letter và
  ghi log `channel.inbox_dead_lettered`. Dòng được xếp lại mang `retry_at` (10 giây, nhân đôi mỗi lần, trần
  5 phút), và cả hai câu lệnh nhận việc bỏ qua dòng chưa tới giờ, nên một lần mạng chập chờn không đốt hết
  các lần thử trong chưa đầy một giây.

Việc giao là ít nhất một lần, nhưng một phiên chạy đã xong thì không bao giờ chạy hai lần. Khi lần ghi
cuối của câu trả lời thất bại, hộp nhận giữ câu trả lời đó trên dòng (`answer`), và lần thử lại chỉ gửi
lại tin nhắn cuối, không phát lại phần tiến trình trực tiếp, thay vì chạy lại agent cùng công cụ của nó.
Các tin nhắn được gộp chung vào một câu trả lời thì chỉ gửi nó một lần; những dòng còn lại hoàn tất mà
không có tin trả lời riêng. Có hai trường hợp vẫn chạy lại: daemon chết đúng lúc đang ghi lần cuối, và
câu trả lời quá lớn để giữ (trên 256 KiB, `MAX_STORED_ANSWER_CHARS`).

Sau khi được nhận:

1. lệnh điều khiển và lệnh ghép nối được xử lý;
2. lệnh gạch chéo đi qua bộ điều phối lệnh chuẩn;
3. văn bản thường được gom nhịp rồi định tuyến tới agent và phiên chat đã chọn;
4. hàng đợi theo phiên chat và các cổng ngân sách ngày/tháng chạy trước khi bất cứ gì mới được thực thi;
5. sự kiện luồng cập nhật câu trả lời đang chạy, và kết quả cuối được gửi đi.

Khóa phiên chat bao gồm định danh kênh và chat, nên hai kênh truyền không bao giờ dùng chung trạng thái
hội thoại.

## Gửi câu trả lời về

Tầng gửi sở hữu:

- việc thoát ký tự và cắt khúc an toàn cho kênh truyền;
- phản hồi "đang gõ" và thả cảm xúc ở nơi hỗ trợ;
- sửa tin tiến độ trực tiếp khi `mid_stream_updates` và `canEdit` cùng đúng;
- menu lệnh gạch chéo ở nơi adapter hỗ trợ;
- chữ hoàn tất và chữ báo lỗi đã bản địa hóa, cùng dòng chi phí cuối tin;
- giới hạn tần suất và hàng đợi thông báo chiều ra (`ChannelSettings`: nhịp gom tin, nhịp sửa tin và cỡ
  hàng đợi là cố định, `notifyMaxPerMinute` mặc định là 3).

Kênh không bao giờ đọc tham số thô của công cụ. Engine quyết định cái gì an toàn để hiển thị rồi phát ra
dưới dạng sự kiện `tool_execution_start` và `tool_progress`, nên không adapter nào phải được tin tưởng
với nội dung một câu lệnh shell.

### Bot nhớ đã gửi gì

Mỗi runtime kênh giữ trong bộ nhớ một bảng có giới hạn, từ `(cuộc chat, id tin)` sang loại tin bot đã gửi
ở đó: một khúc câu trả lời (kèm việc dòng chi phí cuối tin có nằm trong khúc ấy không) hoặc một bản tin
chủ động (kèm nhãn của nó). Bảng chỉ giữ id, loại và nhãn, không bao giờ giữ nội dung tin, tối đa 2.000
mục, và mất sau khi khởi động lại. Tin không có trong bảng, dù bị đẩy ra, gửi từ trước lần khởi động lại,
là kết quả của lệnh gạch chéo, hay là dòng chi phí đã đi thành một khúc riêng, đơn giản là "không biết",
và nơi đọc bảng lùi về một dòng chỉ dẫn thay vì nội dung.

### Ngữ cảnh trả lời

Ở chat riêng Telegram, một tin trả lời một tin của chính bot mang theo `replyTo` (id và nội dung tin được
trả lời, cùng đoạn `quote` người vận hành đã bôi chọn). Chat nhóm không bao giờ đặt nó: bảng tin đã gửi
lưu theo chat chứ không theo người, nên nếu không thì một thành viên trả lời có thể kéo câu trả lời của
thành viên khác vào phiên của mình.

`runExchange` biến nó thành một đoạn dẫn bằng `toReplyLead`:

- với một câu trả lời, nội dung tin được trả lời (hoặc đoạn bôi chọn, nếu nằm trong phần thân câu trả lời)
  bọc như nội dung dán vào và cắt ở một độ dài cố định;
- với một thông báo, chỉ nhãn của nó;
- với mọi thứ khác, một dòng chỉ dẫn.

Dòng chân của lượt chạy (chi phí LLM, token, số lần gọi model) được giấu khỏi model như một con số của
người vận hành: nó bị cắt khỏi nội dung tin được trả lời, và đoạn bôi chọn chạm vào nó thì lùi về cả phần
thân không có dòng chân. Dòng chân gửi thành một tin riêng không bao giờ được ghi lại, nên trả lời vào nó
chỉ nhận dòng chỉ dẫn. Một tin trong hộp thư được phát lại vẫn giữ `replyTo` nhưng gặp bảng rỗng sau khi
khởi động lại, nên cũng chỉ nhận dòng chỉ dẫn.

Một tin trả lời không bao giờ được đưa vào lượt chạy đang dở: nó chờ lượt đó xong rồi chạy thành lượt
riêng, để mang theo đoạn dẫn. Khi nhiều tin gom vào một lượt thì chỉ giữ tin trả lời của tin cuối.

### Ghi chú về khoảng im lặng

Khoảng im lặng được đo từ dòng `session_messages` mới nhất (`SessionActivity.lastMessageAt`), không bao giờ
từ `sessions.last_activity_at`, vì lệnh gạch chéo cũng làm mới cột đó. Khi dòng ấy cũ hơn
`gap_note_minutes`, đoạn dẫn mở đầu bằng một dòng nói chat đã im lặng bao lâu và giá trước đó có thể đã cũ. Đọc
thất bại thì ghi log `channel.gap_note_lookup_failed` và bỏ qua ghi chú, nên không bao giờ làm hỏng lượt.
Khóa này nằm trong `deliveryFields` nhưng không nằm trong `SAFE_DELIVERY_OVERRIDE_FIELDS`, nên một kênh
plugin khai báo không ghi đè được nó.

### Đoạn dẫn không bao giờ được lưu

`runExchange` truyền ghi chú khoảng im lặng và đoạn dẫn trả lời qua `RunInput.lead`, một lần cho mỗi lượt
chạy. Engine thêm nó thành một tin người dùng tạm thời ngay trước lời của người vận hành, giống cách nó
khôi phục danh sách việc cần làm: model đọc được trong lượt đó, còn `history show` và lịch sử chat qua
`/v1` chỉ hiện đúng những gì người vận hành đã gõ. Phiên, tuyến và lịch sử không đổi, và `/new` vẫn là cách
bắt đầu mới một cách tường minh.

## Khởi động và tắt

`startChannels` kiểm tra mọi định nghĩa đã đăng ký, tạo adapter cho từng kênh đang bật và khởi động
chúng bằng `Promise.allSettled`, nên một token cũ không chặn được các kênh còn lại. Lỗi khởi động
không bao giờ nghiêm trọng: kênh có `start()` ném lỗi bị giải phóng và loại, nên nó không bao giờ lắng
nghe và không cho ai vào. `OperatorConfigError` (token thiếu hoặc bị từ chối) ghi log
`channel.start_skipped` và được trả về trong `StartChannelsResult.skipped` để daemon báo; mọi lỗi khác
ghi log `channel.start_failed`. Lỗi lúc dựng runtime (agent không có, giá trị sai) vẫn ném trước khi
kênh nào khởi động. Nếu không kênh nào chạy, chạy riêng CLI vẫn hợp lệ.

Chỉ một token mà chính nhà cung cấp từ chối mới tính là cấu hình: HTTP 401 hoặc 403 từ Telegram, và 401
từ Zalo, vì bảng mã lỗi của chính Zalo xếp 403 là lỗi máy chủ. Mọi lỗi `getMe` khác là lỗi đường truyền,
và cả hai adapter thử tối đa bốn lần với khoảng chờ có trần trước khi bỏ kênh. Zalo Personal không có
token để bị từ chối: nó thử đăng nhập lại ở nền (đầu tiên 5 giây, tối đa 5 phút).

`startChannels` trả về `{ stop, snapshots, skipped, notifier?, defaultRecipient? }`: hàm tắt, ảnh chụp sức khỏe, các kênh bị loại,
một bộ gửi chiều ra định tuyến tới runtime sở hữu kênh (`AcknowledgedRouter`), và người nhận mặc định
cho tin chủ động. Người nhận đó là `fallback_chat_id` của kênh, hoặc id được phép duy nhất khi kênh chỉ
có đúng một. `stop` chạy hết mọi khâu dọn dẹp và không bao giờ để một lần dọn hỏng chặn những lần còn
lại.

## Thêm một kênh

1. Viết một `ChannelDefinition` và một `ChannelAdapter` phía sau `channels/api.ts`, trong
   `channels/adapters/<tên>/`.
2. Giữ phần phân tích kênh truyền, dựng hiển thị, và thông tin đăng nhập bên trong thư mục đó.
3. Khai đúng năng lực thật, và áp `maxTextLen` ở tầng dựng hiển thị.
4. Nhận tín hiệu tắt trước khi gắn listener hay bắt đầu polling.
5. Đăng ký định nghĩa ở tầng composition, thường qua một plugin đi kèm đáng tin cậy.
6. Thêm kiểm tra cấu hình và doctor qua chính đường schema của định nghĩa.

Nếu bạn thấy mình đang thêm một `if` riêng cho từng kênh vào mã gửi tin, mã lệnh, mã phê duyệt hay mã
lưu trữ, nghĩa là `ChannelCapabilities` đang thiếu một năng lực. Hãy thêm vào đó.

## Bản đồ mã nguồn

- [src/channels/api.ts](../../src/channels/api.ts): bề mặt công khai của module
- [src/channels/types.ts](../../src/channels/types.ts): `ChannelDefinition`, `ChannelAdapter`, `ChannelCapabilities`, `InboundInbox`
- [src/channels/define.ts](../../src/channels/define.ts): `createChannel`
- [src/channels/registry.ts](../../src/channels/registry.ts): đăng ký và trộn plugin
- [src/channels/schema.ts](../../src/channels/schema.ts): `resolveChannelSettings`, các khóa cấu hình gửi tin
- [src/channels/start.ts](../../src/channels/start.ts): `startChannels`
- [src/channels/delivery/](../../src/channels/delivery/): cổng xét duyệt, rút hộp nhận, hàng đợi, truyền luồng, trả lời
- [src/channels/adapters/](../../src/channels/adapters/): `telegram`, `zalo`, `zalo-personal`
- [Mở rộng](./mo-rong.md), [Bên trong](./ben-trong.md)
