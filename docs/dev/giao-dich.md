# Giao dịch: bên trong

Dành cho người đóng góp mã. Hướng dẫn cho người dùng ở [giao-dich.md](../giao-dich.md). Trang này giữ các hợp đồng đứng sau nó.

## Nguồn

Mọi lời gọi nguồn trả về một `SourceResult<T>` ([source-result.ts](../../src/trading/kernel/source/source-result.ts)):

```ts
type SourceResult<T> = SourceAvailable<T> | SourceUnavailable

interface SourceUnavailable {
  readonly kind: 'unavailable'
  readonly reason: SourceUnavailableReason // 'unconfigured' | 'unsupported' | 'stale' | 'failed'
  readonly attemptedSourceIds: readonly SourceId[]
  readonly caveats: readonly Caveat[]
}
```

- Độ tươi (`live` hoặc `cached`) nằm trên từng dòng xuất xứ, không bao giờ là một con số tổng.
- Một bộ nối khai cái nó tải và phân tích phần dữ liệu. Mốc hết giờ, thử lại, trần kích thước, cache và cầu dao thuộc về [`sources/transport/http.ts`](../../src/trading/sources/transport/http.ts).
- Một lần đọc giá khai mốc hết giờ chặt và một lần thử. Các lần đọc hàng loạt giữ mặc định của transport.
- `SOURCE_ROUTES` ([routes.ts](../../src/trading/sources/routes.ts)) quyết định nguồn nào phục vụ một phạm vi, theo thứ tự nào. `SOURCE_RATE_LIMITS` ([source-facts.ts](../../src/trading/wiring/composition/source-facts.ts)) liệt kê mọi nguồn xuất xưởng. Nguồn cần khóa mà chưa có khóa thì không được đăng ký, và khởi động ghi `trading.source.skipped`.
- Mọi kết quả `news` đi qua `withNewsArchive` ([news-archive.ts](../../src/trading/wiring/composition/news-archive.ts)).

## Khi nào một ngày đã settle

Một vị từ duy nhất sở hữu câu hỏi này, trong [calendar.ts](../../src/trading/markets/calendar.ts):

```ts
isSettled(calendar, day, now) // calendar.isTradingDay(day) && now >= calendar.tapeFinalAt(day)
resolveSettledDay(calendar, now) // hôm nay nếu đã settle, nếu không thì phiên giao dịch trước
```

`tapeFinalAt(day)` là giờ đóng phiên cộng độ trễ khớp lệnh. Mọi bên ghi và bên đọc đều hỏi nó; không ai chép lại. Các nơi gọi:

- bộ lập lịch refresh đặt một nhịp ở `tapeFinalAt` ([refresh-schedule.ts](../../src/trading/features/market-data/ops/refresh-schedule.ts));
- một lượt refresh chỉ ghi dòng đóng dấu `asOf` khi thời điểm đó đã qua;
- `isAttemptCurrent` ([refresh của equity-vn](../../src/trading/markets/equity-vn/refresh/refresh.ts)) hỏi `isSettled(calendar, attempt.asOf, attempt.attemptedAt)` trước khi xét tuổi, nên một dấu ghi trong khoảng chờ settle không bao giờ bị đọc là hiện hành;
- năng lực quote của một thị trường bỏ một số đọc qua `isLiveObservation` và lùi về giá đã lưu qua `liveOrStoredQuote` ([stored-quote.ts](../../src/trading/markets/stored-quote.ts)). Thị trường sở hữu câu hỏi, không bao giờ là bộ nối.

`upsertSeriesPoint` ([kho market-data](../../src/trading/features/market-data/store/market-data.ts)) trả lời dòng có được ghi hay không. Một lượt chạy chỉ đếm những gì nó ghi, và `force` là thứ suy lại một ngày đã lưu. Một ngày mà lịch sử bảng vàng không tìm thấy bảng nào thì không phải một mục `missingTargets`.

## Khâu sàng lọc và danh sách loại trừ

`ScreenRequest` mang `market`, `limit`, `instrumentKind` và `sectors`. Không thị trường nào đọc hồ sơ. Dấu `nằm trong danh sách loại trừ của bạn` tới qua một `ExclusionReader` ([types.ts](../../src/trading/features/market-data/types.ts)) do tầng composition bind, nên `market-data` không với tới tính năng nào có phạm vi operator.

## Cảnh báo

Một cảnh báo do hệ thống dựng mang một chuỗi origin mà lượt dựng đối soát theo ([alerts/types.ts](../../src/trading/features/alerts/types.ts)):

| Origin | Dựng cho |
|---|---|
| `exit:<suggestionId>:<stop\|target>:<threshold>` | mỗi đề xuất hành động đứng sau một vị thế bạn nắm |
| `screen:<market>:<ticker>:<up\|down>:<day>` | mọi mã trong danh sách theo dõi và đang nắm |

Ngưỡng là một phần danh tính của cảnh báo thoát, nên một cắt lỗ mà trail đã nâng là một origin mới: nó được dựng, và cái cũ nghỉ hẳn. Cảnh báo của operator không mang origin.

Bộ nhớ theo phiên của trail (`trailedThrough`) chỉ được đặt sau khi việc nâng đã ngã ngũ: đã ghi, thua một lần nâng đồng thời, hoặc không cần nâng. Một lần ghi hỏng để nó không được đặt, nên nhịp kế tiếp thử lại thay vì chờ một phiên. Cách vòng cảnh báo cô lập lỗi nằm ở [vận hành](van-hanh.md#phân-loại-lỗi-của-một-lượt).

## Bảng thành tích và các lượt chạy hàng loạt

- `independentCalls` (`pipeline/reporting.ts`) là chỗ duy nhất gộp một lời gọi lặp lại lời gọi còn mở trên cùng mã và cùng chiều. Nó chỉ đọc `FoldableCall` (`at`, `instrument`, `action`, `outcome.exitDay`), nên hồ sơ theo phạm vi gộp các dòng gọn `FocusCall` mà `listFocusCalls` trả về (không payload, không giới hạn số dòng) bằng cùng quy tắc `summarizeTrackRecord` dùng, từng phạm vi một. Không có bản cài đặt thứ hai trong SQL; `LATEST_OF_SAME_CALL_SQL` vẫn giữ dòng mới nhất của một lời gọi cùng ngày qua các phiên bản.
- Một dòng mà payload không còn đọc được thì bị bỏ khỏi danh sách thay vì làm hỏng cả lần đọc: `readableRow` (`store/readable-row.ts`) bắt `StorageError`, ghi `trading.suggestion_row_unreadable` kèm id dòng và ném lại mọi lỗi khác. Các lần đọc đang chờ, đã chốt, kế hoạch thoát và trang danh sách dùng chung nó. `findLatestExitPlan` khi đó lùi về các dòng cũ hơn trong cửa sổ nhìn lại, nên một dòng mới nhất hỏng không bị đọc thành "không có kế hoạch".
- Mỗi mã trong một lượt hàng loạt được tính cỡ trên cuốn sổ trước lượt. `breachedCaps` (`pipeline/exposure.ts`) báo các trần ngành, nhóm và ETF bị hai lệnh mua trở lên vượt; `overcommittedBook` (`pipeline/overcommit.ts`) báo phần tiền mặt (cả sổ, và một thị trường mà venue chạm tới ít hơn) và phần rủi ro mở mà cũng các lệnh mua ấy tiêu vượt, ở `SuggestionBatchResult.overcommit`, tính bằng tỷ lệ NAV. Nó chỉ mang tính tư vấn: lần đọc kế hoạch của các mã đang nắm mà hỏng thì mất phát hiện đó và ghi `trading.batch_open_risk_unread`.
- Lệnh mua treo khớp ở phiên đầu tiên giao dịch dưới limit. Ở phiên khớp đó, bộ chấm điểm chỉ đọc mục tiêu khi phiên mở thấp hơn limit; cắt lỗ được thử ở đó như ở mọi phiên.

## Các mục của bản tin

Một số mục theo từng thị trường (`reading`, `market-prices`, `market-quotes`, `market-board`, `market-cap`, `turnover`, `derivatives`, `taker-flow`, `etf-flows`, `positioning`, `premium`, `range`, `leaders`, `leaders-24h`, `movers-session`, `movers-24h`, `sentiment`) đến từ bộ chuyển đổi overview của từng thị trường, trên một khuôn chung theo từng thị trường, không phải từ một builder của bản tin. Một thị trường thêm một khối, không bao giờ thêm một loại mục.

## Chấm điểm chủ đề

Các lần đọc chủ đề, ngành và cổ phiếu dùng chung bảng `theme_reads` (một cấp và một chủ thể). Mã chấm mỗi cái 0-100 trong [`features/themes/score/`](../../src/trading/features/themes/score/) từ các trọng số cố định; `SCORE_VERSION` được lưu cùng lượt chạy, và các phần đi trong payload để tính lại được điểm.

## Định giá và cuốn sổ

[portfolio/types.ts](../../src/trading/features/portfolio/types.ts):

- `viewRelative` (tỷ trọng, phần trăm) là cái công cụ của agent với tới. `viewAbsolute` (tiền) chỉ với tới được từ các bề mặt của operator. `ValuedBook` không bao giờ được đưa cho một mô hình.
- Một `ValuedPosition` là `kind: 'priced'` (giá và giá trị) hoặc `kind: 'unpriced'` (một `caveat`, không có giá trị). Giá thiếu không bao giờ là số 0.
- Một `Holding` là các vị thế theo từng sàn của một công cụ được gộp thành một mức phơi nhiễm.
- `PriceFreshness.markKind` là `live` hoặc `close`, được gập trong [valuation.ts](../../src/trading/features/portfolio/folds/valuation.ts): `live` chỉ khi mọi vị thế đã định giá đều live.
- `realizedPnlBase` là tiền mặt + giá vốn - nạp ròng, nên nó tồn tại khi `navBase` không có. Khi có khoản nắm chưa định giá, `navBase` vắng mặt và bản đánh giá mang `portfolio.valuation-partial`.
- Các phát hiện đến từ `assessPortfolio` ([health.ts](../../src/trading/features/portfolio/folds/health.ts)). Một phát hiện là một mã có kiểu kèm bằng chứng có kiểu; các trường chi tiết là tỷ phần mang phân số thô và bộ render đóng dấu đơn vị (`check-caveat-details` làm hỏng một `%` sau một placeholder).
- Một lần khớp từ `/trade`, `order_place` hay `/record sync` ghi dòng của nó qua `portfolio.record`, đường mà `/record` dùng. Sync khóa một lần khớp là `<venue>:<orderId>` (`buildVenueFillKey`, [sync.ts](../../src/trading/features/ledger/sync.ts)). Dòng xác nhận nêu nguồn gốc của từng con số (`FillSource`, [ledger/types.ts](../../src/trading/features/ledger/types.ts)).

## Năng lực của sàn

Một sàn khai những gì API của nó làm được ([venues/types.ts](../../src/trading/venues/types.ts)); registry từ chối một manifest và một adapter không khớp nhau.

```ts
interface VenueExecution {
  readonly exit: 'attached' | 'none'   // lối thoát đang treo: placeExit, fetchExit, cancelExit
  readonly amend: boolean              // dời lối thoát tại chỗ: amendExit
  readonly fills: 'enumerable' | 'by-symbol' | 'none' // fetchFilledOrders, listFilledOrders
  readonly balances: boolean           // fetchBalances, cho /reconcile
}
```

Một sàn không nhận lệnh thì không có adapter (`manifest.acceptsOrders` là false). Danh mục của nó được đọc độc lập. Một sàn không có `amend` thì không bao giờ bị cho hủy-rồi-đặt. Thêm một sàn: xem [AGENTS.md](../../AGENTS.md).

## Đặt lệnh

- Công tắc dừng bền vững nằm ở bảng `order_settings`, chỉ được kiểm với lệnh mua.
- Xác nhận, lối thoát và hủy được tuần tự hóa, và các trần cả cuốn sổ được đọc lại bên trong cửa sổ đó.
- Mã đặt lệnh: [`features/order/`](../../src/trading/features/order/). Định tuyến chỉ nằm ở `routing.ts`; dấu đang-bay, mirror và phép kiểm lối thoát mồ côi nằm ở `intents.ts`, `mirror.ts` và `orphan-exits.ts`.

## Các route HTTP

Các route mà tính năng giao dịch thêm vào, được phục vụ khi `[api] enabled = true`. Phần còn lại của API và mọi dạng wire nằm ở [CONTRACT.md](../../src/app/server/CONTRACT.md).

| Route | Cờ năng lực |
|---|---|
| `GET /v1/quotes` | `quotes` |
| `GET /v1/ohlcv` | `ohlcv` |
| `GET /v1/events` | `ohlcv` |
| `GET /v1/news` | - |
| `GET /v1/profile`, `POST /v1/profile` | - |
| `GET /v1/portfolio` | `portfolio` |
| `GET /v1/portfolio/nav` | `portfolio` |
| `GET /v1/suggestions` | `suggestions` |
| `GET /v1/suggestions/:id/card` | `suggestions` |
| `GET /v1/track-record` | `suggestions` |
| `GET /v1/brief`, `PATCH /v1/brief` | - |

## Nghiên cứu yếu tố VN

[`scripts/research-vn-factor-history.ts`](../../scripts/research-vn-factor-history.ts) đo các yếu tố VN trên lịch sử. Nó sao chép cuốn sổ vào một thư mục bạn đặt tên và gieo vào đó các nến cũ hơn, lịch sử tỷ số đúng như lúc mỗi ngày bảng giá (một quý được tính từ ngày nó được nộp lần đầu, không phải từ bản soát xét hay kiểm toán) và các dòng tiền trước đó. Nó sàng lọc mỗi phiên thứ năm bằng bộ chấm điểm thật và báo rank IC của từng yếu tố so với lợi suất trong cửa sổ kết cục dài, kèm t Newey-West, từng nửa riêng, và chỉ số tổng hợp khi bỏ từng yếu tố. Nó không bao giờ ghi vào cuốn sổ hay nhật ký bảng. Tập mẫu là các mã niêm yết hôm nay, nên hãy đọc nó như một hình dạng.

## Bản đồ mã nguồn

- [`src/trading/kernel/source/source-result.ts`](../../src/trading/kernel/source/source-result.ts) - `SourceResult`.
- [`src/trading/sources/`](../../src/trading/sources/) - bộ nối, `routes.ts`, `transport/`.
- [`src/trading/markets/calendar.ts`](../../src/trading/markets/calendar.ts) - vị từ settle.
- [`src/trading/features/market-data/`](../../src/trading/features/market-data/) - kho, lịch refresh, kiểu của khâu sàng lọc.
- [`src/trading/features/alerts/`](../../src/trading/features/alerts/) - origin của cảnh báo và việc dựng.
- [`src/trading/features/themes/`](../../src/trading/features/themes/) - `/themes`, chấm điểm.
- [`src/trading/features/portfolio/`](../../src/trading/features/portfolio/) - định giá, sức khỏe, lời khuyên.
- [`src/trading/features/ledger/`](../../src/trading/features/ledger/) - ghi sổ lệnh, sync.
- [`src/trading/features/order/`](../../src/trading/features/order/) - `/trade` và `order_place`.
- [`src/trading/venues/`](../../src/trading/venues/) - manifest và adapter của sàn.
- [`src/app/server/CONTRACT.md`](../../src/app/server/CONTRACT.md) - API `/v1`.
