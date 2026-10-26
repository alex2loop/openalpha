# Nguồn dữ liệu

Số liệu thị trường của OpenAlpha đến từ đâu, ai trả lời khi một nhà cung cấp gặp sự cố, và vài thứ bạn có thể cần cài đặt.

Tóm tắt: mọi nhà cung cấp đều bật sẵn, bạn không cần bật gì hay trỏ tới địa chỉ nào, và hai nhà cung cấp nhận một khóa tùy chọn. Cùng chủ đề nhưng nhìn từ phía giao dịch: [Giao dịch](giao-dich.md#dữ-liệu-thị-trường-và-đề-xuất).

## Bạn cần làm gì

Không cần làm gì để bắt đầu. Hai nhà cung cấp nhận một khóa mà bạn có thể thêm sau:

| Nhà cung cấp | Biến | Nếu không có |
|---|---|---|
| `coingecko` | `COINGECKO_API_KEY` | Mất bên dự phòng cuối cho bảng vốn hóa crypto, và mất luôn cách tra riêng một coin nằm ngoài mọi bảng. Nó cũng không còn trong danh sách FX cho một coin thanh toán so với tiền pháp định. |
| `fred` | `FRED_API_KEY` | Bạn mất các chuỗi chỉ FRED công bố. Vĩ mô Mỹ vẫn đọc được từ `treasury` và `bls`, hai bên không cần khóa. |

Lưu khóa bằng `openalpha key set <TÊN>` (hoặc ở Cài đặt > Công cụ trên trang văn phòng) rồi khởi động lại daemon, hoặc đặt biến trong shell hay môi trường; đừng bao giờ ghi khóa vào tệp cấu hình. `openalpha key list` cho thấy cả hai biến và biến nào đã đặt. OpenAlpha cũng đọc cùng tên đó với tiền tố sản phẩm (`OPENALPHA_FRED_API_KEY`). Biến đã đặt nhưng để trống thì coi như chưa đặt. Muốn dùng tên biến khác thì đổi tên trong `config.toml`:

```toml
[trading.sources]
coingecko = "OPENALPHA_COINGECKO_API_KEY"
```

Khóa là mã nhà cung cấp, giá trị là tên biến, không bao giờ là bí mật. Ghi tên một nhà cung cấp không nhận khóa là lỗi lúc khởi động. Chỉ câu lệnh hoặc sửa tệp mới đổi được tên biến; trang văn phòng thì không.

Nhà cung cấp thiếu khóa đơn giản là không được dùng, và dữ liệu của nó chuyển sang nhà cung cấp kế tiếp. Lúc khởi động, OpenAlpha ghi một cảnh báo `trading.source.skipped` nêu tên từng nhà cung cấp bị bỏ qua và biến nó cần. Muốn kiểm tra mà không khởi động gì:

```bash
openalpha doctor sources
```

Lệnh in `mọi nguồn dữ liệu đều đã có thông tin xác thực cần thiết`, hoặc mỗi nhà cung cấp tùy chọn chưa đặt biến một dòng `i`, nêu tên biến và khóa đó sẽ thêm được gì. Chạy không khóa là chế độ hạn chế được hỗ trợ.

Endpoint và URL feed nằm cố định trong mã. Không cài đặt nào chuyển hướng một yêu cầu sang host khác.

## Định tuyến

Với mỗi loại dữ liệu và mỗi thị trường có một danh sách nhà cung cấp theo thứ tự. OpenAlpha hỏi bên đầu tiên; nếu bên đó hỏng hoặc không có gì cho mã đó thì hỏi bên kế tiếp. Câu trả lời dùng được đầu tiên thắng, và mỗi con số đều mang theo nhà cung cấp mà nó đến từ.

Có hai ngoại lệ:

- **Đọc trộn.** Vĩ mô Mỹ, các bảng vàng Việt Nam và danh sách giám sát của sàn hỏi mọi nhà cung cấp rồi gộp câu trả lời, vì không bên nào có đủ hết. Khi hai bên cùng công bố một mục, thứ tự trong danh sách quyết định bên nào thắng. Vĩ mô Mỹ xếp `treasury` và `bls` lên đầu, nên bản cài không có khóa vẫn đọc được vĩ mô.
- **Đọc chia việc.** Với tin tức, một nhà cung cấp lo tin riêng của một mã, một nhà khác lo lần đọc toàn thị trường. Hai bên chia việc, không dự phòng cho nhau.

Nhà cung cấp có lần gọi gần nhất bị hỏng, hoặc đang tạm dừng (xem [Khi một nhà cung cấp hỏng](#khi-một-nhà-cung-cấp-hỏng)), bị đẩy xuống sau các bên khỏe. Không ai được đẩy lên vì mới trả lời gần đây.

### Ai trả lời cái gì

| Dữ liệu | Nhà cung cấp, theo thứ tự |
|---|---|
| **Cổ phiếu VN** | |
| Giá trực tiếp | `vndirect`, `vietcap-chart`, `entrade` |
| Lịch sử theo ngày | `vndirect`, `entrade`, `vietcap-chart`, `vps` |
| Danh sách mã; dữ liệu cơ bản, sự kiện, dòng tiền, khuyến nghị của giới môi giới, tỷ lệ định giá | `vndirect` |
| Bảng giá trực tiếp và room ngoại | `vndirect`, `vietcap-board` |
| Báo cáo tài chính (năm đầy đủ và các quý) | `vietcap-statements` |
| Dòng tiền tự doanh | `cafef` |
| Lưu chuyển tiền tệ còn thiếu của một quý | `cafef-statements` |
| Phía mua và bán của các giao dịch trong ngày | `kbsec`, `vietcap` |
| Danh sách giám sát của sàn (trộn) | `hsx`, `ssi` |
| Thành phần rổ chỉ số (`vn30`, `vn100`) | `vietcap` |
| Tin tức | `vndirect`, `rss` |
| **Việt Nam, toàn khu vực** | |
| Chuỗi vĩ mô | `vndirect` |
| Lãi suất điều hành và liên ngân hàng | `sbv` |
| Báo cáo hằng tháng của cơ quan thống kê | `nso` |
| **Crypto** | |
| Giá trực tiếp | `binance`, `okx`, `mexc` (sàn mặc định của `crypto` đứng đầu) |
| Lịch sử theo ngày | `binance`, `bybit`, `mexc`, `yahoo` |
| Bảng vốn hóa xếp hạng | `coinmarketcap`, `coinpaprika`, `coinlore`, `coingecko` |
| Tâm lý thị trường | `alternative-me` |
| Funding | `binance-futures` |
| Tin tức | `google-news`, `rss` |
| **Vàng (thế giới)** | |
| Giá trực tiếp và lịch sử | `yahoo`, `binance` |
| Positioning hợp đồng tương lai (CFTC, hằng tuần) | `cftc` |
| Tin tức | `rss` |
| **Vàng (Việt Nam)** | |
| Bảng vàng trong nước (trộn) | `giavang`, `pnj` |
| Lịch sử bảng giá | `giavang` |
| Tin tức | `rss` |
| **Không gắn với một thị trường** | |
| Vĩ mô Mỹ (trộn) | `treasury`, `bls`, `fred` |
| Tỷ giá FX | `coinbase`, `okx`, `coingecko`, `yahoo`, `er-api` |
| Lịch sử FX | `yahoo` |
| Giá hàng hóa | `vndirect`, `fred-csv` |
| Tin tức cho dòng tin vĩ mô | `rss` |

Vài nguồn ít hiển nhiên làm gì:

- `vndirect` đứng đầu giá VN vì dòng giá của nó được ghi ngay khi thị trường đang giao dịch. Nó không phục vụ chỉ số: giá chỉ số đi tới `vietcap-chart`, còn lịch sử chỉ số đi tới `entrade` rồi `vietcap-chart`. `vps` đứng cuối, có mặt cho các chỉ số chuẩn ETF (VNDIAMOND, VNX50...) mà cả `vndirect` lẫn `entrade` đều không phục vụ, để một lần bị từ chối không làm mất tất cả.
- `vietcap-board` đọc cả bảng giá VN trong một lần gọi và dự phòng cho `vndirect` ở cả bảng giá trực tiếp lẫn room ngoại.
- `cafef-statements` không phải bên dự phòng cho `vietcap-statements`. Nó chỉ được hỏi cho quý mới nhất khi `vietcap-statements` đã có bảng cân đối và kết quả kinh doanh nhưng chưa có lưu chuyển tiền tệ, và số của nó chỉ được giữ khi lợi nhuận trước thuế lũy kế khớp với các quý đã có. `vietcap-statements` thay chúng ngay ngày nó có lưu chuyển tiền tệ.
- `cafef` không phải bên dự phòng cho dòng tiền của `vndirect`. Nó chỉ công bố khối tự doanh, sớm hơn hai phiên, và chỉ được hỏi cho những phiên còn thiếu phần đó.
- `fred-csv` mang các chuỗi hàng hóa hằng tháng mà không feed hằng ngày nào có (than, gạo, thịt lợn, thép). `vndirect` mang các chuỗi hằng ngày. Hai bên không bao giờ tranh nhau một mặt hàng.
- `coinbase` và `okx` định giá một coin thanh toán (như USDT) so với tiền pháp định. Không có đường dự phòng từ `USDTVND` sang `USDVND`: USDT là một công cụ khác, và tỷ giá thiếu được báo chứ không đoán.
- Giá crypto đặt sàn mặc định của `crypto` lên đầu (`default_for` trong `[trading.venues.<id>]`, mặc định `binance`) khi sàn đó cũng là nhà cung cấp dữ liệu. Một kế hoạch định giá ở nơi khác sẽ báo một con số mà bạn không khớp lệnh được.
- `mexc` dự phòng cho `binance` ở giá và đứng thứ ba ở lịch sử. Nó niêm yết những coin các sàn lớn không có, nhưng khối lượng ở đuôi dài là kém đáng tin nhất, nên nó chỉ trả lời cho mã mà các sàn lớn từ chối.
- `okx` không niêm yết mọi coin; coin nó thiếu bị bỏ qua mà không tính là một lần hỏng.
- `coingecko` phục vụ bảng vốn hóa và một tỷ giá FX, không phục vụ đường giá, vì vòng cảnh báo đọc giá của mọi coin đang theo dõi ở mỗi nhịp, và một nhà cung cấp tính hạn mức theo tháng sẽ tiêu hết hạn mức vào đó.

Có một loại được khai nhưng chưa có nhà cung cấp: dòng tiền ròng của ETF spot crypto. Mục `etf-flows` của bản tin báo `unavailable`. Đó là điều bình thường, không phải sự cố.

### Đọc các nguồn Việt Nam

Các nguồn scrape Việt Nam và các bảng vàng khá mong manh, và việc chúng bật mặc định không thay đổi điều đó:

- `vndirect`, `entrade` và `vietcap` đọc các endpoint nội bộ của công ty chứng khoán, không tài liệu, không cam kết dịch vụ.
- `cafef` đọc chính handler của một trang tiêu dùng, và công bố các dòng mà giá trị với khối lượng tự mâu thuẫn nhau. Những dòng đó bị bỏ.
- `pnj` đọc endpoint của chính cửa hàng.
- `giavang` là API cộng đồng do một người vận hành.

Chúng vẫn được đăng ký. Khi một nguồn không trả lời, bạn nhận một *unavailable* có ghi rõ nguồn, hữu ích hơn một bản cài lặng lẽ không phủ gì.

`nso` đôi khi không với tới được từ nước ngoài. Không sao: việc `trading.macro-extract` của daemon thử lại ở nhịp kế tiếp, và một báo cáo hằng tháng nằm trên mạng nhiều tuần. Việc này đọc các báo cáo của cơ quan thống kê (cùng các tiêu đề về PMI và đầu tư công của Việt Nam) bằng một model trong `[[model_tiers.extraction]]`, nếu không có thì dùng `[[models]]`. Nó chỉ giữ một con số nếu trích dẫn của nó xuất hiện nguyên văn trong nguồn và con số có trong trích dẫn.

Positioning của CFTC là hằng tuần và có độ trễ, và báo cáo nói rõ điều đó. Nó mang ngày thứ Ba mà các vị thế được giữ, và được công bố vào thứ Sáu sau đó. Một con số mang ngày thứ Ba tuần trước là báo cáo đang nói thật về độ trễ của chính nó, không phải số đọc cũ.

## Khi một nhà cung cấp hỏng

Bạn sẽ thấy điều này ở ba nơi.

**Trên câu trả lời.** Khi một nhà cung cấp sau trả lời được, lần đọc mang một dòng kiểu "`{source}` không trả lời cho lượt đọc này nên số liệu lấy từ `{fallback}`". Khi mọi nhà cung cấp đều hỏng: "Đã thử hết các nguồn cho `{kind}` nhưng không nguồn nào trả về dữ liệu dùng được", và phần đó hiện là vắng mặt kèm lý do, không được lấp bằng một phỏng đoán. Nhà cung cấp tìm rồi mà không thấy gì (một mã bị tạm ngừng, một mã vốn hóa nhỏ không có dòng tiền ngoại) không phải sự cố và không được báo như sự cố.

**Trong `/sources`.** Lệnh chỉ liệt kê các nhà cung cấp đang tạm dừng hoặc có lần gọi gần nhất bị hỏng, mỗi bên một dòng, hoặc một dòng duy nhất khi mọi thứ bình thường. Mỗi dòng cho biết nhà cung cấp và loại dữ liệu, `đang tạm dừng cho tới lần thử lại`, lỗi gần nhất và lần phản hồi gần nhất. Lỗi gần nhất là một trong các câu sau:

| Thông báo | Chuyện gì đã xảy ra |
|---|---|
| `quá lâu không phản hồi` | yêu cầu hết giờ |
| `bị chặn vì gọi quá nhiều` | nhà cung cấp trả mã 429 |
| `không kết nối được` | mọi lỗi HTTP khác |
| `trả về dữ liệu không đọc được` | phản hồi không phải thứ nhà cung cấp thường gửi |

Danh sách này là bộ nhớ của chính tiến trình đó. Một lần gọi dòng lệnh mới sẽ báo `chưa gọi nguồn nào kể từ lúc tiến trình này khởi động - hãy chạy một lệnh đọc dữ liệu trong cùng phiên rồi hỏi lại` thay vì tự nhận mọi thứ đều khỏe.

**Trong thời gian tạm dừng.** Sau nhiều lần hỏng, một nhà cung cấp bị bỏ qua 5 phút (xem [Giới hạn](#giới-hạn)) rồi được thử lại.

Một lần phân tích thất bại ở một loại dữ liệu (nhà cung cấp đổi định dạng) chỉ được báo cho loại đó. Nó không làm tạm dừng các loại khác của nhà cung cấp.

## Chỉ giá còn mới

Một nhà cung cấp ngừng cập nhật thì không báo lỗi. Nó vẫn trả về một cây nến từ vài giờ trước nhưng mang ngày hôm nay. Vì vậy một mức giá chỉ được tính là trực tiếp khi cả hai điều sau đúng:

- nó thuộc một phiên mới hơn giá đóng cửa đã chốt gần nhất, và
- nó không quá 90 phút tuổi: 30 phút để giá đóng cửa được in ra, cộng tối đa 60 phút cho một bảng giá im (giờ nghỉ một tiếng của kim loại trên CME). Trong giờ nghỉ trưa của thị trường Việt Nam, giá cuối trước giờ nghỉ đại diện cho cả giờ nghỉ.

Một mức giá trượt một trong hai phép kiểm không phải lỗi. OpenAlpha hiện giá đóng cửa đã chốt gần nhất mà nó đang giữ và nói rõ: "`{ticker}` chưa khớp giá nào mới hơn giá đóng cửa phiên gần nhất, nên bảng hiển thị giá đóng cửa đó thay vì giá trực tiếp." Nó chỉ từ chối với mã mà nó hoàn toàn không có giá đóng cửa đã lưu.

## Giới hạn

Mỗi nhà cung cấp được điều nhịp theo một tốc độ yêu cầu mỗi phút, hoặc là trần gói miễn phí mà họ công bố, hoặc - khi họ không công bố - tốc độ mà một lượt quét toàn tập chịu được. Nhịp được áp trước mỗi lời gọi, nên một danh sách theo dõi rộng không làm chạm giới hạn của chính nhà cung cấp. Yêu cầu mỗi phút:

| Tốc độ | Nhà cung cấp |
|---|---|
| 600 | `binance`, `binance-futures`, `bybit`, `okx`, `mexc` |
| 300 | `cafef`, `vndirect` |
| 120 | `fred`, `vietcap-statements` |
| 60 | `cafef-statements`, `coinbase`, `coinlore`, `coinpaprika`, `entrade`, `google-news`, `hsx`, `kbsec`, `rss`, `ssi`, `treasury`, `vietcap`, `yahoo` |
| 30 | `alternative-me`, `coinmarketcap`, `fred-csv`, `giavang`, `pnj`, `vietcap-board`, `vietcap-chart`, `vps` |
| 20 | `bls`, `cftc` |
| 10 | `coingecko`, `er-api`, `nso`, `sbv` |

Ba nhà cung cấp tính hạn mức theo cửa sổ dài hơn mà nhịp theo phút không diễn đạt được: `bls` theo ngày, `er-api` và `coingecko` theo tháng (bộ nối `coingecko` nhắm tới gói Demo 10.000 lời gọi mỗi tháng). Dùng bình thường thì không bên nào gần chạm: `er-api` đứng cuối danh sách FX và `bls` chỉ được hỏi một lần mỗi lượt refresh vĩ mô. `coinmarketcap` không công bố trần cho phần dùng không khóa và trả `1022` khi một người gọi ẩn danh đã dùng hết; nó hồi lại trong vòng một phút sau khi nghỉ, và nhà cung cấp kế tiếp lấp chỗ trống.

OpenAlpha không giữ hạn mức theo ngày hay theo tháng nào của riêng nó cho lời gọi nhà cung cấp, vì các lời gọi đó miễn phí ở những gói mà nó nhắm tới. Trần chi tiêu có cho lời gọi model: [Ngân sách](ngan-sach.md).

Thời gian và kích thước:

- Một yêu cầu có tổng cộng 35 giây, gồm cả chờ đến lượt và các lần thử lại. Mỗi lần thử có 10 giây, tối đa 3 lần, giãn cách tăng dần từ 0,5 giây tới 5 giây.
- Giá (`/price`, nhịp danh sách theo dõi, mỗi nhịp cảnh báo) chỉ có 1 lần thử, 8 giây, nên một nhà cung cấp chết chỉ tốn một lần chờ ngắn trước khi hỏi bên kế tiếp. Các nhà cung cấp vĩ mô Mỹ cũng chỉ có một lần thử mỗi bên, vì lần đọc phải chờ bên chậm nhất.
- Chỉ hết giờ và lỗi tạm thời (408, 425, 500, 502, 503, 504) mới được thử lại. Mã 429 chỉ được thử lại nếu nhà cung cấp nói khi nào quay lại và khoảng chờ đó còn nằm trong phần 35 giây còn lại; nếu không, nó được báo là bị chặn vì gọi quá nhiều và nhà cung cấp bị tạm dừng đúng khoảng thời gian nó yêu cầu.
- Phản hồi trên 2 MiB bị từ chối.
- Một lần đọc phân trang đi theo tối đa 20 trang hoặc 120 giây. Nếu nó dừng khi trang cuối còn đầy, bạn nhận "Đây mới là phần đầu - kết quả thực tế còn nhiều hơn."
- Một nhà cung cấp bị tạm dừng 5 phút sau 3 lần hỏng liên tiếp, một nửa trong 20 lời gọi gần nhất bị hỏng, hoặc một phản hồi cho OpenAlpha biết khi nào quay lại.

Một số lệnh giới hạn lượng đọc: bảng giá hiện tối đa 12 mã một lượt, một lượt sàng lọc xem xét tối đa 50 ứng viên, và một lần đọc tin trả tối đa 50 mục. Mã bị cắt bởi một giới hạn được báo là bị cắt, không bao giờ lặng lẽ biến mất.

## Cache

Có rất ít thứ được cache, và mỗi cái đều có lý do đo được.

- **Các ngày crypto đã chốt.** Lịch sử theo ngày của các ngày trước hôm nay từ `binance`, `bybit` và `mexc` được giữ trong bộ nhớ (tối đa 8.000 mục) và chỉ tải một lần. Cây nến hôm nay đang hình thành không bao giờ được dùng làm bằng chứng, nên một cửa sổ không chấm điểm khác nhau từng phút. Một ngày vừa chốt chỉ tải đúng ngày đó, không tải lại 200 ngày trước. Lịch sử cổ phiếu không bao giờ đi qua đường này, vì giá điều chỉnh bị sửa ngược về quá khứ.
- **Vĩ mô.** Một lần đọc vĩ mô đã trộn cho mỗi khu vực và mỗi ngày, dùng chung cho mọi thị trường chấm điểm dựa trên nó. Lần đọc mà có nhà cung cấp không trả lời thì không được giữ, nên lượt đầu tiên trong ngày (trước khi các chuỗi Mỹ được công bố) không bao giờ thành câu trả lời của cả ngày.
- **Bảng crypto.** Bảng xếp hạng được đọc một lần mỗi giờ và dùng chung cho mọi lần tra giá và ký hiệu.
- **Lần đọc toàn thị trường VN.** Một lượt refresh hỏi `vndirect` từng mã một, nhưng nhà cung cấp trả cả thị trường cho mỗi truy vấn, nên bên gọi đầu tiên đọc cả cửa sổ và những bên sau lấy phần của mình. Nó sống 60 giây khi nhàn rỗi và không bao giờ quá 5 phút.
- **Các yêu cầu giống hệt nhau cùng lúc** dùng chung một lần tải trong lúc chúng còn đang chạy, và không gì được trả lời từ một lần đọc cũ.

Mỗi con số mang theo `live` hoặc `cached` cùng nhà cung cấp của nó. Trực tiếp và đã lưu là hai việc khác nhau: giá, tin tức, tâm lý, funding, FX và bảng giá trực tiếp được đọc mới mỗi lần, còn lịch sử, dữ liệu cơ bản, dòng tiền, vĩ mô và báo cáo tài chính được một lượt refresh tải về, lưu trong cơ sở dữ liệu của bạn và đọc từ đó, để bằng chứng ổn định suốt một phiên. Một lượt refresh thay cả danh sách mã của một thị trường hoặc không thay gì.

## Thời tiết trên trang văn phòng

Trang văn phòng đọc thời tiết hiện tại của thành phố từ Open-Meteo (`api.open-meteo.com`, không cần khóa), ngay từ trình duyệt của bạn. Đó chỉ là cảnh: bầu trời, mưa và ánh sáng trong văn phòng. Không gì lưu nó lại, và không đề xuất, điểm số hay bản tin nào dùng nó làm bằng chứng. Xem [Vận hành](van-hanh.md#con-phố-và-thành-phố).

## Plugin

Plugin có thể thêm một nhà cung cấp. Nó luôn được thử sau các nhà cung cấp có sẵn cho cùng dữ liệu, không bao giờ đứng đầu, và cần `plugins.allow_code = true`. Xem [Mở rộng](dev/mo-rong.md#plugin).

Bên trong: [dev/nguon-du-lieu.md](dev/nguon-du-lieu.md).
