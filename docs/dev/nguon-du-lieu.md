# Bên trong nguồn dữ liệu

Dành cho người thêm hoặc sửa một nhà cung cấp. Có những nhà cung cấp nào, cần khóa gì và giới hạn nào bạn có thể chạm tới: [Nguồn dữ liệu](../nguon-du-lieu.md).

Mã nguồn: `src/trading/sources/` (bộ nối, tuyến, sổ đăng ký, kênh truyền), hợp đồng ở `src/trading/kernel/source/`, composition ở `src/trading/wiring/composition/`. Quy tắc ranh giới: [AGENTS.md](../../AGENTS.md).

## Một nguồn là gì

Một nguồn nuôi quy trình bằng chứng tất định: dữ liệu của nó được phân tích thành kiểu chuẩn của kernel, đóng dấu xuất xứ, chấm thành yếu tố, rồi được trích dẫn trong đề xuất. Chuẩn này cao hơn công cụ agent, vốn chỉ cung cấp thông tin cho phần lập luận để con người đọc.

- Dữ liệu đủ tốt để làm bằng chứng thì có sẵn dưới dạng bộ nối first-party, kèm bộ phân tích, schema, giới hạn tần suất và tuyến dự phòng.
- Dữ liệu agent chỉ nên đọc, không được dùng để suy ra kết luận, thì là công cụ MCP do operator tự kết nối.

Một nhà cung cấp là một mã phục vụ một hoặc nhiều **loại** dữ liệu. Mỗi cặp `(loại, mã)` là một đối tượng `Source` riêng, đăng ký dưới khóa `kind:id`.

## Hợp đồng

### `SourceKind` và `SourceKindMap`

`SourceKindMap` (`kernel/source/source-result.ts`) ánh xạ mỗi loại tới giá trị nó trả về. Đó là danh sách đóng những thứ hệ thống biết cách hỏi.

| Loại | Giá trị | Ghi chú |
|---|---|---|
| `instruments` | `InstrumentRecord[]` | toàn bộ công cụ giao dịch được |
| `quote` | `Quote` | giá trực tiếp hoặc giá đã chốt gần nhất, kèm cửa sổ phiên nếu nhà cung cấp có |
| `bars` | `Candle[]` | phiên cũ nhất trước; mọi nơi dùng đọc phần đuôi là mới nhất |
| `sessionQuotes` | `SessionQuote[]` | cả bảng giá trong một lần đọc |
| `fundamentals` | `FundamentalSnapshot[]` | |
| `accounts` | `FiledAccounts` | mọi báo cáo năm và quý mà nhà cung cấp phục vụ cho một mã |
| `events` | `MarketEvent[]` | khi nhà cung cấp có công bố: `cashPerShare` (theo đơn vị giá của thị trường) và `paysOn` của cổ tức tiền mặt, `shareRatio` (số cổ phiếu mới trên mỗi cổ phiếu đang giữ) của cổ tức bằng cổ phiếu, `shareRatio` và `subscriptionPrice` của quyền mua |
| `news` | `NewsItem[]` | |
| `macro` | `MacroSnapshot` | trộn từ nhiều nhà cung cấp |
| `policyRates` | `PolicyRateSnapshot` | lãi suất điều hành và liên ngân hàng bình quân của ngân hàng trung ương |
| `statReports` | `StatReport[]` | báo cáo hằng tháng của cơ quan thống kê |
| `commodityPrices` | `CommodityHistory` | |
| `valuationRatios` | `ValuationRatios` | |
| `indexContributors` | `IndexContributions` | mỗi mã đã cộng bao nhiêu điểm cho một chỉ số trong phiên, từ nguồn không nhận ngày |
| `indexValuation` | `IndexRatios` | ngày mới nhất của các tỷ lệ riêng của một chỉ số |
| `flows` | `FlowSnapshot[]` | |
| `proprietaryFlows` | `ProprietaryFlow[]` | chỉ khối tự doanh, từ nhà cung cấp công bố sớm hơn nhà cung cấp `flows` |
| `tradeSides` | `DailyTradeSides` | |
| `foreignRoom` | `ForeignRoom[]` | |
| `supervision` | `SupervisionSnapshot` | chỉ các mã đang bị sàn giám sát, trên những bảng mà lần đọc đã phủ; mã vắng mặt trên một bảng đã phủ là không bị giám sát |
| `indexMembership` | `IndexMembership[]` | |
| `recommendations` | `AnalystRecommendation[]` | |
| `sentiment` | `SentimentSnapshot` | |
| `funding` | `FundingSnapshot` | |
| `marketCap` | `MarketCapRecord[]` | |
| `fx` | `FxQuote` | |
| `fxHistory` | `FxRatePoint[]` | cũ nhất trước; có khoảng trống ở những ngày thị trường của cả hai đồng tiền đều không giao dịch |
| `goldBoard` | `GoldBoard` | trộn từ nhiều nhà cung cấp |
| `goldBoardHistory` | `GoldBoardPoint[]` | cũ nhất trước; chỉ các phiên nhà cung cấp đã công bố |
| `positioning` | `PositioningSnapshot` | CFTC, hằng tuần và có độ trễ |
| `etfFlows` | `EtfFlowSnapshot` | đã khai nhưng chưa định tuyến: chưa nhà cung cấp nào được kiểm chứng trên một phản hồi thật |

### `SourceContext`

Yêu cầu. Mọi trường đều tùy chọn vì một kiểu duy nhất phục vụ mọi loại.

| Trường | Ý nghĩa |
|---|---|
| `market` | `MarketRef` của yêu cầu; vắng mặt với các loại không thuộc thị trường nào (FX, vĩ mô) |
| `instrument` | công cụ kèm thị trường |
| `instrumentKind` | cho nhà cung cấp phục vụ mỗi lớp công cụ từ một endpoint hoặc đơn vị khác nhau; vắng mặt nghĩa là cổ phiếu tiền mặt |
| `ticker` | ký hiệu không gắn thị trường (cặp FX, hàng hóa); không bao giờ thay cho `instrument` |
| `tickers` | một lô ký hiệu, cho nhà cung cấp trả lời nhiều mã trong một yêu cầu |
| `region` | phạm vi cho các loại liên thị trường |
| `feedScope` | chọn một nhóm feed khi không nêu thị trường hay khu vực (feed `economy` của dòng tin vĩ mô) |
| `searchSubject` / `searchTopic` | cho nhà cung cấp văn bản không lập chỉ mục theo ký hiệu: cách viết của chính bên gọi cho chủ thể và lĩnh vực của nó, để một tên trùng với từ thông dụng không trả về mọi cách dùng khác của từ đó |
| `fromDay` / `toDay` | ngày giao dịch `YYYY-MM-DD` |
| `limit` | trần số dòng |
| `live` | giá như hiện tại, không phải giá đóng cửa đã chốt gần nhất |

### `SourceResult<T>`

```ts
{ kind: 'available',   value, provenance: SourceProvenance[], caveats: Caveat[] }
{ kind: 'unavailable', reason, attemptedSourceIds, caveats }
```

Cả hai dạng đều mang caveat, nên một lần thành công nhưng có vấn đề vẫn diễn đạt được. `reason` là `unconfigured` (không có gì được định tuyến), `unsupported` (không nguồn nào có `covers` nhận yêu cầu này), `stale`, `empty` (mọi nhà cung cấp đều trả lời là không có gì - kết luận cuối) hoặc `failed` (ít nhất một nhà cung cấp đã định tuyến không trả lời được).

`SourceProvenance` tính theo từng dấu, không theo từng kết quả: `{ sourceId, fetchedAt, freshness, observedAt? }`. Độ tươi là `live` hoặc `cached` và nằm trên **từng dòng**, vì một giá trị ghép từ bốn nhà cung cấp không thể trả lời gọn câu "cái này có tươi không?". `provenanceOf` không trả gì cho kết quả `unavailable`: các mã đã thử chỉ để chẩn đoán, không bao giờ để trích dẫn.

Không có gì bịa ra con số để lấp chỗ trống, và không có gì ném lỗi chỉ vì nhà cung cấp miễn phí không phủ tới. Ngoại lệ duy nhất là việc hủy: tín hiệu hủy lan ra thành `AbortError` qua mọi tầng. Một nguồn vẫn ném lỗi thì bị sổ đăng ký bắt, ghi log `trading.source_threw`, và trả `unavailable('failed')` kèm `source.payload-rejected`.

### Một số đọc phải **mới**, không chỉ là của hôm nay

Một nhà cung cấp ngừng cập nhật thì **không báo hỏng**. Nó trả về một cây nến từ vài giờ trước nhưng mang ngày hôm nay: đúng định dạng, không phân biệt được với giá trực tiếp, và cơ chế dự phòng không nhìn thấy. Vì vậy `isLiveObservation` (`markets/calendar.ts`) hỏi hai câu, và một số đọc phải qua cả hai:

- **Nó thuộc phiên nào.** Phải mới hơn giá chốt gần nhất đã settle, xét theo **phiên** chứ không theo thời điểm: phiên khớp lệnh đóng cửa in giá vài phút sau tiếng chuông, và nếu chỉ kiểm theo thời điểm thì giá chốt hôm nay sẽ bị đọc là "trực tiếp" suốt phần còn lại của ngày.
- **Nó cũ bao nhiêu.** Không được chậm hơn đồng hồ quá `TAPE_SETTLE_LAG_MS` (30 phút) cộng khoảng dài nhất mà một bảng giá đang mở có thể hợp lệ không in giá nào, `QUIET_TAPE_MS` (60 phút: giờ nghỉ của CME với kim loại) - tổng cộng 90 phút. Một giá đóng cửa thật đã cũ đúng bằng `TAPE_SETTLE_LAG_MS` ngay lúc phiên của nó settle, nên hạn mức được dựng từ cả hai. Giờ nghỉ trưa được miễn: giá cuối trước giờ nghỉ đại diện cho cả khoảng trống.

`toLiveReading` (`markets/live-reading.ts`) - đường của `/overview` và `/market` - áp đúng phép kiểm tuổi đó (`isRecentObservation`) lên ngày đã settle mà bên gọi đang giữ. Quy tắc settle nằm ở [Giao dịch](../giao-dich.md#một-phiên-chốt-khi-bảng-giá-của-nó-chốt-không-phải-khi-chuông-reo).

Một số đọc trượt một trong hai phép kiểm thì **không phải lỗi**. Thị trường trả giá chốt mà kho đang lưu, gắn nhãn `market-data.quote-not-live`, để màn hình nói rõ đó là giá nào; chỉ từ chối với mã mà kho hoàn toàn không định giá được. Crypto làm việc này qua `liveOrStoredQuote` (`markets/stored-quote.ts`), cổ phiếu VN qua `storedQuote` của cùng tệp.

## Giải phẫu một bộ nối

`createSource` (`sources/define.ts`) biến một đặc tả thành `Source<K>`. Có ba dạng:

**Đặc tả yêu cầu** - khai báo, một vòng gọi. Bộ nối nêu đường dẫn và phân tích phản hồi; nó không bao giờ đụng tới client.

```ts
createSource({
  id: YAHOO_ID,
  kind: 'quote',
  format: 'json',
  http: options.http,
  covers: (context) => context.instrument !== undefined,
  request: (context) => {
    const listing = yahooListing(context)

    return listing
      ? { ...QUOTE_ATTEMPT_LIMITS, ...chartRequest(listing.symbol, { range: QUOTE_RANGE }) }
      : null
  },
  parse: (raw, context) => parsedSource(toQuote(firstResult(raw), context), proxyCaveats(context)),
  observedAt: (value) => value.observedAt,
})
```

**Đặc tả nạp** - `load(context, signal)` cho lần đọc nhiều hơn một yêu cầu cộng một lần phân tích: nhiều vòng gọi nối tiếp (tra ký hiệu rồi đọc, như bộ dựng dùng chung `adapters/crypto-board.ts` mà `coinmarketcap`, `coinpaprika`, `coinlore` và `coingecko` dùng cho bảng xếp hạng), duyệt theo con trỏ (trade sides của `vietcap`), hoặc một kết quả mà dạng khai báo không diễn đạt được. Nó vẫn trả cùng `SourceFetchOutcome`, nên dự phòng và xuất xứ hoạt động y hệt.

**Phân trang** - `paged: { pageSize, pageParam?, extractRows }` trên một đặc tả yêu cầu khiến kênh truyền tải các trang tiếp theo chừng nào một trang trả đúng `pageSize` dòng, tối đa 20 trang hoặc hạn mức thời gian của bộ trang, rồi đưa mọi dòng cho `parse` một lần. Không bộ nối nào tự viết vòng lặp trang. Nếu một giới hạn dừng nó khi trang cuối còn đầy, kết quả mang `source.truncated` thay vì bị cắt cụt trong im lặng.

Quy tắc cho mọi bộ nối:

- **`covers` chỉ trả lời về hình dạng của yêu cầu, không bao giờ về định tuyến.** Một nguồn được *đọc* `context.market` để đóng dấu thứ nó đã phân tích (`resolveRowTarget`), không được *kiểm tra* nó để quyết định có phục vụ hay không, và không bao giờ tự dựng `MarketRef` hay `Region`. `SOURCE_ROUTES` sở hữu việc đó.
- **`request` trả `null` nghĩa là "không phải yêu cầu này"** và cho ra `unavailable('unsupported')`.
- **Ném lỗi từ `parse` là cách duy nhất để từ chối một phản hồi.** Nó ánh xạ thành `source.payload-rejected`, không bao giờ thành hỏng kênh truyền: schema lệch ở một loại không được làm mọi loại khác của nhà cung cấp đó phải nghỉ. Riêng thân phản hồi không phải JSON (trang chặn bot, HTML sau mã 200) thì tính là một vòng gọi hỏng và đếm vào bộ ngắt. Bộ nối gấp lại sau lời gọi kênh truyền nằm ngoài phép ánh xạ đó và dùng `mapOutcome` để có nó.
- **Bộ nối không xử lý I/O.** Thời gian chờ, thử lại, trần kích thước phản hồi, điều nhịp, cầu dao và ghi log yêu cầu thuộc về `sources/transport/http.ts`.
- **Bộ nối sở hữu từ vựng ký hiệu của máy chủ nó.** Bảng kim loại của Yahoo là toàn phần vì Yahoo trả 200 cho một mã niêm yết không liên quan thay vì 404 trên một ticker chưa ánh xạ.
- **Phản hồi nêu một đại lượng hai lần là đang nêu nó trên hai cơ sở khác nhau.** vndirect công bố cả `EPS_TR` lẫn `PRICE_TO_EARNINGS`. Cái đầu chia lợi nhuận bốn quý gần nhất cho số cổ phiếu của năm đó; cái sau dùng số cổ phiếu trong sổ đăng ký mà mọi tỷ lệ khác trong cùng phản hồi mang, vốn có hiệu lực vào ngày riêng của nó sau một đợt phát hành hoặc cổ tức bằng cổ phiếu. Dùng nguyên như đã nộp, `EPS_TR` định giá một cổ phiếu mới trên lợi nhuận của cổ phiếu cũ: MBB đọc ra P/E 5,4 so với 6,2 mà chính phản hồi đó công bố, và 66 trong 652 mã được tra có vẻ rẻ hơn tới một phần năm. Bộ nối đọc tỷ lệ và dựng lại dòng theo từng cổ phiếu từ đó, nên mọi trường trên một snapshot đếm cùng một số cổ phiếu.

Các hàm phân tích dùng chung nằm ở `sources/rows/normalization.ts` (kiểm tra hữu hạn/dương, đổi epoch giây sang ngày trong một múi giờ có tên, dựng nến, làm sạch văn bản, cắt tham số theo dõi) và `sources/rows/gold-board.ts`.

## Đăng ký: các dữ kiện do mã sở hữu

`SourceFacts` được lắp một lần duy nhất, ở `wiring/composition/source-registry.ts`, từ các hằng mà mỗi module bộ nối export:

| Dữ kiện | Chủ sở hữu | Vì sao do mã sở hữu |
|---|---|---|
| `endpoints` | `SOURCE_ENDPOINTS` trong `composition/source-facts.ts`, gom từ `*_DEFAULT_ENDPOINT` của từng bộ nối | không cấu hình nào chuyển hướng một yêu cầu sang host khác |
| `rateLimits` | `SOURCE_RATE_LIMITS` | trần nhà cung cấp công bố, hoặc một tốc độ mà một lượt quét toàn tập chịu được |
| `feeds` | `RSS_FEEDS` trong `adapters/rss.ts` | một feed ngoài danh sách cho phép không bao giờ được tải |
| `credentials` | phân giải từ môi trường lúc composition | bí mật thô không bao giờ vào một đối tượng cấu hình |
| `plainUserAgentSources` | `PLAIN_USER_AGENT_SOURCES` trong `composition/source-facts.ts` | nhà cung cấp nào từ chối user agent trình duyệt - đã đo, không đoán |

Mọi yêu cầu đi ra đều mang `BROWSER_HEADERS` từ `core/http-client.ts` (cũng là mặc định trong `buildInit`, nên sàn, công cụ và kênh đều thừa hưởng): chuỗi user agent của một trình duyệt phổ biến cùng header ngôn ngữ đi kèm, vì client không khai cả hai chính là dấu hiệu để hệ thống chống bot nhận diện. Tên sản phẩm không bao giờ bị tự khai với nhà cung cấp.

`PLAIN_USER_AGENT_SOURCES` là danh sách chọn không dùng user agent trình duyệt: `fred` và `fred-csv` (bản không khóa của nó). Máy chủ biên của FRED ngắt kết nối khi gặp chuỗi trình duyệt, và điều này đến dưới dạng **không có mã HTTP nào cả**, nên cơ chế dự phòng không đọc được đó là một lần từ chối. Thêm một mã vào đó cũng phải qua phép đo hai chiều ấy: thăm dò trên mọi host nhà cung cấp (2026-09-21), chuỗi trình duyệt nhanh bằng hoặc hơn ở mọi nơi khác, còn `home.treasury.gov` làm chậm chuỗi trần tới 18,0 giây so với 1,7 giây - chắc chắn hết giờ với hạn chót của một lần thử.

Một endpoint có thể là một danh sách (`giavang` có một origin dự phòng). Đó là dự phòng ở tầng kênh truyền trên cùng một backend, khác với dự phòng ở tầng tuyến giữa các nhà cung cấp. Mỗi host có hạn chờ riêng cho một lần thử, nên host chính có treo thì host dự phòng vẫn đến lượt. `buildEndpointMaps` giữ origin làm danh sách host đáng tin, còn tiền tố đường dẫn của endpoint được giữ riêng, nên `/api/v3` của CoinGecko không bị mất.

Thông tin đăng nhập: `SOURCE_CREDENTIALS` khai, cho từng nguồn, **tên** biến mặc định (`COINGECKO_API_KEY`, `FRED_API_KEY`, `BLS_API_KEY`) và dòng catalog nói đặt khóa đó thêm được gì (`trading.source.credential.<id>`, do `doctor` in ra); `SOURCE_CREDENTIAL_ENV` suy ra từ đó.

- `[trading.sources]` đổi được tên biến, nhưng không bao giờ ghi giá trị hay host. Đổi tên cho một nguồn không nhận thông tin đăng nhập gây `OperatorConfigError` lúc khởi động (`errors.configSourceNoCredential`).
- `resolveCredential` (`core/security/credentials.ts`) đọc biến đó, rồi cùng tên đó với tiền tố sản phẩm (`OPENALPHA_FRED_API_KEY`).
- Một yêu cầu khai vị trí đặt thông tin đăng nhập (`header` kèm một tiền tố tùy chọn, hoặc `query`) mà không có bí mật nào được phân giải là `OperatorConfigError`, trừ khi nó được đánh dấu `optional` (`bls` chỉ gửi `registrationkey` khi `BLS_API_KEY` được đặt).
- Nguồn có `keylessTier` trong dữ kiện thì được đăng ký dù có khóa hay không, và `unavailableSources` vẫn liệt kê nó để `doctor` và `key list` nêu tên biến.

Nguồn cần khóa mà không có thì không được đăng ký, nên loại dữ liệu đó chuyển sang nhà cung cấp kế tiếp. Lúc khởi động hệ thống ghi một cảnh báo `trading.source.skipped`, nêu tên từng nguồn bị bỏ qua và biến mà nó cần. Bản cài không có khóa là chế độ hạn chế **được hỗ trợ**. `unavailableSources` trả lời đúng câu hỏi đó dưới dạng dữ liệu thuần, nên `doctor` dùng chung phép kiểm này mà không cần khởi động hệ thống (nguồn từ plugin nằm ngoài: dữ kiện đăng nhập của chúng đến cùng module, mà chỉ lúc khởi động mới nạp).

Đăng ký diễn ra theo pha: `createSourceRegistry` mở một pha đăng ký, mọi nguồn có sẵn và nguồn plugin đăng ký, rồi `close()`. Nguồn nào có cặp `(kind, id)` không có vị trí trong bảng tuyến sẽ bị từ chối với `source <kind>:<id> has no failover position`: nhà cung cấp không với tới được là lỗi lắp ráp (composition), không phải thứ lặng lẽ bị vô hiệu.

## Định tuyến

`SOURCE_ROUTES` (`sources/routes.ts`) là một bảng `loại -> phạm vi -> danh sách mã nguồn có thứ tự`. Bảng theo thứ tự đọc cho từng thị trường nằm ở [trang người dùng](../nguon-du-lieu.md#định-tuyến). Phạm vi được xác định theo thứ tự sau, trúng cái nào dùng cái đó:

1. `context.market` (`equity-vn`, `crypto`, `gold`, `gold-vn`)
2. `context.region` (`us`, `vn`) - cho các loại liên thị trường
3. `'*'` (`ANY_SCOPE`) - khi loại đó hoàn toàn không thuộc phạm vi nào (`fx`, dòng tin vĩ mô)

`resolveRouteOrder` đặt mã first-party trước mã plugin, nên plugin không bao giờ được thử trước. `withVenueQuoteLead` đưa sàn mặc định của `crypto` lên đầu tuyến `quote` crypto khi sàn đó cũng là nhà cung cấp. `news` theo từng thị trường, cộng `*` cho dòng tin vĩ mô; ở thị trường có hai nhà cung cấp (cổ phiếu VN, crypto), hai bên chia yêu cầu chứ không dự phòng cho nhau: tin riêng của một mã đến từ bên đầu, lần đọc toàn thị trường đến từ `rss`.

### Thứ tự tuyến và ghi chú về bộ nối

Thứ tự là một quyết định có chủ ý, không phải ngẫu nhiên.

**Giá và mức chỉ số VN.** `vndirect` đứng đầu vì dòng giá trong phiên của nó được ghi ngay khi thị trường đang giao dịch. Nó từ chối thẳng một mức chỉ số, nên chỉ số hay hợp đồng phái sinh chuyển xuống `vietcap-chart`, có chuỗi một phút cập nhật suốt phiên. `entrade` đứng sau vì chuỗi trong phiên của chính nó đôi khi cắt mất các cây nến mới nhất, tùy cửa sổ yêu cầu, và trả lời chậm vài giờ mà **không báo hỏng**. Đo lúc 15:03 ICT: cửa sổ 14 ngày trả về cây nến 10:45 của VNINDEX, trong khi cửa sổ 13 ngày và 15 ngày đều trả về giá đóng 14:45, và ba lời gọi 14 ngày giống hệt nhau cho ba phần đuôi khác nhau. Cơ chế dự phòng không nhìn thấy lỗi thiếu nến này, cũng không thấy một giá đóng đã cũ. Vì vậy khả năng `quote` tự kiểm tra độ mới của mọi giá nó nhận (xem [Một số đọc phải mới](#một-số-đọc-phải-mới-không-chỉ-là-của-hôm-nay)).

**`vietcap-board` và `vietcap-chart` đăng ký dưới mã riêng**, không dưới `vietcap`: cầu dao, bộ đếm lỗi và gáo nhịp đều tính theo mã **duy nhất**. `vietcap-board` đọc cả bảng giá một lần và trả lời `sessionQuotes` lẫn `foreignRoom` từ cùng dữ liệu (`vndirect` đứng trước vì các dòng của nó cũng chính là dữ liệu dùng để dựng bằng chứng đã chốt, nên số đếm trực tiếp và số đã lưu đo trên cùng một tập). Nếu dùng chung `vietcap`, ba phản hồi bảng xấu sẽ làm `indexMembership` - tuyến không có nhà cung cấp thứ hai - mất dữ liệu suốt năm phút, và một lần đọc bảng 4 MiB sẽ chung gáo token với lượt quét `tradeSides` theo từng mã. `vietcap-chart` có biểu đồ mọi chỉ số HOSE, nên lỗi của một lần quét bảng không được làm mất chuỗi mà các yếu tố ETF dùng để chấm điểm; nó phục vụ cả `bars` lẫn `quote` dưới một mã vì cùng máy chủ, cùng đường dẫn, nên thêm mã thứ tư không tách được gì.

**Thứ tự `bars` của VN.** `vndirect` không công bố dòng chỉ số nào (nó từ chối chúng trong `covers`, nên một chỉ số không tốn của nó yêu cầu nào) và `entrade` đã vẽ một số chỉ số ở độ sâu mà cây mã này đọc, nên `vietcap-chart` đứng thứ ba. Chỉ số nào `entrade` có thì tùy ký hiệu; với phần còn lại nó trả lời `invalid symbol` và tuyến đi tiếp. Cận `to` của `vietcap-chart` gồm cả cây nến mang đúng giây đó và làm tròn lên ở các trường hợp khác, và chuỗi ngày của nó mang cả cây nến hôm nay còn đang hình thành, nên bộ nối bỏ mọi thứ sau ngày đã settle thay vì tin vào cận.

`vps` đứng cuối. Với ba nhà cung cấp, sáu chỉ số vẫn chỉ có một nguồn: các chuẩn ETF VNDIAMOND, VNFINLEAD, VNFINSELECT, VNMIDCAP, VNSHINE và VNX50 bị `vndirect` từ chối và `entrade` trả lời `invalid symbol`, nên một lần `vietcap-chart` từ chối là mất cả sáu. Feed của VPS Securities mang chúng sâu 707 phiên so với 673 của vietcap, mọi giá đóng trùng nhau trên 125 phiên đã đo. Hai dữ kiện nhà cung cấp mà bộ nối sở hữu: feed viết VNMIDCAP là `VNMID`, và cận `to` của nó làm tròn **lên** tới ngày, nên ngày đã settle được áp lên các cây nến đã phân tích thay vì tin vào truy vấn. Giá trị giao dịch của nó chỉ gồm lệnh khớp, thấp hơn của vietcap 17% (vietcap cộng thêm nhánh thỏa thuận sau phiên), nên nó chỉ được dự phòng cho một nhà cung cấp mà không yếu tố nào đọc khối lượng. Yếu tố ETF đọc giá đóng và `isRestated` cân giá đóng, nên không gì phía sau thấy được khác biệt.

**`sbv`** đọc lãi suất điều hành và lãi suất liên ngân hàng bình quân của Ngân hàng Nhà nước từ trang lãi suất. Trang đổi câu chữ thì phân tích hỏng và không ghi gì; không bao giờ đoán một giá trị. Trang chỉ cho thấy hôm nay, nên lịch sử duy nhất là thứ `refreshPolicyRates` (loại `macro` của VN, chạy cạnh `refreshFxSeries`) lưu mỗi lượt: lãi suất điều hành đóng dấu phiên refresh, lãi suất liên ngân hàng đóng dấu ngày mà trang nêu.

**`nso`** đọc báo cáo kinh tế - xã hội hằng tháng của cơ quan thống kê qua WordPress API của nó. Mỗi báo cáo mang một tag và được đăng đầu tháng sau tháng nó phủ (các trang liệt kê của site bỏ sót báo cáo; tag thì không). Yêu cầu là `/wp-json/wp/v2/posts` với tag `727`, mỗi tháng một lần: tháng được phủ lấy từ các bài đăng của tháng kế tiếp, không bao giờ tìm theo slug (slug có lỗi chính tả), và chuỗi có giá trị từ tháng 9 năm 2024. Máy chủ này đôi khi không với tới được từ nước ngoài, nên vòng trích xuất thử lại ở nhịp kế tiếp.

**`trading.macro-extract`** là một việc của dịch vụ nền (daemon) (`wiring/tasks.ts`); các thị trường không có mô hình. Mỗi nhịp nó đọc tới một lô báo cáo `nso` chưa đọc, cộng tiêu đề PMI và đầu tư công của Việt Nam từ `news_items`, qua `[[model_tiers.extraction]]` (nếu không có thì `[[models]]`). `macro-extract/verify.ts` chỉ giữ một con số nếu trích dẫn của nó nguyên văn trong nguồn, con số có trong trích dẫn, dấu của một chuỗi biến động khớp với các từ đứng trước (`giảm` là âm; các mức như PMI không bao giờ bị kiểm dấu), tháng của nó là tháng của tài liệu, và nó nằm trong khoảng của chuỗi. Một con số được giữ cùng trích dẫn của nó vào `series_points` và `series_provenance` trong một giao dịch cùng dòng `macro_documents`. Một con số trên báo chí không bao giờ thay con số của cơ quan thống kê.

**`vietcap-statements`, tỷ lệ của `vndirect`, hàng hóa.** `vietcap-statements` phục vụ báo cáo năm và quý của một mã. `vndirect` phục vụ `valuationRatios` (P/E và P/B hằng ngày cùng trung bình năm năm). `commodityPrices` có hai nhà cung cấp không bao giờ xếp hạng nhau cho một mặt hàng: feed sàn của `vndirect` là hằng ngày, còn `fred-csv` (bản tải biểu đồ không khóa của FRED) mang các chuỗi hằng tháng mà không feed hằng ngày miễn phí nào có.

- Một lời gọi `vietcap-statements` trả về tám năm, nên `annual_accounts` không bền cũng không lưu trữ: tải lại là dựng lại được. Một quý được giữ khi chỉ có bảng cân đối và kết quả kinh doanh, vì nhà cung cấp nộp lưu chuyển tiền tệ sau; một năm vẫn cần đủ ba báo cáo. Quý thiếu thì các dòng tiền của nó vắng mặt, và mọi tổng bốn quý, dòng tiền tự do và tỷ lệ chuyển đổi tiền cần chúng cũng vắng mặt theo, không bao giờ là số 0. Cột `cash_flow_source_id` được đặt khi các dòng tiền đến từ `cafef-statements`.
  34 quý đi vào `quarterly_accounts` và được đọc như một năm chạy sau năm đã kiểm toán mới nhất, và năm quý mới nhất còn được đọc thành các dòng quý so với cùng kỳ năm trước (`AccountsHistory.quarters`, dựng trong `markets/equity-vn/accounts/quarters.ts`).
- Một ngân hàng được nhận ra từ bảng cân đối, không bao giờ từ ngành. Nhà cung cấp điền số 0 vào mã của các họ khác, nên một dòng cho vay khách hàng dương (`bsb104`) đánh dấu ngân hàng và `isBankLines` (`kernel/market/annual-accounts.ts`) kiểm tra đúng dòng đó. Phần `NOTE` tùy chọn chỉ làm mất các dòng ngân hàng khi vắng. Các dòng chi ra được lưu đã đảo dấu (`OUTFLOW_LINES`).
- `cashFlowToDate` là bảng lưu chuyển tiền tệ lũy kế của một quý từ `cafef-statements`.
  - **Khi nào được hỏi.** Lượt refresh báo cáo chỉ hỏi khi quý mới nhất của một mã không phải ngân hàng là quý đang theo dõi và thiếu lưu chuyển tiền tệ, còn mọi quý trước đó trong năm đã có đủ.
  - **Cách tính một quý.** Số của quý là số lũy kế trừ các quý đã lưu (không bao giờ trừ hai cột của CafeF cho nhau, vì cột quý trước của nó là bản nộp trước soát xét), và chỉ được giữ khi lợi nhuận trước thuế lũy kế khớp tổng các quý đã lưu trong ngưỡng `CASH_FLOW_MATCH_TOLERANCE`.
  - **Ô trống.** CafeF để trống ô có giá trị 0, nên ô trống trong một dòng có trong bảng được đọc là 0; riêng ô dòng tiền thuần từ hoạt động kinh doanh hoặc lợi nhuận trước thuế mà trống thì trang bị từ chối, vì phép điền dựa trên chính hai số này. Nhãn được so ở dạng Unicode dựng sẵn (NFC), và một cột mà mọi ô đều trống là quý chưa công bố.
  - **Giữ số đã điền.** Mọi quý mà `vietcap-statements` vẫn trả về không có lưu chuyển tiền tệ đều giữ số lần điền trước nếu lợi nhuận trước thuế không đổi, dù quý đó còn được theo dõi hay không. Vì vậy CafeF chỉ được hỏi khi chưa có số điền nào, còn khi CafeF không trả lời hoặc phép kiểm hỏng thì quý vẫn ở trạng thái thiếu.
  - **Hỏi lại.** Quý chưa có lưu chuyển tiền tệ, hoặc đang dùng số của CafeF, được hỏi lại một lần sau mỗi phiên đã chốt khi còn là quý đang theo dõi (tính khoảng cách từ lúc bắt đầu chạy sẽ hụt vài phút của lần tải trước và bỏ sót một ngày); suggest không bao giờ gọi CafeF.
  - **Cảnh báo.** Hai cảnh báo nói phần còn thiếu: `factor.accounts-quarter-partial` và `factor.accounts-quarter-late`. Mọi cảnh báo báo cáo tài chính đều tới báo cáo qua dòng chất lượng khi mã có điểm hiện tại; riêng hai cảnh báo này còn đi thẳng qua năng lực báo cáo tài chính, nên mã chưa có điểm hiện tại vẫn hiện chúng.
- Hai dòng của nhà cung cấp cố tình không đọc: lợi nhuận hoạt động của nó, vì lợi nhuận hoạt động lõi là lợi nhuận gộp trừ chi phí bán hàng và quản lý (`markets/equity-vn/accounts/history.ts`), và EPS của nó, vốn không được điều chỉnh khi chia cổ tức bằng cổ phiếu, nên số cổ phiếu là vốn cổ phần chia `VN_SHARE_PAR_VND`.
- Dòng nào nhà cung cấp ngừng điền thì phát `factor.accounts-lines-dropped` và được đọc là vắng mặt.
- `commodityPrices` và `valuationRatios` được đọc lúc phân tích và không bao giờ lưu. `vndirect` phục vụ chúng từ `/v4/commodities` và `/v4/ratios`, theo từng mã từ `fromDay` hoặc cho mọi mã ở một phiên `toDay` kèm trung bình năm năm. Thân `fred-csv` thiếu dòng tiêu đề CSV thì phân tích hỏng chứ không đọc thành rỗng. Một năm lỗ không có P/E, và thiếu là không có số đọc; một phiên không giao dịch trả về rỗng, nên bên đọc lùi lại một phiên.

**`proprietaryFlows` không phải bên dự phòng cho `flows`.** `cafef` chỉ công bố khối tự doanh, không có số liệu khối ngoại. Nó dẫn khối đó hai phiên, trong khi `vndirect` làm rơi cả phiên (bốn trong 68 ngày giao dịch, đo trên bốn tháng). Bên đọc dòng tiền chỉ hỏi nó cho những phiên còn thiếu nhánh đó, không bao giờ cho các phiên mới nhất: khối tự doanh công bố sau giờ đóng cửa, nên các phiên đó thiếu ở mọi nhà cung cấp, và hỏi sẽ quét cả tập mỗi ngày cho dữ liệu mà chưa ai có.

**Giá crypto** đặt sàn mặc định của `crypto` (`default_for` trong `[trading.venues.<id>]`, `binance` nếu không đặt) lên đầu khi sàn đó cũng là nhà cung cấp: một kế hoạch định giá ở nơi khác sẽ báo một con số mà operator không khớp lệnh được. `okx` không niêm yết mọi mã; mã nó thiếu trả lời mã `51001`, mà bộ nối ánh xạ thành trượt nghiệp vụ để cơ chế dự phòng đi tiếp mà không tính là nhà cung cấp hỏng. Ba nhà cung cấp giá đều không cần khóa và không bị tính hạn mức theo tháng, điều quan trọng vì vòng cảnh báo đọc giá của mọi coin đang theo dõi ở mỗi nhịp; một bên chính tính hạn mức theo tháng sẽ tiêu hết hạn mức vào vòng nền. Đó là lý do CoinGecko phục vụ bảng vốn hóa và một lần đọc tỷ giá, không phục vụ đường giá.

Binance hỏi `symbolStatus=TRADING`: một cặp bị nó tạm dừng sẽ mãi trả giao dịch cuối cùng, và bộ lọc biến nó thành mã 400 mà cơ chế dự phòng vốn đã hiểu. Không lọc thì LITUSDT bị tạm dừng sẽ báo 0,743 trong khi OKX, Bybit và MEXC giao dịch ở 4,6, lệch 82%, kéo mức cắt lỗ theo ATR xuống dưới không và khiến kế hoạch bị báo là thiếu dữ liệu.

`mexc` niêm yết nhiều cơ sở spot hơn hẳn Binance và Bybit cộng lại, nên nó phục vụ vài coin xếp hạng cao mà không bên nào kia có (phần còn lại không sàn nào trong tuyến niêm yết). Nó cố ý đứng thứ ba ở `bars`: cái đuôi dài mà riêng nó phủ là nơi khối lượng báo cáo kém đáng tin nhất, nên nó chỉ trả lời cho mã mà các sàn lớn từ chối. Nến của nó không có `takerBuyVolume` (không tách được phía chủ động), mà `Candle` mô hình hóa là vắng mặt chứ không phải số 0.

**`fx`** là một danh sách `ANY_SCOPE` mà các thành viên không chồng lấn nhau.

- Các nhà cung cấp coin dẫn đầu và tự chọn việc: chúng chỉ phủ một cặp có cơ sở là coin mà chúng định giá được. `yahoo` và `er-api` tách một cặp thành hai mã ISO, nên `USDTVND` bảy ký tự trượt `covers` của chúng.
- `coinbase` đứng đầu cặp nó giao dịch vì sổ crypto được định giá qua tỷ giá đó; `okx` đứng sau vì sổ lệnh của coinbase ở cặp đó sâu hơn.
- `fxHistory` chỉ có `yahoo`: các nhà cung cấp coin báo giá spot, không phải lịch sử có ngày, và `er-api` chỉ công bố bảng của hôm nay.
- Một cặp tiền pháp định đi tới `yahoo` nguyên vẹn. Chặng coin sang đô la (`USDTUSD`, chặng cầu nối của tỷ giá `USDTVND`) đọc mã `USDT-USD` của Yahoo, và bị từ chối nếu Yahoo không trả về đúng loại tiền mã hóa. Không có chặng này thì tỷ giá của một ngày đã qua mang giá USDT của hôm nay, đổi theo từng lần gọi dù vẫn ghi là của ngày đó.
- Không có đường dự phòng từ `USDTVND` sang `USDVND`: USDT là một công cụ khác ở một thị trường khác, và một tỷ giá bị thay thế tệ hơn khoảng trống mà `valuation.fx-missing` báo.

### Sức khỏe chỉ hạ bậc, không bao giờ nâng bậc

Sau khi áp thứ tự tuyến, `orderByHealth` sắp xếp ổn định để đẩy nhà cung cấp đang yếu xuống sau nhà cung cấp khỏe. "Yếu" nghĩa là cầu dao đang mở, hoặc sự kiện gần nhất được ghi là một lần hỏng (`recordSuccess` xóa mã lỗi).

`lastFailureCode` là một `CaveatCode`, và `toCaveatCode` chỉ tạo ra được bốn mã: `source.timeout`, `source.rate-limited`, `source.unavailable`, `source.payload-rejected`. `/sources` hiển thị từng mã qua `trading.source.failure.<code>` và `renderProvidedValue` (`features/market-data/render/sources.ts`), nên mã nào danh mục chưa có câu chữ thì hiện chính mã đó chứ không hiện một khóa trần. Câu đầy đủ `trading.caveat.<code>` không hợp với dòng này: nó nêu tên nhà cung cấp, mà dòng đó vốn đã bắt đầu bằng tên ấy.

Không sắp theo **độ mới của lần thành công**: cách đó xếp hạng nhà cung cấp theo việc nó làm cho một **loại khác**. Một lời gọi `marketCap` từng đẩy CoinGecko lên trước Binance cho mọi yêu cầu `bars` sau đó, và bên dự phòng có điều nhịp phục vụ cả một màn hình mà bên chính không điều nhịp mới là bên được định tuyến đứng đầu.

### Dự phòng và trộn

`SourceRegistry` có hai thao tác; khác biệt là các nhà cung cấp có thay thế được cho nhau hay không.

- **`resolve`** - dự phòng. Đi qua các nhà cung cấp đủ điều kiện theo thứ tự; kết quả `available` đầu tiên có giá trị dùng được (mảng không rỗng, hoặc bất kỳ giá trị nào không phải mảng) sẽ thắng. Các ghi chú sự cố từ những nhà cung cấp đã bị bỏ qua được gộp thành một dòng `source.recovered` nêu tên nhà cung cấp đã hỏng và nhà cung cấp đã trả lời. Nếu không bên nào thắng:
  - khi mọi nhà cung cấp đều đã trả lời (rỗng, từ chối là `unsupported`, hoặc chỉ có caveat `source.symbol-not-found`, `source.ambiguous-symbol` hay `source.empty-window`), kết quả là `unavailable('empty')`, mỗi nhà cung cấp rỗng được nêu bằng `source.empty-window`. Một mã bị tạm ngừng hay mã vốn hóa nhỏ không có dòng tiền ngoại là bình thường, và không được đọc thành sự cố. Ghi chú đó chỉ phát ra khi cả tuyến đều rỗng, nên một yêu cầu đã phục hồi không mang theo gì về nhà cung cấp nó đã đi qua;
  - nếu không, `unavailable('failed')` kèm mọi mã đã thử cùng `source.no-available-provider`, và một cảnh báo `trading.source_route_exhausted` mỗi phạm vi mỗi phút (một lượt quét toàn tập làm cạn cùng một tuyến một lần cho mỗi mã).
- **`resolveAll`** - trộn. Mọi nhà cung cấp đã định tuyến và có phủ đều chạy song song, và bên gọi gộp các kết quả theo thứ tự tuyến - thứ tự đó cũng là thứ tự ưu tiên. Chặng có cầu dao đang mở bị bỏ qua (một nhà cung cấp im bặt sẽ tốn trọn hạn chót ở mọi lần đọc trộn); chỉ xét cầu dao, không bao giờ xét `isDegraded`, để một lần hỏng không loại một chặng chỉ đang có một phút tồi. Các bên gọi trộn vì hai lý do.

  Phần lớn trộn vì không nhà cung cấp nào phủ hết chủ thể:

  - `macro` - không nhà cung cấp nào công bố mọi chuỗi; cặp không-khóa `treasury`/`bls` dẫn đầu để một bản cài không khóa vẫn đọc được vĩ mô.
  - `goldBoard` - không nhà cung cấp nào báo giá mọi loại vàng trong nước, nên bảng dùng được đầu tiên sẽ bỏ mất loại nào chỉ nhà cung cấp đứng sau mới có. `giavang` đứng trước vì nó báo giá của chính SJC; dòng vàng miếng mà `pnj` bán lại chỉ được dùng khi `giavang` không trả lời.
  - `supervision` - `hsx` là dịch vụ niêm yết của chính HOSE, còn bảng của công ty chứng khoán `ssi` là endpoint miễn phí duy nhất cũng có HNX, nên hợp của hai nguồn mới phủ được thị trường. Mỗi lần đọc nêu rõ đã phủ những bảng nào; bảng nào không lần đọc nào phủ thì các mã trên đó ở trạng thái **chưa biết**, không phải sạch.

  `proprietaryFlows` trộn vì lý do còn lại. Nó chỉ có một nhà cung cấp, nhưng cơ chế dự phòng sẽ coi câu trả lời "không có dòng nào" là một lần hỏng, trong khi ở đây chính câu trả lời đó mới là thông tin đáng có: một khối tự doanh không giao dịch gì cũng là một khoảng trống đã được lấp.

Cả hai đều kiểm tín hiệu của bên gọi trước khi làm việc và ném lỗi khi bị hủy.

## Kênh truyền

`createSourceHttp` (`sources/transport/http.ts`) là client duy nhất: một thể hiện dùng chung cho mọi bộ nối, giữ bộ điều nhịp và sổ sức khỏe. Các hằng này là mặc định toàn cục - thứ một yêu cầu nhận được khi không đòi gì riêng.

| Núm vặn | Giá trị | Ý nghĩa |
|---|---|---|
| `REQUEST_BUDGET_MS` | 35.000 | trần thời gian thực cho cả yêu cầu, gồm cả thời gian chờ nhịp và chờ thử lại |
| `ATTEMPT_TIMEOUT_MS` | 10.000 | hạn chót mỗi lần thử bên trong hạn mức đó (mặc định cho đọc theo lô) |
| `RETRY_MAXIMUM_ATTEMPTS` | 3 | mặc định cho đọc theo lô |
| `RETRY_INITIAL_DELAY_MS` / `RETRY_MAXIMUM_DELAY_MS` | 500 / 5.000 | cận của khoảng chờ |
| `MAXIMUM_RESPONSE_BYTES` | 2 MiB | trần kích thước thân phản hồi |
| `MAXIMUM_PAGES` | 20 | số trang tiếp theo mà một lần tải sẽ đuổi theo |
| `PAGE_SET_BUDGET_MS` | 120.000 | trần cho cả một bộ trang; không có nó, một lần đọc hai mươi trang là hai mươi hạn mức yêu cầu nối tiếp nhau |
| `BREAKER_FAILURE_THRESHOLD` | 3 | số lần hỏng liên tiếp trước khi cầu dao mở |
| `BREAKER_FAILURE_WINDOW` / `BREAKER_FAILURE_RATE` | 20 / 0,5 | số kết cục gần nhất dùng để đo **tỷ lệ** hỏng, và tỷ lệ hỏng cần đạt |
| `BREAKER_COOLDOWN_MS` | 300.000 | cầu dao mở trong bao lâu; nó chỉ đóng khi hết khoảng này, vì một yêu cầu gửi trước lúc cầu dao mở có thành công cũng không nói gì về nhà cung cấp lúc này |

Hai loại đọc dùng chung kênh truyền này. **Đọc theo lô** (lượt quét refresh, lịch sử nến) dùng mặc định, vì xong việc quan trọng hơn xong ngay. **Đọc giá** (`/price`, nhịp danh sách theo dõi, mỗi nhịp cảnh báo) rải thêm `QUOTE_ATTEMPT_LIMITS` (8.000 ms, 1 lần thử), nên bên chính chết chỉ tốn một lần chờ ngắn trước khi chuyển sang dự phòng, thay vì ba lần thử lùi dần trong lúc có người đang chờ ở dấu nhắc lệnh. Các con số nằm trong một hằng được export duy nhất nên các bộ nối quote không lệch nhau được. 8.000 là con số đo được trên một phiên chạy có tải: yahoo trả lời một giá đơn lẻ trong khoảng một giây, nhưng mất từ 2,2 s tới 5,3 s khi nằm trong một bản tin dùng chung tiến trình với một trăm yêu cầu khác, và một cận chặt hơn thì phiên chạy nào cũng báo nhà cung cấp còn sống là đã chết.

Một yêu cầu, theo thứ tự:

1. **Kiểm tra trước.** Nếu tín hiệu của bên gọi đã hủy thì ném lỗi. Nếu cầu dao đang mở thì trả về `source.breaker-open` mà không đụng tới mạng.
2. **Xác định đích.** Origin đã đăng ký của nhà cung cấp cộng đường dẫn gốc của nó, hoặc - với yêu cầu feed - URL feed trong danh sách cho phép mà `feedId` chỉ tới. Mọi đích khác không định tuyến được, và được báo là `source.unavailable`.
3. **Gắn thông tin đăng nhập.** Yêu cầu chỉ khai vị trí đặt; kênh truyền tự đọc phần bí mật đã phân giải. Chỗ bí mật được phép đi tới nằm ở [Các bất biến về bảo mật](#các-bất-biến-về-bảo-mật).
4. **Điều nhịp.** Mỗi nhà cung cấp có khai giới hạn có một gáo token, nạp lại liên tục, nên thời gian chờ tính được mà không cần hỏi vòng. Gáo chỉ chứa một phần tư hạn mức của phút (`BURST_FRACTION`, tối thiểu một token): một tiến trình vừa khởi động mà tiêu hết cả phút trong một thoáng sẽ bị nhà cung cấp đo theo cửa sổ ngắn hơn từ chối. Thông lượng bền vững vẫn là đúng tốc độ đã khai. Điều nhịp diễn ra **trước** lời gọi, không phải để phục hồi sau mã 429: nếu không, một danh sách theo dõi rộng sẽ bật cầu dao và mất nhà cung cấp đó suốt một chu kỳ nghỉ. Mỗi lần thử lại lấy một token riêng, vì thử lại là thêm một yêu cầu nhà cung cấp phải phục vụ. Lời gọi hết ngân sách trong lúc chờ token chưa từng tới nhà cung cấp, nên trả `source.timeout` mà không đụng cầu dao: hàng đợi sâu sau một nhà cung cấp khỏe không được làm nó mở.
5. **Gửi, kèm thử lại.** `isRetryable` gồm các lần hết giờ và `408 425 500 502 503 504`; mọi mã khác là câu trả lời của nhà cung cấp, thử lại cũng chỉ nhận đúng câu đó. Mã 429 được quyết theo header: chỉ thử lại nếu có `Retry-After`, vì hạn mức đã cạn thì không nói gì, và gọi lại chỉ tiêu thêm thứ đã hết - đó là cách hạn ngạch tháng cháy sạch trong một buổi chiều. `Retry-After` trên 429/503 cũng là mức sàn do server đặt: khoảng chờ lùi dần vẫn áp lên trên, nhưng không bao giờ chờ ít hơn. Nếu mức sàn dài hơn phần ngân sách yêu cầu còn lại thì không chờ cho hết: lần thử lại bị bỏ, nên chính mã 429 được ánh xạ (`source.rate-limited`, kèm `Retry-After` đưa cho cầu dao) thay vì một ngân sách hết hạn giữa lúc chờ rồi bị đọc thành `source.timeout`.
6. **Ghi sức khỏe, rồi ánh xạ.** Cầu dao thấy vòng gọi bất kể phần thân có ánh xạ được hay không, vì schema lệch không phải lỗi kênh truyền.
7. **Ghi log.** Một dòng debug `trading.source_request` cho mỗi vòng gọi, với `sourceId`, `path`, `status`, `elapsedMs` và `pacedMs` (thời gian chờ trong hàng đợi được đo tách khỏi thời gian trên dây; bộ điều nhịp có thể giữ một lời gọi cả phút, và nếu tính khoảng chờ đó là độ trễ thì nhà cung cấp sẽ trông như chậm). Cả hai đo bằng `performance.now()`; hiệu của đồng hồ treo tường sẽ ra thời lượng âm khi đồng hồ NTP nhảy.

Cầu dao mở ở một trong ba tín hiệu: phản hồi đầu tiên tự nêu khoảng chờ của nó; ba lần hỏng liên tiếp (một lần hết giờ trong một lượt quét hàng trăm yêu cầu chẳng nói gì về sức khỏe); hoặc một nửa trong hai mươi kết cục gần nhất bị hỏng. Chuỗi liên tiếp bắt được nhà cung cấp đã ngừng trả lời, còn tỷ lệ bắt được nhà cung cấp chỉ trả lời một nửa số lần - trường hợp các lần thành công của một lượt gọi song song nhiều yêu cầu (fan-out) cứ reset chuỗi mãi, trong khi mỗi lần hỏng vẫn tốn đủ hạn mức thử lại. `summary()` công bố `{ id, lastSuccessAt?, lastFailureCode?, breaker }` và không bao giờ kèm URL, thông tin đăng nhập hay thông báo của nhà cung cấp: màn hình sức khỏe chính là nơi một khóa bị lộ khó bị để ý nhất.

## Giới hạn và trần

Quyết định thiết kế là mỗi trần nằm ở tầng nào: con số mô tả **nhà cung cấp** là dữ kiện do mã sở hữu; con số mô tả **lời gọi** thì đi theo yêu cầu.

### 1. Giá trị mặc định toàn cục của kênh truyền

Bảng ở phần [Kênh truyền](#kênh-truyền): một giá trị cho mọi nhà cung cấp. Đây là chỉnh mạng, không phải phán đoán của operator: nhà cung cấp hoặc trả lời trong các mốc đó, hoặc dự phòng chuyển sang nguồn kế tiếp.

### 2. Dữ kiện theo từng nguồn

Trần duy nhất theo từng nhà cung cấp là giới hạn tần suất, `SOURCE_RATE_LIMITS` (`composition/source-facts.ts`): trần gói miễn phí mà nhà cung cấp công bố, hoặc - nếu họ không công bố - tốc độ mà một lượt quét toàn tập chịu được mà không bị bóp. Các con số theo phút nằm ở [trang người dùng](../nguon-du-lieu.md#giới-hạn). Vì sao những con số ít hiển nhiên lại như vậy:

- `binance` 600: dẫn đầu `bars` crypto, và `quote` crypto khi là sàn mặc định; vòng cảnh báo đọc một giá cho mỗi coin đang theo dõi ở mỗi nhịp. `okx` 600: trần công bố là 20 yêu cầu mỗi 2 giây mỗi IP. `mexc` 600: host cấp 3.000/phút (500 trọng số mỗi 10 giây ở trọng số 1); khớp hai anh em cùng tuyến. `binance-futures` 600: tuyến `funding` duy nhất. `bybit` 600, `fred` 120: trần đã công bố.
- `cafef` 300: theo từng mã, nên một lần lấp khoảng trống quét cả tập. `vndirect` 300: endpoint của công ty chứng khoán, bị quét toàn tập.
- `cafef-statements` 60: không công bố; một trang khoảng 33 KB, chỉ hỏi cho mã có quý mới nhất thiếu lưu chuyển tiền tệ.
- `vietcap-statements` 120: không công bố; một mã tốn ba yêu cầu (bốn với ngân hàng) và một lượt refresh hỏi khoảng 120 mã chỉ khi báo cáo của chúng đến hạn.
- 60: `coinpaprika` công bố 10/giây và 20.000/tháng; `coinlore` và `treasury` không công bố (tốc độ chịu được khi quét); `entrade`, `kbsec`, `vietcap` là endpoint của công ty chứng khoán; `google-news` là một lần tìm cho mỗi lần đọc một công cụ; `hsx` một lần đọc `supervision` mỗi lượt quét; `rss` dùng chung cho mọi feed mà mã đó phục vụ; `ssi` là chặng `supervision` mang HNX; `yahoo` phục vụ `quote`/`bars` vàng cộng chặng `fx` tiền pháp định; `coinbase` là một cặp cho mỗi lần quy đổi.
- 30: `giavang` phục vụ cả `goldBoard` lẫn `goldBoardHistory` (lịch sử chỉ là vàng miếng SJC); `pnj` là nhóm PNJ và vàng miếng SJC khi `giavang` không trả lời; `vietcap-board` một lần đọc bảng là bốn yêu cầu; `vietcap-chart` theo từng mã, nhà cung cấp đầu tiên vẽ mọi chỉ số HOSE; `vps` theo từng mã, dự phòng `bars` cho các chỉ số mà chỉ nó và `vietcap-chart` mang; `fred-csv` chuỗi hàng hóa hằng tháng; `alternative-me` một lần đọc `sentiment` mỗi phiên chạy.
- `cftc` 20: một tệp hằng tuần. `sbv` 10, `nso` 10: không công bố; một trang / một báo cáo hằng tháng.

**Mọi nhà cung cấp đã định tuyến đều được điều nhịp, và điều này được kiểm lúc khởi động.** `assertEveryRoutedSourcePaced` từ chối lắp ráp (composition) với `sources declare no rate limit: <ids>` nếu một mã đã định tuyến không có trong bảng, nên một tuyến ở một tệp và giới hạn ở tệp khác được bắt ngay đó thay vì thành mã 429 ở môi trường thật.

Ba con số giới hạn một cú bùng nổ thay vì hạn ngạch thật sự ràng buộc chúng, vì gáo token không diễn đạt được một ngày hay một tháng: `bls` (theo ngày), `er-api` và `coingecko` (theo tháng).

- Dùng bình thường thì không bên nào gần chạm. `bls` được cổng vĩ mô hỏi tối đa một lần mỗi ngày UTC và không hỏi giữa hai kỳ công bố; `er-api` đứng cuối tuyến `fx`.
- Các con số này ngăn một cơn bão cầu dao tiêu hết hạn ngạch trong một buổi chiều. Đặt xa trên đỉnh thật thì chẳng ngăn được gì: một vòng chạy mất kiểm soát ở hàng trăm yêu cầu mỗi phút làm cạn hạn ngạch tháng trong một giờ, trong khi con số gần đỉnh để lại nửa ngày cho cầu dao và một con người phản ứng.
- `coinmarketcap` (30) không công bố trần cho phần dùng không khóa và trả `1022` khi một người gọi ẩn danh đã dùng hết (đo được là hồi lại trong vòng một phút sau khi nghỉ). Con số này chặn cú bùng nổ, và nhà cung cấp kế tiếp lấp chỗ khi bị từ chối.
- `coingecko` (10) cần khóa (`COINGECKO_API_KEY`; bộ nối nhắm tới gói Demo 10.000 lần gọi mỗi tháng), nên không có khóa thì nó không được đăng ký. Nó đứng cuối tuyến vốn hóa, chỉ được với tới khi khóa của nó có và các bảng không khóa đã hỏng hoặc một coin nằm ngoài mọi cửa sổ.

Bộ điều nhịp coi một giới hạn vắng mặt là không điều nhịp, không phải bằng không. Không bộ nối có sẵn nào đi vào đường đó nhưng plugin thì có, nên manifest bỏ `rateLimitPerMinute` sẽ nhận `PLUGIN_DEFAULT_RATE_LIMIT_PER_MINUTE` (30). Giới hạn bằng không là `ConfigError` (schema của manifest đòi số nguyên dương, và bộ điều nhịp từ chối giới hạn không dương): công thức chờ chia cho nó và `setTimeout` kẹp `Infinity` thành chạy ngay, lặng lẽ không điều nhịp thay vì không bao giờ cấp. Điều nhịp tính theo từng mã nguồn, không theo từng loại: một gáo phục vụ mọi loại mà nhà cung cấp trả lời, vì nhà cung cấp đếm yêu cầu theo cùng một cách.

### 3. Ghi đè theo từng yêu cầu

Một `SourceRequest` có thể ghi đè các trường dưới đây. Chúng chỉ bao giờ siết chặt hơn: hạn mức 35 giây bọc mọi lần thử và mọi khoảng chờ thử lại (qua `AbortSignal.any`).

| Trường | Tác dụng |
|---|---|
| `attemptTimeoutMs` | thay hạn chót 10 giây mỗi lần thử |
| `maxAttempts` | thay trần 3 lần thử |
| `businessMissStatuses` | các mã trạng thái nghĩa là "không hỗ trợ ở đây" thay vì "nhà cung cấp hỏng" |

`QUOTE_ATTEMPT_LIMITS` (export từ `transport/http.ts`) được các bộ nối thêm vào mọi đường quote (`vndirect`, `vietcap-chart`, `entrade`, `okx`, `binance`, `mexc`, `yahoo`) và vào các lần đọc `fx` của `coinbase`, `okx` và `coingecko`. Trộn là trường hợp ngược lại: `resolveAll` chờ mọi chặng, nên một lần thử lại làm chậm mọi nhà cung cấp trong đó. `fred`, `treasury` và `bls` dùng `COMPLEMENTARY_ATTEMPT_LIMITS` (1 lần thử, hạn chót mặc định), chặn lần trộn vĩ mô ở hạn chót đơn của chặng chậm nhất.

Mọi tuyến quote áp giới hạn quote lên **cả hai** chặng. Một bên chính để ở mặc định đọc theo lô không làm lần đọc dễ thành công hơn; nó tốn ba lần thử và khoảng 31 giây để tới đúng cơ chế dự phòng mà một lần thử đạt tới trong 8 giây. Với nhà cung cấp khỏe thì hạn chót không bao giờ gần (lần đọc giá VN có trung vị 502 ms, tối đa 732 ms). Nó cố ý không phải dữ kiện theo từng nguồn: cùng một nhà cung cấp phục vụ cả lượt quét theo lô lẫn quote tương tác, và hạn chót thuộc về việc nào đang được hỏi (`yahoo` có 8 giây cho một quote và 10 giây cho lịch sử nến trong cùng một phiên chạy).

### 4. Trần theo từng bộ nối

Một lời gọi được phép đòi nhà cung cấp bao nhiêu, do bộ nối sở hữu vì đó là hợp đồng API của máy chủ đó:

| Nguồn | Trần | Nó chặn cái gì |
|---|---|---|
| `binance`, `bybit` | 1.000 | kline mỗi yêu cầu |
| `mexc` | 500 | kline mỗi yêu cầu - đã đo; trần ghi trong tài liệu là 1.000 nhưng endpoint trả 500 dù `limit` cao tới đâu |
| `coingecko` | 250 | dòng tập công cụ mỗi trang - coin xếp hạng quá nó được tra theo tên, mỗi lời gọi một ký hiệu |
| `coinpaprika` | 750 | cửa sổ phân giải, trong một yêu cầu; không tra ký hiệu, nên coin nằm quá nó rơi xuống coingecko |
| `coinmarketcap` | 750 | dòng danh sách mỗi yêu cầu - cả cửa sổ xếp hạng trong một lời gọi, nên nó dẫn đầu; phần không khóa không có dòng theo ký hiệu, nên coin nằm quá nó rơi xuống nhà cung cấp kế tiếp |
| `coinlore` | 100 | ticker mỗi yêu cầu - không tra ký hiệu, nên nó chỉ trả lời cho cửa sổ của chính nó |
| `vndirect` | 500 / 4.000 | cỡ trang chuẩn / cỡ trang toàn thị trường (`DEFAULT_PAGE_SIZE` / `MARKET_PAGE_SIZE`). Phân trang theo offset trên cả thị trường lặp lại vài dòng và làm rơi đúng bấy nhiêu dòng khác dù sắp xếp thế nào (một tháng nến mất khoảng 1.400 trong 34.893 dòng), nên một cửa sổ toàn thị trường không bao giờ được phân trang: cửa sổ vừa một trang thì đọc nguyên, không vừa thì đọc từng ngày một, và một ngày làm đầy trang của nó thì lần đọc hỏng |
| `vndirect` | 50 | bản ghi tin mỗi yêu cầu |
| `vndirect` | 50 | mã mỗi lô `/v4/ratios/latest` (`RATIO_BATCH_TICKERS`) - không có dạng toàn thị trường, khoảng 83 ms mỗi mã khi CDN nguội: 200 hết giờ mọi lần, 100 đo được 8,3 giây so với `REQUEST_BUDGET_MS`, 50 trả lời trong 4,3 giây và vẫn quét cả tập dưới mười yêu cầu |
| `vndirect` | 45 | ngày mỗi cửa sổ nến của lần đọc toàn thị trường |
| `vietcap` | 8 | trang trade sides |
| `vietcap-board` | 600 | ký hiệu mỗi yêu cầu bảng - mỗi mã giải mã ra khoảng 2,4 KB, nên cả danh sách một lần đạt gần 4 MiB so với trần 2 MiB của kênh truyền |
| `fred` | 10 | quan sát mỗi chuỗi |
| `giavang` | 24 giờ | độ lệch dấu thời gian chấp nhận được trước khi một dòng bị bỏ |

Phân trang đi qua nhiều tầng: bộ nối nêu `pageSize`, kênh truyền tải các trang tiếp theo tới `MAXIMUM_PAGES`, và chạm nó khi trang cuối còn đầy cho ra `source.truncated`.

### Cái gì không có trần

**Không có hạn mức yêu cầu theo ngày hay theo tháng cho từng nguồn**, và không có tinh chỉnh cầu dao, trần kích thước phản hồi, hay trần số trang theo từng nguồn (ba thứ đó là toàn cục). Một khóa gói miễn phí chỉ được bảo vệ bằng gáo theo phút. Trần chi phí có cho chi tiêu LLM ([ngân sách](../ngan-sach.md)), không có cho lời gọi nhà cung cấp, vì các lời gọi đó miễn phí ở những gói mà các bộ nối này nhắm tới.

## Phân loại lỗi

Mọi việc nhà cung cấp có thể gây ra đều có tên, và tên đó đến với người đọc dưới dạng caveat. Đây là các mã mà kênh truyền và sổ đăng ký phát ra; bộ nối và thị trường còn thêm mã riêng, tất cả ở `kernel/caveat.ts`.

| Mã | Nguyên nhân | Ảnh hưởng tới sức khỏe |
|---|---|---|
| `source.timeout` | hết hạn chót lần thử hoặc hết hạn mức | tính là một lần hỏng; ngân sách hết hạn khi lời gọi còn đang xếp hàng sau bộ điều nhịp thì vẫn trả về hết giờ nhưng không được tính, vì chưa gửi gì |
| `source.rate-limited` | HTTP 429 | có tính; `Retry-After` mở cầu dao ngay, và nếu không có thì yêu cầu cũng không được thử lại |
| `source.unavailable` | mọi lỗi HTTP khác, hoặc một đích không định tuyến được | có tính |
| `source.breaker-open` | yêu cầu bị từ chối trước khi ra mạng | không - nó chính là hệ quả |
| `source.payload-rejected` | `parse` ném lỗi, hoặc thân phản hồi không đúng schema đã khai | không, theo thiết kế |
| `source.symbol-not-found` | một mã trạng thái có trong tài liệu nhà cung cấp, liệt kê ở `businessMissStatuses` | không - đó là một thuộc tính của yêu cầu |
| `source.empty-window` | nhà cung cấp đã trả lời, bằng không có gì | không |
| `source.truncated` | phân trang chạm `MAXIMUM_PAGES` hoặc hạn mức của cả bộ trang với một trang cuối đầy | không |
| `source.market-read-truncated` | một lần đọc toàn thị trường của `vndirect` mà một trang bị cắt; nó hỏng cho mọi mã dùng chung lần đọc đó, vì một phần đầu sẽ thay cả cửa sổ đầy | không |
| `source.no-available-provider` | mọi nhà cung cấp đã định tuyến đều được thử và không ai phục vụ được | không - nó tóm tắt những cái còn lại |

Hai điểm cần phân biệt:

- **Trượt nghiệp vụ không phải sự cố.** `businessMissStatuses` cho bộ nối khai những mã không thử lại được nào có nghĩa là "yêu cầu này không hỗ trợ ở đây" - ví dụ mã 404 của Yahoo với một cặp coin không niêm yết. Kết quả là `unavailable('unsupported')` và nhà cung cấp kế tiếp được thử. Ticker kim loại của Yahoo đi qua một bảng **toàn phần**, nên mã 404 ở đó là ánh xạ hỏng và phải được đọc là một lần hỏng.
- **Bên gọi tự hủy không phải nhà cung cấp hỏng.** Cả hai trường hợp khi hạn mức hết đều được quyết dựa trên **tín hiệu**, không dựa vào tên lỗi (`AbortSignal.timeout` từ chối với `TimeoutError`): bên gọi tự hủy thì ném lỗi lên và không bao giờ chạm cầu dao; còn hết hạn chót của chúng ta nghĩa là nhà cung cấp quá chậm.

## Cache

Các cache đều hẹp, và mỗi cái đều có một chi phí đo được để biện minh.

**Nến đã settle** (`sources/settled-bars.ts`) - cache theo ngày kiểu read-through, bọc quanh một nguồn bars. Mọi ngày trước hôm nay đã settle và không đổi nữa, nên chỉ tải một lần. Nó chỉ bọc `binance`, `bybit` và `mexc`, vì cần chuỗi thô, khóa theo UTC, liên tục. Chuỗi đã điều chỉnh (equity-vn) sẽ bị sửa ngược về quá khứ nên không bao giờ được đi qua nó; tính liên tục cũng bắt buộc vì độ phủ được kiểm theo ngày lịch - thị trường có cuối tuần sẽ không bao giờ trúng cache.

- Cây nến hôm nay (đang hình thành) bị bỏ trước khi có gì đọc nó. Giữ lại thì cùng một cửa sổ sẽ chấm điểm khác nhau từng phút, và bằng chứng bị gắn vào một phiên chưa ai đóng. Mọi nơi dùng đọc nến như bằng chứng đã settle và lấy giá trực tiếp từ `quote`.
- Cache trả về **đoạn đầu** dài nhất của các ngày đã settle mà nó giữ, và chỉ tải lại từ chỗ trống đầu tiên, nên một ngày vừa settle không kéo theo việc tải lại hai trăm ngày trước đó - cái giá mà mọi mã trên một bảng sẽ phải trả mỗi lần ngày UTC sang trang.
- Ngày nào nhà cung cấp trả lời bằng cách không công bố gì thì được cache là **vắng mặt**, nhưng chỉ với đoạn liên tục ở đầu: một mã niêm yết không có nến nào trước cây nến đầu tiên của nó, trong khi khoảng trống ở giữa có thể là phản hồi bị cắt, và ghi nó là vắng mặt sẽ rút ngắn mọi khoảng nhìn lại về sau.
- Các dòng từ cache mang `freshness: 'cached'` trong phần xuất xứ. Khóa kèm thị trường, vì cùng một ticker có thể là công cụ khác nhau ở mỗi thị trường mà một nguồn phục vụ. Giới hạn: 8.000 mục, LRU.

**Vĩ mô** (`markets/macro-cache.ts`) - một lần đọc vĩ mô đã trộn cho mỗi khu vực và mỗi ngày, dùng chung cho mọi thị trường chấm điểm dựa trên nó (vàng đọc từ nhiều năng lực và cổ phiếu VN từ một năng lực khác), tất cả cùng hỏi đúng một câu `(khu vực, ngày)`. Ô nhớ giữ **promise đang chạy**, nên các bên gọi tới cùng lúc dùng chung một lượt fan-out. Có hai mục (hôm nay và ngày kề bên, cho phiên chạy vắt qua nửa đêm). Lần đọc hỏng hoặc bị hủy tự xóa ô của nó, và lần đọc mà có nhà cung cấp không trả lời cũng vậy: lượt đầu tiên trong ngày chạy trước khi các chuỗi của Mỹ được công bố, và chỉ lần đọc đầy đủ mới được trả cho các bên gọi sau.

**Đọc chỉ số** (`kernel/market/index-reading.ts`; `vndirect` phục vụ `indexValuation`, `vndirect-mkw` phục vụ `indexContributors`; thị trường VN công bố cả hai thành năng lực, cờ `hasIndexes` trên `/v1/markets`).

*Định giá* được lưu, không bao giờ đọc trong một request: `refreshIndexValuation` (`markets/equity-vn/refresh/index-valuation.ts`, chạy ở cuối mỗi lượt refresh VN, ngoài các loại bằng chứng, nên một lượt phát lại vẫn thử lại lần đọc đã lỗi; nó báo như một loại riêng `index-ratios`, không lưu thành lần thử, và một lần đọc hay ghi hỏng chỉ đánh dấu chỉ số đó thiếu chứ không làm hỏng cả lượt refresh) hỏi nhà cung cấp nhiều nhất một lần cho mỗi chỉ số và ngày UTC (mốc kiểm tra là thời điểm ghi của điểm P/E; `force` bỏ qua), đọc một cửa sổ gồm bảy mã tỷ lệ từ `fromDay` (lùi năm phiên) và giữ ngày mới nhất có đủ cả hai hệ số.

- Mỗi chỉ số, tỷ lệ và ngày một dòng `series_points`, mã `index-ratio:<INDEX>:<ratio>`, ngày là `reportDate` của nhà cung cấp, từ đó là lịch sử riêng của dịch vụ nền; không có migration.
- `series_points` bị dọn sau `history_days` (mặc định 1095) và không bao giờ dưới `HISTORY_FLOOR_DAYS.macroSeries` (khoảng 500), nên mặc định đủ cho so sánh một và ba năm với lịch sử của chính nó, còn so năm năm cần nâng `history_days` (trung bình năm năm đang hiện là của nhà cung cấp, không điền ngược).
- `createIndexValuation` đọc điểm lưu mới nhất của từng tỷ lệ rồi dựng số đọc; lượt refresh lỗi thì giữ số cũ, và số cũ hơn mười ngày mang `source.stale-cache`.
- ROE là `P/B / P/E`, suy ra.
- Nhà cung cấp không công bố tỷ lệ trên đường trung bình cho VN30, nên cùng lượt đó đếm các mã VN30 đã lưu (`indexTier`) nằm trên đường trung bình 50 và 200 phiên của chính chúng vào ngày của các tỷ lệ (`aboveMeanRatios`, từ dữ liệu giá của mặt cắt) rồi lưu dưới cùng mã chuỗi.

*Mã kéo chỉ số* không bao giờ được lưu: `createIndexContributors` (`markets/equity-vn/tape/index-contributors.ts`) giữ một ô cho mỗi chỉ số (tổng ba).

- Khi phiên đang giao dịch ô có hạn `LIVE_CONTRIBUTORS_TTL_MS`; khi bảng giá đã chốt (`isTapeServing`) thì đọc một lần và giữ đến lần mở cửa kế tiếp, khóa theo ngày đã chốt.
- Các lời gọi cùng lúc dùng chung một lượt đọc đang chạy với hạn riêng, vì lượt đọc không được gắn với người gọi đến trước; đọc lỗi thì trả ô đang giữ kèm `source.stale-cache`, hoặc trả lỗi nếu chưa giữ gì.
- `point` của nguồn bị bỏ dưới `MINIMUM_CONTRIBUTION_POINTS` (0,005, như chính widget của nhà cung cấp), và mỗi phía liệt kê `CONTRIBUTORS_PER_SIDE` mã đầu.

**Cổng vĩ mô** (`sources/macro-gate.ts`) - đứng trước mọi nguồn `macro` có khai `MacroSourceProfile` (`MACRO_SOURCE_PROFILES` trong `source-facts.ts`: `bls`, `fred`, `treasury`, `vndirect`; nguồn từ plugin không khai gì và được đọc như cũ). `gateMacroSource` bọc nguồn lúc đăng ký, nên cả dự phòng (`resolve`) lẫn lần đọc trộn (`resolveAll`) đều đi qua nó. Lần đọc tốt gần nhất được lưu theo từng nguồn và từng chuỗi trong `series_points` dưới khóa `<nguồn>:<chuỗi>` (ngày quan sát, giá trị và thời điểm ghi; không cần migration). Mỗi lần gọi:

1. Đã lưu và ghi trong cùng một ngày UTC, hoặc `cadence` là hằng tháng và quan sát đã lưu đã là kỳ mới nhất mà một bản công bố có thể mô tả vào hôm nay (lùi `lagMonths` tháng, thêm một tháng nữa trước `releaseDay`): trả số liệu đã lưu, `freshness: 'cached'` kèm `fetchedAt` thật, không gọi HTTP.
2. Nếu không thì gọi. Câu trả lời được ghi lại (`replace`); ghi hỏng chỉ được log (`trading.macro_read_unsaved`) và không làm hỏng lần đọc, đọc kho hỏng cũng vậy (`trading.macro_read_unreadable`).
3. Bị từ chối hoặc lỗi thì trả số liệu đã lưu kèm ngày quan sát và không caveat, miễn là quan sát mới nhất còn trong `staleAfterDays`; không có gì đã lưu hoặc đã quá hạn thì lỗi giữ nguyên và caveat của nó được hiển thị.
4. Lời từ chối mang `source.quota-exhausted` được nhớ trong bộ nhớ tới hết ngày UTC: các lần đọc sau trong ngày không gọi HTTP mà trả lời như bước 3, bằng số liệu đã lưu hoặc chính lời từ chối đó. Không ghi thêm gì vào `series_points`.

Profile là toàn bộ phần riêng của từng nguồn: `series`, `cadence` (`daily`, hoặc `monthly` với `releaseDay` và `lagMonths`) và `staleAfterDays`. `bls` khai hằng tháng, ngày công bố 10, trễ 1 tháng, quá hạn sau 120 ngày; `fred` và `treasury` hằng ngày và 10 ngày (một cuối tuần cộng một ngày lễ); `vndirect` hằng ngày và 180 ngày (lãi suất tiền gửi đổi vài lần một năm). Hết lượt gọi trong ngày ở `bls` trả mã riêng `source.quota-exhausted` thay vì `source.rate-limited`.

**Tập công cụ** (`sources/adapters/crypto-universe.ts`) - một lần đọc bảng xếp hạng mỗi giờ làm việc (`UNIVERSE_ROWS_TTL_MS`). Bảng xếp hạng chỉ đổi vài bậc mỗi giờ, và mọi lần đọc giá, tra ký hiệu đều dùng chung một lượt quét. Năm phút từng tốn một danh sách 750 dòng cho mỗi lượt sàng lọc và làm chạm trần không công bố của CoinMarketCap theo từng đợt. Mỗi dòng giữ thời điểm quan sát của riêng nó, nên không gì trông tươi hơn thực tế.

**Lần đọc toàn thị trường** (`sources/adapters/vndirect/market-read.ts`) - một lượt quét refresh hỏi `vndirect` từng mã một trên cùng một cửa sổ, trong khi nhà cung cấp trả cả thị trường cho mỗi truy vấn, nên bên gọi đầu tiên đọc cả cửa sổ và mọi bên gọi sau lấy phần của mình. Ô nhớ duy nhất trượt tới sau mỗi lần trúng (nhàn rỗi 60 giây) và không sống quá năm phút. Một lần đọc hỏng là lỗi của riêng mỗi bên gọi chứ không dự phòng theo từng mã, vì làm vậy sẽ biến một lần nhà cung cấp hỏng thành một yêu cầu cho mỗi mã.

Ngoài các cache, `resolve` cho các yêu cầu giống hệt nhau dưới cùng một tín hiệu dùng chung một lần đọc đang chạy (`sources/coalesce.ts`). Mục đó bị bỏ ngay khi xong, nên không gì được trả lời từ một lần đọc cũ; nó chỉ ngăn các ứng viên danh mục được chấm cùng lúc mỗi bên tải riêng cùng một bảng toàn thị trường.

## Các tính năng giao dịch dùng nguồn thế nào

Không gì ngoài `trading/` đụng tới bộ nối, và gần như không gì bên trong nó đụng tới sổ đăng ký:

```text
CLI / kênh / công cụ agent
  -> tính năng         (features/market-data, brief, suggestion, portfolio, alerts)
    -> năng lực thị trường  (markets/<ref>/..., với tới qua MarketRegistry)
      -> SourceRegistry.resolve | resolveAll
        -> Source.fetch -> SourceHttp -> nhà cung cấp
```

Thị trường nhận sổ đăng ký qua `MarketDeps.sources` (`markets/deps.ts`) và không nhận gì khác chạm được tới mạng. Thị trường không có logger, không có đồng hồ - mọi thời điểm đều đến trong yêu cầu - nhờ vậy năng lực kiểm thử được và kết quả của nó truy ngược được về nguồn.

Các bên giữ sổ đăng ký ngoài một năng lực thị trường, mỗi bên vì một lý do mà thị trường không phục vụ được:

- `runTapeNews` (`features/market-data/context.ts`): dòng tin vĩ mô định giá mọi thị trường và không thuộc về thị trường nào.
- `createFxRates` (`features/market-data/reads/fx.ts`): khâu định giá và cuốn sổ đều quy đổi tiền tệ và không bên nào được giữ sổ đăng ký, nên chỗ nối là `FxRates.convert`. Hãy sao chép mẫu này khi một tính năng không thuộc thị trường cần đọc nhà cung cấp: một interface phía bên dùng nêu tên thao tác, không phải sổ đăng ký.
- Việc trích xuất vĩ mô (`features/market-data/macro-extract/tick.ts`): đọc `statReports`, một loại không thuộc thị trường nào.
- Tính năng chủ đề (`features/themes/evidence/`, `features/themes/chain/`): đọc `commodityPrices` và `valuationRatios` qua một góc nhìn `Pick<SourceRegistry, 'resolve'>`.
- Composition: dựng nó, bọc nó để mọi lần đọc `news` đều được lưu trữ (`wiring/composition/news-archive.ts`), và dựng `macroCache` trên nó.

### Năng lực là hợp đồng hướng tới tính năng

`MarketCapabilities` (`markets/types.ts`) là một bản đồ một phần trên `MarketCapabilityMap`: `quote`, `bars`, `overview`, `events`, `news`, `screen`, `sectors`, `sentiment`, `funding`, `recommendations`, `accounts`, `flows`, `tradeSides`, `statistics`, `macroRisk`, `basis`, `brief`, `refresh`, `staleKinds`. Một tính năng đọc năng lực mà thị trường không công bố sẽ nhận `market-data.kind-unsupported` chứ không phải một phương thức ném lỗi. Phần lớn kết quả là `SourceResult<T>`, nên caveat và xuất xứ đi từ bộ nối tới dòng hiển thị mà không cần từ vựng thứ hai; năng lực thêm đơn vị giá, tiền tệ, trạng thái phiên và ngày `asOf`.

### Một lần đọc đi qua thị trường nào

Không quy tắc nào dựa trên thứ tự đăng ký:

| Bên gọi đưa | Cách xác định | Chủ sở hữu |
|---|---|---|
| một ticker trần | `resolveInstrument` định danh nó qua sổ đăng ký; tên không rõ hoặc mơ hồ thành `market.ticker-unknown` / `market.ticker-ambiguous`, không bao giờ rơi về một thị trường dự phòng | `features/market-data/resolve.ts` |
| một mã thị trường | `requireMarket`, ném lỗi nêu mọi mã đã đăng ký | `features/market-data/market-data-run.ts` |
| không gì, ở lệnh gắn với thị trường | chủ của `[locale] region`: `markets.regionOwner(config.defaultRegion)` | `markets/registry.ts` |
| một khu vực, cho lần đọc theo khu vực | `markets.regionOwner(region)`, có năng lực vĩ mô công bố chỉ số tổng hợp của khu vực | `markets/registry.ts` |
| một khu vực, cho lần đọc mà mọi thị trường trong đó cùng đóng góp | mọi thị trường trong khu vực có công bố năng lực đó, gộp lại (tin tức chọn lọc) | `features/market-data/context.ts` |

Một khu vực có thể có nhiều thị trường (`vn` có vàng trong nước và cổ phiếu VN), nên lấy cái đầu tiên sẽ làm câu trả lời phụ thuộc thứ tự đăng ký: `/overview` sẽ hiện vĩ mô chỉ-toàn-cầu của vàng trong nước dưới tiêu đề VN trong khi `/brief`, `/rebalance` và `/suggest` chặn theo bản đã điều chỉnh cho VN, vốn chỉ hạ dải xuống. Mặc định theo chủ khu vực là lý do `/screen`, `/price` và `/suggest` nhận thị trường làm từ cuối tùy chọn. `ownsRegion` được kiểm lúc khởi động: một khu vực không có chủ hoặc có hai chủ là `ConfigError`. Một khu vực mà chủ của nó không công bố lịch thì không đóng góp gì và thị trường vẫn bắt buộc.

### Hai hình dạng đọc: trực tiếp, và bằng chứng đã lưu

**Đọc trực tiếp** gọi nhà cung cấp ở mỗi lần, khi con số chính là câu trả lời và cũ là thất bại: `quote`, `tradeSides`, `news`, `sentiment`, `funding`, `fx`, `goldBoard`, `sessionQuotes`. Chúng mang SLA của quote khi có người đang chờ.

**Bằng chứng đã lưu** đi qua một lượt quét refresh. Năng lực `refresh` của một thị trường phân giải các loại của nó từ sổ đăng ký, kiểm toàn bộ phạm vi rồi ghi vào `MarketDataStore`; các tính năng đọc từ kho. Các loại được quét là `REFRESH_DATA_KINDS` (`kernel/market/refresh.ts`): `instruments`, `bars`, `fundamentals`, `flows`, `macro`, `accounts`, `premium`, `index-ratios`. `foreignRoom` và `indexMembership` được phân giải trong lượt refresh tập công cụ, vì chúng chỉ có nghĩa khi gắn với tập niêm yết đang được thay. Một lượt sàng lọc không thể phát một yêu cầu trực tiếp cho mỗi mã, và bằng chứng phải ổn định suốt một phiên.

- **Xuất xứ được lưu cùng dòng.** Một `BarRecord` mang `sourceId` và `fetchedAt` của lần tải ra nó, nên một đề xuất nêu tên nhà cung cấp đã công bố cây nến mới nhất của nó, không phải bên đang được định tuyến hôm nay. Một dấu cho mỗi yếu tố, không phải mỗi cây nến.
- **Thay phạm vi là nguyên tử.** `replaceInstruments` thay cả tập công cụ của một thị trường hoặc không thay gì; một lần ghi dở sẽ hủy niêm yết mọi mã mà nhà cung cấp bỏ sót.
- **Một phản hồi bị từ chối là một đích bị từ chối, không phải kết quả rỗng.** Đường bằng chứng biến một dòng thiếu hoặc không được chấp nhận thành một lần từ chối theo từng công cụ, mang caveat.
- **Thời gian lưu giữ được suy ra.** `MarketManifest.evidenceSessions` nói các yếu tố của một thị trường đọc bao nhiêu lịch sử và lượt dọn lưu giữ tự định cỡ theo cái lớn nhất.
- **`staleKinds` quyết định refresh tải lại gì**, vì chỉ thị trường biết nhịp của từng loại (danh sách niêm yết hằng tuần, dữ liệu cơ bản vài phiên một lần). Một lần thử đã lưu phải qua một phép kiểm trước: ngày mà nó tuyên bố phải đã settle vào lúc nó được ghi, nếu không một phiên chạy trong khoảng settle sẽ ghim loại đó vào một bảng giá còn đang hình thành.
- **Các loại chạy theo chặng.** `equity-vn` chạy `bars`, `fundamentals` và `flows` cùng lúc, rồi `macro`, rồi `accounts`: hai loại sau đọc cross-section mà ba loại đầu vừa ghi lại. Một chặng chờ mọi loại trong nó xong rồi mới sang chặng kế, nên một loại ném lỗi không bao giờ để loại bên cạnh còn ghi sau khi lượt refresh đã hỏng. Mỗi kết quả loại mang `elapsedMs`, được ghi trong `trading.market_data_refreshed`.

Crypto là ngoại lệ: `markets/crypto/screen-run.ts` xếp hạng thẳng từ các lần đọc `marketCap` và `bars` mà không có kho nào, vì tập công cụ của nó là một yêu cầu xếp hạng duy nhất chứ không phải một bảng được quét.

### Fan-out bị chặn ở tầng tính năng, không ở tầng kênh truyền

Bộ điều nhịp chặn số yêu cầu mỗi nhà cung cấp mỗi phút, không chặn số mà một tính năng khởi động:

| Chặn | Giá trị | Ở đâu |
|---|---|---|
| mục bảng giá / song song | 12 / 4 | `SURFACE_LIMITS.maximumQuoteBoardItems` (`trading/surface-limits.ts`), `reads/quote-board.ts` |
| song song quote của sàng lọc | 4 | `features/market-data/market-data.ts` |
| song song thống kê | 5 | `reads/statistics.ts` |
| song song đánh giá cảnh báo | 4 | `features/alerts/alerts.ts` |
| song song ứng viên / định giá | 5 | `features/portfolio/candidates.ts`, `folds/valuation.ts` |
| song song lô đề xuất | 5 | `wiring/config-defaults.ts` |
| song song nguồn bằng chứng VN / bằng chứng yếu tố VN | 5 / 8 | `markets/equity-vn/policy.ts`, `markets/equity-vn/factors/factors.ts` |
| song song nguồn crypto | 10 | `markets/crypto/policy.ts` (`screen-run.ts` và lượt quét nến) |
| mã lịch / song song | 40 / 5 | `SURFACE_LIMITS` |
| ứng viên sàng lọc / mục tin | 50 / 50 | `SURFACE_LIMITS.maximumScreenCandidates`, `.maximumNewsItems` |

**Một giới hạn không phải là một bảng xếp hạng**: mã bị cắt bởi một giới hạn được giải thích bằng `market-data.universe-truncated`, không lặng lẽ biến mất (nhịp danh sách theo dõi là ví dụ làm việc, ở [Giao dịch](../giao-dich.md#nhịp-thị-trường-đọc-trực-tiếp-mười-hai-mã-một-lượt)). Và **chi phí của bộ điều nhịp trả theo từng nhà cung cấp, không theo từng thị trường**, nên một lượt sàng lọc crypto tự chặn số yêu cầu đang bay: một lượt không chặn sẽ bóp nghẹt một đề xuất chạy cùng lúc về token của chính nhà cung cấp đó.

### Một tính năng làm gì với một lần hỏng

Tính năng không bao giờ biến một `SourceResult` thành ngoại lệ.

- **`unavailable` hiển thị thành một phần vắng mặt** nêu lý do và các mã đã thử. Mục `etf-flows` của bản tin báo `unavailable` là hành vi được thiết kế cho một loại chưa định tuyến.
- **Caveat tích lũy lên trên** và khử trùng một lần cho mỗi thông điệp: các phần sẵn sàng gom caveat vào một danh sách, một phần *hỏng* thì tự nêu caveat của mình.
- **Một lần đọc cố-gắng-hết-sức truyền caveat đi thay vì sụp thành vắng mặt**, để sự cố không bị đọc thành phiên đóng cửa. Khối độ rộng trong phiên của VN trả `{ breadth?, caveats }` và overview nối các caveat đó.
- **Một giá trị không hữu hạn hoặc thiếu thành caveat, không bao giờ thành dòng số 0.**
- **Quy trình suy giảm chứ không đoán**: [Giao dịch](../giao-dich.md#quy-trình-đề-xuất).

Agent gọi một công cụ, công cụ gọi một tính năng, tính năng đọc kho hoặc một năng lực. Các công cụ dữ liệu thị trường tự mô tả là trả lời từ "our own sources" hoặc kho hồ sơ của chúng ta: một con số agent trích dẫn đã đi qua một bộ nối, một schema và một dấu xuất xứ.

## Các bất biến về bảo mật

- **Host được ghim.** Bộ nối nêu một đường dẫn tương đối theo nhà cung cấp; origin đến từ danh sách endpoint đã được kiểm lúc khởi động. Một `SourceRequest` không diễn đạt được một URL tuyệt đối.
- **Feed nằm trong danh sách cho phép.** `feedId` chọn từ `RSS_FEEDS` do mã sở hữu; `path` và `query` bị bỏ qua trên đường đó, và một feed ngoài bản đồ không bao giờ được tải.
- **Bí mật chỉ nằm trong yêu cầu đi ra.** Không bao giờ trong xuất xứ, bản tóm tắt, dòng log hay tệp cấu hình. `formatErrForLog` làm sạch những gì được ghi log.
- **POST là đọc.** `jsonBody` có cho nhà cung cấp không có tương đương GET, và chỉ cho việc đọc: chính sách thử lại phát lại yêu cầu, nên một thân yêu cầu làm thay đổi gì đó cũng sẽ bị phát lại.
- **Thân phản hồi bị chặn** ở 2 MiB, và thân không phải 2xx bị lớp HTTP lõi bỏ đi, vì thế chỉ một **mã trạng thái** có trong tài liệu nhà cung cấp mới đánh dấu được một lần trượt nghiệp vụ.
- **Văn bản tải về được làm sạch** trước khi tới agent: `normalization.ts` chạy phép quét prompt-injection và phát `source.content-sanitized` thay vì để markup đi qua.

## Nguồn từ plugin

Plugin thêm nhà cung cấp bằng cách đặt `sources.ts` ở gốc. Chỉ cần tệp có mặt là đủ, giống `agents/`, `workflows/` và `skills/`; không có mục manifest nào, và module tự export các dữ kiện của nó. Phía người dùng: [Mở rộng](mo-rong.md#plugin).

```ts
export const manifest = {
  id: 'acme',
  endpoint: 'https://api.acme.com/v1',
  rateLimitPerMinute: 60,
  credentialEnv: 'ACME_API_KEY',
  routes: [{ kind: 'bars', scope: 'equity-vn' }],
}

export function createSources(kit) {
  return [kit.define({ kind: 'bars', covers, request, parse })]
}
```

- **Module không import gì cả.** Tệp của người dùng không phân giải được các specifier runtime bên trong binary đã biên dịch, nên bộ công cụ được truyền vào dưới dạng tham số: `kit.define` là `createSource` với mã của module và kênh truyền đã **ghim** sẵn, `kit.ok` là `parsedSource`. Plugin không thể nhận mã của nhà cung cấp khác, cũng không với tới host khác qua client dùng chung: mọi yêu cầu đều được kiểm với origin trong manifest, và `feedId` bị từ chối thẳng (`sources/plugin-module.ts`).
- **Chỉ đặc tả yêu cầu.** `kit.define` từ chối đặc tả nạp.
- **Cần `plugins.allow_code = true`**, tách biệt với `allow_untrusted`. Chạy mã của plugin là cấp cho nó mọi thứ tiến trình làm được; endpoint đã khai chỉ ràng buộc plugin trung thực, không ràng buộc plugin có ý xấu. `allow_code` là ranh giới của sự đồng ý.
- **Plugin không bao giờ được thử trước.** Các tuyến đã trộn đặt mọi mã first-party trước mọi mã plugin trong cùng phạm vi. Plugin được mở một phạm vi chưa nguồn có sẵn nào phục vụ, hoặc đứng sau phạm vi đã có. Mã đã thuộc một nguồn có sẵn, hoặc bị hai plugin cùng nhận, thì bị bỏ.
- **Lỗi được khoanh lại.** Module không đọc được, import ném lỗi, import quá 5 giây (`IMPORT_TIMEOUT_MS`), manifest sai, mã trùng, hay loại đã khai mà các tuyến của nó không phủ - đều ghi log `trading.plugin_source_skipped` và bỏ plugin đó. Hệ thống vẫn khởi động tiếp. Các module được import **tuần tự**, vì một module chạy ngay khi import và không nên chạy vài module lạ cùng lúc khi khởi động.

## Thêm một nguồn first-party

1. Viết `sources/adapters/<provider>.ts` export ra `<PROVIDER>_DEFAULT_ENDPOINT` và `create<Provider>Sources(options: SourceAdapterOptions): readonly RegisteredSource[]`, một lời gọi `createSource` cho mỗi loại.
2. Thêm endpoint vào `SOURCE_ENDPOINTS`, một tốc độ vào `SOURCE_RATE_LIMITS` (composition từ chối một mã đã định tuyến mà thiếu nó), và một tên biến kèm dòng catalog `adds` vào `SOURCE_CREDENTIALS` nếu nó cần khóa.
3. Thêm factory đó vào `createBuiltInSources` (`composition/source-facts.ts`) bằng spread.
4. Cho mỗi cặp `(kind, id)` một vị trí trong `SOURCE_ROUTES`. Khâu đăng ký ném lỗi nếu thiếu.
5. Nếu nó đưa vào một mã caveat mới, thêm nó vào `kernel/caveat.ts` kèm mức nghiêm trọng, và thêm câu chữ của nó vào **cả** `en.json` lẫn `vi.json`.

## Đã cân nhắc và đã loại

- **Định tuyến nguồn theo kiểu khai báo trong `plugin.toml`.** Một tuyến khẳng định rằng bộ nối gọi được đúng các công cụ trong một thị trường - năng lực mà chỉ mã của nó mới có. Tuyến thiếu phần ánh xạ ký hiệu sẽ tải nhầm công cụ và lưu thành bằng chứng mà không báo gì.
- **Nguồn tùy chỉnh do operator khai kèm một bản ánh xạ trường.** `Candle.at` là một ngày giao dịch trong khi phần lớn nhà cung cấp trả về epoch ms, nên bất kỳ nhà cung cấp thật nào cũng cần một phép quy đổi; thêm các phép quy đổi vào cấu hình là viết một ngôn ngữ bằng TOML.
- **Thư mục nguồn theo từng thị trường.** Các nguồn thật sự dùng chung - `vndirect` phục vụ cổ phiếu VN và vĩ mô VN, `yahoo` phục vụ vàng và FX - nên không thị trường nào sở hữu chúng.
- **Xếp hạng nhà cung cấp theo độ mới của lần thành công.** Xem [Sức khỏe chỉ hạ bậc, không bao giờ nâng bậc](#sức-khỏe-chỉ-hạ-bậc-không-bao-giờ-nâng-bậc).

## Bản đồ mã nguồn

- Hợp đồng: [kernel/source/source-result.ts](../../src/trading/kernel/source/source-result.ts), [kernel/caveat.ts](../../src/trading/kernel/caveat.ts)
- Tuyến và sổ đăng ký: [sources/routes.ts](../../src/trading/sources/routes.ts), [sources/registry.ts](../../src/trading/sources/registry.ts)
- Factory bộ nối: [sources/define.ts](../../src/trading/sources/define.ts), [sources/adapters/](../../src/trading/sources/adapters/), [sources/rows/](../../src/trading/sources/rows/)
- Kênh truyền: [sources/transport/http.ts](../../src/trading/sources/transport/http.ts), [pacer.ts](../../src/trading/sources/transport/pacer.ts), [health.ts](../../src/trading/sources/transport/health.ts), [http-failure.ts](../../src/trading/sources/transport/http-failure.ts)
- Cache: [sources/settled-bars.ts](../../src/trading/sources/settled-bars.ts), [sources/coalesce.ts](../../src/trading/sources/coalesce.ts), [markets/macro-cache.ts](../../src/trading/markets/macro-cache.ts)
- Composition và dữ kiện: [wiring/composition/source-facts.ts](../../src/trading/wiring/composition/source-facts.ts), [wiring/composition/source-registry.ts](../../src/trading/wiring/composition/source-registry.ts)
- Nguồn từ plugin: [sources/plugin-module.ts](../../src/trading/sources/plugin-module.ts)
- Quy tắc độ mới: [markets/calendar.ts](../../src/trading/markets/calendar.ts), [markets/live-reading.ts](../../src/trading/markets/live-reading.ts), [markets/stored-quote.ts](../../src/trading/markets/stored-quote.ts)
- Trích xuất vĩ mô: [features/market-data/macro-extract/](../../src/trading/features/market-data/macro-extract/)
- Hiển thị `/sources`: [features/market-data/render/sources.ts](../../src/trading/features/market-data/render/sources.ts)
