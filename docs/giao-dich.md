# Giao dịch

Cả phần giao dịch nằm trong một trang: một con số đến từ đâu, một đề xuất được dựng từ nó thế nào, cuốn sổ của bạn được tính từ sổ lệnh ra sao, và con đường duy nhất để chạm tới một sàn.

Chỉ đọc một mục thì hãy đọc [Cuốn sổ](#cuốn-sổ). Mọi con số về sau - cỡ lệnh, độ lệch, rủi ro đang mở, bảng thành tích - đều được **tính ra** từ các dòng sổ, không lưu riêng. Một dòng sổ sai thì mọi thứ khác sai theo.

---

**Mục lục**

- [Dữ liệu thị trường và đề xuất](#dữ-liệu-thị-trường-và-đề-xuất)
- [Cuốn sổ](#cuốn-sổ)
- [Đặt lệnh](#đặt-lệnh)

## Dữ liệu thị trường và đề xuất

OpenAlpha thu dữ liệu, tính toán, cho hai phía tranh luận, rồi đưa bạn một kết luận. Và dừng ở đó.

**Mặc định OpenAlpha chỉ gợi ý, và chỉ có đúng một đường để đặt lệnh.** `/trade` và công cụ `order_place` đặt lệnh spot trên một sàn đã đăng ký. Mỗi lệnh:

- phải được bạn duyệt và nằm trong trần;
- đi tới đúng một sàn - nếu có hơn một sàn khớp được thì lệnh bị từ chối, không chọn bừa;
- được ghi vào sổ khi khớp.

Một lệnh vào đã duyệt có thể để lại **một** lệnh chốt lời/cắt lỗ treo ở sàn. Không còn chỗ nào khác gửi được lệnh. Nếu không sàn nào có khóa giao dịch thì `order_place` không được đăng ký, còn `/trade` chỉ nêu tên các khóa cần đặt.

### Những gì xuất xưởng

**Mã thị trường** và **nhóm danh mục** là hai tên khác nhau; chúng chỉ khác nhau ở cổ phiếu VN. Các lệnh nhận mã thị trường.

| Thị trường | Khu vực | Lớp tài sản | Nhóm | Tiền tệ | Giữ ngày giao dịch của khu vực |
|---|---|---|---|---|---|
| `gold` | `global` | vàng | `gold` | USD | có |
| `gold-vn` | `vn` | vàng | `gold-vn` | VND | không |
| `equity-vn` | `vn` | cổ phiếu | `equity-vn` | VND | có |
| `crypto` | `global` | crypto | `crypto` | USDT | không |

Hai thị trường dùng chung khu vực `vn`, nên một trong hai phải định nghĩa "một ngày giao dịch Việt Nam" là gì. Lịch của bản tin và mọi ngày as-of liên thị trường đều dựa vào đó. Cổ phiếu giữ vai này cho `vn`, vàng thế giới giữ cho `global`, còn crypto thì không bao giờ đóng cửa. Khi khởi động, hệ thống từ chối chạy nếu một khu vực không có thị trường nào như vậy, hoặc có tới hai.

### Nguồn dữ liệu

Mọi nguồn đều được đăng ký sẵn. Bạn không cần bật gì hay trỏ tới host nào: endpoint nằm sẵn trong mã. Thứ gì một nguồn không phủ được thì trả về kết quả *unavailable* có ghi rõ tên nguồn.

Một bảng tuyến cố định quyết định nguồn nào phục vụ một phạm vi, theo thứ tự nào. Sức khỏe chỉ **hạ bậc**: nguồn có câu trả lời mới nhất là một lần hỏng, hoặc có cầu dao đang mở, bị đẩy xuống sau các nguồn còn khỏe. Không ai được nâng bậc vì mới trả lời gần đây. Xem [Nguồn dữ liệu](nguon-du-lieu.md).

| Nguồn | Cung cấp | Cần khóa |
|---|---|---|
| `yahoo` | giá và nến vàng, FX tiền pháp định | không |
| `rss` | các feed tin tức, theo khu vực hoặc làm nguồn dự phòng cho mọi phạm vi | không |
| `google-news` | tiêu đề crypto, trước `rss` | không |
| `okx` | giá crypto khi `okx` là sàn mặc định của `crypto` | không |
| `binance` `binance-futures` `alternative-me` | giá và nến crypto; funding, open interest (kèm mức đổi) và tỷ lệ long/short; tâm lý | không |
| `bybit` | nến crypto cho các mã mà spot `binance` không niêm yết | không |
| `mexc` | nến và giá crypto cho các mã mà cả `binance` lẫn `bybit` đều không niêm yết | không |
| `coingecko` | nguồn dự phòng cuối cho bảng crypto; nguồn duy nhất tra một ký hiệu nằm ngoài mọi bảng; tỷ giá mà một coin thanh toán giao dịch so với một tiền pháp định | `COINGECKO_API_KEY` |
| `vndirect` | công cụ VN, nến, dữ liệu cơ bản, sự kiện, dòng tiền, room ngoại, khuyến nghị của giới môi giới, vĩ mô VN, giá hàng hóa hằng ngày, tin tức VN | không |
| `entrade` | giá và nến VN; đứng sau `vietcap-chart` cho giá của một chỉ số, nhưng đứng trước nó ở phần nến (nó chỉ vẽ bốn chỉ số tiêu đề) | không |
| `vietcap` | thành phần rổ chỉ số VN (`vn30`, `vn100`) và trade sides theo từng mã | không |
| `kbsec` | trade sides VN theo từng mã, trước `vietcap` | không |
| `hsx` `ssi` | các mã đang bị giám sát, trộn giữa dịch vụ niêm yết HOSE và một bảng công ty chứng khoán cũng mang HNX | không |
| `vietcap-board` | bảng giá VN trực tiếp trong một lần đọc: giá phiên và room ngoại, đứng sau `vndirect` cho cả hai | không |
| `vietcap-chart` | chỉ số cho mọi index HOSE: chuỗi ngày mà các chuẩn ETF được chấm điểm trên đó, và chuỗi trong phiên đứng sau giá index trực tiếp | không |
| `vps` | chỉ số cho các index chuẩn ETF mà chỉ nó và `vietcap-chart` mang; đứng sau `vietcap-chart`, nguồn có giá trị giao dịch gồm cả nhánh thỏa thuận mà feed này bỏ qua | không |
| `cafef` | dòng tiền tự doanh VN, cho các phiên `vndirect` chưa công bố | không |
| `cafef-statements` | lưu chuyển tiền tệ của một quý VN, cho quý mới nhất mà `vietcap-statements` đã có nhưng chưa có phần này | không |
| `giavang` `pnj` | các bảng vàng trong nước VN, trộn theo đúng thứ tự đó | không |
| `sbv` | lãi suất điều hành VN (tái cấp vốn, tái chiết khấu) và lãi suất liên ngân hàng bình quân, từ trang lãi suất của Ngân hàng Nhà nước | không |
| `nso` | báo cáo kinh tế - xã hội hằng tháng của cơ quan thống kê, đọc bởi việc `trading.macro-extract` | không |
| `fred-csv` | các chuỗi hàng hóa hằng tháng mà không feed hằng ngày nào mang (than, gạo, thịt lợn, thép), đứng sau `vndirect` | không |
| `vietcap-statements` | báo cáo tài chính VN: năm đầy đủ cộng các quý riêng (xem bên dưới) | không |
| `treasury` `bls` `fred` | các chuỗi vĩ mô Mỹ, trộn lại chứ không dự phòng cho nhau | `fred` cần `FRED_API_KEY`; `bls` nhận `BLS_API_KEY` tùy chọn |
| `coinpaprika` | bảng crypto xếp hạng và mức đổi bảy ngày, không khóa, trong một yêu cầu; dự phòng đầu tiên sau `coinmarketcap`; nguồn này đo khối lượng 24 giờ thấp hơn, nên `/screen crypto` báo khi thứ hạng lấy từ nó hoặc từ bất kỳ nguồn dự phòng nào khác | không |
| `coinmarketcap` `coinlore` | bảng crypto xếp hạng mà khâu sàng lọc chọn tập công cụ từ đó, không khóa, trong một yêu cầu; `coinlore` đứng thứ ba | không |
| `coinbase` | giá USD của một coin thanh toán, từ một sàn có giao dịch cặp đó | không |
| `er-api` | FX tiền pháp định, đứng sau `yahoo` | không |
| `cftc` | positioning hợp đồng tương lai vàng: báo cáo Commitments of Traders hằng tuần | không |

Có một loại được khai nhưng **chưa định tuyến**: dòng tiền ròng của ETF spot crypto. Chưa nhà cung cấp nào được kiểm chứng trên phản hồi thật, nên mục `etf-flows` của bản tin báo `unavailable` chứ không hỏng.

**Các nguồn scrape VN và các bảng vàng khá mong manh**, và việc chúng bật mặc định không thay đổi điều đó:

- `vndirect`, `entrade` và `vietcap` đọc các endpoint nội bộ của công ty chứng khoán: không tài liệu, không SLA.
- `cafef` đọc chính AJAX handler của một trang tiêu dùng, và công bố các dòng mà giá trị với khối lượng tự mâu thuẫn nhau; các dòng đó bị bỏ chứ không được ghi.
- `pnj` đọc endpoint của chính cửa hàng.
- `giavang` là API cộng đồng do một người vận hành.

Chúng vẫn được đăng ký, vì khi một nguồn không trả lời, bạn nhận một *unavailable* nêu tên nó - hữu ích hơn một bản cài VN lặng lẽ không phủ gì.

Positioning của CFTC là **hằng tuần và có độ trễ**, và báo cáo nói rõ điều đó. Số liệu mang ngày thứ Ba mà các vị thế được giữ, và được công bố vào thứ Sáu sau đó. Một con số mang ngày thứ Ba tuần trước là báo cáo đang nói thật về độ trễ của chính nó, không phải số đọc cũ.

Vĩ mô là loại **duy nhất** gộp dữ liệu thay vì dự phòng cho nhau: không nhà cung cấp nào công bố mọi chuỗi, và khi hai bên cùng công bố một chuỗi thì thứ tự tuyến quyết định bên nào thắng. Cặp không cần khóa `treasury`/`bls` đứng đầu để bản cài không khóa vẫn đọc được vĩ mô Mỹ.

Chỉ số vĩ mô tổng hợp được chuẩn hóa lại khi công bố: chuỗi nào hôm nay không có số đọc thì không bỏ
phiếu. Mỗi yếu tố dẫn dắt công bố tỷ phần của nó trên **số phiếu thực sự đã bỏ**, và mức đóng góp được
đo so với chính điểm mà nó làm dịch chuyển.

- Các trọng số công bố cộng lại bằng một, và các mức đóng góp cộng lại bằng điểm.
- Dữ liệu thiếu hiện ra ở `coverage` cùng danh sách thiếu.
- Khi chỉ còn cách ngưỡng độ phủ tối thiểu đúng một chuỗi, một ghi chú báo rằng mất thêm chuỗi nữa là
  trạng thái chuyển sang phòng thủ. Nếu trạng thái đã là phòng thủ thì không có ghi chú này.
- Một yếu tố dẫn dắt nêu luôn đơn vị của nó: các chuỗi lãi suất là phần trăm, còn chỉ số USD (gốc
  Jan-2006 = 100) và VIX là các mức, in ra không có dấu phần trăm.

Điều này đúng cả với con số bạn thấy, không chỉ con số đã lưu. Các tỷ phần in dưới tổng mà chúng chia ra được làm tròn **cùng nhau**, nên cột cộng lại đúng trên màn hình. Quy tắc này áp cả với mức đóng góp yếu tố của một đề xuất dưới chỉ số tổng hợp, và với các mục tiêu nhóm trong hồ sơ (chuẩn hóa về một). Chỉ các dòng thật sự in ra một tỷ phần mới tham gia.

**Nguồn cần khóa mà chưa có khóa thì không được đăng ký**, nên loại dữ liệu đó chuyển sang nguồn kế tiếp. Khi khởi động, một cảnh báo `trading.source.skipped` nêu tên từng nguồn bị bỏ qua và biến môi trường nó cần. Chạy không khóa là chế độ suy giảm được hỗ trợ, không bao giờ là lỗi nghiêm trọng.

Khóa đến từ biến môi trường và không bao giờ nằm trong cấu hình. Tên biến, tiền tố `OPENALPHA_` và việc đổi tên bằng `[trading.sources]` nằm ở [Nguồn dữ liệu](nguon-du-lieu.md#định-tuyến).

#### Báo cáo tài chính VN: các năm đã kiểm toán, rồi các quý gần nhất

`vietcap-statements` trả báo cáo cả năm và các quý riêng lẻ của một mã cùng lúc. Những năm đã qua cửa sổ kiểm toán in mỗi năm một dòng, cũ nhất trước.

Khi các quý chạy vượt qua năm đã kiểm toán mới nhất, bốn quý mới nhất được công bố tính tới ngày bảng giá sẽ in thành một dòng nữa, đánh dấu là **chưa kiểm toán**:

- các khoản thuộc dòng tiền (doanh thu, lợi nhuận, dòng tiền, capex, cổ tức) được cộng lại;
- các khoản thuộc số dư được đọc ở thời điểm đóng của quý cuối;
- thiếu một khoản dòng tiền ở bất kỳ quý nào trong bốn quý thì khoản đó bị bỏ, chứ không đọc trên ít quý hơn.

Một cửa sổ kết thúc trong năm đã kiểm toán mới nhất, hoặc ở quý IV của nó, thì chỉ lặp lại bản kiểm toán nên không in gì. Cuộc tranh luận được dặn phải cân dòng này thấp hơn một bản kiểm toán.

Ngoài các năm đã kiểm toán, OpenAlpha còn cho xem 5 quý gần nhất, mỗi quý so với cùng kỳ năm trước, để thấy doanh nghiệp đang tốt lên hay xấu đi ngay lúc này. Số quý chưa kiểm toán nên chỉ dùng để tham khảo.

Quý mới được đưa vào phân tích ngay khi có kết quả kinh doanh, không chờ lưu chuyển tiền tệ (phần này hay về chậm vài ngày):

- Phần còn thiếu được lấy từ `cafef-statements`, chỉ khi số liệu khớp với các quý đã có. Dòng quý đó sẽ ghi "tạm tính từ nguồn dự phòng".
- Chưa lấy được thì dòng tiền để trống, không tính là 0.

Đề xuất sẽ nhắc bạn khi quý mới nhất còn thiếu lưu chuyển tiền tệ, hoặc khi quý đã quá hạn mà chưa có số. Gặp trường hợp sau, bạn nên xem thêm báo cáo trên trang của công ty.

Báo cáo được tải lại mỗi 30 ngày. Vào mùa báo cáo thì dày hơn: hai ngày một lần khi quý mới chưa về, sau mỗi phiên khi quý đã về nhưng còn thiếu lưu chuyển tiền tệ. Mùa báo cáo là từ 15 đến 70 ngày sau khi quý kết thúc, khoảng mà 25 mã lớn đã nộp các quý 2025-26 (quý I và quý III trong 15-35 ngày, bản bán niên đã soát xét trong 30-66 ngày). Một mã có năm tài chính không trùng năm dương lịch được đọc theo các quý dương lịch, nên chỉ bị hỏi thêm vài lần.

#### Hết giờ, thử lại và cache

Mọi nguồn dùng chung một bộ mốc hết giờ, thử lại, trần kích thước phản hồi, cache và cầu dao, nên không nguồn nào tự lệch đi.

Một **lần đọc giá** - đứng sau `/price`, nhịp danh sách theo dõi và mọi nhịp cảnh báo - có mốc hết giờ chặt và đúng một lần thử. Một nguồn chính đã chết chỉ tốn một lần chờ ngắn trước khi nguồn kế tiếp tiếp quản, thay vì các lần thử lại có khoảng chờ trong lúc bạn đợi trước một ô nhập. Các lần đọc hàng loạt giữ mặc định. Con số nằm ở [Nguồn dữ liệu](nguon-du-lieu.md).

#### Một giá trực tiếp mang theo cả phiên tới giờ

Một giá từ nguồn có chuỗi trong phiên mang theo **đỉnh, đáy và khối lượng cộng dồn** của phiên bên cạnh mức giá, cộng thời điểm cửa sổ đó mở. Một mức giá đứng một mình không nói được nó đang ở đỉnh hay đáy. Có ba nơi cần biết:

- lượt quét cảnh báo so ngưỡng với các mức cực trị, chứ không so với bản in cuối;
- `/price` báo biên độ ngày bên cạnh con số;
- phép kiểm kế-hoạch-đang-đứng hỏi xem các mức giá của một đề xuất đã lưu còn trả nổi rủi ro của chính nó hay không.

Biên độ này vắng mặt trên một số đọc đã settle và với nguồn nào không có chuỗi trong phiên. Không chỗ nào suy ra biên độ từ một giá đóng duy nhất.

Các dòng tiêu đề crypto được đo so với giá đóng đã settle từ chuỗi ngày của chính chúng, in ngay bên cạnh, chứ không so với một cửa sổ 24 giờ trôi không hiện ở đâu trên màn hình.

Các bảng tổng hợp đặt cạnh những dòng đó lấy từ bảng vốn hóa thị trường, nơi mọi nguồn đều công bố cửa sổ 24 giờ trôi. Nên danh sách mã biến động mạnh và bảng xếp hạng giá trị giao dịch đặt tiêu đề theo cửa sổ đó chứ không theo một phiên. Tỷ phần taker mua là ngoại lệ: nó là của một phiên đã settle, và nêu tên phiên đó.

Dòng quy mô thị trường cũng đếm có bao nhiêu mã thanh khoản tăng và giảm trong cùng ngày trôi đó - số đọc độ rộng duy nhất mà một thị trường không có phiên đưa ra được. Bản tin sáng đọc lúc 07:00 ở Việt Nam cho thấy giờ châu Á có làm bảng giá dịch chuyển hay không, chứ không chỉ hai mã dẫn đầu.

Một mã đang nắm hay đang theo dõi đã giao dịch cao hơn giá đóng đã settle ít nhất 2% rồi quay về bằng hoặc dưới nó thì được gắn tiêu đề *mở lên rồi trả lại hết*. Không gì khác trên dòng đó đổi.

#### Nhịp thị trường đọc trực tiếp, mười hai mã một lượt

`/watchlist` và mục `cross-asset-pulse` của bản tin đọc giá trực tiếp theo cùng một cách, chặn ở **mười hai** công cụ, tải **bốn cái một lượt**. `/watchlist` báo giá các mã bạn theo dõi; mục pulse thêm mọi mã bạn đang nắm, đã khử trùng. Cái trần giới hạn chi tiêu và độ trễ, không phải một bảng xếp hạng. Danh sách dài hơn thì bị cắt và nói rõ bằng `market-data.universe-truncated`, nên một mã bạn mong đợi mà không thấy sẽ được giải thích.

Mỗi dòng hỏi một giá trực tiếp. Thị trường không trong phiên trả lời bằng giá đóng đã lưu, nên cùng một lời gọi đúng cả lúc 10 giờ sáng lẫn nửa đêm.

Một mã mà giá không được hỗ trợ, không có, hoặc không hữu hạn thì thành một caveat nêu tên nó, không bao giờ thành một dòng bằng 0. Một mức giá giả trên một dòng nhịp thị trường không phân biệt được với giá thật.

#### Một màn hình sàng lọc được xếp hạng trên bằng chứng đã settle

Một bảng lấy lúc 11 giờ sáng được xếp hạng tới giá đóng hôm qua, dù giá hiển thị là giá trực tiếp. Ngày của bảng là ngày theo lịch thị trường ở thời điểm chạy; ngày "bằng chứng tới" là ngày đã settle cuối cùng mà việc xếp hạng thật sự phủ, vì cây nến hôm nay đang hình thành bị bỏ đi.

Với thị trường liên tục (crypto, lịch UTC), ngày của bảng là ngày UTC chứ không phải ngày địa phương của bạn, và ngày đã settle luôn là hôm qua theo UTC. Ví dụ: 09:44 UTC 2026-09-09 (16:44 ICT) sàng lọc với `asOf 2026-09-09` trên bằng chứng tới `2026-09-08`. Từ 00:00 tới 06:59 ICT, ngày địa phương đã đi trước ngày UTC một ngày.

Kết quả mang `market-data.evidence-settled-only`: lịch sử giá chạy tới giá đóng đã settle cuối cùng, còn các số đọc mà thị trường công bố liên tục là hiện hành. Nó không nêu tên phiên nào, vì bảng đã tự nêu phiên của mình, và nhắc lại sẽ đặt hai cái dấu lên một thông điệp.

Xếp hạng lại trên một phiên dở sẽ làm các mã lên xuống suốt buổi sáng, trên khối lượng còn chưa về hết.

#### Một phiên settle khi bảng giá của nó settle, không phải khi chuông reo

Một bảng ngừng giao dịch ở giờ đóng và công bố phiên khớp lệnh đóng cửa vài phút sau đó. Giữa hai thời điểm ấy, nguồn trả lời bằng một phiên trông như đã hoàn tất mà thiếu bản in cuối. Trên HOSE, đó là 18 trong 25 mã sôi động nhất mang giá đóng sai, và tổng giá trị giao dịch của cả thị trường thiếu 10%.

Vì vậy một ngày chỉ được coi là đã settle khi giờ đóng **cộng độ trễ khớp lệnh** đã qua. Trước đó không lưu gì cho ngày ấy, và neo của bộ lập lịch chính là thời điểm đó. Một quy tắc duy nhất quyết định cái gì được lưu và cái gì được phục vụ.

**Giờ đóng đã khai.** Bảng có phiên khớp lệnh thì có giờ đóng thật: HOSE chốt giá đóng cửa ở 14:45, và độ trễ sau đó phủ cửa sổ thỏa thuận và PLO 14:45-15:00 cộng thời gian nguồn công bố. Bảng kiểu nhà kinh doanh không chốt gì - nó được sửa cho tới khi ngừng sửa - nên giờ đóng của nó là một **ước lượng** về lúc các lần sửa kết thúc. Với `gold-vn` đó là 17:30, vì SJC được đo là vẫn còn sửa ở 17:15. Một ước lượng bị phép đo phản bác thì được dời; một mức giá đã chốt thì không.

**Mức chênh vàng trong nước** là lý do quy tắc này dùng chung. Nó định giá một bảng tĩnh của nhà cung cấp so với vàng thế giới, thứ vẫn đang dịch chuyển. Một điểm lấy giữa giờ đóng của quầy và giờ settle đo ra mức chênh khác với một điểm lấy sau đó, và chuỗi giữ cái nào đến trước. Một ngày đã có sẵn thì được báo là hiện hành chứ không phải đã cập nhật, và `force` là thứ suy lại nó. Nếu không, mức chênh đã lưu sẽ đóng băng ở số đọc đầu tiên của ngày trong khi mọi màn hình tính ra một mức mới hơn.

Phiên chạy trực tiếp chỉ ghi phiên đã settle. Một lượt bù sau đó lấp các ngày còn thiếu của cửa sổ phân vị từ các bảng vàng có ngày, định giá so với giá đóng thế giới và tỷ giá mới nhất trong hạn mức độ trễ. Ngày mà giá đóng thế giới hay tỷ giá không bao giờ tới thì được báo là thiếu, không bị bỏ qua trong im lặng. Ngày mà quầy không công bố gì thì không tính là thiếu: nó không thể tới, và đếm nó sẽ khiến mọi phiên chạy trông như thiếu hụt. Nhà cung cấp ngừng công bố hẳn thì được bắt bởi chính ngưỡng độ phủ của phân vị.

**Dấu refresh đã lưu.** Một lần thử refresh được đóng dấu bằng ngày nó phủ, và phiên chạy kế tiếp dùng lại thay vì tải lại. Một phiên chạy rơi vào khoảng chờ settle sẽ đóng dấu ngày vẫn đang hình thành, rồi mọi phiên sau đọc dấu đó là hiện hành. Nó không tự lành: loại đó vẫn bị ghim vào bảng giá đang hình thành cho tới khi cửa sổ nhịp vượt qua, mà qua một ngày thứ Sáu là ba ngày. Nên một dấu chỉ được coi là hiện hành nếu ngày đó đã chốt vào lúc phiên chạy nhận nó, trước cả khi xét tuổi.

**Giá trực tiếp.** Giá trực tiếp của một thị trường bị bỏ khi phiên của chính nó không mới hơn giá đóng đã settle, hoặc khi tuổi của nó vượt quá mức một bản in đóng cửa hay một bảng giá im ắng có thể giải thích. **Thị trường** sở hữu câu hỏi đó, không phải nguồn - như phép kiểm tuổi bảng của `gold-vn` vốn đã làm. Cách phán xét một số đọc nằm ở [Nguồn dữ liệu](nguon-du-lieu.md). Nó bắt ba thứ, cả ba đều tới đúng định dạng:

- Sàn tạm dừng một cặp thì cứ phục vụ giao dịch cuối của nó vô thời hạn, nên các mức giá sẽ neo một lệnh vào trên một bảng giá đã chết.
- Một phiên đã settle trả lời mọi yêu cầu sau đó bằng giá đóng nó vốn giữ, thứ mà màn hình sẽ in như mức giá thị trường đang tạo ra ngay lúc này. Trên HOSE, cửa sổ đó là mọi yêu cầu từ 15:15 tới lần mở kế tiếp, khoảng ba phần tư ngày.
- Một feed ngừng tiến tới thì cứ trả lời bằng cây nến từ vài giờ trước mang ngày hôm nay. `/price`, `/overview` và `/market` có thể mỗi nơi in một cây nến chỉ số cũ khác nhau, cả ba đều in mức tăng trên một phiên mà chỉ số đã giảm.

Trong cả ba trường hợp, giá đóng đã settle đứng ra thay, được đóng ngày chính xác. Giá trực tiếp chỉ sống sót như phương án cuối cho một mã mà kho hoàn toàn không định giá được: một cuốn sổ định giá trên bất cứ mức giá nào nó lấy được, và chỉ dấu độ tươi là được phép thiếu. Crypto và cổ phiếu VN trả lời theo cách này, nên một thị trường đang đóng bảng vẫn in ra một mức giá chứ không từ chối.

Một lần từ chối khi bảng đang mở thì nói rõ điều đó. Thị trường đóng cửa thì không cần giải thích, nhưng một mã mà bảng đang giao dịch mà chưa in ra là một mã bị tạm dừng - thứ bạn có thể hành động. Nó mang `market-data.quote-not-live` nêu tên mã.

#### Khâu sàng lọc đánh dấu một mã bị loại, và không bao giờ ẩn nó

Một mã bạn đã loại vẫn được xếp hạng và vẫn in ra, kèm `nằm trong danh sách loại trừ của bạn` trên chính dòng của nó. Ẩn nó sẽ lặng lẽ thu hẹp bảng mà không báo bạn. Chỗ chặn thật nằm ở nơi khác: giai đoạn `profile-exclusion` trong quy trình đề xuất và danh sách ứng viên của tái cân bằng.

Không gì từ hồ sơ định hình chính cái bảng. Tập công cụ, xếp hạng, điểm số và các yếu tố giống hệt nhau dưới mọi hồ sơ, nên bảng không mang dấu hồ sơ nào - một tiêu đề chính sách ở đó sẽ hàm ý một bộ lọc chưa bao giờ chạy.

Hồ sơ không đọc được thì bảng mất các dấu, không bao giờ mất các dòng, và nói rõ bằng `profile.exclusions-unavailable`. Đó là thứ tách "ở đây không có gì bị loại" khỏi "mình không kiểm được".

#### Unavailable là một câu trả lời

Mọi lời gọi nguồn trả về hoặc dữ liệu kèm xuất xứ và caveat, hoặc *unavailable* kèm một lý do - `unconfigured`, `unsupported`, `stale` hay `failed` - các nguồn đã được thử, và các caveat. Không gì bịa ra một con số để lấp khoảng trống, và không gì hỏng vì một nguồn miễn phí không có độ phủ.

Độ tươi (`live` hoặc `cached`) nằm trên **từng** dòng xuất xứ, không bao giờ là một con số tổng: một kết quả lắp từ bốn nguồn không có câu trả lời duy nhất cho "cái này có tươi không?".

Một khối được đóng ngày theo một phiên thì đọc **mọi** con số trong nó ở phiên đó, hoặc bỏ những con số nó không đọc được. Độ rộng VN đếm từng mã ở phiên đã settle và giữ lại các con số xu hướng chỉ số bất cứ khi nào chuỗi chỉ số dừng ngắn hơn. Endpoint chỉ số giữ lại cây nến đã settle vài giờ sau khi các mã cổ phiếu đã có, và khối nêu tên phiên mà chuỗi đó thật sự với tới. Một tiêu đề mà cửa sổ của nó thiếu thì chỉ phát biểu riêng tiêu đề.

Phiên đó là thứ đóng ngày cho khối, không bao giờ là ngày mới nhất mà bất cứ thứ gì trong khối báo. Hai thứ này khác nhau mỗi buổi sáng cho tới khi lượt refresh về: endpoint chỉ số công bố hôm nay trong khi bảng giá đã lưu vẫn kết thúc ở hôm qua. Lấy ngày theo cái muộn hơn sẽ đóng dấu độ rộng, giá trị giao dịch, dòng tiền, mã dẫn đầu, mã biến động mạnh và các bảng của một phiên dưới ngày của phiên kế tiếp. Nó cũng sẽ ép im ghi chú rằng giá trị giao dịch và dòng tiền ngoại hôm nay chưa được đo.

Mỗi dòng giá mang `closedOn` của riêng nó. Công cụ của agent gom cùng các bảng tổng hợp đó dưới `settledSession`.

### Quy trình đề xuất

Năm giai đoạn, đúng thứ tự: **nhận diện, yếu tố, tranh luận, các cổng, lưu**.

- Một giai đoạn **bị chặn thì ép ra kết luận giữ nguyên.** Một đề xuất không thể đi vòng quanh một phép kiểm đã hỏng.
- **Mức tin cậy chỉ đi xuống.** Cuộc tranh luận có thể hạ nó; không gì nâng nó lên.
- Mọi đề xuất ghi lại phiên bản chiến lược và các phiên bản tính toán, kể cả phiên bản skill. Sửa một skill tách quần thể đã ghi đúng như sửa một chiến lược.
- Mọi cuộc tranh luận đã lưu liệt kê các mô hình chat đã trả lời các vai của nó, nên đổi mô hình cũng tách bảng thành tích.

Một phiên chạy kết thúc theo một trong bốn cách:

| Kết quả | Nghĩa là |
|---|---|
| `completed` | Bạn nhận đề xuất. Đánh dấu `reused` khi mã đã được đề xuất trong ngày trên giá đóng cửa mới nhất đã lưu, hoặc một lệnh mua trước đó vẫn còn hiệu lực. Đề xuất dùng lại không bao giờ tự chạy lại chỉ vì sổ đã đổi: giao dịch trên chính mã đó thêm `suggestion.position-changed`, còn mọi thay đổi khác trong sổ thêm `suggestion.book-changed` cho đề xuất tính từ tỷ trọng và tiền mặt trong sổ (lệnh mua, lệnh giảm bớt theo lý do của kế hoạch, lệnh giữ do khối lượng tính theo NAV và tiền mặt). Thêm `force` để tính lại. |
| `unsupported` | Không thị trường nào nhận mã, hoặc có hai thị trường nhận và bạn phải nói rõ. |
| `cooldown` | Mã vừa được đề xuất quá gần. Báo ngày nó đủ điều kiện trở lại. |
| `error` | Phiên chạy qua hết các cổng rồi không ghi được (nhiều khả năng do kho lưu). Chạy lại là an toàn. |

`error` không phải giữ nguyên. Giữ nguyên nghĩa là "đã đánh giá và bác bỏ", và là một câu trả lời thật kèm các mã lý do dẫn tới nó. `error` nghĩa là việc đánh giá chưa bao giờ được ghi.

#### Độ sâu tranh luận

Hai chế độ, đặt bằng `[trading.suggestions] debate_mode` và ghi đè được theo từng yêu cầu (`/suggest FPT lean`, hoặc `mode` trên `suggestion_run` của MCP):

- **`full`** (mặc định) chạy `bull-researcher`, `bear-researcher`, `portfolio-manager`, `trader`, `risk-analyst` và `claim-verifier`.
- **`lean`** chạy `market-analyst` và `claim-verifier`.

Mỗi vai có một phần ngân sách riêng. Nếu một vai dừng giữa chừng hoặc dùng hết phần của mình, cả phiên chạy chuyển về giữ nguyên, thay vì cho ra một cuộc tranh luận dở dang.

Mỗi vai được hỏi tối đa hai lần. Nếu câu trả lời sai schema, vai được hỏi lại kèm chỗ sai (`trading.debate_role_repaired`). Nếu chuỗi nhà cung cấp hoàn toàn không xử lý được lượt đó, vai được hỏi lại y nguyên (`trading.debate_role_retried`), vì chuỗi đã chờ hết thời gian nghỉ trước.

Độ sâu được chọn đúng một lần, quy tắc nào khớp trước thì thắng:

1. Chế độ bạn đã gõ rõ thì giữ nguyên.
2. `force` nghĩa là full.
3. Bản nháp mà cuốn sổ đã quyết (`no-rebalance-needed`, `evidence-sold`, `sale-below-board-lot`, `increase-unfunded`, `segment-off`, `segment-target-zero`, `reference-only`, `factors-bearish`, `factors-neutral`, `factors-contested`) chạy lean, vì tranh luận chỉ hạ được xuống nên không đổi được nó. Báo cáo nói rõ là điểm số (ba lý do `factors-*`) hay danh mục đã chốt kết quả, và chỉ lệnh `/suggest <mã> full` để đọc đủ lập luận.
4. Mọi trường hợp khác dùng chế độ đã cấu hình.

Dòng mà sổ đang nắm cũng được miễn bậc độ sâu khi dùng lại. Nếu không, mặc định lean sẽ khiến nó bị chạy lại mỗi ngày trên cấu hình full. Riêng khi bạn gõ rõ `full`, lệnh chạy lại qua dòng lean đó và thay nó, nên hỏi lập luận đầy đủ thì không bao giờ nhận lại bản rút gọn.

#### Kiểm tra những gì cuộc tranh luận nói

**Một luận điểm bị dữ liệu bác bỏ chỉ giữ lại đề xuất khi đề xuất đó dựa vào cuộc tranh luận.**

- Một luận điểm ủng hộ hành động được đề xuất mà bằng chứng nói ngược lại sẽ biến lệnh mua, hay lệnh
  giảm bớt vì bằng chứng, thành giữ nguyên.
- Lệnh giảm bớt theo lý do của chính kế hoạch (`over-target`, `weak-signal`, `over-cap`) chưa bao giờ
  dựa vào lập luận của cuộc tranh luận. Nên khi đó luận điểm bị bác bỏ chỉ được nêu ra và hạ mức tin
  cậy.
- Với lệnh `over-cap`, các vai được biết trần nào đã bị vượt (mỗi mã, quỹ hay ngành), đo trên toàn
  danh mục. Nhờ vậy phần còn trống dưới một trần khác không bị đọc thành bằng chứng là chưa vượt trần
  nào.

**Một con số mà bằng chứng chưa bao giờ in ra thì bị nêu tên, không bị phán xử.** Sau khâu kiểm chứng, mọi con số trong các khẳng định quan trọng được so theo giá trị với các con số trong bằng chứng. Các đơn vị (`tỷ`, `bn`, `%` và còn lại) được quy đổi, đọc được cả dấu phẩy lẫn dấu chấm thập phân, và một con số khớp nếu lệch không quá nửa chữ số cuối đã in, nên số đã làm tròn vẫn tính. Số đếm nhỏ trần và các năm bị bỏ qua.

Con số nào còn lại được báo bằng `suggestion.figure-unmatched`, một caveat thông tin. Nó không bao giờ làm đổi kết luận. Một tổng hay một khoảng cách do nhà phân tích tự tính không khớp với số nào, và một khẳng định văn bản tự do không nêu chỉ số hay kỳ nào để đối chiếu, nên con số nào thuộc dòng nào vẫn do bên kiểm chứng quyết định.

**Các tiêu đề được đọc trước khi có ai lập luận từ chúng.** Một yêu cầu tới nhóm mô hình `decisions` hỏi hai câu cho mỗi tiêu đề: nó nói về cái gì (mã này, ngành của mã, thị trường chung, hay không liên quan) và nó có báo xung đột, lệnh trừng phạt hay tình trạng khẩn cấp của nhà nước không. Lần đọc này được cho biết tên công ty và ngành của mã, nên một mã ba chữ cái ngắn không bị nhầm với doanh nghiệp khác.

- Câu trả lời chắc chắn: tiêu đề chuyển giữa phần tin về chính mã và phần bối cảnh thị trường, hoặc bị bỏ.
- Không chắc: cách nhóm của feed được giữ nguyên.
- Từ hai câu chuyện rủi ro khác nhau trở lên thì nêu `market.risk-event-headlines`.
- Không có lần đọc: phiên chạy nói rõ bằng `suggestion.headlines-unread`, giữ cách nhóm của feed và dùng bảng từ khóa cho cảnh báo rủi ro.

Khi nguồn tin, nguồn khuyến nghị của nhà phân tích hoặc lịch doanh nghiệp bị gián đoạn, phần phân tích được báo rõ và không bao giờ coi sự im lặng là bình yên.

Phần này không làm đổi mức tin cậy, các mức giá hay cỡ lệnh. Các lần đọc đi tới chuỗi `[[model_tiers.decisions]]`; không cấu hình nhóm `decisions` thì chúng tắt.

#### Bán một mã đang nắm

`reduce` mang theo một lý do. Ba lý do đến từ kế hoạch: `over-target` cắt bớt tỷ trọng về mức mục tiêu, `weak-signal` bán ra một mã có điểm chung đã xuống dưới ngưỡng giữ (không áp cho quỹ, vì quỹ bám theo chỉ số chứ không theo một công ty), còn `over-cap` đưa một mã đã vượt trần về đúng mức trần, nên `/suggest` nêu đúng lý do mà `/rebalance` in ra. Lệnh bán khỏi một nhóm bạn đặt 0% được ghi là `over-target`, vì mục tiêu của nhóm đó là không. Các lý do còn lại là bằng chứng đang quay sang chống lại một mã bạn nắm, mỗi lý do bán một phần tỷ lệ riêng của vị thế:

- `structure-broken` - một giá đóng dưới mức thấp của các phiên trước nó, từ chính số đọc của thị trường.
- `regime-risk-off` - trạng thái thị trường của nhóm chuyển sang phòng thủ.
- `thesis-weakening`
- `overheated` - bên long đang trả funding chen chúc.
- `stale` - một cửa sổ nắm giữ đầy mà vẫn ở giá vốn.
- `ceiling-close` - một cổ phiếu VN bạn nắm vừa đóng cửa ở giá trần hoặc sát trần. Phiên sau thường mở cửa cao hơn, nhưng các tuần tiếp theo hay kém thị trường, nên phần chốt lời đầu quen thuộc của bạn được giảm bớt ngay lúc mở cửa đó; qua phiên mở cửa ấy thì khoảng trống giá đã được trả xong và không còn đề xuất gì.

`structure-broken`, `stale` và `ceiling-close` chỉ được đọc trên nhóm kỳ hạn ngắn. Nhóm dài hạn không bị bán vì một mức thấp mười phiên, một quý đi ngang hay một phiên đóng cửa ở trần.

Khi cả trim lẫn một lý do bằng chứng cùng bật, bên bán nhiều hơn (tính theo lô chẵn) thắng và dòng mang
lý do đó. Hòa thì lý do bằng chứng thắng.

- Khi bằng chứng chỉ đòi bán chưa tới một lô chẵn trên vị thế bạn chưa bán bớt, mã được giữ với lý do
  `sale-below-board-lot`, không bị báo là đã bán rồi.
- `over-target` bật ở mọi độ lệch vượt một lô chẵn, và một mã đã tăng đúng vào lúc có tín hiệu thoát
  thì đã lệch xa tới mức đó. Xếp ngược thứ tự sẽ áp cỡ của một lần trim thường lệ lên một cấu trúc mà
  thị trường đã phá vỡ.
- Tranh luận hỏi nên giữ hay bán, như với trim, và chỉ có thể từ chối.

#### Hai phép kiểm chạy trước

Các giai đoạn riêng của quy trình chạy trước cổng của bất kỳ thị trường nào, cho mọi thị trường:

- `profile-exclusion` - danh sách loại trừ của bạn.
- `deployment` - từ chối thêm rủi ro vào một bảng giá risk-off khi sổ đã đầu tư đủ.

#### Tín hiệu đã settle; giá là trực tiếp

Các yếu tố chỉ được tính trên nến đã settle. Tính trên nến đang hình thành thì yếu tố sẽ vẽ lại. Nhưng giai đoạn mức giá và phép kiểm kế-hoạch-đang-đứng hỏi giá trực tiếp, nên giá vào, cắt lỗ và mục tiêu được dựng trên mức giá bạn đang nhìn.

Mỗi thị trường tự quyết khi nào trả lời được giá trực tiếp, và lùi về giá đóng cuối khi không, nên trước giờ mở và phiên đóng không đổi. Một số đọc có trực tiếp hay không do phiên của nó quyết định, không do dấu thời gian. Phiên khớp lệnh đóng cửa in sau chuông, nên khi bảng giá settle, bản in đóng cửa của chính thị trường thành giá đóng của phiên và dòng trực tiếp bị bỏ.

Bằng chứng và giá có thể kết thúc ở hai phiên khác nhau, nên mọi dòng đã lưu mang một ngày **bằng chứng tới**: phiên đã settle mới nhất mà các yếu tố và mức giá của nó được đọc từ đó. Phần cuối báo cáo in ngày này mỗi khi nó khác ngày chạy. Trên thị trường liên tục thì phiên chạy nào cũng vậy, vì nến của ngày lịch đóng vào nửa đêm UTC kế tiếp. Ngày của lời gọi vẫn là ngày nó được định giá, thứ mà danh tính dùng-lại và cửa sổ kết cục dựa vào.

#### Riêng cổ phiếu VN

**Giá VN ra ngoài biên của chính phiên nghĩa là lịch sử đã cũ, không phải mã bị tạm dừng.** Không giao dịch nào in ngoài biên. Nếu giá trực tiếp rơi ra ngoài biên dựng từ giá đóng đã lưu, thì giá đóng đó đang ở cơ sở cũ - thường là ngày giao dịch không hưởng quyền mà nguồn chưa điều chỉnh. Phiên chạy giữ nguyên với `history-not-adjusted` thay vì định giá trên nó. Phép kiểm này chạy trước khối chạm-biên, thứ nếu không sẽ đọc mức rơi đó như một mã kẹt sàn. Lần refresh kế tiếp thấy giá đóng đã điều chỉnh sẽ dựng lại mã.

**Các yếu tố của một cổ phiếu VN in thành danh sách "nhìn nhanh"**, chia theo phía: điểm cộng, điểm trừ, rồi thông tin thêm. Trong mỗi nhóm, yếu tố mạnh nhất đứng đầu. Mỗi dòng mang thang điểm riêng của yếu tố và các số đọc chính, không bao giờ là một ngưỡng cố định.

- Tăng trưởng không có yếu tố riêng, nên chỉ in số, trong nhóm thông tin thêm. Yếu tố có điểm gần 0 cũng nằm ở đó.
- Khả năng sinh lời và sức khỏe tài chính dùng chung điểm chất lượng, nên dòng thứ hai để trống vạch thay vì đếm hai lần.
- Yếu tố không có số đọc in `—`.
- REPL in dạng lưới; chat in mỗi dòng một hàng.

Các số đọc mà dòng không hiện vẫn nằm trong phép tính. Thị trường nào có yếu tố mà danh sách chưa có dòng thì giữ bảng yếu tố.

**Trạng thái thị trường VN giữ nguyên cho tới khi điểm rời hẳn nó.** Vào một trạng thái ở +-0,25 và chỉ rời khi điểm quay lại trong +-0,15, nên một chỉ số tổng hợp lởn vởn trên ngưỡng không làm dịch triển khai mỗi ngày. `macro.regime-held` báo khi dải giữ được chỗ mà điểm trần lẽ ra đã lật. Trí nhớ là lần đọc đã xếp hạng gần nhất đã lưu trong vòng năm phiên; cũ hơn nghĩa là dịch vụ nền (daemon) đã tắt, không phải thị trường lặng. Nó chỉ áp với VN, thị trường duy nhất lưu các số đọc của mình.

**Quỹ ETF VN được đọc qua chỉ số mà nó mô phỏng.** Hai yếu tố của quỹ đọc chính chỉ số đó. Khi cây nến mới nhất của chỉ số cũ hơn của quỹ, cả hai mang `factor.input-stale`. Những điểm khác so với cổ phiếu:

- Cuộc tranh luận dùng khung phân tích vĩ mô và thanh khoản, thay cho định giá và chất lượng doanh nghiệp.
- Không có cảnh báo hạn nộp báo cáo, vì quỹ không nộp báo cáo tài chính như doanh nghiệp.
- Mức dưới giá vào là mốc xem lại, cách ba lần ATR với kỳ hạn dài. Không có gì kéo nó lên theo giá, nên nó không bao giờ nằm sát dưới giá đóng cửa một ATR như cắt lỗ đã kéo theo của cổ phiếu.

#### Một mã đang nắm được lập kế hoạch mà không cần ai hỏi

Lệnh mua được ghi mà chưa có kế hoạch nào đang đứng sẽ nhận một dòng giữ nguyên chỉ có mức giá (`recorded-entry`) ở giá khớp. Dòng này do đúng một đường ghi của sổ lệnh tạo ra, nên lệnh gạch chéo, công cụ ghi sổ của agent, một lần sync sàn và một lần khớp được phản chiếu đều nhận được. Dòng xác nhận ghi của bạn in nó ra; biên nhận của agent thì không.

Nhịp cảnh báo cũng ghi đúng dòng đó, từ giá đóng đã settle, cho mã đang nắm nào chưa có gì theo dõi, rồi gửi một thông báo.

Đây là kế hoạch mà mã được cắt lỗ, đặt mục tiêu và trail theo, cho tới khi `/suggest` thay nó. Kế hoạch đã ghi không bao giờ thỏa cổng dùng lại và không bắt đầu thời gian chờ. Một phiên chạy mà phần tranh luận không trả lời được (chưa có khóa mô hình, một vai bị lỗi, hết ngân sách) thì chưa quyết định gì: bạn vẫn thấy kết quả kèm lý do, nhưng nó không được lưu, nên không bao giờ thay kế hoạch đang có.

- Kế hoạch của một lời gọi hết hiệu lực khi nhịp kết cục chốt nó; kế hoạch đã ghi hết hiệu lực khi giá đóng đã settle vượt qua một trong hai mức.
- Dù cách nào, nhịp kế tiếp lập kế hoạch mới từ mức mã đang giao dịch, với sàn là mức cắt lỗ cũ chừng nào mức đó còn dưới giá.
- Kế hoạch do phiên bản chiến lược cũ định giá cũng được thay theo cách đó, tối đa một lần mỗi phiên, để chính sách mức giá mới áp tới các mã đang nắm. Thông báo chỉ gửi khi cắt lỗ hoặc chốt lời đã dịch.

#### Một đề xuất đã lưu mà giá đã rời khỏi các mức của nó thì trả về với dấu vô hiệu

Mỗi thị trường khai mức rủi ro-lợi nhuận mà các mức giá vẫn phải đạt ở giá hiện tại. `equity-vn` và `crypto` đều là 1:1.

Trần đuổi giá trong kế hoạch chính là ngưỡng đó quy ra giá: (mục tiêu + R x cắt lỗ) / (1 + R). Kế hoạch và phép kiểm dùng lại đọc cùng một giá trị, nên khi một thị trường chỉnh mức sàn, giá mà kế hoạch in ra và giá mà phép kiểm áp dịch chuyển cùng lúc.

- Trên trần: câu trả lời hôm nay giữ nguyên.
- Dưới trần, hoặc giá vượt cắt lỗ hay mục tiêu: dòng được phục vụ kèm `suggestion.levels-void`. `/suggest <mã> force` chạy một lời gọi mới.
- Cắt lỗ suy từ ATR, nên quy tắc co giãn theo độ biến động của từng thị trường chứ không theo một phần trăm phẳng.
- Thị trường không khai mức sàn thì không đọc giá trực tiếp và giữ câu trả lời suốt thời gian chờ. Thị trường không đọc được giá thì nói rõ bằng `suggestion.standing-unverified`.

#### Đặt cắt lỗ và mục tiêu theo từng thị trường

`[trading.markets.<id>]` nhận:

- `stop_loss_atr` - khoảng cắt lỗ tính bằng số lần ATR;
- `reward_risk` - mục tiêu bằng bao nhiêu lần khoảng rủi ro;
- `maximum_stop_loss` - trần cứng, tính bằng phần của giá vào.

`stop_loss_atr` và `reward_risk` thay giá trị riêng của thị trường cho cả hai tầm nhìn. Khi cắt lỗ theo ATR nằm xa hơn trần, cắt lỗ được kéo vào sát ngay trong trần, không bao giờ vượt một tick. Mục tiêu và chốt lời đầu tiên được đặt theo khoảng rủi ro nhỏ hơn đó, nên tỷ lệ lợi/rủi ro không đổi và cỡ lệnh lớn lên theo khoảng ngắn hơn. Kế hoạch khi đó mang `market.stop-capped`. Với `gold-vn`, trần tính xuống từ giá cửa hàng mua lại, nên chênh lệch mua/bán cộng thêm ở trên.

Đặt bất kỳ khóa nào trong ba khóa này sẽ thêm hậu tố vào phiên bản chiến lược của thị trường đó (`1.0.0+3f9a1c0b`). Kế hoạch định giá theo khóa của bạn giữ bảng thành tích riêng, không bao giờ được phục vụ lại khi khóa đổi, và mã đang nắm được lập kế hoạch lại một lần. Cắt lỗ chỉ nâng lên, nên nới khóa không bao giờ hạ một mức cắt lỗ bạn đang giữ. Các khóa và khoảng giá trị: [Cấu hình](cau-hinh.md).

#### Lệnh mua crypto sau một đợt tăng nóng nằm dưới giá

Khi một mã đã tăng 25% trở lên qua bảy phiên đã settle gần nhất, giá vào là một lệnh limit mua thấp hơn giá trực tiếp nửa ATR, đứng năm phiên. Cắt lỗ, chốt lời, mục tiêu và giá vô hiệu đều được định giá từ mức limit đó.

Đo ngày 2026-10-15 trên nến theo giờ của 81 mã, với limit chỉ tính là khớp khi có giao dịch xuyên qua nó sau khi đặt: nó hơn mua ở giá hiện tại 2,4% mỗi lệnh trên các lối thoát của chính kế hoạch (t 3,2; 85% khớp). Kế hoạch bảo bạn đặt nó trên sàn dạng good-til-cancelled, vì `/trade` chỉ đặt lệnh khớp ngay. Quy tắc này là chính sách mức giá của thị trường, không phải một cài đặt.

#### Cỡ lệnh

Cỡ lệnh được lập ngân sách trên cắt lỗ lúc vào; trạng thái thị trường (regime) co cả lệnh. Trần rủi ro chia ngân sách mỗi lệnh cho khoảng ATR từ giá vào tới cắt lỗ, không bao giờ cho một mức cắt lỗ đã bị trail hay ratchet kéo gần lại. Lối thoát chặt hơn không phải một ván cược nhỏ hơn.

Hệ số trạng thái thị trường của nhóm giảm cỡ cuối cùng, cùng với mức tin cậy và ý định của trader. Một nhận định phòng thủ nên thu nhỏ lệnh mua kể cả khi tiền mặt không phải trần ràng buộc. `suggestion.size-scaled-by-regime` báo khi trạng thái thị trường là cái chặt nhất trong ba.

Mọi mã trong một lượt `/suggest` đều được tính cỡ trên cùng cuốn sổ như nó đứng trước lượt đó. Nên mỗi
lệnh mua tự nó vừa với tiền mặt và phần rủi ro mở còn lại.

Sau các kết luận, "Nếu bạn thực hiện mọi đề xuất ở trên" liệt kê những gì hai lệnh mua trở lên cùng
vượt:

- trần ngành hoặc nhóm;
- số tiền mặt sổ có thể chi (và, khi venue của một thị trường chạm tới ít hơn, tiền mặt của thị trường
  đó);
- phần còn lại dưới trần rủi ro mở.

Lệnh bán chưa giải phóng tiền mặt hay rủi ro mở cho tới khi nó settle, nên chỉ lệnh mua được tính. Đó
là một ghi chú, không phải lời từ chối. Con số rủi ro mở đọc cắt lỗ đã lưu của từng lệnh mua, nên một
cắt lỗ đã được nâng theo mức đang nắm khiến nó nghiêng về phía im lặng.

#### Dùng lại trên thị trường không có ranh giới phiên

Một ngày crypto chỉ là quy ước vẽ biểu đồ, nên việc dùng lại tính theo tuổi chứ không theo ngày. Phiên chạy lúc 23:00 UTC và lúc 01:00 cách nhau hai giờ, không phải hai ngày. Một dòng trẻ hơn 4 giờ thỏa cổng dù rơi vào ngày nào. Thời gian chờ vẫn đếm theo phiên.

Một lệnh mua cũng đứng cho tới khi không còn lấy được như đã viết. Giá vào của nó là giá trực tiếp, thứ dịch chuyển xa giữa các phiên chạy; định giá lại cùng một ý tưởng crypto mỗi ngày có thể dời cắt lỗ tới 21%. Phiên chạy phục vụ lại đúng lệnh mua đó, đánh dấu `reused`, khi tất cả điều sau đúng:

- lời gọi mới nhất trên mã là một lệnh mua chưa chốt, nằm trong cửa sổ kết cục của nó;
- bạn chưa giao dịch mã đó;
- giá trực tiếp nằm giữa cắt lỗ và giá vô hiệu của nó;
- không phiên đã settle nào kể từ đó giao dịch xuyên qua cắt lỗ.

Cái gì không đọc được thì chạy mới, và `force` luôn chạy mới.

#### Một phạm vi, một đề xuất mỗi ngày

Một đề xuất được định danh bằng thị trường, mã, phiên bản chiến lược, **khóa phạm vi** và ngày. Các lời gọi của chính bạn là phạm vi `default`. Một agent có `[focus]` lưu dưới một khóa suy ra từ bảng đó (đã sắp xếp và khử trùng, nên đổi thứ tự một danh sách không bao giờ tách một hồ sơ).

Mọi thứ đọc "lời gọi trước" đều đọc theo phạm vi: các cổng thời gian chờ và dùng lại, luận điểm đang đứng mà một phiên chạy mới kiểm, và phép hiệu chỉnh định cỡ một lệnh mua. Phạm vi chỉ có kỳ hạn không được hòa vào của bạn. Kế hoạch thoát, kết luận mà `/rebalance` đọc và trail nâng cắt lỗ chỉ đọc `default`: một cuốn sổ, một kế hoạch. Mọi phạm vi đều được chấm điểm, và lịch sử giá được viết lại sẽ vô hiệu các lời gọi đang mở của mọi phạm vi trên mã đó.

Phép hiệu chỉnh làm hạ độ tin cậy và định cỡ lệnh mua chỉ đọc những lời gọi đã hết cửa sổ theo dõi, nên các lệnh bị cắt lỗ sớm không làm bảng thành tích trông tệ hơn thực tế.

Một mã nằm ngoài phạm vi của agent gọi thì bị từ chối trước mọi lời gọi mô hình, kèm tên phạm vi. Màn hình sàng lọc nó chạy được thu hẹp về các thị trường và ngành của nó trước khi xếp hạng, nên bảng và tiêu đề đếm ngành, không phải cả thị trường. `/suggest`, bản tin, `/suggest stops` và kế hoạch đã ghi luôn là phạm vi của chính bạn.

Một lời gọi phạm vi đọc như một ý kiến thứ hai. Nó mở bằng dòng đó và mang mức giá, luận điểm, tranh luận và caveat, nhưng không có cỡ lệnh, số đơn vị, số tiền, ghi chú lệnh hay gợi ý `/record`, và cả JSON lẫn thẻ của nó đều không mang vị thế đang nắm. Hành động theo nó sẽ mở một vị thế mà không kế hoạch nào theo dõi.

### Kết cục và bảng thành tích

Các đề xuất được chốt dựa trên các nến sau đó: `target`, `stop` hoặc `expired`, kèm lợi suất và, nếu có chuẩn so sánh, lợi suất của chuẩn trong cùng cửa sổ. Chuẩn đọc từ bộ đệm cũ, hoặc dừng sớm hơn phiên thoát quá một phiên, thì không được so sánh, thay vì so trên một quãng ngắn hơn.

**Cửa sổ.** Một lời gọi được đọc ở cuối cửa sổ nắm giữ của chính nó. Lời gọi nằm chờ trong lúc dịch vụ nền tắt quá mốc nhìn lại một năm vẫn được chấm như lẽ ra lúc đó. Nếu không còn nến của cửa sổ ấy, lời gọi đóng với không có kết quả (không phải `expired` phẳng) và nằm ngoài mọi phép đếm có chấm điểm. `/reflect` đếm nó cùng các dòng đóng vì lịch sử giá bị viết lại.

Một giá in nằm trong biên độ của chính phiên nó. Nếu nến phiên của một lời gọi không còn bao được giá mà nó được định, thì một đợt cổ tức hay chia tách đã điều chỉnh chuỗi bên dưới, và lời gọi đóng theo cách đó thay vì chấm các mức giá trên một thang mà chuỗi đã rời.

**Phí.** Mọi lợi suất đã chốt là ròng sau phí khứ hồi tại sàn mà thị trường ghi vào theo mặc định (`fees` của từng sàn, qua `default_for`). Lời gọi VN trả phí môi giới và thuế bán; lời gọi crypto trả phí taker; thị trường không có sàn nào có phí thì trả cố định 0,1%. Phiên bản công thức kết cục tách các dòng chấm theo hai cách.

**Khóa giá trần/sàn VN.** Một phiên giao dịch cả ngày ở một giá kẹt biên là không có đối ứng ở một phía, và bộ chấm điểm không ghi gì ở phía đó.

- Kẹt sàn: cắt lỗ của lệnh long được giữ tới khi bảng mở lại, rồi khớp ở giá mở cửa của phiên đó hoặc ở mức cắt lỗ, tùy cái nào thấp hơn.
- Kẹt trần: giá vào của lệnh mua dời tới giá mở cửa của phiên kế tiếp có giao dịch, và T+2 cùng phép so chuẩn đều đếm từ lần khớp đó.
- Lệnh bán chốt mục tiêu vào trần kẹt vẫn khớp, vì bên mua xếp hàng ở trần.
- Lời gọi mà trần chặn suốt cửa sổ đóng là `unfilled`: không giao dịch, không kết quả, nằm ngoài mọi phép đếm có chấm điểm.
- Mã bạn đang nắm đóng cửa ở giá trần hoặc sát trần được đề xuất giảm bớt một phần ngay phiên mở cửa kế tiếp (`ceiling-close`, trong mục Bán một mã đang nắm).

**Lệnh mua treo.** Lệnh mua treo khớp ở phiên đầu tiên giao dịch dưới limit của nó (chạm chưa phải
khớp), ở giá mở cửa phiên đó nếu phiên mở thấp hơn.

- Trong ngày của chính lời gọi, chỉ mức dịch từ giá tới giá đóng được tính, vì đáy ngày có thể in
  trước khi lệnh tồn tại.
- Ở chính phiên khớp, mục tiêu chỉ được tính khi phiên mở thấp hơn limit (khớp lúc mở cửa do giá
  nhảy). Phiên mở bằng hoặc cao hơn limit là khớp giữa chừng, và một nến ngày không nói được đỉnh có
  in trước hay không. Nên mục tiêu được đọc từ phiên kế tiếp.
- Cắt lỗ vẫn được thử ngay ở phiên khớp, như ở mọi phiên, trước mục tiêu.
- Limit chưa khớp tới ngày cuối cùng của nó đóng là `unfilled` theo cách tương tự. `/reflect` đếm các
  lời gọi này riêng khỏi những lời gọi đã diễn ra.

Biên độ được đọc là biên lưu cho phiên đặt lệnh, nên biên ngày đầu rộng hơn của một mã mới niêm yết cũng áp cho các phiên sau, và một khóa trong vài tuần đầu có thể bị bỏ sót.

**Bảng thành tích cho thấy gì.** Nó mở bằng các lời gọi mà nó rút ra: đã có bao nhiêu đề xuất, bao nhiêu đã diễn ra, bao nhiêu còn mở, và bao nhiêu nằm trên thị trường không có chuỗi giá nên không bao giờ chấm được. Rồi nó báo tỷ lệ thắng, lợi suất trung bình và trung vị, phép so chuẩn, và **hiệu chỉnh theo dải mức tin cậy**. Một tỷ lệ không có mẫu số thì không nói lên gì. Nếu các lời gọi tin cậy cao không thắng nhiều hơn lời gọi tin cậy thấp, đó là con số đáng thấy cạnh con số tiêu đề.

Mọi tỷ lệ đếm các lời gọi độc lập. Một lời gọi lặp lại lời gọi còn mở trên cùng mã và cùng chiều thì đi cùng một nhịp, nên được gộp vào lời gọi đầu. Bản tin tái phát hành một ý tưởng đang nắm mỗi phiên, và mỗi dòng nếu không sẽ bị đếm như một kết cục nữa. `/reflect` báo đã gộp bao nhiêu. Hồ sơ theo phạm vi và theo agent bên dưới gộp cùng cách, trên các lời gọi của riêng từng phạm vi (như `/reflect` đọc một phạm vi), nên một phạm vi chạm mức tối thiểu để báo cáo bằng các lời gọi độc lập và mẫu của nó khớp với điều `/reflect` nói về nó.

Khoảng nằm cạnh mỗi tỷ lệ cho biết con số đó chắc đến đâu: ít lời gọi thì khoảng rộng, và hai tỷ lệ có khoảng chồng lên nhau thì thực ra chưa khác nhau.

`/reflect` cũng nói bạn đã làm gì với các lời gọi đã diễn ra, đọc từ sổ lệnh lúc làm báo cáo và không bao giờ lưu. Một lời gọi được tính là đã làm theo khi có lần khớp cùng chiều trên cùng công cụ nằm giữa phiên đặt lệnh của nó và ngày nó được chấm xong. Nó in hai con số, mỗi con chỉ khi nhóm của nó đạt mức tối thiểu để báo cáo của bảng thành tích:

- lợi suất trung bình của các lời gọi đã làm theo so với các lời gọi bạn bỏ qua;
- chênh lệch trung bình giữa mỗi lần khớp và giá vào được đề xuất (implementation shortfall; dương nghĩa là khớp tệ hơn).

Một lần khớp vàng VN được ghi theo đơn vị của cửa hàng trong khi đề xuất của nó báo giá theo lượng, nên hãy đối chiếu một lệnh mua vàng đã ghi với đề xuất của nó trước khi tin dòng shortfall cho vàng.

#### Thành tích của chính bảng giá

Đề xuất chỉ là vài mã mỗi phiên; màn hình sàng lọc chấm cả trăm. Vì vậy mỗi phiên đã settle, dịch vụ
nền ghi lại toàn bộ bảng của từng thị trường, mỗi loại mã một bảng. Quỹ ETF VN được ghi bên cạnh cổ
phiếu, kèm chỉ số tổng hợp, điểm yếu tố, giá đóng và các nguồn đã cung cấp bảng.

- Mỗi dòng được chấm theo lợi suất đóng-tới-đóng trong cửa sổ kỳ hạn của chính thị trường, so với chuẩn
  nếu thị trường có nêu chuẩn.
- Cả hai giá đóng lấy từ chuỗi như nó đang đứng lúc dòng được chấm, nên một đợt cổ tức hay chia tách
  sau đó không làm dịch cái nào.
- Không cắt lỗ, không mục tiêu, không phí: nó đo bằng chứng, không đo một giao dịch.
- Mỗi dòng ghi tên nguồn, nên những phiên phải dùng nguồn dự phòng có thể đo riêng. Ở thị trường có
  nhiều bảng thì ghi cả loại mã của bảng, nên có thể đo riêng chỉ số tổng hợp của quỹ và của cổ phiếu.
  Các dòng ghi trước thay đổi này không có hai thông tin đó.

`/reflect` in nó thành khối quy kết thứ hai. Đó là mẫu mà các trọng số yếu tố và dải mức tin cậy được khớp theo khi nó lớn dần. Mỗi yếu tố được chấm theo phiên bản chiến lược, hai bản mới nhất mỗi thị trường, vì đổi phiên bản làm yếu tố đo thứ khác.

Một script nghiên cứu đo các yếu tố VN trên lịch sử ([trang dành cho lập trình viên](dev/giao-dich.md)).
Đo trên 2025-01 tới 2026-07, nó giải thích ba lựa chọn:

- lý do chỉ số tổng hợp cổ phiếu VN không mang `size` hay `sector-strength`;
- lý do `quality` được đọc nhưng không có trọng số trong điểm;
- lý do các điểm cắt mức tin cậy được khớp trên 75 bảng hằng tuần.

Trong giai đoạn đó, một ngành đã chạy trước chọn ra các mã yếu hơn, và các doanh nghiệp chạy tốt nhất
không thắng bảng. Cả hai kéo các lệnh mua tin cậy trung bình về chỗ lệnh tin cậy thấp đứng. Tập mẫu là
các mã niêm yết hôm nay, nên hãy đọc nó như một hình dạng, không phải một con số chính xác.

Chất lượng vẫn in trên các dòng lợi nhuận và sức khỏe, vẫn lập danh sách ngắn cho các mã theo chủ đề,
và vẫn quyết định lệnh bán theo luận điểm của một khoản nắm dài hạn khi không có báo cáo năm nào để
chấm.

Một mã ngừng giao dịch trong khi chuẩn của thị trường vẫn in sẽ được chốt ở giá đóng cuối của nó, đánh dấu là đã dừng, khi chuẩn đã in mười phiên mà không có nó và đã tới cuối cửa sổ. `/reflect` báo bao nhiêu mã. Không gì được điền suy diễn.

Mã mà danh sách niêm yết của thị trường vẫn gọi là đang hoạt động thì chờ ba mươi phiên thay vì mười. Danh sách đến từ nguồn khác với nến, nên một feed mất chuỗi của một mã có sáu tuần để được sửa trước khi bị đọc là dừng giao dịch. Một đợt đình chỉ mà danh sách không bao giờ báo vẫn được ghi nhận.

#### Hồ sơ theo phạm vi, và độ trùng

`/reflect` cho thấy hồ sơ của chính bạn (chỉ phạm vi `default`), rồi một khối "Theo phạm vi" khi một agent đã gọi dưới phạm vi riêng. Với mỗi phạm vi nó cho thấy:

- các lời gọi đã chốt (lời gọi độc lập, như trên) và tỷ lệ thắng;
- tần suất nó chọn cùng hành động với các phạm vi khác trên cùng mã và ngày;
- khi nó đi ngược các phạm vi khác và cả hai phía đã được chấm, ai đúng.

Hồ sơ của một agent trên mọi phạm vi nó từng dùng nằm ở `agent show`. Sửa một phạm vi không bao giờ bắt đầu một hồ sơ mới, và khóa cũ với khóa mới không bao giờ được đem so với nhau.

Quy tắc giống nhau ở mọi nơi đo:

- Lời gọi nhóm theo mã và ngày. "Các phạm vi khác" là mọi phạm vi khác trừ phạm vi của chính agent đó.
- Đa số là hành động mà hơn một nửa trong số đó chọn. Hòa hay chia ba thì không so.
- Giữ nguyên là một hành động. Một lần giữ nguyên chưa quyết (phiên chạy hỏng) và một kế hoạch đã ghi không phải một lời gọi và không bỏ phiếu.
- Một ca đối nghịch cần cả hai phía đã chấm và đa số không phải giữ nguyên, nên đa số giữ nguyên bị loại.
- Hai phạm vi bị đánh dấu là một góc nhìn khi chúng cùng lời gọi từ 95% trở lên trên ít nhất 20 mã cả hai đều gọi, không tính mã cả hai cùng giữ. Hai agent chờ mọi thứ không bị coi là bản sao.
- Dưới 20 ca so sánh được thì chỉ in số đếm, không bao giờ in tỷ lệ.

Công cụ `suggestion_track_record` trả hồ sơ và độ trùng của phạm vi riêng agent đang hỏi. `GET /v1/suggestions?focus=` liệt kê các lời gọi của một phạm vi.

### Cảnh báo và bản tin

**Cảnh báo** là các ngưỡng giá (`above` / `below`) nổ đúng một lần và gửi tới một kênh.

**Việc gửi.** Mỗi lần nhận một lượt gửi có thời hạn 60 giây. Gửi hỏng thì được thử ba lần, chờ 30 giây rồi một phút giữa các lần, sau đó bỏ lượt gửi đó thay vì thử lại mãi:

- cảnh báo do hệ thống dựng bị tắt, rồi được dựng lại sau 15 phút chừng nào mức đó còn được kỳ vọng, vì thông báo chưa hề tới bạn; cảnh báo do một lượt đối soát tắt thì nghỉ chừng nào dòng của nó còn được giữ (`[retention] days`);
- ngày của một bản tin bị bỏ và ngày mai được lên lịch;
- cảnh báo bạn tạo bằng `/alert` không bao giờ bị tắt vì gửi hỏng. Nó là của riêng bạn và không gì dựng lại nó, nên nó cứ thử lại, mỗi lần chờ gấp đôi lần trước và tối đa một giờ, cho tới khi kênh nhận hoặc bạn chạy `/alert disable`.

Chat đã bị `pair revoke` thì khác: không lần thử lại nào tới được, nên ngay lần gửi đầu tiên bị từ chối, cảnh báo đó tắt luôn (của bạn hay do hệ thống dựng đều vậy) và bản tin sáng cũng tắt. Cảnh báo thoát và sàng lọc đi theo chat của bản tin, nên chừng nào chat đó còn bị thu hồi thì chúng thôi được dựng, kể cả khi bản tin đã tắt từ trước; ghép nối lại chat đó, hoặc chạy `/brief enable` từ một chat khác, thì chúng được dựng lại.

**Việc đánh giá** có giới hạn và dùng chung:

- Mỗi nhịp duyệt qua mọi cảnh báo đang hoạt động, nên cắt lỗ hay mục tiêu được kiểm mỗi phút dù có bao nhiêu cảnh báo.
- Mỗi **công cụ mỗi nhịp** chỉ lấy một giá, dùng chung cho mọi cảnh báo theo dõi mã đó. Vừa nhanh vừa nhẹ cho giới hạn tốc độ của nguồn. Nó chỉ sống trong một nhịp.
- Ngưỡng được so với **đỉnh và đáy của phiên**, không chỉ giá cuối, nên mức bị chạm giữa hai lần hỏi vẫn nổ. Cảnh báo tạo sau khi phiên đã mở chỉ đọc giá cuối trong phiên đó, vì cực trị của phiên gồm cả các biến động trước khi nó bắt đầu theo dõi.
- Cảnh báo trên thị trường đóng hẳn (cuối tuần, nghỉ trưa) bị bỏ qua để khỏi tốn giá trực tiếp. Trước giờ mở và sau giờ đóng vẫn đánh giá theo giá đóng đã settle.
- Giá thiếu hoặc không hữu hạn thì cảnh báo vẫn hoạt động và nói rõ lý do. Một cảnh báo lặng lẽ ngừng theo dõi tệ hơn một cảnh báo nói rằng nó không nhìn được.

**Hai loại cảnh báo.** **Cảnh báo của operator** là cái bạn tạo bằng `/alert`. **Cảnh báo do hệ thống dựng** mang một danh tính cố định mà lượt dựng đối soát theo. Phát hiện cắt ngưỡng, thử lại và tắt hoạt động giống nhau ở cả hai.

| Dựng cho | Ngưỡng |
|---|---|
| Mỗi đề xuất hành động đứng sau một vị thế bạn nắm (cảnh báo thoát) | Cắt lỗ của kế hoạch như đã trail tới hôm nay, và mục tiêu của nó |
| Mọi mã trong danh sách theo dõi và đang nắm (cảnh báo sàng lọc) | Một dải mỗi bên của giá đóng đã settle |

Thị trường nào khai một trail thì nâng cắt lỗ đã lưu mỗi phiên đã settle. Mức được nâng lên được dựng thành một cảnh báo mới và cảnh báo cũ nghỉ hẳn. Một phiên chạy lại `/suggest` trong ngày mà thay một lệnh mua sẽ giữ mức mà trail đã đạt tới khi nó nằm trên cắt lỗ của kế hoạch mới: một mức cắt lỗ không bao giờ đi xuống. Một lần ghi hỏng được thử lại ở nhịp kế tiếp thay vì chờ phiên sau.

Một nhịp cảnh báo gửi cái đến hạn trước, rồi chạy hai lượt dựng, mỗi lượt riêng. Một lượt hỏng được ghi log (`trading.alert_arming_failed`) và lượt kia vẫn chạy, nên cảnh báo giá vẫn được gửi dù các lượt dựng làm gì. Trong lượt thoát, việc lập kế hoạch hỏng ở một mã được ghi log kèm mã đó (`trading.exit_holding_failed`) và mã ấy giữ kế hoạch nó đang có, còn các mã khác vẫn được lập như thường. Chính bước gửi mà hỏng thì vẫn dừng vòng lặp, như trước.

Cả hai lượt đều **đối soát** chứ không nối thêm: tính ra những cảnh báo nào nên tồn tại lúc này, dựng cái còn thiếu, và tắt cái không còn được kỳ vọng. Cảnh báo thoát đi theo cuốn sổ, nên một chỉnh sửa sổ lệnh làm đổi vị thế sẽ bật hoặc tắt cảnh báo ở nhịp kế tiếp. Một dải sàng lọc gắn với ngày settle của nó, nên các dải hôm qua nghỉ hẳn ở nhịp đầu tiên sau lần settle kế tiếp.

Dải sàng lọc là `biên độ ngày trung bình x breakout_range` mỗi bên của giá đóng đã settle, đo trên `breakout_sessions` phiên (cả hai ở `[trading.alerts]`). Chúng quyết định khi nào bạn được báo, không quyết định một đề xuất nghĩa là gì. Một mã có dưới năm phiên dùng được trong cửa sổ thì không dựng gì: một mức trung bình dựng trên lịch sử thiếu sẽ nổ theo nhiễu.

**Bản tin** là phiên chạy hằng ngày duy nhất: một bản tin sáng trước giờ mở. Không có phiên chạy sau giờ đóng. Đề xuất đã chốt và cảnh báo đã nổ được gộp vào bản tin sáng hôm sau.

- Mục không dựng được thì đánh dấu `unavailable`.
- Mục không có gì để nói hôm đó (không cảnh báo nào nổ, không đổi trạng thái thị trường) là `omitted-by-policy`.

Hai thứ này được tách riêng vì chỉ một trong hai là vấn đề.

Bản tin mở đầu bằng một **câu chuyện thị trường**, do code tìm ra, không gọi mô hình và không tốn phí,
cùng phần nhìn lại các câu chuyện trước.

- **Phần nhìn lại** đối chiếu các điều kiện theo dõi của một câu chuyện đã kể ở phiên trước với số liệu
  hôm nay, và cho biết câu chuyện đó có đúng hướng hay không.
- **Câu chuyện** nêu một điều bất thường mà thị trường Việt Nam vừa làm. Nó gồm một câu dẫn, các số
  liệu đứng sau, nhận định được ghi rõ là suy luận, điều có thể khiến nhận định sai và điều cần theo dõi
  tiếp.
- Mỗi câu chuyện chỉ được kể một lần, vào phiên đầu tiên nó xuất hiện. Khi nó còn tiếp diễn, phần nhìn
  lại sẽ mang nó đi tiếp. Khi phần nhìn lại đã khép nó, bản tin ghi rằng câu chuyện vẫn đang tiếp diễn,
  kèm số phiên.
- Phiên nào không có gì bất thường thì chỉ in một dòng yên ả. Phiên nào chỉ có những câu chuyện đã kể
  thì bản tin ghi là chưa có chuyện mới, và không nói thêm gì khi phần nhìn lại phía trên đã nhắc hết
  các câu chuyện đó.

Câu chuyện chỉ đọc thị trường và phiên đã chốt gần nhất, không bao giờ đọc sổ của bạn hay giá đang
chạy. Nó không xuất hiện khi bản tin không có khối thị trường Việt Nam: nhóm này đang tắt và bạn không
giữ hay theo dõi mã Việt Nam nào.

Một bản tin đọc theo thứ tự này: khối **operator** mở đầu bằng cuốn sổ (bạn đang nắm gì, trước mọi bình luận thị trường); mỗi thị trường một khối **thị trường**, đề tên và glyph của chính thị trường đó, chỉ mang các mục thị trường đó công bố; và khối **hành động** ở cuối.

| Khối | Các mục |
|---|---|
| Câu chuyện, trên mọi khối | `thesis-review` `story` |
| Operator | `session-delta` `book-summary` `resolved-suggestions` `fired-alerts` `position-exits` `unwatched-positions` `stale-positions` `positions-in-loss` `cross-asset-pulse` `trade-sides` `drift-nudge` `monthly-scorecard` |
| Bối cảnh vĩ mô | `regime-shift` `macro` `deposit-rate` `macro-headlines` `economy-headlines` |
| Mỗi thị trường | `reading` `market-prices` `market-quotes` `market-board` `tape` `breadth` `turnover` `range` `market-cap` `sector-rotation` `foreign-desk-flow` `proprietary-flow` `derivatives` `taker-flow` `etf-flows` `positioning` `premium` `leaders` `leaders-24h` `movers-session` `movers-24h` `sentiment` `basis` `fx` |
| Danh sách theo dõi | `watchlist-leading` `watchlist-dropped` `screen-delta` |
| Tin tức | `disclosures` `index-review` `events` `headlines` |
| Hành động | `cost` `suggestions` `cross-asset-suggestions` `next-actions` `discipline` |

Hai mục mức giá, `fired-alerts` và `position-exits`, in mức giá cổ phiếu VN theo giá bảng điện như `/portfolio` và `/alert`; thang giá được ghi một lần ở cuối bản tin.

Mỗi thị trường chỉ công bố các mục riêng mà nó có dữ liệu, nên thêm một thị trường là thêm một khối chứ không thêm mục mới. Thị trường nào công bố chỉ số tổng hợp riêng mà không giữ khu vực của mình (crypto) thì mang nó trên khối `/overview` của chính nó, với cùng các dòng điểm, yếu tố dẫn dắt, thiếu và độ phủ. Số đọc khu vực phía trên nó là của thị trường giữ khu vực.

**Thứ tự đọc.** Báo cáo nào cũng mở đầu bằng câu trả lời và kết thúc bằng phần chú thích:

- `/suggest` mở bằng kết luận (`nên MUA`, `CHƯA MUA hôm nay`...), rồi mỗi mức giá một dòng, rồi lập luận và điều sẽ chứng minh nó sai, sau đó mới tới các yếu tố và phần tranh luận. Ngày dữ liệu, hồ sơ, đơn vị giá và ghi chú rổ chỉ số nằm cuối báo cáo.
- `/rebalance` lấy chính kế hoạch làm tiêu đề (nên mua hoặc bán bao nhiêu mã, tổng bao nhiêu tiền); mỗi lệnh chỉ còn phần mua trước và tỷ trọng, tổng tài sản và hồ sơ nằm cuối.
- `/portfolio` đặt cảnh báo tiền mặt cao hơn mục tiêu ngay dưới dòng tổng tài sản, và tách tiền mặt khỏi lãi/lỗ.
- `/overview` chỉ in bảng yếu tố vĩ mô một lần: thị trường thứ hai dùng cùng chỉ số tổng hợp sẽ ghi một dòng thay vì in lại.
- Tiêu đề tin và trích dẫn in nguyên văn theo nguồn; tin viết bằng ngôn ngữ khác với bạn được ghi chú, ví dụ `(tiếng Anh)`.

**Thang** cho thấy một số đọc nằm ở đâu giữa hai đầu. Đầu bên trái **luôn** là đầu bất lợi cho người đọc, và `●` là chính số đọc đó. Số đọc vượt quá một trong hai đầu thì nằm ngoài khung.

- `/overview` vẽ chỉ số tổng hợp trên thang `-1`..`+1` với `┼` ở các ngưỡng trạng thái, và vẽ từng yếu tố dẫn dắt giữa các neo bearish và bullish của nó. Với lãi suất, neo bearish là con số lớn hơn, nên thang tự làm phép đảo giúp bạn.
- Mỗi dòng `/portfolio` có kế hoạch vẽ giá trực tiếp của nó giữa mức cắt lỗ và mức chốt lời, trên một dòng riêng, có ghi rõ hai mức giá.
- Một đề xuất thì không vẽ gì. Mức chốt lời đầu tiên của một kế hoạch mới nằm đúng một đơn vị rủi ro trên giá vào, nên cái dấu sẽ luôn nằm giữa và chẳng nói gì.
- Kết quả công cụ do mô hình chuyển tiếp in bằng chữ thường, không có glyph nào.

**Thanh nhóm** chỉ hiện trên điện thoại, dưới dòng đầu của mỗi nhóm: 20 ô, mỗi ô 5% NAV, nên các thanh so sánh được giữa các dòng. `█` là phần đang nắm (`▌` là nửa ô) và `○` là mức duy nhất mà dòng được đọc so với: mục tiêu trong `/rebalance`, trần trong `/portfolio`. Chú giải dưới mỗi bảng nêu tên nó. `○` rỗng để vẫn thấy được bên trong phần tô. REPL giữ lưới thường, nơi các con số thẳng hàng đã mang số đọc. `/profile` không vẽ thanh: nó hiện cài đặt, không hiện số nắm giữ.

**Đợt cơ cấu chỉ số kế tiếp.** Bản tin nêu phiên cơ cấu FTSE GEIS hoặc VN30 kế tiếp, tính từ quy tắc rà soát chứ không từ một danh sách được bảo trì. Vào đêm trước, mọi đề xuất VN trên một mã thuộc rổ chỉ số mang ngày đó như một caveat. Đến chính phiên đó, lệnh mua mới bị từ chối và các mã đang nắm đọc caveat thay vào. Không có cài đặt nào: các ngày là của sàn, không phải của bạn.

**Các mục đề xuất chạy sau cùng và tốn nhất**, trên phần ngân sách riêng của bản tin. Nếu hết ngân
sách thì mất các mục đó, không bao giờ mất cả bản tin.

- Mỗi mục chạy một cuộc tranh luận **lean** trên mọi mã đang nắm trong phạm vi của nó trước, rồi tới
  danh sách theo dõi: `suggestions` cho VN, `cross-asset-suggestions` cho mọi thị trường khác.
- Mã nào có cuộc tranh luận chưa xong (thiếu key, một vai lỗi, hết ngân sách) thì hiện CHƯA KẾT LUẬN
  và không kèm mức tin cậy, thay vì CHỜ. Chưa có quyết định nào, và kế hoạch đang có vẫn tiếp tục theo
  dõi mã đó.
- Đề xuất lấy lại từ lúc sớm hơn trong ngày, mà sổ của bạn đã đổi sau đó, được nêu tên một lần ở cuối
  bản tin kèm `/suggest <mã> force` để tính lại.

Một mã đang nắm không bao giờ bị cắt, vì chính phiên chạy của nó là thứ định giá lại kế hoạch:

- một cắt lỗ mới (ratchet, không bao giờ thấp hơn mức đang đứng);
- một mục tiêu mới;
- mức chốt lời đang đứng, giữ cho tới khi đợt đầu tiên được bán;
- mọi lý do reduce, mà cảnh báo thoát dựng ở nhịp kế tiếp.

Một mã đã được đề xuất trong ngày thì được phục vụ từ dòng của nó mà không tốn gì.

`next-actions` chạy sau cùng vì nó đọc kết quả thật của các mục khác. Nó chỉ gợi ý `/rebalance` khi có gì đó đã lệch và chỉ gợi ý `/alert` khi có cảnh báo đã nổ.

Chi phí của lần đọc nằm dưới một đường kẻ ở tận cuối, vì nó thuộc cả bản tin. Việc tách theo thị trường ngăn một con số bị báo hai lần dưới hai tiêu đề: mức chênh vàng trong nước thuộc khối của `gold-vn`, positioning hợp đồng tương lai thuộc khối của `gold`.

**Thời điểm.** Giờ gửi mặc định là 08:15 theo múi giờ **của thị trường** (08:15 ở TP.HCM, không phải 08:15 UTC và không phải ở nơi bạn đang ngồi). Bản tin chỉ được gửi khi phiên còn trước giờ mở (thị trường giao dịch suốt ngày, hoặc ngày thị trường nghỉ, vẫn tính là trước giờ mở), nên không bao giờ dựng hay gửi giữa phiên hoặc sau giờ đóng, và một phép kiểm trước khi chạy xác nhận phiên trước đã tạo ra một cây nến trước khi tốn token nào.

Sau thời gian ngừng hoạt động, các buổi sáng đã lỡ không được phát lại.

- Một ngày đã lên lịch mà đã qua bị bỏ qua với cảnh báo `trading.brief_stale_day_skipped`, và lịch
  chuyển sang hôm nay.
- Bản tin hôm nay vẫn được gửi muộn nếu dịch vụ nền khởi động sau giờ gửi nhưng trước giờ mở.
- Nếu dịch vụ nền khởi động sau giờ mở, hoặc một lần gửi lại rơi vào sau giờ mở, bản tin hôm nay bị bỏ
  qua với cảnh báo `trading.brief_past_open_skipped`. Chat nhận một dòng báo điều này, và bản tin sáng
  hôm sau là bản kế tiếp.
- Bản tin bắt đầu dựng trước giờ mở nhưng xong sau đó vẫn được gửi, kèm dòng đầu báo giá đã chạy từ
  lúc viết.

Một ngày mà cả ba lần gửi đều hỏng thì bị bỏ, không phải bỏ đăng ký. Lịch chuyển sang ngày mai, `trading.brief_day_abandoned` được ghi log, và một thông báo cho biết bản tin hôm nay đã bị bỏ (gửi theo kiểu cố gắng hết sức qua đúng kênh vừa hỏng, nên có thể không tới). Chỉ `/brief disable` mới tắt bản tin sáng.

- `/brief enable 07:30` đặt giờ riêng của bạn.
- `/brief enable` không kèm giờ thì theo `[trading.briefs] send_time`, nên sửa cấu hình sau này vẫn dời bản tin.
- Bật lại sau khi bản tin hôm nay đã gửi thì bắt đầu từ ngày mai, và bị từ chối khi một bản tin đang được gửi. Lời từ chối được giữ ngay lúc ghi, nên một lần gửi bắt đầu giữa lúc kiểm tra và lúc bật vẫn giữ quyền của nó và lệnh báo rằng một bản tin đang được gửi.
- `/brief` đứng một mình hiện bản tin mới nhất, dựng một bản nếu chưa có.
- `/brief disable` dừng việc gửi.

#### Những tin chỉ nằm trong chuông

Kết quả đề xuất đã chấm, tin về mã bạn giữ và việc chỉ số của khu vực giảm mạnh vào chuông trong ứng dụng mà không tới chat nào, để ngày yên ắng thì điện thoại cũng yên ắng. Thêm loại tin
vào `[notices] chat` trong `config.toml` nếu muốn nhận cả ở chat: `call-scored`, `held-news` hoặc `index-drop` (tên nào
khác làm dịch vụ nền dừng ngay lúc khởi động, kèm danh sách hợp lệ). Mọi thứ khác dịch vụ nền gửi tới chat vẫn như cũ.

- **Một lời gọi đã được chấm.** Khi bảng thành tích đóng một lời gọi bạn đã nhận, ở mục tiêu, mức cắt lỗ hoặc lúc hết hạn,
  bạn được báo một lần: kết quả sau phí, cạnh mức chuẩn của chính thị trường đó trong cùng quãng, nếu thị trường có nêu
  chuẩn. Chỉ lời gọi có cửa sổ vừa kết thúc trong vài ngày gần đây mới được báo, nên lượt chấm đầu tiên sau khi nâng cấp
  không làm chuông ngập kết quả cũ. Chỉ lời gọi thuộc thành tích của chính bạn mới vào chuông hay chat; ý kiến thứ hai
  của một agent có phạm vi riêng chỉ hiện trực tiếp trên trang văn phòng, ở chỗ agent đó. Thẻ của lời gọi đó có đủ
  bức tranh.
- **Tin về mã bạn đang giữ.** Mỗi mã đang giữ có một thông báo mỗi ngày, kèm tiêu đề và nguồn, cho tin đăng trong ngày:
  tin cũ mà dịch vụ nền mới lưu sau đó thì không được báo. Nó chỉ gồm những mã
  dịch vụ nền đã đọc: tiêu đề được lưu lại khi một `/suggest` hay một cuộc chat về mã đó đọc đến chúng, và không có gì đi lấy
  tin cho các mã bạn giữ theo lịch. Sau khi khởi động lại, nó không lặp lại tiêu đề của ngày hôm đó.
- **Chỉ số giảm mạnh.** Khi chỉ số của khu vực giảm ít nhất 1,5% trong một phiên, mỗi phiên một lần, kiểm tra vài phút
  một lần trong lúc phiên đang chạy. Thông báo nói bao nhiêu mã bạn giữ trên thị trường của chỉ số đó đang giảm (chỉ tính theo giá trực tiếp của phiên này) và có mã nào thủng mức cắt lỗ chưa.
  Nếu có mã không định giá được, nó nói bao nhiêu mã chưa kiểm tra được, và không bao giờ khẳng định là không có mã nào
  thủng.

### Chủ đề

`/themes` là lần đọc từ trên xuống về cổ phiếu Việt Nam, và nó dừng ngay trước một giao dịch. Một phiên chạy:

1. cập nhật các chủ đề bạn đã theo dõi;
2. tìm các chủ đề mới đang hình thành từ các số liệu vĩ mô, giá hàng hóa, biến động ngành và tin tức;
3. với mỗi chủ đề bạn **đã duyệt** mà lần đọc này vẫn giữ ở trạng thái đang theo dõi: ánh xạ các ngành nó lan tới, lập danh sách ngắn các công ty bằng mã (tối đa năm công ty mỗi ngành hưởng lợi), rồi đọc chúng ba cái một lần.

Nó không đưa giá. `/suggest <mã>` mới đưa giá vào, cắt lỗ, mục tiêu và cỡ lệnh.

Các lệnh:

- `/themes` chạy nó. Nó tốn lời gọi mô hình, bị chặn bởi `[trading.themes] maximum_cost_usd`.
- `/themes run <id>` soát lại một chủ đề đang theo dõi cùng các ngành và công ty của nó, không tìm chủ đề mới, và báo cáo chỉ nói về chủ đề đó, không kèm bảng điểm các lần trước.
- `/themes show` hiện mọi chủ đề còn trong danh sách (đang theo dõi, đã kết thúc hoặc chờ duyệt) như lần đọc cuối, miễn phí. Chủ đề đã bỏ hoặc đã dừng theo dõi không hiện nữa.
- `/themes approve|reject|retire <id>` chuyển trạng thái một chủ đề.
- Qua MCP chỉ có công cụ chỉ-đọc `themes_view`.

Chuyên viên phân tích chủ đề dùng `[[model_tiers.themes]]` khi được cấu hình, nếu không thì dùng `[[models]]`.

**Mã chấm điểm, mô hình đọc.** Điểm của một chủ đề, một ngành hay một công ty là phép tính số học trên
các mức đánh giá của mô hình cùng các con số của phiên chạy, không bao giờ là một con số do mô hình tự
đưa ra. Nó mang một độ tin cậy cho biết điểm đứng trên bao nhiêu phần của lần đọc.

- Một đề xuất chủ đề được xét trên lập luận của chính nó và phải nêu tên các ngành được hưởng lợi. Nó
  liệt kê mọi điều kiện sẽ làm nó kết thúc, nên duyệt nó là duyệt luôn điểm thoát.
- Khi một lần soát không tới được các ngành của chủ đề đang theo dõi, báo cáo giữ ngành và mã của lần
  soát trước, và nói rõ là lần nào.
- Cơ hội cổ phiếu chỉ liệt kê mã có mức tin cậy từ trung bình trở lên. Mã tin cậy thấp, như mã chưa có
  P/E để định giá, vẫn hiện dưới ngành của nó, kèm nhãn.
- Chủ đề đang theo dõi mà lần soát ngành không thấy ngành nào hưởng lợi thì được chấm độ lan tỏa bằng
  không, chứ không bỏ phần đó ra. Lần soát bị lỗi thì mới bỏ ra.
- Con số "trước đó" cạnh điểm chỉ so với điểm tính cùng một cách, và chủ đề đã kết thúc chỉ hiện lý do
  kết thúc, không hiện xác suất.

**Lợi nhuận được hiện như một kịch bản cơ sở.** Một lần đọc in `kịch bản cơ sở, lãi mỗi cổ phiếu (EPS) {tăng trưởng} trong {số tháng} tháng`, tăng trưởng có dấu, không kèm xác suất. P/E mục tiêu chỉ bị từ chối khi cao hơn đỉnh năm năm của chính mã. Các số đọc trên mức trần cứng 200 bị loại khỏi khoảng.

**Mỗi lần đọc cổ phiếu được chấm sau.** Việc `theme-outcomes` so nó với VN-Index ở 3, 6 và 12 tháng
từ các nến đã lưu (không gọi mô hình), và `/themes show` in mỗi dải điểm đã đi thế nào.

- Một mã hoặc ngành được đọc dưới nhiều chủ đề trong cùng một phiên chạy chỉ tính là một ván cược, ở
  mức trung bình điểm của nó.
- Mỗi nhóm điểm in kết quả so với VN-Index khi có đủ 20 lượt đọc. Còn việc điểm cao có thắng điểm thấp
  hay không chỉ được kết luận khi mọi nhóm đều đủ 20.
- Chỉ những lần đọc chấm theo cách tính điểm hiện tại mới được tính, nên đổi trọng số điểm là bắt đầu
  một bảng mới.
- Mã niêm yết chưa đủ một năm vẫn được đo, tính từ giá đóng cửa ngày được đọc.

**Mã giữ cho mô hình trung thực.** Mã dựng gói bằng chứng và cấp mọi id trong đó (`M1`, `C3`, `N12`); mô hình chỉ trích dẫn. Chuyên viên phân tích chủ đề là persona giao dịch duy nhất có công cụ, `research`.

- Nó cập nhật các chủ đề `active` và `weakening` từng cái một, rồi đề xuất cái mới đối chiếu với các tiêu đề và luận điểm đã biết.
- Một khẳng định trích id mà gói không có thì bị bỏ, mô hình được hỏi lại một lần, và một lần đọc vẫn thiếu bằng chứng phản bác thì bị bỏ.
- Một đề xuất cần hai nguồn ủng hộ, một trong hai là vĩ mô hoặc hàng hóa, và từ một đến ba ngành hưởng lợi.
- Điều kiện kết thúc của một đề xuất được yêu cầu nêu một con số, một ngưỡng và một khoảng thời gian, bám vào động lực hoặc ngành hưởng lợi, và chưa chạm ở thời điểm đề xuất. Quy tắc này nằm trong lời nhắc; mã không kiểm.
- Một chủ đề chỉ bị đánh dấu `invalidated` khi một điều kiện của chính nó được dữ liệu cứng chống lưng. Từ đó ngành và công ty của nó không được đọc nữa, và báo cáo gợi ý `/themes retire <id>`.
- Chỉ bạn mới đặt một chủ đề thành `active`, từ chối hay cho nghỉ hẳn.

**Một ngân sách, một phiên chạy tại một thời điểm.** Một phiên chạy dùng một ngân sách, thấp hơn giữa `[trading.themes] maximum_cost_usd` và `[budget]`, và một hạn mức research. Mỗi tiến trình chỉ chạy một lượt tại một thời điểm.

- Nó không ghi gì cho tới khi mọi bước đã trả lời, và đổi trạng thái chỉ chạm các chủ đề còn đang theo dõi.
- Hết ngân sách thì dừng giai đoạn đó và nêu tên các bước bị bỏ.
- Bảng không đọc được thì bỏ giai đoạn công ty và báo một khoảng trống `screen`.
- Mỗi chủ đề bắt đầu từ lần đọc mới nhất của chính nó, nên phiên chạy cuối không bao giờ là toàn bộ bức tranh.
- Tin tức là mọi tin vào kho kể từ lần đọc cũ nhất trong các chủ đề của phiên chạy, bất kể đăng lúc nào, nên tin vào kho muộn không bị sót. Chủ đề nào được đọc gần đây hơn mốc đó có thể gặp lại vài tin cũ.

**Từ chủ đề tới công ty.** Với mỗi chủ đề `active`, mã đọc bảng, các ngành, các quý đã lưu và một ngày tỷ số định giá một lần. Chuyên viên phân tích ánh xạ chủ đề tới tối đa ba siêu ngành ICB, mỗi cái kèm một phản biện có trích dẫn. Mã rồi lập danh sách ngắn tối đa năm mã mỗi ngành từ những mã còn lại trên bảng mà yếu tố chất lượng đã bật, loại các điểm Piotroski yếu, cờ Beneish, dòng tiền tự do âm và lợi nhuận trên vốn đầu tư không dương. Chuyên viên phân tích đọc các mã ba cái một lần, không có `research`.

**Các lần đọc công ty được kiểm tra.** Mã hỏi lại một lần, rồi bỏ mã kèm một ghi chú, khi tỷ lệ kịch bản của một lần đọc cổ phiếu không cộng ra 100, P/E mục tiêu của nó cao hơn đỉnh năm năm của mã, hoặc một nhận định "lợi nhuận" không trích con số nào trong báo cáo. Mã, không phải mô hình, tính độ chen chúc và bất ngờ lợi nhuận: một tín hiệu chưa đọc không bao giờ làm một mã bị coi là chen chúc, và một mã có quý mới nhất chậm hơn lịch quá hai quý thì không được đọc.

**Một điểm được dựng thế nào.** Các lần đọc chủ đề, ngành và cổ phiếu đều được chấm 0-100 từ các trọng số cố định, lưu cùng phiên chạy.

- Phần chưa đọc thì rơi khỏi các trọng số thay vì tính bằng 0, và một lần đọc có dưới một nửa trọng số được đọc thì không được chấm.
- Một chủ đề đã bị vô hiệu, và một ngành mà nó gây hại, không bao giờ được chấm.
- Độ tin cậy đến từ trọng số được đọc và từ các con số mà lập luận của chính lần đọc trích, không bao giờ từ việc các phần chênh nhau bao nhiêu.
- Các phần được lưu cùng lần đọc, nên điểm tính lại được.
- Báo cáo gọi nó là điểm chủ đề và in trên thang 100. Một dòng phía trên chủ đề đầu tiên kể các phần của điểm một mã theo trọng số, nặng nhất trước, và nói đây không phải điểm chung -1 tới +1 mà `/screen` và `/suggest` in.
- Mỗi ngành trong danh sách ngành hưởng lợi kể mọi mã đã đọc dưới nó kèm điểm chủ đề, nên một chủ đề có mã xếp dưới năm mã đầu vẫn hiện mã của mình.

### Các tác vụ nền

Chúng chạy trong dịch vụ nền, thêm nữa khi một sàn có khóa giao dịch. Mỗi tác vụ chạy ở nhịp mặc định dựng sẵn và không làm gì khi không có gì đủ điều kiện. Cách xử lý khi hỏng nằm ở [các việc dựng sẵn](van-hanh.md).

| Tác vụ | Mỗi | Lô | Đăng ký | Làm gì |
|---|---|---|---|---|
| `alerts` | 60s | 50 | luôn | Gửi cái đã nổ, rồi đối soát cảnh báo thoát và sàng lọc theo cuốn sổ |
| `briefs` | 60s | 50 | luôn | Dựng và gửi bản tin theo lịch |
| `outcomes` | 12h | 50 | luôn | Chốt các đề xuất đang chờ dựa trên các nến sau đó |
| `macro-extract` | 12h | 3 | luôn | Đọc báo cáo của cơ quan thống kê (`nso`) và các bài báo khớp thành các chuỗi vĩ mô đã lưu, trên nhóm mô hình `extraction` |
| `theme-outcomes` | 12h | 50 | luôn | Chấm các lần đọc công ty của `/themes` so với VN-Index ở 3, 6 và 12 tháng, từ nến đã lưu; không gọi mô hình |
| `refresh` | theo phiên | - | luôn | Làm mới mọi thị trường còn dùng, rồi ghi dòng lệnh, rồi ghi bảng đã settle của mỗi thị trường và chấm các bảng cũ đã tới cuối cửa sổ của chúng (xem [thành tích của chính bảng giá](#thành-tích-của-chính-bảng-giá)) |
| `intraday` | theo lịch | - | luôn | Gửi bản đọc trong phiên vào các giờ đã cấu hình của khu vực, nghỉ giữa các lần |
| `exits` | 60s | 50 | một sàn có khóa giao dịch | Đối soát những gì đang treo ở sàn với cuốn sổ, và trail các cắt lỗ nó giữ |
| `intents` | 5m | - | có dịch vụ đặt lệnh | Chốt một lệnh mà sàn đã nhận mà cuốn sổ chưa có; không chạm sàn nào |

Hai cái cuối vắng mặt trên bản cài không có khóa sàn, nên số vòng lặp khác nhau giữa hai cuốn sổ. Một sàn không có khóa thì không treo được lệnh thoát nào, và không có dịch vụ đặt lệnh thì không có lệnh nào chưa chốt.

Vòng cảnh báo chạy theo thứ tự (gửi, dựng cảnh báo thoát, dựng cảnh báo sàng lọc), nên một cảnh báo không bao giờ được gửi bởi chính nhịp đã dựng nó. Dòng lệnh đi theo neo của refresh vì nó ghi một dòng mỗi mã mỗi phiên đã settle, đúng lúc refresh vốn đã chờ.

Chỉ nhịp `[trading.refresh]` là cấu hình được. Vòng cảnh báo và đối soát lệnh thoát đang treo chạy mỗi 60 giây, còn chốt lệnh khớp bị lỡ chạy mỗi 5 phút, cố định. Phần còn lại (`briefs`, `outcomes`, `macro-extract`, `theme-outcomes`) được điều nhịp theo chi phí của chúng.

#### Refresh được lên lịch thế nào

Refresh đi theo lịch giao dịch, không theo một khoảng cố định. Nó chạy khi mỗi phiên settle (giờ đóng cộng độ trễ khớp lệnh - cùng thời điểm quyết định một phiên có được coi là đã settle không) và 60 phút trước mỗi giờ mở, nên bản tin sáng và màn hình sàng lọc đầu tiên đọc dữ liệu tươi mà không phải trả công tải ngay tại chỗ. Thị trường nào có giờ riêng đều đặt một neo. Khoảng cấu hình vẫn còn như một trần cho thị trường liên tục và cho một registry rỗng.

Refresh phủ mọi thị trường bạn còn dùng: một nhóm đã bật trong hồ sơ, hoặc một thị trường mà bạn đang nắm một mã, theo dõi một mã, chờ một lời gọi được chấm, hoặc có bản tin lên lịch dựng trên đó. Một nhóm đã tắt chỉ rời khi không còn gì trong số đó đọc nó, nên cắt lỗ của một khoản đang nắm không bao giờ bị bỏ không có giá. Chưa có hồ sơ thì mọi thị trường đều được làm mới. Đọc tập đó hỏng thì làm mới tất cả. Bản tin sáng mô tả cùng tập đó, và nêu tên một thị trường trên `/refresh` thì làm mới nó bất kể.

Các thị trường chạy cùng lúc, không lần lượt. Chúng gần như không dùng chung nguồn, bộ điều tốc đo cái ít ỏi chúng dùng chung, và bắt mỗi thị trường chờ thị trường trước chỉ cộng dồn các host độc lập.

Bên trong thị trường chứng khoán Việt Nam cũng vậy. Lịch sử giá, chỉ số tài chính và dòng tiền được tải cùng lúc. Bối cảnh vĩ mô và báo cáo tài chính chờ ba phần đó xong, vì cả hai đọc đúng dữ liệu ba phần đó vừa lưu.

**Mỗi thị trường chỉ một lượt quét tại một thời điểm.** Một `/refresh` gõ trong lúc nhịp đã lên lịch đang chạy sẽ nhập vào lượt tải đó thay vì đua với nó. `/refresh force` là cặp duy nhất xếp hàng thay vì nhập vào: một lượt quét không force có thể bỏ qua các phạm vi mà nó cho là còn tươi, đúng cái mà `force` yêu cầu làm lại.

`/refresh <thị trường>` chỉ quét thị trường đó. Một tên chưa đăng ký nhận dòng cách dùng chứ không phải một lần bỏ qua im lặng. Một lệnh nhập vào lượt quét đang chạy sẽ nói vậy và nêu tên thị trường nó đang chờ. Mọi dòng tiến độ nêu tên thị trường của nó, vì một dòng không tên sẽ nhấp nháy giữa các thị trường dùng chung dòng.

**Chi phí đọc bảng đi cùng phiên chạy.** Lượt quét crypto lập kế hoạch trên bảng vốn hóa xếp hạng, nơi các nguồn công bố độ sâu khác nhau (750 dòng, 250 và 100). Một lượt quét đã chuyển sang nguồn nông hơn lập kế hoạch trên một phần của tập, và mọi số đếm nó báo sẽ mô tả phần đó như toàn bộ. Nên các caveat của chính bảng cùng `market-data.universe-shallow` được chuyển tới kết quả, như `/screen` và `/overview` vốn đã nói về cùng lượt quét. Một kết quả mà mọi mục tiêu đều hỏng vẫn nhận `source.no-available-provider`.

**Một caveat refresh nêu tên loại của nó.** `/refresh` in mỗi loại thành một dòng. `/overview` và `/brief` gom mọi caveat vào một danh sách đã khử trùng, nơi một ghi chú viết `1 of 23 pulls landed` không trả lời câu hỏi nào. Nên câu của mỗi caveat nêu tên loại của nó dù nó rơi ở đâu, và màn hình refresh in các ghi chú dưới thị trường chứ không dưới một dòng sẽ nêu loại hai lần.

**Ai đã điều khiển một phiên được ghi một lần, hoặc không ghi.** Mỗi lần refresh ghi tỷ lệ bên mua/bên bán chủ động cho mỗi mã bạn nắm hoặc theo dõi. Không nguồn nào đứng sau nó nhận một ngày: `kbsec` trả lời bằng phiên mà bảng của nó hiện đang giữ, còn `vietcap` phân trang ngược từ băng giá mới nhất. Nên tỷ lệ này chỉ đọc được giữa thời điểm bảng giá settle và lần mở cửa kế tiếp.

Các neo refresh đặt hai lượt trong cửa sổ đó (15:15 và 08:00 với bảng VN). Sau giờ mở thì phiên đó mất vĩnh viễn. Một mã mà lượt quét không ghi được vì vậy được nêu tên dưới thị trường của nó trong màn hình `/refresh`, vì một chỗ hụt mà lượt sau không lấp được là một lỗ hổng trong chuỗi. Lượt quét chỉ phủ các thị trường mà refresh phủ, nên `/refresh crypto` không tốn ngân sách của nguồn VN nào.

Một mã không nắm cũng không theo dõi thì không bao giờ bị quét, tức là mọi ứng viên mua. `/suggest` tự đọc băng giá cho phiên nó đang phán xét và không lưu gì; một dòng đã lưu nếu không sẽ gia nhập một mục bản tin liệt kê những gì bạn theo dõi. Cả hai bên đọc đều hỏi cùng một ngày, nên một dòng đã lưu của phiên trước không bao giờ thay cho phiên đang được phán xét.

**Một tín hiệu băng giá trên mọi dòng sàng lọc VN:** *foreign flip*. Khối ngoại bán ròng, tính theo tỷ phần giá trị giao dịch, thấp hơn hai độ lệch chuẩn so với một mức trung bình trước đó vốn là mua ròng, sau một đợt tăng 3% hoặc hơn qua bốn phiên. Nó không đổi điểm nào. Một đề xuất trên mã đang hiện nó mang nó như một caveat, và nhật ký yếu tố mang nó để bảng theo dõi tiến tới nói được nó đáng giá bao nhiêu trước khi nó được nhận trọng số.

**Crypto đọc băng giá của riêng nó.** Hai tín hiệu đi theo mọi dòng sàng lọc crypto và được ghi cùng điểm yếu tố:

- Một *cú rũ bỏ giữ được*: một phiên giảm ít nhất 5% qua bốn phiên, trên khối lượng tương đối từ 1,5 trở lên, đóng trong một phần năm thấp nhất của biên độ, mà đáy của nó mọi phiên sau đều giữ được, đọc trong hai tới bốn phiên sau đó.
- Một *đợt tăng do đòn bẩy dẫn*: số hợp đồng open interest tăng ít nhất gấp đôi mức tăng của giá qua cùng ba phiên, trên một đợt tăng 5% hoặc hơn.

Không cái nào đổi điểm. Một đề xuất trên mã đang hiện một trong hai mang một caveat: cái đầu nói rằng bán ở đây là bán đáy, cái sau nói rằng đợt tăng đang được đòn bẩy gánh chứ không phải spot. Không có cài đặt. Các ngưỡng là chính sách chiến lược, được đánh phiên bản cùng chiến lược crypto.

**Các yếu tố crypto, trọng số bằng nhau:** xu hướng, funding, độ lệch long/short của nhà đầu tư nhỏ lẻ, tốc độ quay vòng giao dịch và độ biến động.

- Xu hướng là số đọc sức mạnh giá duy nhất, có chủ ý. Động lượng và khoảng cách tới đỉnh 200 phiên đã được kiểm tra so với diễn biến của các coin trong một tới bốn tuần sau đó, không thêm được gì, và đi cùng nhịp với xu hướng. Giữ cả ba nghĩa là đếm một ý kiến ba lần.
- Funding và độ lệch long/short là ngược chiều đám đông: bên đang trả tiền để ở lại, và đám đông đã vào rồi, còn ít thứ để mua hơn.
- Độ lệch là tỷ lệ tài khoản long/short toàn cầu của Binance, lưu cùng dòng funding. Không có cài đặt cho nó.

**Khởi động.** Lượt refresh đầu tiên chạy dưới **ngân sách 60 giây** rồi được tách ra. Kho ấm settle trong ngân sách. Kho nguội thì hết giờ, dịch vụ nền bắt đầu nhận việc, và lượt quét hoàn tất ở nền: tươi dần dần, đúng đắn luôn luôn. Không gì dừng lượt quét ở hạn chót, vì một phạm vi bị dừng không ghi dòng thử nào và nhịp sau sẽ làm lại toàn bộ.

### Chi phí và giới hạn

Chi phí được theo dõi theo từng phiên chạy. Trần theo ngày, theo tháng và theo phiên chạy đều là **tùy chọn bật**: `0` nghĩa là không giới hạn, và đó là mặc định. Cảnh báo mềm ở mức 80%. Vòng lặp bị chặn bởi trần số lượt, trần thời lượng và một bộ phát hiện vòng lặp.

Bộ phát hiện vòng lặp không dừng cả phiên chạy:

- Ở lời gọi gần giống hệt lần thứ hai, nó chặn riêng lời gọi đó kèm một chỉ dẫn chuyển hướng mà mô hình đọc được.
- Ở lần thứ ba, nó **đóng bề mặt công cụ** trong phần còn lại của phiên chạy. Bản ghi hội thoại đã có mọi kết quả mô hình lấy được, nên một phiên chạy kết thúc bằng câu trả lời dựng từ chúng tốt hơn một lần kết thúc bằng mã dừng.

Ngân sách số lần gọi công cụ thì vẫn dừng, vì nó là ngân sách.

Tranh luận chạy các persona trên nhóm mô hình `debate` khi có cấu hình, nếu không thì trên chuỗi chính. Một bảng tranh luận năm mã mỗi lượt.

### Bề mặt

Mọi năng lực đều với tới được qua các bề mặt này, từ cùng các dịch vụ.

**Công cụ** (cho agent), thêm `order_place` và `order_exits` khi một sàn có khóa giao dịch. Một số được đưa cho mô hình ngay từ đầu: `market_overview`, `market_screen`, `market_price`, `market_bars`, `market_events`, `market_sector_strength`, `macro_risk`, `vn_foreign_flow`, `portfolio_view`, `portfolio_record`, `profile_update`, `suggestion_run`, `suggestion_batch` (và `skill_view`). Phần còn lại được tìm qua tìm kiếm công cụ khi một lượt cần.

Cách chia này hẹp có chủ ý. Một công cụ chỉ được đưa sẵn khi một mô hình không thấy nó sẽ trả lời từ web mở, bằng những con số nghe có vẻ hợp lý cho các dữ kiện mà sản phẩm này đã có. Mỗi công cụ đưa sẵn tốn token ở mọi lượt, nên toàn bộ tập đưa sẵn bị chặn ở 23.

Tìm kiếm công cụ chỉ chặn một lời gọi mà nó phải *đoán*. Gọi đúng tên thì nạp công cụ và chạy. Gọi khớp theo độ tương tự thì bị chặn, và kết quả nêu tên các công cụ đã nạp rồi kết thúc bằng một `hint` bảo nên gọi gì. Tối đa tám công cụ đã tìm được giữ nạp, cái cũ nhất bị đẩy ra trước.

Toàn bộ tập:

`market_price` `market_bars` `market_overview` `market_events` `market_accounts` `market_news` `market_screen` `market_sector_strength` `market_sentiment` `market_funding` `macro_risk` `vn_foreign_flow` `vn_futures_basis` `portfolio_view` `portfolio_history` `portfolio_review` `portfolio_rebalance` `portfolio_record` `portfolio_update` `portfolio_remove` `watchlist_update` `profile_view` `profile_update` `profile_segment` `suggestion_run` `suggestion_batch` `suggestion_track_record` `alert_manage` `brief_build` `brief_manage` `themes_view`

**Lệnh gạch chéo** (chat, REPL): `/setup` `/record` `/update` `/delete` `/transactions` `/portfolio` `/profile` `/watchlist` `/price` `/market` `/overview` `/screen` `/sources` `/suggest` `/themes` `/rebalance` `/reconcile` `/reflect` `/alert` `/brief` `/refresh`, cộng `/trade`. `/trade` đặt lệnh khi một sàn có khóa giao dịch, nếu không thì nêu tên các khóa nó cần. Cú pháp đầy đủ: [Lệnh](lenh.md).

**Chat trong terminal** dùng cùng các lệnh gạch chéo như mọi kênh:

```bash
openalpha chat --message "/setup"
openalpha chat --message "/record deposit vps 100000000 VND 2026-08-03"
openalpha chat --message "/profile set risk-level balanced"
openalpha chat --message "/suggest FPT"
```

Cảnh báo được gọi bằng mã sáu ký tự (đuôi của mã dài) trong `/alert list`, lời xác nhận và mọi thông báo; `/alert disable <mã cảnh báo>` nhận mã đó, và liệt kê mã đầy đủ khi nó khớp nhiều cảnh báo. Cảnh báo giá hay thoát lệnh khi chạm mở đầu bằng tiêu đề và bước kế tiếp: với thoát lệnh là dòng `/record sell` để điền khi bán xong, rồi `/suggest` để xem lại. Trong chat `/transactions` mặc định hiện 10 dòng, và `/portfolio` liệt kê các vị thế ngay sau phần cảnh báo, rồi mới đến tiền mặt, lãi lỗ và phân bổ, với tối đa ba lần đóng vị thế gần nhất trên điện thoại.

`/alert create` và `/brief enable` cần một nơi để gửi tới, như Telegram hay Zalo. Gõ trong một kênh đã kết nối thì gửi về chính chat đó. Gõ trong terminal thì gửi về chat của bạn: kênh được cấu hình đầu tiên thắng (Telegram, rồi Zalo, rồi Zalo Personal), và `fallback_chat_id` chọn chat, nếu không thì chat duy nhất đã ghép nối. Chưa cấu hình kênh nào thì bị từ chối. Tin chỉ đến khi OpenAlpha đang chạy nền (`openalpha start --background`).

Dùng chat ngôn ngữ tự nhiên cho mọi thứ cú pháp gạch chéo không phủ: nến, tin tuyển chọn, sức mạnh ngành, dòng tiền ngoại, rà soát danh mục, bảng thành tích. Agent gọi các công cụ giao dịch có kiểu.

Bạn có thể bỏ thị trường khi mã chỉ khớp một thị trường. Nếu hai thị trường cùng nhận mã, đề xuất báo `ambiguous-market` và hỏi thị trường thay vì đoán.

**HTTP** (loopback, xác thực bằng bearer). `openalpha start` phục vụ một API cục bộ khi `[api] enabled = true` (xem [`[api]`](cau-hinh.md)). Các route trả về **mã và dữ liệu, không bao giờ là văn xuôi**: client nhận `{ code: 'suggestion.reused-same-day' }` và hiển thị bằng ngôn ngữ của người đọc. Mọi yêu cầu hành động với tư cách một operator cục bộ duy nhất, cố định lúc khởi động, nên không payload nào chọn hay giả mạo được một người dùng. Danh sách route: [trang dành cho lập trình viên](dev/giao-dich.md).

### Ngôn ngữ

Mọi chuỗi bạn thấy là một khóa ngôn ngữ, có cả tiếng Anh và tiếng Việt. Các mã suy ra từ những danh sách cố định, nên một giá trị mới không thể tồn tại mà thiếu mục trong danh mục: khởi động hỏng, và một phép kiểm lúc build hỏng sớm hơn nữa.

Thuật ngữ tiếng Việt được kiểm tự động lúc build. Lỗi đáng lo không phải một bản dịch trông sai, mà là một bản dịch trông ổn: một đề xuất `reduce` bị dịch thành *bán* sẽ bảo bạn bán sạch trong khi sản phẩm đề xuất giảm bớt.

### Lưu trữ

Schema bắt đầu gọn và lớn dần bằng migration. Các migration chạy theo thứ tự id, chỉ những cái chưa áp, và một migration đã áp thì không bao giờ đổi.

Thời gian giữ dữ liệu thị trường là **suy ra, không cấu hình**: cửa sổ bằng chứng dài nhất mà một thị trường đã đăng ký khai, quy từ phiên ra ngày lịch theo quy tắc cuối tuần của chính thị trường đó, cộng 5% dự phòng. Một giá trị cấu hình vừa sai theo mặc định vừa không đánh giá được. Một lượt dọn ngắn hơn cửa sổ bằng chứng dài nhất sẽ xóa các dòng mà đường yếu tố hỏi lại ở phiên chạy kế tiếp.

---

## Cuốn sổ

Sổ lệnh là nguồn sự thật duy nhất. Vị thế, tiền mặt và NAV đều được tính từ các dòng sổ lệnh, không bao giờ là số dư lưu riêng có thể lệch khỏi các bút toán đã tạo ra chúng.

Một vị thế được khóa theo công cụ **và sàn**. Cùng một coin ở hai nơi lưu ký là hai vị thế, với hai giá vốn và hai số lượng đã settle. Một lệnh bán ở sàn này giải phóng giá vốn của sàn đó, không phải một mức bình quân gồm cả coin nằm ở nơi khác. `/portfolio` gộp chúng lại thành một dòng (một mức phơi nhiễm, một tỷ trọng, một giá vốn trộn) và chỉ thêm một dòng sàn bên dưới khi một khoản nắm thật sự trải trên nhiều sàn. Tiền mặt cũng được giữ theo từng sàn; hệ quả được nói rõ ở cuối trang này.

Ghi một giao dịch là cập nhật sổ lệnh của bạn. Nó không bao giờ gửi lệnh đi đâu.

### Sổ lệnh

Mỗi dòng có một id, thời điểm được ghi lần đầu, thời điểm sửa lần cuối và chính giao dịch. Một giao dịch là một dòng, sửa và xóa tại chỗ. Gõ nhầm ngày nghĩa là sửa ngày đó, không phải thêm một dòng để thay.

Đây là một đánh đổi có chủ ý: cuốn sổ được tính từ các dòng **như chúng đang đứng ngay lúc này**. Sửa một bút toán sẽ tính lại mọi con số suy ra từ nó, kể cả các đề xuất được lập trước lần sửa. Không có nhật ký kiểm toán, và `/reflect` không thể chứng minh cuốn sổ trông thế nào vào ngày một đề xuất được lập. Sự tiện lợi được chọn thay cho sự bảo đảm đó.

| Loại | Dạng | Tác dụng |
|---|---|---|
| `deposit` | số tiền, tiền tệ, ngày | tiền vào |
| `withdrawal` | số tiền, tiền tệ, ngày | tiền ra |
| `fee` | số tiền, tiền tệ, ngày | tiền ra |
| `loss` | số tiền, tiền tệ, ngày | tiền ra |
| `buy` | công cụ, khối lượng, đơn giá, phí (tùy chọn), tiền tệ, ngày | tiền ra, khối lượng vào |
| `sell` | công cụ, khối lượng, đơn giá, phí (tùy chọn), tiền tệ, ngày | tiền vào, khối lượng ra |
| `rights` | công cụ, khối lượng, đơn giá, phí, tiền tệ, ngày | tiền ra, khối lượng vào |
| `dividend` | công cụ, số tiền, tiền tệ, ngày | tiền vào |
| `split` | công cụ, độ lệch khối lượng có dấu, ngày | chỉ khối lượng |
| `distribution` | công cụ, độ lệch khối lượng có dấu, ngày | chỉ khối lượng |
| `transfer` | từ sàn, tới sàn, số tiền, tiền tệ, phí, ngày | tiền chuyển giữa hai sàn của bạn; nạp ròng không đổi; phí tính ở nguồn |

Điều chỉnh số lượng cổ phần (`split`, `distribution`) không dời đồng tiền nào, nên nó không nhận tiền tệ cũng không nhận tỷ giá FX. Cú pháp làm cho bút toán sai không thể viết ra, thay vì kiểm sau.

**Mọi dòng nêu một công cụ đều nêu một sàn.** Sàn mà registry không biết, hoặc không thể giữ thị trường của dòng đó, bị từ chối. Kể cả `split`: một sàn không giữ được thị trường thì không có vị thế để điều chỉnh. Một dòng tiền mặt nêu một sàn và không nêu công cụ.

**Phí.** `buy` hay `sell` có thể bỏ phí. Khi đó tỷ lệ `fees` bạn cấu hình cho sàn đó ở `[trading.venues.<id>]` sẽ định giá nó, không bao giờ là số 0, thứ sẽ làm cuốn sổ nhẹ đi mãi mãi. Sàn nào cũng có tỷ lệ, vì một công ty chứng khoán tự khai bằng tay phải nêu một. `rights` luôn nêu phí của chính nó, vì một đợt phát hành quyền mua không được môi giới ở tỷ lệ chuẩn. Dòng đã lưu luôn mang một khoản phí; chỉ cái bạn phải gõ là khác. Dòng xác nhận ghi cho biết phí lấy từ tỷ lệ nào, hoặc phí bạn nêu lệch khỏi nó bao xa.

**Khối lượng được hỏi từ sàn, không bao giờ suy từ một tỷ lệ.** Một sàn đặt `fee_asset = "base"` trong `fees` (OKX và Binance mặc định, như phần lớn sàn crypto) trừ phí **mua** ngay từ tài sản nó giao, nên một lệnh 3 coin ghi có ít hơn 3. Dòng phải mang con số thực sự được ghi có, vì vị thế cộng `quantity` nguyên như vậy còn phí chỉ làm đổi tiền mặt.

Phần hụt không tính được từ tỷ lệ đã cấu hình. Một lệnh khớp theo maker hay taker và chỉ sàn biết cái nào, nên một khối lượng suy ra sẽ là một phỏng đoán được lưu như dữ kiện đã ghi. Lệnh bán không bị ảnh hưởng: phí của nó trừ từ tiền thu về, thứ mà phía tiền mặt đã mang.

Ghi một giao dịch ở sàn có khóa giao dịch sẽ tra xem sàn đó thật sự đã khớp gì ngày đó, cùng chiều, trên cùng công cụ. **Đúng một** lần khớp lệch không quá 1% so với cỡ bạn nêu thì tạo ra dòng, với khối lượng khớp trừ phí tính bằng tài sản gốc, giá bình quân, và phí quy ra tiền tệ giao dịch.

Mọi trường hợp khác để dòng đúng như bạn gõ: sàn không có client, ngày nằm ngoài cửa sổ lịch sử của sàn, không khớp cái nào, có hai lần khớp mà cái nào cũng có thể, hoặc sàn không trả lời. Phí bạn nêu không bao giờ bị ghi đè. Nêu phí là cách bạn ghi một giao dịch mà không thể hỏi sàn. Dòng xác nhận nói rõ trường hợp nào đã xảy ra.

**`fee` và `loss`.** Cả hai đều lấy tiền ra và không cái nào chạm nạp ròng, nhưng phí là chi phí giao dịch còn loss là kết quả giao dịch. `loss` tồn tại để khoản tiền mất trên các giao dịch đã đóng trước khi cuốn sổ bắt đầu ghi (thứ mà một lần nhập snapshot chỉ nêu được thành một tổng) không bị ghi như phí môi giới.

**Ngày.** Ngày của một dòng là ngày giao dịch (`YYYY-MM-DD`), không bao giờ là datetime. Hai bút toán cùng ngày được sắp theo id, giữ thứ tự ghi trong ngày. Việc settle được suy ra từ lịch của thị trường sở hữu: T+2 cho cổ phiếu Việt Nam, cùng ngày cho mọi thị trường khác. Nó được suy lại mỗi khi bạn sửa ngày.

#### Sửa một bút toán

`/transactions` in một mã ngắn bên cạnh mọi dòng. Chính mã đó là thứ bạn gõ lại:

```text
🧾 Recent transactions
  [0f9838] 2026-06-14 Buy ACB 600 @ 22,400 VND
```

```bash
openalpha chat --message "/update 0f9838 buy VPS equity-vn:ACB 600 21900 VND 12000 2026-06-16"
openalpha chat --message "/delete 0f9838 confirm"
```

`/update` nhận mã ngắn rồi tới đủ cả dòng `/record`: cả giao dịch, không phải một bản vá. Câu trả lời cho xem dòng như trước khi sửa, rồi tới xác nhận. Khi sửa, bạn phải nêu rõ khối lượng và phí, ở chỗ `/record` cho phép viết `all` hoặc để phí theo tỷ lệ. Dòng bạn sửa vốn đã có cả hai, và tính lại một trong hai dựa trên một cuốn sổ mới hơn hay một tỷ lệ đã đổi sẽ dịch một con số đã chốt mà bạn chưa hề nêu lại.

`/delete <mã bút toán>` cho xem dòng đó và hỏi lại trước (một nút trên Telegram, một dòng để gõ ở nơi khác); `/delete <mã bút toán> confirm` mới xóa hẳn dòng đó (một dòng trùng, hoặc một giao dịch chưa từng xảy ra). Script nào xóa một bước thì phải thêm `confirm`. Cả hai cũng nhận mã bút toán đầy đủ, đó là cái agent truyền qua `portfolio_update` hay `portfolio_remove`.

Mã ngắn là **sáu ký tự cuối** của mã bút toán, không phải sáu ký tự đầu: id mở đầu bằng dấu thời gian, nên các dòng ghi trong cùng một millisecond dùng chung các ký tự đầu. Một mã ngắn khớp nhiều hơn một dòng thì bị từ chối thay vì đoán.

Mọi trường đều đổi được, gồm cả ngày. Ghi lùi ngày không bị hạn chế.

#### Một lần ghi kiểm những gì

Mọi lần chèn, sửa và xóa đều kiểm **toàn bộ cuốn sổ như nó sẽ trông sau lần ghi đó**, trong cùng giao dịch ghi dòng ấy. Một lần sửa có thể làm hỏng một dòng mà nó chưa từng chạm tới. Thu nhỏ một lệnh mua tháng Một có thể khiến một lần rút tiền tháng Hai bị âm quỹ, dù lúc ghi nó vốn đủ tiền. Dời một lệnh mua ra trước lần nạp tiền đã cấp vốn cho nó thì để bạn tiêu một khoản chưa có. Cả hai đều bị từ chối, kèm ngày và phần thiếu được nêu tên:

```text
buy on 2026-06-11 needs 13152000 available cash, book has 0
sell of 600 ACB exceeds 0 settled on 2026-06-15
```

Một dòng ghi ngày sau hôm nay (theo lịch của khu vực chính) cũng bị từ chối. Giao dịch chưa xảy ra là gõ nhầm, và nếu nhận thì sổ sẽ giấu nó đi cho tới đúng ngày đó.

Giá luôn ghi đầy đủ, như `58400`, không phải con số trên bảng điện (`58,40`, tức ×1.000 VND). Một giá cổ phiếu Việt Nam thấp hơn 1.000 đồng trong khi mã đang giao dịch trên mức đó bị từ chối, kèm giá đầy đủ để ghi lại. Ngưỡng của `/alert` cũng vậy.

Ở mọi thị trường, giá bạn gõ mà cao hoặc thấp hơn giá gần nhất của mã (giá đóng cửa đã lưu tính tới
ngày của nó; với vàng trong nước, hoặc mã chưa có giá đóng cửa nào được lưu, là giá đang giao dịch) từ
mười lần trở lên thì chưa được lưu ngay. Câu trả lời đưa ra cả hai con số và hỏi bạn có đúng ý không,
vì lệch xa cỡ đó gần như luôn là gõ thiếu hoặc thừa vài số 0.

Bấm "Đúng giá này, lưu lại", hoặc gửi lại đúng lệnh đó với `confirm` ở cuối, thì giá được lưu như bạn
gõ. Không có gì được giữ lại giữa hai bước: bỏ qua câu hỏi thì không có gì được ghi.

- `/record`, `/update` và `/alert create` đều hỏi như vậy.
- Tiền nạp, rút và phí không có giá để so nên không bao giờ bị hỏi. Mã không có giá nào để so, hoặc giá
  không về kịp trong 3 giây, thì cũng lưu luôn.
- Giao dịch lấy giá từ lệnh khớp của sàn (`/trade`, `/record sync`, một lệnh thoát đã khớp) cũng không
  bị hỏi. Dòng `rights` cũng vậy, vì giá quyền mua do công ty phát hành đặt, thường theo mệnh giá, thấp
  hơn giá thị trường rất nhiều.
- Trợ lý AI bị từ chối theo cùng cách, và phải hỏi lại bạn trước khi ghi giá.

Bội số đặt ở `[trading.typed_prices] confirm_multiple` (mặc định 10). Ứng dụng desktop cũng được kiểm
như vậy khi request ghi sổ hoặc đặt cảnh báo gửi kèm `typedPrice`.

#### Dòng xác nhận ghi nói gì về phí

```text
🧾 Recorded
  Entry: da6319
  Type: Buy
  Day: 07/09/2026
  Venue: VPS
  Quantity: 1,000 E1VFVN30
  Price: 35.32/E1VFVN30
  Fee: 52,980 VND
  That fee matches the 0.15% rate - correct it with /update if yours differs.
  Cash is now 64,627 VND
  E1VFVN30 at VPS is now 1,000 at an average cost of 35.37
```

Giá vốn bình quân đã gồm phí mua, nên khớp với con số app công ty chứng khoán của bạn hiện, và mọi phép định giá cùng P&L đều đo so với nó. Vì vậy mua rồi bán lại ở cùng giá sẽ hiện đúng là một khoản lỗ nhỏ.

- Mức phí bạn nêu lệch xa tỷ lệ đã cấu hình thì dòng tỷ lệ được thay bằng mức lệch, không bị lặng lẽ chấp nhận.
- Thị trường không có tỷ lệ cấu hình thì không in cả hai dòng: không có gì để đo so với, và một số 0 sẽ bị đọc thành sự đồng ý.

Mọi trường đều có nhãn ở đây và không ở đâu khác. Dòng xác nhận được đọc riêng, để so với cái bạn định lưu. `/transactions` giữ dạng một hàng không nhãn, vì một danh sách trường lặp lại xuống cả trang thì không quét mắt được. Hàng nào cũng ghi sàn, kể cả hàng tiền mặt, để một khoản nạp cho biết tiền vào sàn nào.

### Hai khung nhìn, được áp bằng kiểu dữ liệu

Đây là một ranh giới cấu trúc, không phải một cờ phân quyền.

| | Khung nhìn tương đối | Khung nhìn tuyệt đối |
|---|---|---|
| Hiện | tỷ trọng, phần trăm, phần trăm lợi suất | tiền: NAV, tiền mặt, giá vốn, P&L |
| Với tới từ | công cụ của agent, chat | API HTTP cục bộ đã xác thực của bạn và các lệnh gạch chéo |

Chúng là hai kiểu khác nhau với các trường khác nhau. Một agent không thể vô tình biết quy mô tài khoản của bạn, vì không đường mã nào đưa cho nó một cuốn sổ tính bằng tiền.

### Định giá

Một khoản nắm dưới cỡ lệnh tối thiểu của sàn thì không được liệt kê. Sàn sẽ không khớp nó, nên dòng đó
sẽ mô tả thứ bạn không bán được cũng không hành động được.

Giá trị của nó vẫn tính vào NAV và bảng phân bổ, và mục đó nói đã giữ lại bao nhiêu dòng. Nếu không còn
nguồn nào báo giá nó nữa (ví dụ một coin bị gỡ khỏi sàn), nó được tính theo giá vốn kèm một ghi chú,
thay vì để trống NAV và chặn mọi lệnh mua. Một tỷ trọng không có gì bên dưới là thứ mà con số đếm đó
giải thích.

Mọi chỗ khác cũng đối xử với nó như vậy: bản tin không đếm nó là vị thế đang lỗ và không chạy đề xuất
cho nó, `/market` và trợ lý chat không liệt kê nó, nó không chiếm chỗ trong `maximum_open_trades`, và
riêng nó thì không giữ một thị trường đã tắt lại trong `/refresh`.

Một vị thế đã định giá thuộc một trong hai loại:

- **priced** - có giá và có giá trị;
- **unpriced** - mang một **caveat** nói lý do, và hoàn toàn không có giá trị.

Giá thiếu không bao giờ được hiện thành số 0. Số 0 là một tuyên bố mà phép định giá chưa đưa ra, và điều đó quan trọng khi đó là toàn bộ vị thế của bạn trong một mã đang bị tạm dừng.

Một coin nắm ở hai nơi lưu ký được gộp thành một mức phơi nhiễm, nên nó được báo giá một lần, tính tỷ trọng một lần và quy đổi theo một tỷ giá. Trần ngành, trần nhóm và bộ tái cân bằng đều làm việc từ mức phơi nhiễm đã gộp đó.

#### Hai tỷ giá, và mỗi thị trường thanh toán bằng đồng nào

Giá trị thị trường được quy đổi theo tỷ giá hôm nay của đồng tiền của chính thị trường. Giá vốn được quy đổi theo tỷ giá đóng băng trên dòng lúc giao dịch được ghi, nên một bút toán cũ giữ đúng số tiền nó thật sự tốn. Phần chênh giữa hai thứ là biến động tiền tệ trên những gì bạn nắm, và cuốn sổ báo nó thành một dòng riêng thay vì gộp vào biến động giá.

Đồng tiền thuộc về thị trường. Crypto thanh toán bằng **USDT** và vàng bằng **USD**, và mỗi bên quy đổi theo tỷ giá mà chính thị trường đó giao dịch so với: `USDTVND` cho coin, `USDVND` cho vàng. Tỷ giá USD niêm yết liên ngân hàng cố ý không dùng cho coin, vì USDT không phải USD và tỷ giá niêm yết không phải mức mà một người nắm crypto giao dịch được. Đo ngày 2026-09-08, hai mức lệch nhau 0,3%, toàn bộ theo chiều làm cuốn sổ phình lên.

`USDTVND` chỉ đến từ các nguồn coin. Khi tất cả đều hỏng thì không lùi về `USDVND`, vì một tỷ giá bị lặng lẽ thay thế còn tệ hơn không có. Vị thế đọc là unpriced với `valuation.fx-missing` và NAV bị giữ lại.

Một dòng có thể mang tỷ giá của chính bạn thay vì tỷ giá thị trường:

- `fx <giá>` ở cuối dòng `/record` lưu đúng giá bạn đã trả, với nguồn ghi là `operator`.
- `fx auto` cố ý lấy tỷ giá thị trường của ngày đó.
- Dòng tiền mặt giờ cũng có thể ghi bằng đồng tiền mà thị trường của sàn niêm yết. Nên
  `/record deposit binance 1000 USDT 2026-08-14 fx 26600` là một dòng hợp lệ.
- Không có `fx` thì dòng bằng ngoại tệ được xem trước và giữ lại chờ `/record confirm`, thay vì ghi
  theo một tỷ giá bạn chưa chọn. `/record sync` ghi theo tỷ giá thị trường và nói rõ đồng tiền nào đã
  ghi như vậy.

#### Tiền ngoại tệ tại sàn

Khoản nạp bằng đồng tiền mà thị trường của sàn niêm yết, ví dụ `/record deposit binance 1000 USDT 2026-08-14 fx 26600`, làm sàn đó giữ USDT như một số dư tiền mặt riêng, kèm giá vốn bình quân tính theo đồng gốc của sổ (ở đây là 26,6 triệu VND).

- **Dòng nào làm nó đổi.** Nạp, rút, phí, loss hay chuyển USDT luôn làm nó đổi. Khi sàn đã giữ USDT, mọi lệnh mua và bán USDT ở đó cũng vậy: lệnh mua dùng USDT theo giá vốn bình quân và mang giá vốn ấy sang thứ vừa mua, còn lệnh bán trả tiền về lại cho số USDT. USDT đầu tiên ghi ở một sàn làm đổi cách trả của các lệnh sau đó ở sàn ấy, kể cả khoản nạp ghi lùi ngày trước những lệnh sàn đã trả bằng VND, và các lệnh đó khi ấy có thể bị từ chối. Muốn đổi một sàn đang nạp VND sang USDT, hãy rút số VND ra rồi nạp USDT kèm `fx`.
- **Tỷ giá ghi ở dòng nạp, không ở dòng mua.** Lệnh mua, bán, phí hay chuyển trả bằng USDT sàn đang giữ thì không dùng tỷ giá, nên `fx` trên dòng đó bị từ chối kèm lý do thay vì bị bỏ qua. Giá P2P bạn trả thuộc về dòng nạp USDT.
- **Rút ra là chốt phần chênh tỷ giá.** USDT ra đi theo giá vốn bình quân, nhưng tiền nạp ròng giảm đúng bằng giá trị của nó hôm đó. Nạp 1.000 ở 26.600 rồi rút 1.000 ở 27.000 thì lãi đã chốt là +400.000 VND và tiền mặt về lại 0.
- **Hai đồng tiền không tự đổi sang nhau.** Lệnh USDT ở một sàn chỉ dùng USDT của nó và bị từ chối, nêu tên đồng tiền và sàn, khi thiếu. Rút, phí hay chuyển VND ở đó chỉ dùng VND của nó, dù sàn đang giữ USDT.
- **Dòng chênh tỷ giá âm ngay sau khi nạp qua P2P.** USDT được tính theo tỷ giá USD/VND thị trường, còn giá vốn là giá P2P bạn đã trả, nên ngay sau khoản nạp ở 26.600 dòng đó đọc khoảng -2% khi tỷ giá thị trường là khoảng 26.036.
- **Xem ở đâu.** `/portfolio` liệt kê USDT cạnh tiền mặt cùng giá vốn và giá trị hôm nay, và in phần chênh tỷ giá. `/reconcile` đối chiếu nó với số USDT thật trên sàn.

Một vòng giao dịch crypto, từng bước, với tỷ giá bạn đã trả chỉ ghi một lần, ở dòng nạp:

1. **Nạp USDT kèm tỷ giá bạn đã trả.** `/record deposit binance 1000 USDT 2026-08-14 fx 26600`.
2. **Mua bằng số USDT đó, không `fx`.** `/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14` (hoặc `/record buy binance BTC 0.01 60000` khi BTC chỉ niêm yết ở một thị trường). Lệnh dùng số USDT theo giá vốn của nó; thêm `fx` ở đây sẽ bị từ chối kèm lý do.
3. **Bán ngược về USDT.** `/record sell binance crypto:BTC all 65000 USDT 2026-09-01`.
4. **Rút USDT theo tỷ giá lúc bạn bán.** `/record withdrawal binance 500 USDT 2026-09-20 fx 26900` ghi phần chênh giữa hai tỷ giá thành lãi lỗ đã chốt.
5. **Kiểm tra** bằng `/portfolio`, `/transactions`, và `/reconcile` khi sàn đã có khóa.

Đã có sẵn USDT hoặc coin ở sàn trước khi bắt đầu sổ? Ghi số dư hôm nay, không cần ghi lại lịch sử:

- **Chỉ có USDT:** một dòng nạp bằng số USDT bạn đang giữ, kèm `fx <giá vốn bình quân>`, hoặc `fx auto` nếu bạn không biết (lãi lỗ tỷ giá trước ngày đó khi ấy không được tính).
- **USDT và coin:** nạp số USDT đang giữ cộng với giá vốn của các coin, rồi mỗi coin một dòng mua với khối lượng hiện tại, giá vốn bình quân và phí `0`. Khi đó số USDT trong sổ khớp với sàn. Phí `0` sẽ in một ghi chú "phí lệch"; với số dư đầu kỳ thì cứ bỏ qua.

```text
/record deposit okx 1300 USDT 2026-10-16 fx auto        # 1.000 USDT đang giữ + 300 đã dùng mua BTC
/record buy okx crypto:BTC 0.005 60000 USDT 0 2026-10-16
```

`/record sync` chỉ đọc lệnh khớp từ dòng đầu tiên của sổ trở đi, nên không ghi được số coin đã mua trước đó. Khi sàn đã có khóa, `/reconcile` kiểm tra kết quả với số dư thật.

#### Đã có danh mục, không muốn ghi lại từng lệnh cũ

Bạn đang giữ vài mã, đã bán vài mã và lỗ một khoản, nhưng không muốn ngồi gõ lại cả chục lệnh cũ? Không
cần. Sổ chỉ cần biết ba điều: bạn đã bỏ vào bao nhiêu tiền, đang giữ gì với giá vốn bao nhiêu, và đã
lỗ bao nhiêu trên những mã đã bán. Mỗi điều là vài dòng:

```text
/record deposit vps 200000000 VND 2026-10-01                 # tổng tiền đã nạp vào tài khoản
/record buy vps equity-vn:FPT 1000 95000 VND 0 2026-10-01    # mỗi mã đang giữ một dòng
/record buy vps equity-vn:HPG 2000 26000 VND 0 2026-10-01
/record loss vps 15000000 VND 2026-10-16                     # tổng lỗ của các mã đã bán
```

- **Mã đang giữ:** lấy khối lượng và giá vốn bình quân trong app công ty chứng khoán, phí ghi `0`. Giá
  bình quân ở đó đã gồm phí, bỏ trống phí thì sổ cộng phí thêm lần nữa. Dòng xác nhận sẽ kèm câu
  "Phí lệch -100%", cứ bỏ qua.
- **Ngày mua nên lùi về trước vài hôm.** Cổ phiếu VN về tài khoản sau T+2, nên ghi ngày hôm nay thì
  hai phiên tới sổ chưa cho bán mã đó.
- **Khoản lỗ ghi bằng `loss`**, đừng dùng `withdrawal` hay `fee`. Ghi `withdrawal` thì sổ tưởng bạn
  rút tiền về túi và lãi lỗ trông đẹp hơn thực tế. Ghi `fee` thì khoản lỗ thành phí môi giới. `loss`
  trừ tiền mà vẫn giữ nguyên số tiền bạn đã nạp, nên `/portfolio` ghi rõ "Lãi/lỗ đã chốt: -15.000.000
  VND".
- **Dòng nạp phải có ngày trước các dòng mua và dòng lỗ.** Sổ kiểm cả cuốn mỗi lần ghi, thiếu tiền là
  báo ngay.
- **Mỗi mã được đặt luôn kế hoạch thoát**, tính theo giá vốn bạn đã gõ. Một mã đang giao dịch thấp hơn
  nhiều so với giá vốn đó có thể đã nằm dưới mức cắt lỗ, và `/portfolio` khi ấy ghi "đã xuyên mức cắt
  lỗ". Đó là lời nhắc xem lại mã, không phải lỗi ghi sổ.

Ghi xong, mở `/portfolio` và so tiền mặt với số dư thật bên công ty chứng khoán. Ví dụ trên: 200 triệu
nạp, trừ 95 triệu FPT, 52 triệu HPG và 15 triệu lỗ, còn 38 triệu. Lệch thì thường do nhớ sai tổng lỗ
hoặc giá vốn, sửa bằng `/update <mã bút toán>` chứ đừng thêm dòng mới.

**Với crypto** thì y hệt, chỉ khác là mọi thứ tính bằng USDT:

```text
/record deposit binance 2000 USDT 2026-10-16 fx 26500        # tổng USDT đã nạp, kèm giá bạn trả
/record buy binance crypto:BTC 0.01 60000 USDT 0 2026-10-16  # mỗi coin đang giữ một dòng
/record buy binance crypto:ETH 0.2 2500 USDT 0 2026-10-16
/record loss binance 300 USDT 2026-10-16                     # tổng lỗ của các coin đã bán
```

- **Dòng lỗ không ghi `fx`.** Sàn đã có USDT nên khoản lỗ trừ vào số USDT đó theo giá vốn bạn ghi ở
  dòng nạp. Thêm `fx` thì sổ từ chối và nhắc bỏ đi.
- **Ghi ngày hôm nay cũng được**, vì coin không phải chờ T+2.
- Dòng mua coin với phí `0` kèm hai câu nhắc: "Phí lệch" và "Binance trừ phí bằng BTC...". Với số dư
  ban đầu thì cứ bỏ qua cả hai, miễn khối lượng bạn ghi đúng số đang có trên sàn.
- **Mỗi coin ghi vào được đặt luôn kế hoạch thoát** (cắt lỗ, chốt lời), tính theo giá vốn bạn ghi. Coin
  đã chạy xa khỏi giá vốn thì các mức này có thể nằm khá xa giá hôm nay; `/portfolio` cho biết cách bao
  xa.
- **Đối chiếu:** số USDT trong `/portfolio` phải bằng số USDT trên sàn. Ví dụ trên: 2.000 nạp, trừ 600
  mua BTC, 500 mua ETH và 300 lỗ, còn 600 USDT. Đã khai khóa API thì `/reconcile` so giúp bạn.

Không cần sổ nhớ khoản lỗ cũ thì đơn giản hơn nữa: nạp đúng số tiền mặt đang có cộng giá vốn các mã
đang giữ, bỏ dòng `loss`. Lãi lỗ khi đó tính từ hôm nay.

Gộp như vậy thì mất lịch sử từng mã đã bán: `/transactions` chỉ thấy một dòng lỗ. Đề xuất cũ của
trợ lý và `/reflect` không bị ảnh hưởng, vì chúng chấm điểm đề xuất chứ không chấm giao dịch của
bạn.

#### Mọi mức giá đều nói nó được lấy thế nào

Một vị thế đã định giá được đánh dấu là:

- `live` - số quan sát của nó mới hơn giá đóng cửa của phiên đã settle gần nhất trên lịch thị trường của chính công cụ đó;
- `close` - nó chính là giá đóng đã settle đó.

Mỗi thị trường trả lời theo lịch của chính nó, nên một cuốn sổ có thể giữ cả hai cùng lúc: cổ phiếu VN settle lúc 15:00 giờ Hà Nội trong khi crypto chưa từng ngừng giao dịch.

Cả cuốn sổ là `live` chỉ khi **mọi** vị thế đã định giá đều live, nếu không là `close`. Một cuốn sổ live hiện giờ đồng hồ của mức giá tươi nhất. Một cuốn sổ đã settle nêu tên phiên nó được định giá. Một cuốn sổ lẫn lộn đọc như đã settle và gắn nhãn các chân ngoại lệ trên dòng riêng của chúng, nên tiêu đề không bao giờ tuyên bố một độ tươi mà chỉ vài khoản nắm có. Đó là thứ ngăn một tổng lấy lúc 11 giờ sáng bị đọc như giá trị đóng cửa, và một tổng lấy lúc nửa đêm bị đọc như trực tiếp.

**Lãi/lỗ đã thực hiện** là ngoại lệ. Nó bằng tiền mặt + giá vốn - nạp ròng, nên không có giá nào đi vào nó và nó có mặt cả khi NAV không có. Mọi khoản nạp không phải tiền mặt đang có cũng không phải giá vốn trong một vị thế đang mở thì đã bị tiêu hoặc mất trên một giao dịch đã đóng. Lãi/lỗ chưa thực hiện là biến động trên giấy của những gì bạn vẫn nắm; lãi/lỗ đã thực hiện là phần đã settle và ra đi. Chúng hiện thành hai dòng riêng.

Khi có khoản nắm nào chưa định giá được, NAV bị giữ lại và bản đánh giá mang `portfolio.valuation-partial`. Các phép kiểm theo tỷ trọng tự bỏ qua thay vì chia cho một tổng thiếu, và lệnh mua qua `/trade` hay `order_place` bị từ chối vì cùng lý do. Các phép kiểm loại trừ và thanh khoản vẫn chạy, vì "bạn vẫn nắm thứ nằm trong danh sách loại trừ" đúng bất kể giá.

### Danh mục đã đi thế nào

`/portfolio nav [1m|3m|6m|1y|all]` (mặc định `3m`) cho thấy cuốn sổ đã đi thế nào theo thời gian. Nó được dựng từ một snapshot mỗi ngày:

- **Một snapshot mỗi ngày.** Sau mỗi lượt `trading.refresh`, dịch vụ nền định giá cuốn sổ đúng như `/portfolio` và giữ một dòng cho ngày đó; lượt cuối của ngày thắng. Lịch sử bắt đầu từ khi bạn nâng cấp. Không gì được dựng lại từ sổ lệnh, vì giá đóng VN đã lưu được điều chỉnh ngược còn khối lượng trong sổ lệnh thì không.
- **Lợi suất trọng số thời gian.** Một khoản nạp hay rút làm đổi giá trị cuốn sổ mà không phải là lãi, nên nó bị trừ khỏi ngày nó rơi vào. Cổ tức, phí và loss vẫn nằm trong lợi suất.
- **Sụt giảm từ đỉnh.** Mức sụt sâu nhất và hiện bạn đang thấp hơn đỉnh bao nhiêu, cả hai trên cùng một chỉ số.
- **Một thước đo từ cơ cấu mục tiêu của chính bạn.** Mỗi nhóm bạn đã đặt mục tiêu ăn theo chỉ số chuẩn của thị trường nó, và tiền mặt thì không sinh gì. Một nhóm mà thị trường của nó không có chuẩn bị bỏ ra và phần còn lại được co về đủ một; hiện tại vàng không có chuẩn. Câu trả lời nêu tên các chân. Nếu không nhóm nào bạn đặt mục tiêu có chuẩn, thì không có thước đo và câu trả lời nói vậy. Nếu một chỉ số không có giá phủ toàn cửa sổ (không có từ snapshot đầu tiên, hoặc không có gần snapshot cuối), thước đo bị bỏ chứ không tính từ một phần của nó.
- **Khoảng trống.** Một ngày có khoản nắm nào chưa có giá thì không ghi dòng nào và log `trading.nav_snapshot_skipped` nêu tên các công cụ; dòng trước đó của ngày ấy được giữ. Ngày dịch vụ nền tắt thì không có điểm, nhưng lợi suất qua khoảng trống vẫn chính xác, vì các khoản nạp được đọc từ sổ lệnh. Một cuốn sổ rỗng không ghi gì.

Đây là các con số của chính bạn. Chúng chỉ hiện trên các lệnh gạch chéo và API loopback (`GET /v1/portfolio/nav`), không bao giờ tới một mô hình hay một công cụ MCP.

### Các phát hiện về sức khỏe

Các quy tắc sức khỏe tạo ra những phát hiện này, mỗi cái mang **chủ thể** mà nó nói về, nên hai lần vượt cùng một loại đọc khác nhau:

| Phát hiện | Bật khi |
|---|---|
| `segment-cap-breach` | một nhóm vượt trần của nó |
| `etf-cap-breach` | các ETF của một nhóm cộng lại vượt trần ETF của nhóm đó |
| `segment-drift` | một nhóm lệch 5 điểm trở lên so với mục tiêu |
| `position-cap-breach` | một mã vượt trần mỗi vị thế của nhóm nó |
| `concentration` | một mã chiếm 20% NAV trở lên (quỹ ETF đã có trần ETF của nhóm thì không tính) |
| `sector-cap-breach` | một ngành vượt `maximum-sector-pct-nav` |
| `reserve-below-target` | tiền mặt dưới `reserve-pct-nav` |
| `excluded-holding` | bạn vẫn nắm thứ nằm trong danh sách loại trừ |
| `illiquid-position` | một vị thế cần hơn 5 phiên để thoát |

Một ETF không bao giờ tính vào tỷ trọng ngành: ngành mà nguồn gán cho nó nêu tên công cụ chứ không phải rổ bên trong, nên trần ETF của nhóm mới chặn nó. Trần ETF thay cho trần theo mã đối với quỹ, ở đây cũng như khi một đề xuất định cỡ một cái; nhóm không có trần ETF thì quỹ của nó vẫn chịu trần theo mã.

Mọi phát hiện vượt một giới hạn bằng số đều nêu cả hai phía: tỷ trọng đã đo và trần hay mục tiêu bị vượt, để bạn kiểm câu đó so với cuốn sổ. Cả hai được in ở cùng một độ phân giải trên mọi bề mặt. `excluded-holding` và `illiquid-position` không mang cặp đó: không cái nào vượt một con số, và cái thứ hai đã nêu số phiên của chính nó.

### Hồ sơ

Hồ sơ là chính sách của bạn, và quy trình đọc nó thay vì đoán.

```bash
openalpha chat --message "/profile show"
openalpha chat --message "/profile set risk-level balanced"
openalpha chat --message "/profile reset"
```

`/profile set` nhận một tên trường và một giá trị. Mỗi lần ghi là một lần cập nhật nguyên tử hồ sơ của bạn. Nếu hai cuộc chat cùng sửa, lần sửa cuối thắng và không lần nào bị từ chối.

**Các trường đặt được:**

- `risk-level`, `risk-capacity`, `risk-willingness`, `horizon`, `goal`
- `maximum-sector-pct-nav` - phần tối đa của tổng tài sản được dồn vào một ngành
- `reserve-pct-nav` - phần tiền mặt luôn giữ lại
- `regime-scale` - mỗi lần mua chỉ dùng tối đa chừng này số tiền định mua (0,75 là 75%); thị trường phòng thủ có thể hạ thấp hơn nữa
- `risk-per-trade-pct-nav` - mức lỗ tối đa nếu một lệnh mua mới chạm cắt lỗ
- `maximum-open-risk-pct-nav` - mức lỗ tối đa nếu mọi vị thế đang nắm cùng chạm cắt lỗ
- `entry-tranche-pct` - phần của lệnh mua mới được vào trước (mặc định 0,5)
- `take-profit-tranche-pct` - phần bán ở mục tiêu đầu tiên và trong một reduce (mặc định một phần ba)

Cả hai trường này nhận từ 0,2 tới 1.

**Chính sách nhóm** có các dạng riêng:

- `horizon <nhóm> <short|long>`
- `segment-target`, `segment-cap` và `position-cap`, mỗi cái nhận một nhóm và một phân số
- `/profile enable|disable <nhóm>` bật hoặc tắt một nhóm

Một nhóm mà sàn nào cũng không giao dịch (vàng thế giới, giữ lại vì giá của nó và mức chênh `gold-vn`) luôn tắt, và bật nó bị từ chối. `/suggest` trên một mã của nhóm đó vẫn đưa số đọc yếu tố và các mức giá, như một lần giữ nguyên với lý do `reference-only`, và không chạy tranh luận. Cách dùng của `/profile`, `/record` và `/rebalance` bỏ nó ra, và `/overview` in số đọc vĩ mô của nó mà không có dòng về mức nên chi bao nhiêu của một lệnh mua đã lên kế hoạch, vì ở đó không mua gì.

Một nhóm có tỷ trọng mục tiêu 0% thì không mở vị thế mới nào. Mức `conservative` mặc định để crypto như vậy: `/suggest` một coin bạn chưa nắm sẽ trả lời giữ nguyên với lý do `segment-target-zero`, còn các mã đang nắm vẫn giữ nguyên điểm thoát và lệnh giảm bớt. Muốn mua lại trong nhóm đó, hãy đặt cho nó một tỷ trọng bằng `segment-target`.

`maximum-open-risk-pct-nav` chặn tổng mức mà mọi mã đang nắm có thể mất tại cắt lỗ đã lên kế hoạch của chúng. Một lệnh mua mới được định cỡ vào phần còn lại dưới nó, và một mã đang nắm không có cắt lỗ đã lên kế hoạch thì được báo chứ không bị tính là an toàn.

`risk-level` và cặp `risk-capacity`/`risk-willingness` **loại trừ lẫn nhau**. Level là cách viết tắt và cặp kia là phép suy ra đứng sau nó. Một lần ghi gửi cả hai bị từ chối. Công cụ `profile_update` dựng quy tắc đó vào chính schema của nó, nên mô hình được bảo thử lại trước khi bạn bị hỏi duyệt một lần ghi không thể hạ cánh.

**Đơn vị.** Các trường chính sách trong hồ sơ là **phân số** (`0.25`), còn mọi tỷ trọng hiện trong một khung nhìn là **phần trăm** (`25`). Hậu tố `pct-nav` là một phần của tổng tài sản (NAV) và xuất hiện ở cả hai.

Risk level đặt các mặc định, và các biên giới hạn những gì bạn đặt được. Rủi ro mỗi lệnh 40% NAV bị từ chối, không phải được nhận rồi lặng lẽ bỏ qua. Lời từ chối nêu tên trường bạn gõ và khoảng nó cho phép.

Đổi risk level sẽ gieo lại các trần cho mức mới, nhưng hai thứ bạn tự đặt vẫn ở lại: mục tiêu của một nhóm và lõi ETF của một nhóm. Một lõi vượt trần ETF mới thì bị giữ ở trần và quay lại số của bạn khi trần nới ra lần nữa. Tắt rồi bật một nhóm cũng giữ nó. `/profile reset` xóa cả hai.

Mọi màn hình mà các con số bị hồ sơ định hình đều nêu tên nó một lần, ở dòng cuối của tiêu đề: `/portfolio`, `/rebalance` và một đề xuất đã lưu. Dấu này chỉ là danh tính (rủi ro, kỳ hạn, mục tiêu, cộng một dấu hiệu khi chưa lưu gì), vì mọi giới hạn đã in ở chỗ nó chặn. Một đề xuất đã lưu mang dấu mà nó được định cỡ theo, nên xem lại nó nêu chính sách mà các con số của nó đến từ đó, không phải chính sách đang hiệu lực khi bạn nhìn. `/reflect` không mang dấu nào vì cùng lý do: các dòng của nó được định cỡ theo bất cứ thứ gì áp dụng vào mỗi ngày của chúng.

### Lời khuyên

Lời khuyên hoặc là **ready** (phân bổ nhóm, tái cân bằng từng vị thế, một thế đứng cho nhóm tiền mặt và các khoản nắm yếu) hoặc **unavailable**, với một trong bốn lý do:

| Lý do | Nghĩa là |
|---|---|
| `zero-nav` | không có gì để phân bổ |
| `incomplete-valuation` | ít nhất một khoản nắm không định giá được |
| `insufficient-policy-input` | một công cụ đang nắm không có dữ liệu sàng lọc |
| `unresolved-names` | một mã bạn nêu không khớp thị trường nào đã đăng ký |

Một câu trả lời unavailable vẫn mang các phát hiện, vì "bạn đang vượt trần ngành" vẫn đúng khi một khoản nắm chưa có giá.

Một nhóm mà kế hoạch không cấp vốn đủ tới mục tiêu thì nêu một caveat gọi tên nhóm đó. Mỗi nhóm có phần riêng của quỹ có thể triển khai, nếu không một khoản hụt toàn kế hoạch sẽ đổ ngân sách đã cạn của một nhóm bên cạnh lên mã nào tình cờ đứng dưới mục tiêu.

Khi trần chặn lại là trần dùng chung (trần ETF của nhóm hoặc trần một ngành), cảnh báo ghi tên trần đó
và nói chỉ mã ngoài trần đó mới lấp được nhóm, kèm các mã gợi ý từ bảng sàng lọc mà trần đó không chạm
tới. Nếu thứ chặn là trần ngành, các mã gợi ý sẽ nằm ngoài những ngành đã có trong kế hoạch. Bảng không
có mã nào như vậy thì chỉ còn dòng của trần.

Một lệnh giảm bớt kế hoạch muốn đặt nhưng không đặt được cũng được nêu ra, thay vì để một mã vượt mức mà
không có dòng nào bên cạnh. Có hai lý do:

- phần đã về tài khoản chưa đủ cho một lệnh (T+2); hoặc
- mã khớp quá ít mỗi phiên để giảm bớt một lần. Khi đó nên giảm bớt dần bằng tay.

Trần triển khai được in ra là của cả cuốn sổ, không phải của một nhóm. Quỹ được chia theo tỷ trọng mục tiêu trong hồ sơ và mỗi phần bị giữ ở số đọc vĩ mô của chính nhóm nó, nên một nhóm phòng thủ cạnh một nhóm trung tính cho ra một hỗn hợp không giống cái nào. Mọi màn hình in con số này đều nêu luôn chế độ của từng nhóm đứng sau nó.

**`/rebalance` và `/suggest` định cỡ cùng một mã theo các thứ khác nhau, và cả hai câu trả lời đều đúng.**

- Kế hoạch lấy khoảng cách tới mục tiêu và giữ nó trong ngân sách nhóm, trần mỗi mã và lô chẵn.
- Đề xuất lấy trần chặt nhất trong các trần của chính nó và co nó theo cái chặt nhất trong mức tin cậy, ý định của trader và trạng thái thị trường (không bao giờ là tích của chúng).

Nên một mã mà kế hoạch liệt kê có thể là mã mà đề xuất từ chối hôm đó. Kế hoạch nói vậy ở chỗ nó liệt kê một lệnh mua. Nó không chạy tranh luận, nên không tốn lời gọi mô hình nào.

Một khoảng cách mà kế hoạch không khép được trong một lô thì được nói thẳng thay vì để trông như đã hội tụ, nhưng chỉ khi đó còn là khoảng cách bạn hành động được. Dưới độ phân giải mà câu in ra, mã đó đã ở mục tiêu theo mọi nghĩa thực tế, và một ghi chú nói nó lệch `0%` sẽ đọc như kế hoạch đang cãi chính nó.

Có một kết luận mà kế hoạch không đi vòng qua: một mã đang nắm có kết luận đã lưu mới nhất là `reduce` trên bằng chứng thì không nhận lệnh tăng, dù nó nằm dưới mục tiêu bao xa, và kế hoạch nêu tên nó thay vì để dòng đó lặng lẽ vắng mặt. Một lệnh giảm bớt mang lý do của chính kế hoạch (`over-target`, `weak-signal`, `over-cap`) không phải kết luận đó. Nó là chính quy tắc của kế hoạch này được ghi ngược vào kho, nên hành động theo nó sẽ để kế hoạch tự phủ quyết mình. Không gì khác về kế hoạch đổi: khoảng trống chưa lấp của nhóm vẫn chưa lấp và được báo là tiền mặt.

Một mã đã vượt trần sẽ được giảm bớt, kể cả khi điểm của nó trung tính và nhóm của nó chưa lệch.

- **Theo từng mã.** Khi tỷ trọng một mã vượt trần mỗi mã (hoặc trần của quỹ) quá dải 5/25, kế hoạch
  giảm bớt nó về đúng mức trần. Trần 10% sẽ hành động ở 12,5% và giảm bớt về 10%, còn phiên chạy sau ở
  10,3% không đặt lệnh nào.
- **Theo ngành.** Một ngành vượt trần thì trả phần dư từ các mã yếu nhất trước. Mã có điểm yếu nằm
  trong phần cắt thì được giảm bớt hết (mã trong danh sách loại trừ thì chỉ bị cắt như các mã khác).
  Nếu chỉ riêng các lệnh đó đã đưa ngành về trong dải, các mã khác giữ nguyên tỷ trọng, đúng như phiên
  chạy sau cũng sẽ để yên. Quỹ không bị tính vào đó, các mã thuộc nhóm có mục tiêu 0% cũng vậy, vì
  chúng đằng nào cũng được giảm bớt hết.
- **Giảm bao nhiêu.** Lệnh đưa về mức trần, lệch tối đa một lô, và trong một bước. Số lượng đã về tài
  khoản và thanh khoản của mã vẫn giới hạn số giảm bớt được trong ngày.

Dòng đó đọc "đang vượt trần mỗi mã trong hồ sơ 10% - giảm bớt cho vừa trần, không phải vì điểm yếu" và
nằm dưới mục làm trước. Nó không bao giờ đóng mã khỏi `/rebalance`.

Mã nằm trong danh sách loại trừ mà bạn vẫn đang nắm cũng được giảm về trần: danh sách đó chặn lệnh mua
mới, còn trần là để giới hạn rủi ro. Muốn giữ một mã tập trung có chủ ý thì nâng trần bằng `/profile`.

Một quỹ ETF không bao giờ bị bán vì điểm yếu. Điểm xấu của một chỉ số là nhận định về cả thị trường, và tỷ trọng của nhóm cùng trạng thái thị trường đã lo phần đó, nên một ETF đang nắm có điểm dưới ngưỡng giữ vẫn giữ tỷ trọng. Luật lệch tỷ trọng vẫn có thể cắt bớt nó, và trần vẫn có thể giảm bớt nó. Lõi ETF của nhóm ở lại với quỹ bạn đang nắm cho tới khi một quỹ khác cao điểm hơn 0,15. Các quỹ theo chỉ số trùng nhau đi gần như cùng nhau, nên chênh lệch nhỏ không đáng một vòng phí và thuế.

Không nêu mã thì `/rebalance` định cỡ các khoản nắm của bạn cộng danh sách theo dõi đã lưu. Nêu mã thì định cỡ đúng những mã đó. Mỗi dòng lệnh nêu số tiền theo tiền tệ gốc của cuốn sổ và giá theo tiền tệ báo giá của chính thị trường (thứ mà sàn nhận), nên một thị trường tính theo bảng giá in điểm của nó không kèm tiền tệ còn một coin in tiền tệ của nó. Một mức giá lấy đúng số chữ số thập phân mà đồng tiền của nó có: VND, JPY và KRW không có đơn vị nhỏ hơn, nên một giá đồng in nguyên.

```bash
openalpha chat --message "/portfolio"
openalpha chat --message "/rebalance"
openalpha chat --message "/rebalance FPT MWG"
openalpha chat "Show my valued portfolio and its risk findings."
```

### Bề mặt của cuốn sổ

| Bề mặt | Với tới |
|---|---|
| Công cụ | `portfolio_view` `portfolio_history` `portfolio_review` `portfolio_rebalance` `portfolio_record` `portfolio_update` `portfolio_remove` `watchlist_update` `profile_view` `profile_update` `profile_segment` |
| Gạch chéo | `/record` `/update` `/delete` `/transactions` `/portfolio` `/portfolio nav` `/profile` `/watchlist` `/rebalance` `/reconcile` |
| Chat terminal | Cùng các lệnh gạch chéo cộng việc dùng công cụ bằng ngôn ngữ tự nhiên |
| HTTP | `GET /v1/portfolio` `GET /v1/portfolio/nav` `GET /v1/profile` `POST /v1/profile` |

Chat terminal và các kênh dùng chung một registry lệnh gạch chéo, nên cú pháp giao dịch hay một trường hồ sơ không thể lệch nhau giữa chúng.

Một lần khớp đặt qua `/trade` hay `order_place` được ghi vào sổ lệnh đúng như một `/record` thủ công. Cuốn sổ vẫn là một phép tính trên một tập dòng, và một vị thế mở ở sàn trông giống hệt một vị thế gõ tay. Một lệnh bán do một lối thoát đã kích hoạt ghi rõ chân nào đã khớp (`stopped out` / `target hit`); một lệnh bán bạn tự làm thì không nêu gì.

Khi lệnh cắt lỗ hoặc chốt lời đang treo khớp ở sàn, lượt đối soát các lệnh thoát đang treo kế tiếp (mỗi 60 giây) ghi lệnh bán vào sổ lệnh và gửi một thông báo nêu lệnh thoát nào đã khớp, sàn, khối lượng và giá, và rằng sổ lệnh đã có dòng đó. Ứng dụng nối vào API thấy lần khớp đó một lần. Lệnh bán mà `/record sync` đã ghi trước thì không gửi gì.

**`/record sync <sàn>`** là cách thứ ba để tạo các dòng đó, và nó đi cùng đường. Nó chỉ khác ở cách chọn: nó hỏi sàn đã khớp gì, rồi ghi những gì cuốn sổ chưa có dòng. Kiểm hợp lệ, phép tính và dòng xác nhận đều dùng chung.

Một lệnh giới hạn chỉ khớp một phần trước khi bạn hủy giờ được đồng bộ cho phần đã khớp.

- Một lần khớp được đối chiếu theo order id của chính sàn (`<sàn>:<orderId>`, cũng là khóa `/trade` ghi lần khớp của chính nó), và theo chính các con số so với một dòng bạn gõ tay. Một lần khớp được để yên khi nó khớp một dòng gõ tay mà chưa lần khớp nào nhận, theo sàn, công cụ, ngày, chiều và khối lượng. Mỗi dòng gõ tay hấp thụ tối đa một lần khớp.
- Thị trường của mỗi lần khớp được xác định trong các thị trường mà sàn đó giữ, không thị trường nào khác. Khi không với tới được bộ nhận diện nào, danh sách niêm yết của chính sàn trả lời thay, đọc tối đa một lần mỗi lượt, và chỉ khi đúng một thị trường của sàn có thể nhận mã. Một mã mà thị trường nào cũng không niêm yết, hoặc có hai thị trường cùng nhận, thì bị bỏ qua thay vì đoán.
- Các lần khớp được ghi từ cũ tới mới trên các công cụ. Một mã mà cuốn sổ chỉ nhận được một phần thì không nhận gì cả: nếu một lần sync hỏng hoặc bị hủy giữa chừng, nó rút lại những gì đã ghi của mọi mã chưa xong, nên không bao giờ để lại một vị thế ghi dở. Các dòng mà một lượt trước để lại là của bạn để xóa.

Phân bổ không có bề mặt riêng: `portfolio_rebalance` và `/rebalance` báo các mục tiêu nhóm và thay đổi từng mã như một kế hoạch bằng lời thường.

#### Trên trang văn phòng

Thẻ Danh mục của [trang văn phòng](van-hanh.md#trang-văn-phòng) ghi đúng những dòng mà `/record`, `/update` và `/delete` ghi, qua cùng các bước kiểm tra, và không bao giờ gửi lệnh.

- **Mọi loại dòng.** Biểu mẫu ghi mở sẵn Mua hoặc Bán; mục "Khác" có cổ tức tiền mặt (số tiền thực nhận, theo tiền tệ của thị trường), cổ tức bằng cổ phiếu hay cổ phiếu thưởng (số cổ phiếu nhận thêm), chia tách (số cổ phiếu thêm vào, số âm khi gộp cổ phiếu), mua cổ phiếu quyền (kèm giá mua; để trống phí thì ghi là 0), chuyển tiền (giữa hai sàn của bạn; chọn cùng một sàn ở hai đầu thì bị từ chối trước khi gửi), nạp tiền, rút tiền, phí và lỗ đã thực hiện (khoản lỗ từ trước khi bạn ghi sổ). Một thay đổi số cổ phiếu cho thấy sau khi ghi bạn sẽ nắm bao nhiêu. Lịch sử liệt kê mọi loại, có bộ lọc, và dòng nào cũng sửa hoặc xóa được, có hoàn tác.
- **Tỷ giá bạn đã trả.** Khi một dòng dùng tiền tệ khác với tiền của sổ và cần tỷ giá, như nạp USDT vào một sổ tính bằng VND hay mua ở một sàn không giữ USDT, ô Tỷ giá hiện ra, điền sẵn giá thị trường ngày đó; hãy sửa thành tỷ giá bạn thực trả. Ô này không được để trống, nên trang không bao giờ lưu một dòng như vậy ở mức giá bạn chưa thấy. Dòng trả bằng USDT mà sàn đã giữ (mua, chuyển tiền, phí) không có ô tỷ giá. Nếu không đọc được giá trong ngày, biểu mẫu nói rõ, cho nút Thử lại và chưa cho lưu. Sửa một dòng thì giữ tỷ giá đã ghi của nó.
- **Đối chiếu với sàn.** Lịch sử > Đối chiếu với sàn đọc từng sàn đã có khóa, như `/reconcile`: khớp, hoặc sàn đang giữ nhiều hơn hay ít hơn sổ bao nhiêu, kèm một nút mở biểu mẫu ghi điền sẵn phần chênh (giá để bạn tự điền). Sàn chưa có khóa thì nêu tên biến của nó và dẫn tới Cài đặt > Sàn giao dịch; sàn không đọc được số dư, hoặc không trả lời, thì nói vậy. "Đồng bộ lệnh khớp từ <sàn>" làm đúng việc của `/record sync`: đọc các lệnh đã khớp, ghi những lệnh sổ còn thiếu, và không đặt lệnh nào. Nếu trả lời chậm, trang đọc lại sổ chứ không gửi đồng bộ lần hai.
- **Lệnh.** Khi có sàn đặt lệnh được và `[api] orders` đang bật, Danh mục có thẻ *Lệnh*.
  - Lệnh bạn soạn trong chat bằng `/trade` chờ ở đó để bạn bấm "Đặt lệnh trên <sàn>" (hỏi lại một lần;
    nút bị khóa cho tới khi sàn trả lời, và không gì được gửi hai lần) hoặc "Không đặt".
  - Nếu không có trả lời kịp, trang nói chưa biết lệnh đã đi chưa và đọc lại danh sách. Nên hãy xem lại
    trước khi soạn lệnh khác.
  - Bên dưới là các lệnh thoát đang chờ trên sàn, mỗi lệnh có Hủy lệnh thoát sau một bước xác nhận; các
    vị thế không có gì bảo vệ; những lần khớp sàn đã nhận mà sổ chưa ghi được (Đồng bộ lệnh khớp sẽ ghi
    chúng); và "Cho phép mua", cùng công tắc với `/trade halt`.
  - Đặt hay dời lệnh thoát vẫn dùng `/trade exit` trong chat.

### Sàn, và điều duy nhất cuốn sổ này không làm

Một sàn là nơi tài sản thật sự nằm (OKX, Binance, VPS) và mọi dòng có công cụ đều nêu một sàn. Một số sàn có client sàn và đặt lệnh được. Một sàn bạn giao dịch bằng tay thì không có, và chỉ để ghi sổ. Cả hai giữ vị thế theo cùng một cách.

**Binance liệt kê giao dịch theo từng coin.** `/record sync binance` đọc các coin mà cuốn sổ đã ghi ở đó cộng mọi coin tài khoản đang nắm, và nói vậy ở cuối câu trả lời. Một giao dịch bạn mở và đóng trên một coin chưa bao giờ ghi sẽ không được tìm thấy, nên hãy ghi tay cái đó. Các lần đọc giao dịch theo từng lệnh được điều tốc, nên một cuốn sổ dài không tiêu hết trọng số yêu cầu của sàn trong một đợt.

Coin bạn gửi vào Binance Simple Earn rời khỏi số dư spot và hiện là `LD<coin>`. `/reconcile` khi đó cho thấy coin thiếu và, giả sử, `LDBTC` không có chủ, cạnh nhau. Đó là cùng số coin ở hai nơi, không phải một khoản lỗ.

Mọi dòng tiền mặt nêu nơi lưu ký của nó, và một lệnh mua bị chặn bởi tiền mặt ở sàn mà định tuyến sẽ gửi nó tới. `/portfolio` tách dòng tiền mặt khi có hơn một sàn nắm tiền, và một dòng `transfer` chuyển tiền giữa các sàn mà không chạm nạp ròng.

**Tài sản không thể chuyển giữa các sàn.** Cách duy nhất còn lại để diễn tả là một lệnh bán và một lệnh mua, thứ bịa ra một khoản lãi đã thực hiện và hai khoản phí chưa từng bị tính. Một cuốn sổ mà tài sản đã chuyển đi là sai, và bạn sửa nó bằng cách sửa các dòng.

---

## Đặt lệnh

**Hãy bắt đầu trên tài khoản demo.** Đường đặt lệnh mới được kiểm tĩnh, chưa kiểm trên một tài khoản OKX hay Binance thật. Hãy chạy hết trang này trên một cuốn sổ OKX demo hoặc Binance testnet, gồm cả các phép kiểm ở bước 9, trước khi dùng khóa thật.

`/trade` và công cụ `order_place` đặt lệnh spot trên **OKX** hoặc **Binance**: lệnh thị trường và limit, mua và bán, kèm chốt lời/cắt lỗ tùy chọn trên lệnh mua. Mỗi lệnh bị chặn trần trước khi bạn được hỏi, được bạn duyệt trước khi đi ra, và được phản chiếu vào sổ lệnh khi khớp.

### 1. Lấy một khóa demo

Giao dịch demo là một chế độ nằm trong tài khoản OKX bình thường của bạn, và **khóa của nó tách khỏi khóa thật**. Khóa thật kèm header demo thì lỗi xác thực, và khóa demo không kèm header cũng vậy.

1. Đăng nhập OKX, rồi **Trade**, rồi **Demo Trading**.
2. Khi đang ở chế độ demo: **User / Personal Center**, rồi **Demo Trading API**.
3. **Apply for Demo Trading V5 API**.

Khóa tạo ở bất kỳ chỗ nào khác là khóa thật. Nếu bước 5 trả lỗi xác thực, hãy nghi điều này trước khi nghi chữ ký.

#### Binance

Tài khoản thực hành của Binance là **Demo Trading**, và khóa của nó cũng tách khỏi khóa thật. Đăng nhập, mở **Demo Trading**, và tạo khóa ở trang **API Key Management** của nó. Khóa thật gửi tới host demo thì lỗi xác thực, và ngược lại cũng vậy.

Với khóa thật, chỉ tick **Enable Reading** và **Enable Spot & Margin Trading**, không bao giờ tick **Enable Withdrawals**, và giới hạn nó theo IP máy chủ của bạn. `openalpha doctor venues --online` đọc quyền của khóa và cảnh báo từng quyền rộng hơn mức đó.

### 2. Cấu hình

```toml
[trading.orders]
maximum_stake_quote = 200      # chặn giá trị danh nghĩa khi đang thử
maximum_open_trades = 3

[trading.venues.okx]
simulated = true                 # gửi x-simulated-trading: 1
fees = { buy = 0.0008, sell = 0.0008, fee_asset = "base" }   # phân số của giá trị lệnh, không phải phần trăm
```

```bash
openalpha key set OKX_API_KEY
openalpha key set OKX_API_SECRET
openalpha key set OKX_API_PASSPHRASE
```

Với Binance:

```toml
[trading.venues.binance]
simulated = true                 # mọi lời gọi đi tới demo-api.binance.com
```

```bash
openalpha key set BINANCE_API_KEY
openalpha key set BINANCE_API_SECRET
```

Có khóa của cả hai sàn thì hãy nêu sàn trên mọi lệnh mua: `/trade spot binance:BTC buy 0.001 sl 100000`.

Bạn đổi tên các biến được ở `credentials` dưới `[trading.venues.okx]`, và mỗi biến cũng chạy với tiền tố `OPENALPHA_`. `simulated` không phải chạy thử (dry run): OpenAlpha ký, gửi và hỏi một API thật, và OKX khớp lệnh trên sổ lệnh demo của nó. Không gì bịa ra một lần khớp cục bộ.

### 3. Xác nhận nó đã được đăng ký

`/trade` chỉ tồn tại khi một sàn đã đăng ký có client sàn. Với OKX, điều đó nghĩa là cả ba thông tin đăng nhập đều giải được. Không có chúng thì OKX vẫn là một sàn để bạn ghi giao dịch, chỉ là không có gì để đặt lệnh qua. Không có `/help`. Hãy gõ `/trade` không kèm đối số và đọc câu trả lời:

- **dòng cách dùng** - đã đăng ký, bạn sẵn sàng;
- **unknown command** - thông tin đăng nhập chưa giải được. Log khởi động nói cái nào: `trading.order_credentials_missing` nêu tên chính xác các biến nó đã tìm.

Công cụ `order_place` và `order_exits` theo cùng cổng đó, nên một bản cài chưa từng cấu hình sàn thì không có bề mặt đặt lệnh nào.

**Duyệt.** `order_place` hỏi bạn ở mọi lời gọi và không đưa quyết định ghi nhớ. Nó từ chối thẳng khi
chế độ duyệt của phiên chạy là `bypass`, trừ khi đặt `[trading.orders] allow_unattended`.

- Chốt lời hoặc cắt lỗ chỉ đi kèm lệnh mua: `order_place` từ chối khi có trên lệnh bán, giống `/trade`.
- Lệnh chỉ được tính cỡ và kiểm tra theo giá trực tiếp. Khi giá từ sàn chỉ là giá đóng đã lưu hoặc một
  lần in đã cũ, lệnh được giữ lại kèm một lời nhắn dễ hiểu để bạn thử lại.
- Lệnh mua làm một mã, một ngành hay một nhóm vượt mức trần cũng bị `order_place` từ chối, và agent sẽ
  báo bạn vượt ở đâu. Bạn đặt lại bằng `/trade`, nơi mức vượt được hiện ra trước khi bạn xác nhận.
- Lệnh mua một ETF vào nhóm mà phần ETF không đo được (có khoản nắm ở đó chưa phân loại được) được tính
  là vượt mọi trần ETF mà nhóm đó đã khai. Không kiểm tra được hạn mức thì không cho qua.

Khi đã lưu hồ sơ, lệnh mua bị từ chối (`order.book_unpriced`) lúc còn khoản nắm nào chưa có giá, cả ở `/trade` lẫn `order_place`. Thiếu giá một khoản thì không có tổng, nên không đo được trần vị thế, nhóm hay ETF nào, và một lệnh bỏ qua các trần đó sẽ qua hết. `/portfolio` cho biết đó là mã nào; chạy `/refresh` cho thị trường của mã đó để lấy giá, rồi đặt lại lệnh. Lệnh bán, và lệnh mua khi chưa lưu hồ sơ, không bị giữ lại.

Khi lệnh bị từ chối vì khối lượng (bán nhiều hơn phần đã về, hoặc nhiều hơn phần lệnh chốt lời/cắt lỗ đang treo chưa khóa), con số hiện trong phản hồi `/trade` của bạn nhưng không bao giờ nằm trong những gì agent đọc.

**An toàn trước việc đặt hai lần và sự cố:**

- Mỗi lệnh đã dàn dựng có token riêng, được nhận trước khi chạm tới sàn. Một token đã dùng, đã đặt hay đã hết hạn thì bị từ chối, nên một `/trade confirm` trần không bao giờ đặt cùng một lệnh hai lần. Một lệnh đã mang order id hay một lỗi thì không bao giờ được liệt kê là đang chờ `/trade confirm`.
- Trước khi một lệnh rời đi, một dấu đang-bay được ghi. Nếu tiến trình chết khi sàn đang giữ lệnh, dấu đó vẫn còn, `/trade reconcile` liệt kê nó, và các trần đếm nó cho tới khi nó được chốt. Một lệnh không ghi được dấu này thì không được gửi. Mọi kết cục sau đó thay dấu.
- `/trade` ghi lần khớp của mình dưới chính order id của sàn, cùng khóa mà `/record sync` dùng, và ghi dòng theo phiên mà lần khớp diễn ra thay vì lúc bạn xác nhận. Bên nào ghi sau sẽ thấy dòng đã có sẵn, ngay trong khóa ghi của sổ lệnh, và không ghi thêm gì, nên tiền chỉ bị trừ một lần dù cả hai chạy cùng lúc. Nếu `/record sync` đã ghi lần khớp trong lúc `/trade` còn đang chờ, `/trade` dùng lại dòng đó.
- Một phiên chạy bị hủy sau khi sàn đã nhận lệnh vẫn đánh dấu lệnh cho `/trade reconcile` và, với lệnh còn treo, cố hủy nó.
- Một phiên chạy bị hủy giữa lúc khớp và lúc ghi sổ để lại một dòng chưa ghi với lý do `order.mirror_aborted`, vẫn bị tính vào các trần và được `/trade reconcile` liệt kê.

`/trade reconcile` cũng hỏi mỗi sàn có treo lệnh thoát xem nó đang giữ gì dưới một client id mà bản cài
này đã tạo, và liệt kê cái nào không có dòng sống. Phép kiểm lối thoát chỉ đọc các dòng, nên một lối
thoát như vậy (một sự cố giữa lúc sàn nhận nó và lúc dòng được ghi, hoặc bất kỳ thứ gì cũ hơn) không bao
giờ được kiểm hay trail.

- Nó chỉ báo cáo. `/trade cancel` không với tới được, nên hãy hủy nó trong app của sàn nếu không cần,
  và để nguyên cái đang bảo vệ một vị thế.
- Một sàn không đọc được thì được nêu tên chứ không bị bỏ qua.
- `POST /v1/trade/reconcile` trả cùng hai danh sách (`orphanExits` và `unreadExitVenues`).

Một `/trade exit` gieo client id của lối thoát từ chính yêu cầu, nên một tin nhắn Telegram được gửi lại sau sự cố sẽ tìm thấy lối thoát mà nó đã đặt. CLI và app tạo một id mới cho mỗi lệnh. `POST /v1/trade/exits` nhận header `Idempotency-Key` cho client có thử lại: cùng khóa thì tìm thấy lối thoát mà lời gọi đầu đã đặt, và một lời gọi không kèm khóa là một yêu cầu riêng.

Sàn trả 418 hoặc 429 hiện thành `order.rate_limited` và không được thử lại. Phát lại trong cửa sổ thử lại chỉ làm lệnh cấm sâu thêm.

`order_exits` là lần đọc đứng cạnh: mỗi vị thế có chốt lời/cắt lỗ đang đứng ở sàn của nó hay không, dưới dạng một phần của vị thế, không bao giờ là một khối lượng (dòng mà `portfolio_view` đã vẽ). Không có nó, một mô hình thấy một khoản nắm mà không thấy có cắt lỗ đứng dưới nó, và sẽ khuyên trim như thể phía giảm đang mở.

### 4. Cấp vốn cho cuốn sổ trước

Trần tiền mặt tính tiền khả dụng từ các dòng sổ lệnh, nên lệnh mua đầu tiên trên một cuốn sổ rỗng bị từ chối, đúng như vậy, và lời từ chối nêu cách chữa:

```text
/record deposit okx 1000 USDT 2026-09-07
```

Đây là ghi sổ, không phải chuyển tiền. Nó cho sổ lệnh biết bạn đang nắm gì để cuốn sổ cấp vốn được cho thứ bạn đặt. Bỏ qua bước này thì mọi lệnh mua đều bị từ chối vì thiếu tiền.

### 5. Đặt một lệnh

```text
/trade spot BTC buy 0.001 sl 100000
/trade spot BTC buy 0.001 limit 109000 sl 100000
/trade spot okx:BTC buy 0.001 limit 109000 tp 120000 sl 100000
```

- Mã là **chỉ tài sản gốc**: `BTC`, không bao giờ là `BTC/USDT`. Cặp được dựng cho bạn.
- Khối lượng luôn tính bằng **đơn vị gốc**: `0.001` nghĩa là 0,001 BTC, không phải 0,001 USDT giá trị.
- `tp`/`sl` chỉ đi kèm lệnh mua, vì một lệnh bán chính là lối thoát.
- Lệnh mua mặc định cần `sl`. Đặt `require_stop_loss = false` dưới `[trading.orders]` để cho phép không có.

Tiền tố `sàn:` là tùy chọn và chỉ cần khi có hơn một sàn có thể trả lời. Định tuyến chọn đúng một sàn khớp được lệnh, thu hẹp lệnh bán về các sàn thật sự đang nắm một phần bán được, và từ chối mọi trường hợp khác kèm các ứng viên được nêu tên. Nó không bao giờ chọn hộ bạn, vì một lệnh tiền thật không được phụ thuộc vào một mặc định mà không ai đọc lại. Một lệnh bán bị từ chối khi vượt phần đã settle và chưa được bảo vệ ở sàn đã định tuyến:

- vượt phần đã settle: `order.sell_unsettled`;
- vượt phần bán được, nơi một lối thoát đang treo đã đóng băng coin ở sàn: `order.sell_guarded`.

Dàn dựng không đặt gì. Nó định giá lệnh, làm tròn theo lô và tick của sàn, chạy các trần, và in một lời nhắc duyệt kèm một token. Lời nhắc có **phí ước tính** từ tỷ lệ `fees` của sàn đã định tuyến, nên cái lệnh sẽ tốn bao nhiêu nằm trên lời nhắc bạn duyệt, không chỉ trên biên nhận. Đọc lại token để đặt:

```text
/trade confirm <token>
```

Token có hiệu lực **năm phút**, dùng một lần, và được đối chiếu với một ý định đã lưu, nên một token bịa ra không đặt gì.

Giá, độ lệch và các trần được chạy lại lúc xác nhận trên một giá mới, nên một thị trường đã dịch chuyển trong lúc bạn đọc thì bị từ chối thay vì khớp ở mức giá không ai kiểm. Lệnh limit được giữ theo giá trực tiếp và lệnh thị trường theo giá lúc nó được dàn dựng, cả hai trong `maximum_price_drift`.

Trần tiền mặt tính cả phí mua mà tỷ lệ `fees` của sàn đã định tuyến tính (phí thu bằng chính coin bạn mua thì không cộng gì). Với lệnh thị trường nó còn cộng thêm đúng độ lệch đó làm khoảng trống cho lần khớp, nên một lệnh mua định cỡ bằng toàn bộ tiền mặt bị từ chối thay vì khớp ở sàn rồi không ghi sổ được. Một lệnh bán được kiểm lại lúc xác nhận theo khối lượng còn rảnh.

Để gỡ một chốt lời/cắt lỗ đang treo:

```text
/trade cancel BTC
/trade cancel okx:BTC
```

Hãy nêu sàn khi hai sàn cùng giữ một lối thoát đang treo trên một công cụ. Trường hợp đó bị từ chối thay vì đoán, vì lặng lẽ hủy một trong hai sẽ để cái kia vẫn treo sau một thông báo nói nó đã mất. Hai lối thoát ở cùng một sàn thì không mơ hồ: cả hai đều bị hủy, nên ở sàn đó không còn gì treo lại.

### 6. Bảo vệ một vị thế bạn đã nắm

`/trade spot ... tp ... sl ...` gắn một lối thoát vào lệnh mua mở vị thế. Để đặt một lối thoát lên một vị thế đã mở, hoặc dời cái đang có, hãy nêu nó riêng:

```text
/trade exit BTC sl 100000
/trade exit BTC tp 120000 sl 100000
/trade exit okx:BTC tp 125000 sl 105000
/trade exit BTC qty 0.5 sl 100000
```

Cỡ mặc định là vị thế mà **cuốn sổ** nói bạn đang nắm ở sàn đó, làm tròn theo lô của sàn. `qty` thì phủ một phần của nó. Mọi thứ vượt quá những gì sàn đang giữ thì bị từ chối thay vì cắt bớt: trên OKX, một trigger spot đang treo không đóng băng gì, nên một cái định cỡ vượt quá số dư được nhận bây giờ rồi lặng lẽ khớp thiếu lúc nó nổ. Binance khóa coin phía sau một lối thoát đang treo, nên một cái quá cỡ bị từ chối ngay.

Một lối thoát một phần nói nó để lại gì, trên biên nhận và lần nữa trong `/trade`, vì không gì khác sẽ nói: nửa vị thế có cắt lỗ phía dưới không phải một vị thế được bảo vệ.

Mỗi công cụ ở mỗi sàn có một lối thoát, bất kể nó phủ cỡ nào. Cái thứ hai sẽ không có tên để bạn chỉnh nó, và mọi chốt chặn ở đây đọc đúng một dòng. Thoát dần qua hai trigger khác nhau không phải thứ lệnh này diễn tả được.

Lệnh này không bao giờ để bạn kém được bảo vệ hơn trước. Có ba kết cục và không có cái thứ tư:

- **không có gì đang treo** - lối thoát được đặt;
- **một cái đang treo với đúng hai chân giống nhau** - nó được dời tại chỗ, gồm cả cỡ, không có khoảnh khắc nào vị thế mất bảo vệ;
- **mọi trường hợp khác** - bị từ chối, nêu tên `/trade cancel`.

Trường hợp thứ ba là một lối thoát chỉ có cắt lỗ mà giờ bạn muốn ghép với một chốt lời, hoặc hai lối thoát cùng treo trên một công cụ ở một sàn. Cả hai là một quy trình hai bước có chủ ý: hủy, rồi đặt cặp mới. Lệnh sẽ không gỡ bảo vệ thay bạn, và không cờ nào làm được điều đó.

Vì nó không tiêu được tiền mặt, không mở được vị thế và không giảm được bảo vệ, nó đặt thẳng, không có token xác nhận. Một cặp mà nổ ngay khi được đặt thì bị từ chối trước khi bất cứ thứ gì chạm tới sàn.

Đây cũng là câu trả lời cho cảnh báo lệch: khi nhịp đối soát log `order.exit_diverged`, một lối thoát đang treo phủ nhiều hơn cái sổ nói bạn đang nắm. Chạy `/trade exit` sẽ co nó lại theo vị thế.

**Một cắt lỗ bạn đặt trong app OKX cũng được tính.** `/portfolio` hỏi OKX các lệnh bán đang sống có chân cắt lỗ (TP/SL, OCO và trailing stop), nên một vị thế bạn đã bảo vệ trong app không đọc là "no stop placed". Khi kế hoạch nâng một cắt lỗ trên vị thế như vậy, thông báo bảo bạn dời nó trong app thay vì gợi ý `/trade exit`, thứ sẽ đặt thêm một cái nữa bên cạnh. Nếu không đọc được OKX, dòng đó bị bỏ chứ không đoán. Một lệnh trigger thường không được tính: không có giá đi kèm, một trigger bán không phân biệt được với một chốt lời.

**Trên Binance không dời được một lối thoát.** Binance không có cách đổi một cắt lỗ đang treo, nên `/trade exit` lần hai trên một mã đã có một cái treo ở đó bị từ chối với `order.exit_not_amendable`, và câu trả lời nói phải làm gì:

```text
/trade cancel binance:BTC
/trade exit binance:BTC tp 125000 sl 105000
```

Giữa hai dòng đó, không gì bảo vệ vị thế. Hãy chạy chúng liền nhau.

**Kế hoạch chốt một phần chỉ để lệnh cắt lỗ trên sàn.** Kế hoạch bán một phần vị thế ở mục tiêu rồi để phần còn lại chạy được chấm điểm đúng như vậy, nên trên sàn chỉ nên để lệnh cắt lỗ: đặt chốt lời đúng mục tiêu của kế hoạch sẽ bán hết vị thế ở mức đó. Khi cảnh báo mục tiêu đến, hãy tự bán phần đó và giữ mức cắt lỗ cho phần còn lại:

- **OKX:** lệnh thoát đang chờ giữ số coin phía sau nó, nên phải thu nhỏ nó trước rồi mới bán. Chạy `/trade exit <mã> qty <khối lượng> sl <giá>` để sửa ngay tại chỗ về phần giữ lại, rồi bán phần chốt lời.
- **Binance:** lệnh thoát không sửa được và số coin phía sau nó bị khóa, nên chạy `/trade cancel <mã>`, bán phần đó, rồi `/trade exit <mã> sl <giá>` cho phần còn lại. Giữa các bước không có gì bảo vệ vị thế, nên hãy chạy liền nhau.
- **Sàn tự giao dịch (cổ phiếu VN, vàng VN):** bán phần đó trong ứng dụng của nơi bạn giao dịch.

### Mỗi sàn làm được gì

Một sàn khai những gì API của nó làm được, và sàn nào không làm được một việc thì hỏng lúc khởi động, không phải lúc dùng lần đầu.

- Một sàn không nhận lệnh (cái bạn giao dịch tay) không treo được lối thoát. Đặt hay dời lối thoát trên đó bị từ chối với `order.exit_unsupported`, và vị thế chỉ được bảo vệ bằng cảnh báo. Một lệnh vào ở đó vẫn được ghi, và biên nhận của nó mở đầu bằng vị thế chưa được bảo vệ.
- **OKX** dời được một lối thoát đang treo tại chỗ. **Binance** treo được lối thoát nhưng không dời được (ở trên).
- Khi một sàn liệt kê được các lần khớp của nó, `/record` lấy được số liệu của một giao dịch từ đó và `/record sync` chạy được. Binance liệt kê theo từng coin, nên nó chỉ đọc các coin mà cuốn sổ và tài khoản nêu, và bản sync nói vậy.
- Khi một sàn báo được số dư, `/reconcile` đối chiếu cuốn sổ với nơi lưu ký.

### 7. Xem đang treo những gì

`/trade` trần trả lời một câu hỏi, cái gì đang sống ngay lúc này, theo từng phần. Phần nào rỗng thì vắng mặt, và một dòng đứng đầu tất cả khi việc mua đang tắt:

- **Buying is off since ...** - chỉ có sau `/trade halt`, và đứng đầu vì nó đổi nghĩa mọi dòng khác.
- **Waiting for your confirmation** - mọi lệnh đã dàn dựng còn trong cửa sổ năm phút, mỗi lệnh kèm token đặt nó.
- **Resting exits** - những gì đang đứng ở một sàn, kèm trigger của chúng.
- **Nothing is guarding these** - các vị thế ở một sàn bạn đặt lệnh được, có lối thoát bên dưới ít hơn cuốn sổ nói bạn đang nắm, mỗi cái nêu lệnh để chữa.
- **Placed at the exchange, missing from your book** - danh sách đối soát, kèm cách chữa.

Nó không chạm sàn nào. Một trạng thái cần mọi sàn đều hoạt động sẽ trống đúng lúc bạn cần biết nhất cái gì đang đứng ngoài đó.

`/trade confirm` không kèm token đặt cái lệnh duy nhất đang chờ. Có hai lệnh trở lên thì nó từ chối và liệt kê cả hai, giống cách định tuyến từ chối một sàn mà nó phải chọn giữa.

#### Hai sàn trong một thị trường

Định tuyến thu hẹp về đúng một sàn hoặc từ chối. Nếu một sàn thứ hai vừa phục vụ thị trường vừa nhận lệnh, mọi lệnh mua không nêu sàn trở thành mơ hồ:

```text
/trade spot BTC buy 1 sl 100000       -> order.venue_ambiguous, naming both
/trade spot okx:BTC buy 1 sl 100000   -> routed
```

Một lệnh bán không cần bổ nghĩa: nó thu hẹp về các sàn thật sự đang nắm vị thế, và chỉ một mã nắm ở cả hai mới mơ hồ.

Một sàn bạn giao dịch tay không nhận lệnh, nên định tuyến không bao giờ thấy nó và `/trade` không bị ảnh hưởng. Danh mục của nó vẫn được đọc, đúng như với một sàn có khóa.

### 8. Một lần ghi đi ra tại một thời điểm

Mọi lần ghi lên một sàn (xác nhận, lối thoát, hủy) chạy từng cái một. Điều đó đóng hai cuộc đua cùng một dạng, *đọc trạng thái, quyết định, rồi hành động*:

- Các trần tính trên cả cuốn sổ: tiền mặt chi được và số lệnh đang mở. Hai lần xác nhận chạy cùng lúc sẽ mỗi cái đo một cuốn sổ mà cái kia chưa ghi vào, và cả hai cùng vượt qua một trần mà chỉ một cái được phép.
- Hai lời gọi `/trade exit` chạy cùng lúc sẽ mỗi cái đọc *không có gì đang treo* và đặt, để lại lối thoát thứ hai mà chốt chặn xung đột sinh ra để ngăn.

Các trần được đọc **lại** bên trong cửa sổ đó. Một lệnh mà cuốn sổ không còn cho phép bị từ chối với `order.book_moved` thay vì bị cắt bớt, vì cỡ và các mức giá là thứ bạn đã đồng ý. Nếu trong lúc đó một khoản nắm mất giá, lệnh mua bị từ chối với `order.book_unpriced`.

### 9. Kiểm chứng, theo đúng thứ tự này

Mỗi bước là một kiểu hỏng riêng mà thiết kế này sinh ra để ngăn. Các bước đầu giúp bạn khỏi phải chẩn đoán một lỗi chữ ký khi tiền đang chạy.

- [ ] **Thiếu thông tin đăng nhập** - bỏ đặt một biến: log nêu tên nó, `/trade` là unknown, dịch vụ nền vẫn khởi động.
- [ ] **Chữ ký** - tới được lời nhắc là đã chứng minh dấu thời gian, digest, đường dẫn đã ký và body đều đúng. Chúng hỏng giống hệt nhau, nên hãy tách cái này trước.
- [ ] **Xác nhận trong một phút**, cùng chat, cùng người dùng - nó đặt, thay vì lặng lẽ không làm gì.
- [ ] **Cỡ theo đơn vị gốc** - một lệnh thị trường mua `0.001 BTC` khớp khoảng 0,001 BTC. Đọc biên nhận, không đọc yêu cầu.
- [ ] **Treo và hủy** - một lệnh limit xa thị trường thì treo, rồi bị hủy ở trần số lần hỏi (khoảng 20s).
- [ ] **Khớp một phần** - một lệnh gần thị trường mà khớp nửa thì tiếp tục hỏi chứ không ghi nửa đó.
- [ ] **Vòng đi-về của lối thoát** - biên nhận hiện cả hai chân, một OCO sống ở OKX. Đẩy giá demo qua chốt lời và nhịp đối soát kế tiếp (khoảng 60s) ghi lối thoát. **Chạy hai lần: một dòng sổ, không phải hai.**
- [ ] **Lối thoát trên một vị thế đang nắm** - có vị thế mở và không lối thoát nào đang treo, `/trade exit <mã> sl <giá>` đặt một chân OCO ở OKX và biên nhận nêu khối lượng được phủ.
- [ ] **Dời một lối thoát** - chạy lại với một `sl` khác: OKX báo cùng algo order id với trigger mới, không phải một algo order thứ hai. Đường này được dựng từ danh sách tham số OKX công bố, nên hãy kiểm ở đây trước khi tin nó.
- [ ] **Một lần chỉnh bị từ chối giữ lối thoát cũ** - gửi một `sl` mà sàn bác (trên giá cuối): lần chỉnh hỏng và lối thoát gốc vẫn sống ở OKX.
- [ ] **Từ chối do dạng chân** - có một lối thoát chỉ cắt lỗ đang treo, `/trade exit <mã> tp <giá> sl <giá>` từ chối và nêu lệnh hủy, để nguyên cắt lỗ.
- [ ] **Co lại sau một lệnh bán tay** - `/record sell` một phần vị thế, rồi `/trade exit`: cỡ lối thoát đang treo giảm xuống bằng cái cuốn sổ giờ đang nắm.
- [ ] **Phủ một phần** - `/trade exit <mã> qty <một nửa> sl <giá>`: biên nhận nêu phần để lại chưa được bảo vệ, và `/trade` trần liệt kê vị thế đó dưới *Nothing is guarding these*.
- [ ] **Phủ quá cỡ** - một `qty` lớn hơn vị thế bị từ chối, không đặt gì.
- [ ] **Xác nhận trần** - có đúng một lệnh đang dàn dựng, `/trade confirm` đặt nó. Dàn dựng cái thứ hai và nó từ chối kèm cả hai token thay vì chọn.
- [ ] **Trạng thái** - `/trade` trần liệt kê cái đã dàn dựng, đang treo, chưa được bảo vệ và cái cuốn sổ đang thiếu, và vẫn trả lời khi sàn không với tới được.
- [ ] **Đối soát chốt một lần khớp đã khôi phục** - ép một ý định chưa đối soát, ghi lần khớp bằng `/record sync okx`, rồi `/trade reconcile`: nó báo dòng đã được chốt hộ bạn và các trần được nhả mà không cần gõ token.
- [ ] **Sync nêu tên cái bị bỏ** - có một lần khớp mà cuốn sổ không nhận được, `/record sync okx` nêu tên ký hiệu và lý do thay vì in một con số đếm.
- [ ] **Lối thoát đảo ngược** - `sl` trên `tp` bị từ chối, không đặt algo order nào.
- [ ] **Cỡ đã trừ phí** - một lệnh mua mà phí bị trừ bằng BTC đặt một lối thoát cỡ theo khối lượng đã ghi, không bao giờ hơn số dư OKX hiện.
- [ ] **Phí ước tính** - phí ước tính trên lời nhắc lệch không quá một phần tư so với cái biên nhận tính. Lệch hơn thì biên nhận nói vậy, và bậc phí của sàn trong `fees` là thứ phải sửa.
- [ ] **Định tuyến** - có một sàn phục vụ thị trường thì không cần đối số sàn. Đăng ký sàn thứ hai và một `/trade spot BTC buy` trần bị từ chối, nêu tên cả hai.
- [ ] **Không tự hủy** - xóa dòng vào lệnh: nhịp kế tiếp cảnh báo về độ lệch và OCO vẫn sống.
- [ ] **Một kế hoạch không phải bảo vệ** - có cắt lỗ của một đề xuất trên một khoản nắm và không lối thoát nào treo, `/portfolio` đọc `... from its stop · no stop order placed`. Đặt một cái bằng `/trade exit` và dòng bổ nghĩa biến mất.
- [ ] **Một nhịp chập chờn không chôn một lối thoát** - một not-found mà sàn trả lời lại ở nhịp sau thì khởi động lại cửa sổ chứ không tính vào nó. Chỉ năm phút not-found liền mạch mới đánh dấu dòng đã mất.
- [ ] **Từ chối khi không giám sát** - dưới `--mode bypass`, một lệnh bị từ chối cho tới khi đặt `[trading.orders] allow_unattended`.
- [ ] **Không có nút ghi nhớ** - lời nhắc `order_place` chỉ đưa từ chối và cho phép một lần.
- [ ] **Chữ ký Binance** - với `simulated = true` và khóa demo, `/trade spot binance:BTC buy 0.001 sl 100000` tới được một lời nhắc. Lỗi xác thực ở đây là do khóa, không phải do mã.
- [ ] **Đồng hồ Binance** - đặt đồng hồ máy nhanh 2 s: `/trade` từ chối kèm thông báo đồng hồ trước khi gửi gì.
- [ ] **Biên nhận Binance** - lần khớp hiện giá bình quân, phí bằng BTC và giờ khớp theo đồng hồ của Binance.
- [ ] **Bụi Binance** - thử bán dưới 5 USDT giá trị: bị từ chối vì dưới mức tối thiểu trước khi gửi gì.
- [ ] **Lối thoát Binance** - `/trade exit binance:BTC tp <p> sl <p>` treo một OCO. Chạy lại thì từ chối và nêu `/trade cancel`. `/trade cancel binance:BTC` gỡ cả hai chân. Một `/trade exit` mới đặt lại được.
- [ ] **Lối thoát Binance nổ** - treo một lối thoát có chốt lời nằm ngay trên giá cuối. Khi nó kích hoạt, nhịp đối soát kế tiếp (khoảng 60s) ghi lệnh bán. **Một dòng sổ, không phải hai.**
- [ ] **Sync Binance** - `/record sync binance` ghi các lần khớp demo và kết thúc bằng dòng nói nó kiểm từng coin, ở cả hai ngôn ngữ.
- [ ] **Kiểm toán khóa** - `openalpha doctor venues --online` trên một khóa thật cảnh báo khi Withdrawals đang bật hoặc chưa ghim IP.
- [ ] **Dừng** - `/trade halt`, rồi xác nhận một lệnh mua đã dàn dựng: bị từ chối. Một lệnh bán vẫn đặt được. Khởi động lại dịch vụ nền và `/trade` vẫn cho thấy việc mua đang tắt.

Hai trong số này thăm dò các mã lỗi lấy từ một client bên thứ ba chứ không phải tài liệu tham chiếu của chính OKX: các mã cuộc đua hủy ở **Treo và hủy**, và mã not-found ở **Không tự hủy**, nơi một lần tra cứu bị đọc nhầm là "đã mất" sẽ đóng một lối thoát vẫn đang sống. Cả hai đều hỏng ồn ào, nên một phỏng đoán sai hiện ra như một lỗi, không bao giờ như một cuốn sổ sai.

### 10. Tắt việc mua

`/trade halt` dừng mọi lệnh mua mới cho tới `/trade resume`.

- **Bị chặn:** `/trade spot ... buy`, một `/trade confirm` của lệnh mua đã dàn dựng trước lúc dừng, và một lệnh mua qua `order_place`. Lần xác nhận bị từ chối trước khi gọi bất kỳ sàn nào, nên một token tạo ra một phút trước lúc dừng không lọt được.
- **Vẫn chạy:** lệnh bán, `/trade exit`, `/trade cancel` và `/trade reconcile`. Việc dừng sinh ra để ngừng thêm rủi ro, và mỗi thứ này gỡ bớt nó.
- **Không bao giờ bị chạm:** một lối thoát đang treo. Việc dừng không hủy gì và không bao giờ gọi cancel-all của sàn, nên mọi cắt lỗ vẫn đứng nguyên.
- **Bền vững:** công tắc được lưu trong cơ sở dữ liệu, nên nó sống sót qua một lần khởi động lại và một lần export/reset DB.

Chốt chặn thủ công nằm ngay ở sàn. Trên Binance, tắt **Enable Spot & Margin Trading** trên khóa ở API Management. Trên OKX, gỡ quyền Trade của khóa. Việc đó dừng cả lệnh bán, đúng là lý do việc dừng trong `/trade` không làm vậy.

Bên trong: [dev/giao-dich.md](dev/giao-dich.md).
