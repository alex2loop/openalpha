# Giao dịch: bên trong

Dành cho người đóng góp mã. Hướng dẫn cho người dùng ở [giao-dich.md](../giao-dich.md). Trang này giữ các hợp đồng đứng sau nó.

## Nguồn

Mọi lời gọi nguồn trả về một `SourceResult<T>` ([source-result.ts](../../src/trading/kernel/source/source-result.ts)):

```ts
type SourceResult<T> = SourceAvailable<T> | SourceUnavailable

interface SourceUnavailable {
  readonly kind: 'unavailable'
  readonly reason: SourceUnavailableReason // 'unconfigured' | 'unsupported' | 'stale' | 'failed' | 'empty'
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

`upsertSeriesPoint` ([kho market-data](../../src/trading/features/market-data/store/market-data.ts)) trả lời dòng có được ghi hay không. Một phiên chạy chỉ đếm những gì nó ghi, và `force` là thứ suy lại một ngày đã lưu. Một ngày mà lịch sử bảng vàng không tìm thấy bảng nào thì không phải một mục `missingTargets`.

## Những ngày sàn đóng cửa

`CalendarPolicy.holidays` là một hàm từ năm (và phép thử ngày cuối tuần của chính lịch) ra các ngày nghỉ của năm đó, nên lịch trả lời `isTradingDay` cho năm nào cũng được mà không có bảng nào để kéo dài. Lịch VN nằm trong [`markets/equity-vn/calendar/`](../../src/trading/markets/equity-vn/calendar/closures.ts): các ngày lễ theo điều 112 Bộ luật Lao động (Tết Dương lịch, Tết Nguyên đán, Giỗ Tổ, 30/4 và 1/5, Quốc khánh (từ 2021 thêm một ngày liền kề), từ 2026 có thêm Ngày Văn hóa Việt Nam), ngày nào rơi vào cuối tuần thì nghỉ bù vào ngày làm việc kế tiếp chưa nghỉ, cộng một danh sách ngắn các ngày hoán đổi đã công bố và các năm Chính phủ chọn ngày Quốc khánh thứ hai sau 2/9, vì chúng không theo quy tắc nào. Tết và Giỗ Tổ lấy từ âm lịch Việt Nam ([`lunar.ts`](../../src/trading/markets/equity-vn/calendar/lunar.ts), thuật toán của Hồ Ngọc Đức ở múi giờ UTC+7, nên có năm lệch ngày âm lịch Trung Quốc). `createTradingCalendar` tính mỗi năm một lần và giữ trong một map nhỏ. `holidays` và `open_days` của người dùng được phủ lên các quy tắc và thắng chúng. Các ngày đã qua vẫn do chính các cây nến quyết định, không do lịch này. `CalendarPolicy.earlyCloses` nêu các ngày giao dịch đóng cửa sớm và giờ đóng theo giờ địa phương: lịch Mỹ đóng lúc 13:00 vào ngày sau Lễ Tạ ơn, và vào 3/7 và 24/12 khi các ngày này có giao dịch ([`markets/equity-us/calendar/`](../../src/trading/markets/equity-us/calendar/closures.ts)). `sessionCloseAt`, `tapeFinalAt`, `sessionState` và `hoursOn` đọc nó, nên `/v1/markets` trả giờ đóng sớm làm `close` của ngày đó.

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

## Bảng thành tích và các phiên chạy hàng loạt

- `independentCalls` (`pipeline/reporting.ts`) là chỗ duy nhất gộp một lời gọi lặp lại lời gọi còn mở trên cùng mã và cùng chiều. Nó chỉ đọc `FoldableCall` (`at`, `instrument`, `action`, `outcome.exitDay`), nên mọi lần đọc lời gọi đã chấm đều gộp bằng cùng một quy tắc, từng phạm vi hoặc từng phiên bản một. Không có bản cài đặt thứ hai trong SQL; `LATEST_OF_SAME_CALL_SQL` vẫn giữ dòng mới nhất của một lời gọi cùng ngày qua các phiên bản.
- Lần đọc gọn là `LeanCall` / `listLeanCalls` (`store/suggestion-lean.ts`): mọi lời gọi đã chấm qua được bộ lọc, không payload, không giới hạn số dòng. Nó mang khung thời gian nắm giữ, phiên bản chiến lược, phiên bản tính toán và phiên bản công thức kết quả, do SQL rút từ payload. Dòng nào không đọc được khung thời gian hoặc phiên bản sẽ rời khỏi lần đọc kèm một dòng log `trading.suggestion_row_unreadable`, phần còn lại vẫn trả lời bình thường.
- `readScoredPopulation` (`track-record/population.ts`) gộp rồi mới cắt: đọc các lời gọi gọn, áp `isIncluded` của nơi gọi, gộp lời gọi lặp bằng `independentCalls`, giữ `limit` lời gọi độc lập mới nhất và chỉ khi đó mới đọc payload của các dòng ấy qua `listResolved` với `ids`. `/reflect` và hiệu chuẩn của phiên tranh luận cùng đọc qua đây, nên giới hạn không bị tiêu vào các bản sao của một nước đi. `summarizeTrackRecord` nhận quần thể này: các chỉ số đọc `calls`, số lần gộp lặp và bảng theo phiên bản đọc `lean`. Bảng theo phiên bản chỉ gộp trong từng phiên bản, nên một nước đi lặp dưới hai phiên bản được tính một lần ở mỗi bên và các dòng cộng lại có thể nhiều hơn tổng.
- Một dòng mà payload không còn đọc được thì bị bỏ khỏi danh sách thay vì làm hỏng cả lần đọc: `readableRow` (`store/readable-row.ts`) bắt `StorageError`, ghi `trading.suggestion_row_unreadable` kèm id dòng và ném lại mọi lỗi khác. Các lần đọc đang chờ, đã chốt, kế hoạch thoát và trang danh sách dùng chung nó. `findLatestExitPlan` khi đó lùi về các dòng cũ hơn trong cửa sổ nhìn lại, nên một dòng mới nhất hỏng không bị đọc thành "không có kế hoạch".
- Mỗi mã trong một lượt hàng loạt được tính cỡ trên cuốn sổ trước lượt. `breachedCaps` (`pipeline/exposure.ts`) báo các trần ngành, nhóm và ETF bị hai lệnh mua trở lên vượt; `overcommittedBook` (`pipeline/overcommit.ts`) báo phần tiền mặt (cả sổ, và một thị trường mà venue chạm tới ít hơn) và phần rủi ro mở mà cũng các lệnh mua ấy tiêu vượt, ở `SuggestionBatchResult.overcommit`, tính bằng tỷ lệ NAV. Nó chỉ mang tính tư vấn: lần đọc kế hoạch của các mã đang nắm mà hỏng thì mất phát hiện đó và ghi `trading.batch_open_risk_unread`.
- Lệnh mua treo khớp ở phiên đầu tiên giao dịch dưới limit. Ở phiên khớp đó, bộ chấm điểm chỉ đọc mục tiêu khi phiên mở thấp hơn limit; cắt lỗ được thử ở đó như ở mọi phiên.

## Các mục của bản tin

Một số mục theo từng thị trường (`reading`, `market-prices`, `market-quotes`, `market-board`, `market-cap`, `turnover`, `derivatives`, `taker-flow`, `etf-flows`, `positioning`, `premium`, `range`, `leaders`, `leaders-24h`, `movers-session`, `movers-24h`, `sentiment`) đến từ bộ chuyển đổi overview của từng thị trường, trên một khuôn chung theo từng thị trường, không phải từ một builder của bản tin. Một thị trường thêm một khối, không bao giờ thêm một loại mục. Hai loại mục câu chuyện, `thesis-review` và `story`, không thuộc khối nào: `tryReadStories` của thị trường đọc phiên đã chốt thành các ứng viên, `planStory` (`features/brief/story/plan.ts`) chấm các câu chuyện của ảnh chụp trước và chọn câu chuyện hôm nay, và cả hai đứng đầu bản tin, trên mọi khối.

Bản tin chỉ in các loại mục trong `MARKET_SHOWN_KINDS` (`features/brief/render.ts`); phần còn lại của các mục một thị trường ở lại `/overview <thị trường>`. `BRIEF_FIELD_SUBSETS` (ngay cạnh) thu các dòng của một loại mục về những trường bản tin đọc, như `derivatives` giữ `funding` và `longShortRatio`: `readSections` cho các mục có thể in đi qua `toBriefShape`, hàm bỏ dòng không còn trường nào trong danh sách và để nguyên mục chưa sẵn sàng cùng các loại mục khác.

`world-markets` là loại mục duy nhất của khối vĩ mô không có bộ chuyển đổi overview. `buildWorldMarkets` (`markets/brief-world.ts`, đăng ký trong phần compose bản tin của thị trường Việt Nam) trích S&P 500, lợi suất trái phiếu Mỹ 10 năm và dầu Brent, mỗi dòng mang ngày quan sát của chính nó (`reference`, `at`). Giá trị vĩ mô lấy từ `deps.macro.get(MACRO_COMPOSITE_REGION, asOf)` gộp bằng `mergeMacroValues`, không lấy từ ảnh chụp đã lưu, vì ảnh chụp đó chỉ giữ ngày quan sát cho các driver của chính chỉ số tổng hợp; Brent lấy từ lần đọc `commodityPrices` và chỉ nêu mức giá, vì nguồn không nói hợp đồng nào. Số nào không có giá trị thì không thêm dòng, và giá trị không có ngày thì không thể trích. Mục không có dòng nào là `omitted` khi mọi lần đọc hỏng đều là `unconfigured` hoặc `unsupported` (bản dựng không định tuyến nguồn nào cho chúng, như ở bản web), còn lại là `absent` kèm cảnh báo. Tuổi dữ liệu là một bảng duy nhất, `STALE_AFTER_DAYS` (`kernel/market/macro-series.ts`), đọc qua `isStaleReading` (`markets/brief-macro.ts`) cho cả dòng thế giới lẫn dòng driver vĩ mô: dòng cũ hơn mức chuỗi cho phép mang `freshness: 'stale'` và giữ nguyên điểm.

## Phiên bản chiến lược

`check-strategy-version` băm các literal chính sách mức giá, yếu tố và báo cáo tài chính của từng thị trường cùng các giới hạn đi kèm, gom theo `<MARKET>_STRATEGY_VERSION`. Các bản băm nằm trong `src/trading/markets/strategy-versions.json`, và `bun scripts/check-strategy-version.ts --write` ghi lại chúng. Mỗi thị trường đóng dấu bản băm của mình làm phiên bản tính toán `policy` (`policyVersionOf`, `markets/policy-version.ts`), nên một thay đổi chính sách được ghi lại dưới cùng phiên bản vẫn tách riêng tập mẫu mà việc hiệu chỉnh đọc.

## Chấm điểm chủ đề

Các lần đọc chủ đề, ngành và cổ phiếu dùng chung bảng `theme_reads` (một cấp và một chủ thể). Mã chấm mỗi cái 0-100 trong [`features/themes/score/`](../../src/trading/features/themes/score/) từ các trọng số cố định; `SCORE_VERSION` được lưu cùng phiên chạy, và các phần đi trong payload để tính lại được điểm. Bảng thành tích chỉ đọc kết quả của các lượt mang `SCORE_VERSION` hiện tại, nên khi đổi trọng số, thang đo hay quy tắc độ phủ thì phải tăng phiên bản này trong cùng commit. `check-strategy-version` băm toàn bộ các file tính điểm và báo lỗi cho tới khi thay đổi được ghi lại bằng `--write`.

Tin tức của một phiên chạy lấy từ `NewsArchiveStore.listArchived`: các tin vào kho (`fetched_at`) kể từ lần đọc cũ nhất của các chủ thể lượt đó đọc, không phải các tin đăng từ lúc đó, nên tin vào kho muộn vẫn được đọc đúng một lần.

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
| `GET /v1/suggestions/:id/debate` | `suggestions` |
| `GET /v1/track-record` | `suggestions` |
| `GET /v1/brief`, `PATCH /v1/brief` | - |

Một đề xuất đã lưu giữ các mô hình đã tranh luận nó trong `suggestions.debate_models` (danh sách đã sắp xếp, nối bằng `,`, null ở dòng ghi trước khi có cột) và các mã luận điểm mà bước kiểm chứng bác bỏ trong khối tranh luận (`refutedIds`, vắng ở dòng cũ hơn). `GET /v1/track-record` chỉ đếm theo từng mô hình, trong toàn bộ thời gian, các đề xuất đã chấm điểm của chính bạn (tiêu điểm mặc định) mà `debate_models` ghi đúng một mô hình, gộp bằng `independentCalls` và chịu `MINIMUM_TRACK_RECORD_SAMPLE` như mọi tỷ lệ; đề xuất do nhiều mô hình tranh luận, hay dòng không có danh sách đã lưu, không được tính cho mô hình nào. Mỗi dòng tiêu điểm và `record` của mỗi agent còn có `targetCount`, số lệnh độc lập đã đóng ở mục tiêu. Thêm `?market&ticker`, cùng lần đọc ấy thu về một mã ngay trong WHERE của kho (cả lần đọc đã chấm điểm lẫn số đếm độ phủ): lời gọi lặp được gộp, chỉ lời gọi đã hết thời hạn mới được tính và độ phủ là của mã đó; phần tóm tắt "đề xuất trước đây" trên thẻ mã đọc từ đây, còn `summary.byModel` là `[]` vì phần chia theo mô hình thuộc về cả sổ và không được tính.

## Nghiên cứu yếu tố VN

[`scripts/research-vn-factor-history.ts`](../../scripts/research-vn-factor-history.ts) đo các yếu tố VN trên lịch sử. Nó sao chép cuốn sổ vào một thư mục bạn đặt tên và gieo vào đó các nến cũ hơn, lịch sử tỷ số đúng như lúc mỗi ngày bảng giá (một quý được tính từ ngày nó được nộp lần đầu, không phải từ bản soát xét hay kiểm toán) và các dòng tiền trước đó. Nó sàng lọc mỗi phiên thứ năm bằng bộ chấm điểm thật và báo rank IC của từng yếu tố so với lợi suất trong cửa sổ kết cục dài, kèm t Newey-West, từng nửa riêng, và chỉ số tổng hợp khi bỏ từng yếu tố. Nó không bao giờ ghi vào cuốn sổ hay nhật ký bảng. Tập mẫu là các mã niêm yết hôm nay, nên hãy đọc nó như một hình dạng.

## Thị trường Mỹ

- **Phần dùng chung nằm phẳng.** `markets/<thư mục>/` là một đơn vị thị trường mà thị trường anh em không được nhập, nên những gì VN và Mỹ cùng cần (`fetch-window`, `admissibility`, `turnover`, các phép gộp báo cáo và `accounts-history`) để thành tệp phẳng ở gốc `markets/`. `toAccountsHistoryCore` nhận quy tắc năm cuối cùng, số lượng cổ phiếu, số năm xu hướng và các dòng quan sát từ thị trường; lớp bọc của VN cấp phần của VN và đầu ra không đổi.
- **Ngưỡng điều chỉnh giá.** `restatementOf` nhận ngưỡng (mặc định `RESTATEMENT_TOLERANCE`). Lịch sử Nasdaq đã điều chỉnh chia tách và không điều chỉnh cổ tức, nên Mỹ giữ ngưỡng mặc định và ngày không hưởng cổ tức không tạo điều chỉnh. Cùng ngưỡng đó quyết định các phiên đã đổi có chung một hệ số hay không, nhờ vậy các đề xuất đang mở được quy đổi thay vì bị đóng (số lượng của đề xuất mua được quy về lô của bảng giá, còn số đang giữ theo sổ giao dịch).
- **SEC.** Hai mã cho hai máy chủ: `sec-data` (có tuyến, `data.sec.gov`) và `sec` (không tuyến, `www.sec.gov`, cho bảng mã và kho hồ sơ Form 4). Mọi yêu cầu đặt header `user-agent` bằng liên hệ từ `SEC_CONTACT_EMAIL`; `CREDENTIAL_ALIASES` cho `sec` dùng cùng biến với `sec-data`, nên đổi tên một lần dưới `[trading.sources]` áp dụng cho cả hai.
- **Tập thị trường đang dùng.** `resolveMarketsInUse` đọc hồ sơ đã phân giải (đã lưu hoặc mặc định), nên nhóm mà hồ sơ đã lưu chưa từng nêu là tắt và sổ cũ không bao giờ làm mới thị trường thêm sau. Bộ đọc thống kê Việt Nam chỉ chạy khi `equity-vn` đang dùng.
- **Hồ sơ công bố gần đây.** `recentEvents` (draft-input) giữ các dòng `earnings-release` và `insider-purchase` trong 90 ngày gần nhất và đưa vào phần tranh luận dưới tiêu đề riêng, tách khỏi `upcomingEvents`. Các dòng từ SEC và Nasdaq đặt `composedText`: `title` và `detail` là tiếng Anh viết cho mô hình, còn `describeEvent` (`render/event.ts`) dựng lại câu từ loại sự kiện và các dữ kiện đã lưu theo ngôn ngữ người đọc cho `/v1/events`. Lời của nhà cung cấp được giữ nguyên, và bộ nối khai báo ngôn ngữ của chúng ở `writtenIn` (vndirect `vi`, Nasdaq `en`); khác ngôn ngữ người đọc thì `describeEvent` thêm vào cuối dòng cuối của sự kiện chú thích trong ngoặc như tiêu đề tin, "(tiếng Anh)" hoặc "(tiếng Việt)". Một lần người nội bộ mua mang `insider` (tên, chức danh hoặc quan hệ, số cổ phiếu, giá); chức danh giữ nguyên như hồ sơ viết.
- **Quỹ đòn bẩy.** `isLeveragedFund` đọc tên quỹ đã lưu; một bước ở pha rủi ro chỉ chặn lệnh mua, và quỹ đang giữ vẫn có mức cắt lỗ thật.

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
