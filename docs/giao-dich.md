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

**Mã thị trường** và **nhóm danh mục** là hai tên gọi, và hiện nay trùng nhau: nhóm danh mục của mỗi thị trường chính là mã của nó. Các lệnh nhận mã thị trường.

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

Một số nguồn có công bố dữ liệu trong phiên. Giá lấy từ những nguồn này mang theo **đỉnh, đáy và khối lượng cộng dồn** của phiên bên cạnh mức giá, kèm thời điểm cửa sổ đó mở. Chỉ nhìn một mức giá thì không biết nó đang ở đỉnh hay ở đáy, mà có ba chỗ cần biết điều đó:

- lượt quét cảnh báo so ngưỡng với các mức cực trị, chứ không so với bản in cuối;
- `/price` báo biên độ ngày bên cạnh con số;
- phép kiểm kế-hoạch-đang-đứng hỏi xem các mức giá của một đề xuất đã lưu còn trả nổi rủi ro của chính nó hay không.

Số đọc đã chốt không có biên độ, nguồn không có dữ liệu trong phiên cũng vậy. Không chỗ nào tự đoán biên độ từ một giá đóng duy nhất.

Các dòng tiêu đề crypto được so với giá đóng đã chốt trong chuỗi ngày của chính chúng. Giá đóng đó in ngay bên cạnh dòng. Chúng không được so với một cửa sổ 24 giờ trôi mà bạn không thấy ở đâu trên màn hình.

Các bảng tổng hợp cạnh những dòng đó lấy từ bảng vốn hóa thị trường, và mọi nguồn đều công bố bảng này theo cửa sổ 24 giờ trôi. Nên danh sách mã biến động mạnh và bảng xếp hạng giá trị giao dịch đặt tiêu đề theo cửa sổ đó chứ không theo phiên. Tỷ phần taker mua là ngoại lệ: nó thuộc về một phiên đã chốt, và nêu tên phiên đó.

Dòng quy mô thị trường cũng đếm số mã thanh khoản tăng và giảm trong cùng ngày trôi đó. Với một thị trường không có phiên, đây là số đo độ rộng duy nhất có được. Nhờ vậy bản tin sáng lúc 07:00 ở Việt Nam cho bạn thấy giờ châu Á có làm cả bảng giá dịch chuyển không, chứ không chỉ hai mã dẫn đầu.

Giả sử một mã bạn đang nắm hoặc đang theo dõi từng giao dịch cao hơn giá đóng đã chốt ít nhất 2%, rồi quay về bằng hoặc thấp hơn mức đó. Dòng của nó được gắn tiêu đề *mở lên rồi trả lại hết*. Phần còn lại của dòng giữ nguyên.

#### Nhịp thị trường đọc trực tiếp, mười hai mã một lượt

`/watchlist` và mục `cross-asset-pulse` của bản tin đọc giá trực tiếp theo cùng một cách: tối đa **mười hai** mã, tải **bốn mã một lượt**.

- `/watchlist` báo giá các mã bạn theo dõi.
- Mục pulse thêm mọi mã bạn đang nắm, mã trùng chỉ tính một lần.

Giới hạn này để giữ chi phí và thời gian chờ ở mức thấp, không phải một bảng xếp hạng. Danh sách dài hơn sẽ bị cắt và báo rõ bằng `market-data.universe-truncated`, nên bạn biết vì sao thiếu một mã.

Mỗi dòng hỏi một giá trực tiếp. Thị trường đang ngoài phiên trả lời bằng giá đóng đã lưu, nên cùng một yêu cầu cho kết quả đúng cả lúc 10 giờ sáng lẫn nửa đêm.

Nếu giá của một mã không được hỗ trợ, không lấy được, hoặc không phải một con số hợp lệ, bạn nhận một lưu ý nêu tên mã đó, không bao giờ là một dòng bằng 0. Một mức giá bịa trên dòng nhịp thị trường trông y hệt giá thật.

#### Một màn hình sàng lọc được xếp hạng trên bằng chứng đã chốt

Một bảng lấy lúc 11 giờ sáng hiển thị giá trực tiếp, nhưng được xếp hạng trên dữ liệu tới giá đóng hôm qua. Bạn sẽ thấy hai ngày:

- ngày của bảng là ngày theo lịch thị trường vào lúc chạy;
- ngày "bằng chứng tới" là ngày đã chốt cuối cùng mà việc xếp hạng thật sự dùng, vì cây nến hôm nay chưa xong nên bị bỏ ra.

Thị trường không bao giờ đóng cửa (crypto, theo lịch UTC) đặt ngày cho bảng theo ngày UTC chứ không theo ngày địa phương của bạn, và ngày đã chốt luôn là hôm qua theo UTC. Ví dụ, một lần sàng lọc lúc 09:44 UTC ngày 2026-09-09 (16:44 ICT) ghi `asOf 2026-09-09`, với bằng chứng tới `2026-09-08`. Từ 00:00 tới 06:59 ICT, ngày địa phương của bạn đã đi trước ngày UTC một ngày.

Kết quả mang `market-data.evidence-settled-only`. Nghĩa là lịch sử giá chạy tới giá đóng đã chốt cuối cùng, còn các số đọc mà thị trường công bố liên tục là số hiện hành. Nó không nêu tên phiên: bảng đã tự nêu phiên của mình, nhắc lại sẽ thành hai cái ngày trên một tin.

Sao không xếp hạng trên phiên hôm nay đang dở? Vì các mã sẽ nhảy lên xuống suốt buổi sáng theo khối lượng còn chưa về hết.

#### Một phiên chốt khi bảng giá của nó chốt, không phải khi chuông reo

Một bảng ngừng giao dịch ở giờ đóng, rồi vài phút sau mới công bố kết quả khớp lệnh đóng cửa. Giữa hai thời điểm đó, nguồn trả về một phiên trông như đã xong nhưng thiếu lần khớp cuối. Khi đo trên HOSE, 18 trong 25 mã sôi động nhất mang giá đóng sai, và tổng giá trị giao dịch của cả thị trường bị thiếu 10%.

Vì vậy một ngày chỉ được coi là đã chốt sau khi qua giờ đóng **cộng độ trễ khớp lệnh**. Trước lúc đó không lưu gì cho ngày ấy, và bộ lập lịch cũng tính giờ từ đúng thời điểm này. Một quy tắc duy nhất quyết định cả việc lưu gì lẫn việc hiển thị gì.

**Giờ đóng đã khai.** Bảng có phiên khớp lệnh đóng cửa thì có giờ đóng thật. HOSE chốt giá đóng cửa lúc 14:45, và độ trễ sau đó phủ cửa sổ thỏa thuận và PLO 14:45-15:00 cộng thời gian nguồn công bố.

Bảng giá của tiệm vàng thì không chốt gì: giá cứ được sửa cho tới khi ngừng. Nên giờ đóng của nó là một **ước lượng** về lúc các lần sửa kết thúc. Với `gold-vn` đó là 17:30, vì đo được SJC vẫn còn sửa giá lúc 17:15. Nếu phép đo cho thấy ước lượng sai thì ước lượng được dời; giá đóng đã chốt của sàn thì không.

**Mức chênh vàng trong nước** là lý do mọi thị trường dùng chung quy tắc này. Mức chênh so bảng giá đứng yên của tiệm vàng với vàng thế giới, vốn vẫn đang chạy. Một điểm lấy giữa giờ đóng của quầy và giờ chốt cho ra mức chênh khác với điểm lấy sau đó, và chuỗi giữ điểm nào đến trước.

Một ngày đã có sẵn thì được báo là hiện hành, không phải đã cập nhật; muốn tính lại thì dùng `force`. Không có quy tắc này, mức chênh đã lưu sẽ kẹt ở số đọc đầu tiên trong ngày, trong khi mọi màn hình lại tính ra một mức mới hơn.

Phiên chạy trực tiếp chỉ ghi phiên đã chốt. Sau đó một lượt bù lấp các ngày còn thiếu trong cửa sổ phân vị bằng các bảng giá vàng có ghi ngày. Mỗi ngày được định giá so với giá đóng thế giới và tỷ giá mới nhất còn nằm trong độ trễ cho phép.

- Ngày mà giá đóng thế giới hay tỷ giá không bao giờ về thì được báo là thiếu, không bị lặng lẽ bỏ qua.
- Ngày mà tiệm không công bố gì thì không tính là thiếu. Ngày đó không bao giờ về, và đếm nó sẽ khiến lượt nào cũng trông như thiếu.
- Tiệm ngừng công bố hẳn thì bị chính ngưỡng độ phủ của phân vị phát hiện.

**Dấu refresh đã lưu.** Mỗi lần refresh được đóng dấu bằng ngày nó phủ, và phiên chạy sau dùng lại dấu đó thay vì tải lại. Thử hình dung một phiên chạy rơi đúng vào khoảng chờ chốt: nó sẽ đóng dấu một ngày còn đang hình thành, rồi mọi phiên chạy sau coi dấu đó là hiện hành.

Lỗi này không tự hết. Loại dữ liệu đó sẽ kẹt ở bảng giá chưa xong cho tới khi cửa sổ refresh trôi qua, mà qua một ngày thứ Sáu là ba ngày. Nên một dấu chỉ được coi là hiện hành nếu ngày đó đã chốt vào lúc phiên chạy ghi dấu. Tuổi của dấu chỉ xét sau đó.

**Giá trực tiếp.** Một thị trường bỏ giá trực tiếp của nó trong hai trường hợp: phiên của giá đó không mới hơn giá đóng đã chốt, hoặc giá đó cũ hơn mức mà một lần khớp đóng cửa hay một bảng giá im ắng có thể giải thích. **Thị trường** quyết định việc này, không phải nguồn, giống cách `gold-vn` vốn đã kiểm tuổi bảng giá. Cách đánh giá một số đọc nằm ở [Nguồn dữ liệu](nguon-du-lieu.md).

Quy tắc này bắt được ba lỗi, cả ba đều tới với dáng vẻ hoàn toàn bình thường:

- Sàn tạm dừng một cặp thì cứ trả về giao dịch cuối cùng mãi mãi. Mức giá dựng trên đó sẽ đặt lệnh vào cho một thị trường đã ngừng giao dịch.
- Sau khi phiên chốt, mọi yêu cầu tiếp theo đều nhận lại giá đóng mà nguồn đang giữ. Màn hình sẽ in nó như thể đó là giá thị trường đang khớp ngay lúc này. Trên HOSE, việc này đúng với mọi yêu cầu từ 15:15 tới lần mở cửa kế tiếp, khoảng ba phần tư ngày.
- Một nguồn ngừng cập nhật vẫn cứ trả về cây nến từ vài giờ trước nhưng mang ngày hôm nay. `/price`, `/overview` và `/market` có thể mỗi nơi in một cây nến chỉ số cũ khác nhau, cả ba đều báo tăng trong một ngày mà chỉ số thực ra giảm.

Trong cả ba trường hợp, bạn nhận giá đóng đã chốt thay vào, với ngày chính xác. Giá trực tiếp chỉ được giữ làm phương án cuối, cho mã mà dữ liệu đã lưu hoàn toàn không định giá được. Cuốn sổ được định giá trên bất cứ mức giá nào lấy được, chỉ có dấu độ tươi là được phép thiếu. Crypto và cổ phiếu VN làm theo cách này, nên một thị trường đã đóng cửa vẫn in ra giá chứ không từ chối.

Nếu giá bị từ chối trong lúc bảng đang mở, bạn sẽ được báo. Thị trường đóng cửa thì không cần giải thích. Nhưng một mã chưa khớp lệnh nào trong khi bảng đang giao dịch là một mã bị tạm dừng, và đó là việc bạn có thể xử lý. Nó mang `market-data.quote-not-live` kèm tên mã.

#### Khâu sàng lọc đánh dấu một mã bị loại, và không bao giờ ẩn nó

Một mã bạn đã loại vẫn được xếp hạng và vẫn in ra, kèm `nằm trong danh sách loại trừ của bạn` ngay trên dòng của nó. Ẩn nó đi sẽ lặng lẽ thu hẹp bảng mà bạn không hay. Việc chặn thật diễn ra ở chỗ khác: ở giai đoạn `profile-exclusion` trong quy trình đề xuất và ở danh sách ứng viên khi tái cân bằng.

Hồ sơ của bạn không làm thay đổi chính cái bảng. Tập mã, thứ hạng, điểm số và các yếu tố giống hệt nhau với mọi hồ sơ, nên bảng không mang dấu hồ sơ nào. Đặt một tiêu đề chính sách ở đó sẽ khiến người đọc tưởng có một bộ lọc chưa hề chạy.

Nếu không đọc được hồ sơ, bảng bỏ các dấu nhưng giữ đủ mọi dòng, và báo rõ bằng `profile.exclusions-unavailable`. Nhờ vậy bạn phân biệt được "ở đây không có gì bị loại" với "không kiểm được".

#### Unavailable là một câu trả lời

Mọi lần hỏi một nguồn đều trả về một trong hai thứ:

- dữ liệu, kèm nguồn gốc và các lưu ý; hoặc
- *unavailable* (không có), kèm lý do (`unconfigured`, `unsupported`, `stale` hay `failed`), các nguồn đã thử và các lưu ý.

Không chỗ nào bịa ra con số để lấp chỗ trống, và không gì hỏng chỉ vì một nguồn miễn phí không có dữ liệu cho một mã.

Độ tươi (`live` hoặc `cached`) được ghi trên **từng** dòng nguồn, không bao giờ gộp thành một nhãn chung. Một kết quả ghép từ bốn nguồn thì không có câu trả lời duy nhất cho câu hỏi "cái này có mới không?".

Một khối mang ngày của một phiên thì đọc **mọi** con số trong nó ở phiên đó, hoặc bỏ những con số không đọc được. Lấy ví dụ độ rộng thị trường VN:

- nó đếm từng mã ở phiên đã chốt;
- nguồn chỉ số công bố cây nến đã chốt muộn hơn các mã cổ phiếu vài giờ, nên khi chuỗi chỉ số chưa tới phiên đó thì các con số xu hướng chỉ số bị giữ lại, và khối nêu tên phiên mà chuỗi đó thật sự đã tới;
- một tiêu đề thiếu cửa sổ dữ liệu thì chỉ in riêng tiêu đề.

Khối lấy ngày theo phiên đó, không bao giờ theo ngày mới nhất mà một con số nào đó trong khối báo. Hai ngày này lệch nhau mỗi sáng cho tới khi lượt refresh xong: nguồn chỉ số đã báo hôm nay, còn lịch sử giá đã lưu vẫn dừng ở hôm qua. Lấy ngày muộn hơn sẽ ghi độ rộng, giá trị giao dịch, dòng tiền, mã dẫn đầu, mã biến động mạnh và các bảng của một phiên dưới ngày của phiên sau. Nó còn làm mất ghi chú nhắc rằng giá trị giao dịch và dòng tiền khối ngoại hôm nay chưa đo xong.

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

Con số nào còn lại được báo bằng `suggestion.figure-unmatched`, một lưu ý thông tin. Nó không bao giờ làm đổi kết luận. Một tổng hay một khoảng cách do nhà phân tích tự tính không khớp với số nào, và một khẳng định văn bản tự do không nêu chỉ số hay kỳ nào để đối chiếu, nên con số nào thuộc dòng nào vẫn do bên kiểm chứng quyết định.

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
- `ceiling-close` - một cổ phiếu VN bạn nắm vừa đóng cửa ở giá trần hoặc sát trần. Phiên sau thường mở cửa cao hơn, nhưng các tuần tiếp theo hay kém thị trường. Vì vậy phần chốt lời đầu quen thuộc của bạn được giảm bớt ngay lúc mở cửa đó. Qua phiên mở cửa ấy thì phần giá nhảy đã trả xong, và không còn đề xuất gì.

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

#### Tín hiệu đã chốt; giá là trực tiếp

Các yếu tố chỉ được tính trên nến đã chốt, vì trên nến chưa xong thì yếu tố sẽ cứ thay đổi. Còn giai đoạn mức giá và phép kiểm kế hoạch đang đứng thì hỏi giá trực tiếp. Nên giá vào, cắt lỗ và mục tiêu được dựng trên đúng mức giá bạn đang nhìn.

Mỗi thị trường tự quyết khi nào đưa được giá trực tiếp, còn không thì dùng giá đóng gần nhất, nên trước giờ mở cửa và sau giờ đóng cửa không có gì thay đổi. Một số đọc có tính là trực tiếp hay không là do phiên của nó, không do dấu thời gian. Phiên khớp lệnh đóng cửa ra kết quả sau chuông, nên khi phiên đã chốt, giá đóng cửa của chính thị trường thành giá đóng của phiên và dòng trực tiếp bị bỏ.

Bằng chứng và giá có thể dừng ở hai phiên khác nhau. Nên mọi dòng đã lưu mang một ngày **bằng chứng tới**: phiên đã chốt mới nhất mà các yếu tố và mức giá của nó được đọc từ đó.

- Phần cuối báo cáo in ngày này mỗi khi nó khác ngày chạy.
- Với thị trường không bao giờ đóng cửa thì phiên chạy nào cũng vậy, vì nến của một ngày lịch đóng vào nửa đêm UTC kế tiếp.
- Ngày của đề xuất vẫn là ngày nó được định giá. Việc dùng lại và cửa sổ kết quả đều dựa vào ngày này.

#### Riêng cổ phiếu VN

**Giá VN ra ngoài biên độ của chính phiên nghĩa là lịch sử đã cũ, không phải mã bị tạm dừng.** Không giao dịch nào khớp được ngoài biên độ ngày. Nên nếu giá trực tiếp rơi ra ngoài biên độ tính từ giá đóng đã lưu, thì giá đóng đó đang theo cơ sở cũ. Thường đó là ngày giao dịch không hưởng quyền mà nguồn chưa điều chỉnh.

Khi đó phiên chạy giữ nguyên với `history-not-adjusted`, thay vì định giá trên lịch sử sai. Phép kiểm này chạy trước khối chạm biên, khối mà nếu không sẽ hiểu cú rơi đó là mã đang kẹt sàn. Lần refresh sau thấy giá đóng đã điều chỉnh sẽ dựng lại mã.

**Các yếu tố của một cổ phiếu VN in thành danh sách "nhìn nhanh"**, chia theo phía: điểm cộng, điểm trừ, rồi thông tin thêm. Trong mỗi nhóm, yếu tố mạnh nhất đứng đầu. Mỗi dòng có thang điểm riêng của yếu tố và các số đọc chính, không bao giờ là một ngưỡng đạt/không đạt cố định. Dòng khối ngoại ghi số mua ròng của khối ngoại cộng dồn qua đúng các phiên mà điểm của nó đã tính.

- Tăng trưởng không có yếu tố riêng, nên chỉ in số, trong nhóm thông tin thêm. Yếu tố có điểm gần 0 cũng nằm ở đó.
- Khả năng sinh lời và sức khỏe tài chính dùng chung điểm chất lượng, nên dòng thứ hai để trống vạch thay vì đếm hai lần.
- Yếu tố không có số đọc in `—`.
- REPL in dạng lưới; chat in mỗi dòng một hàng.

Các số đọc mà dòng không hiện vẫn nằm trong phép tính. Thị trường nào có yếu tố mà danh sách chưa có dòng thì giữ bảng yếu tố.

**Trạng thái thị trường VN giữ nguyên cho tới khi điểm rời hẳn nó.** Một trạng thái bắt đầu ở +-0,25 và chỉ kết thúc khi điểm quay lại trong khoảng +-0,15. Nhờ vậy một điểm số lởn vởn quanh ngưỡng không làm thay đổi mức giải ngân mỗi ngày.

- `macro.regime-held` báo cho bạn khi dải này giữ lại một trạng thái mà riêng điểm số lẽ ra đã lật.
- Trạng thái được nhớ từ lần đọc đã xếp hạng gần nhất đã lưu, trong vòng năm phiên. Cũ hơn nghĩa là dịch vụ nền (daemon) đã tắt, không phải thị trường yên ắng.
- Quy tắc này chỉ áp cho VN, thị trường duy nhất lưu các số đọc của mình.

**Quỹ ETF VN được đọc qua chỉ số mà nó mô phỏng.** Hai yếu tố của quỹ đọc chính chỉ số đó. Khi cây nến mới nhất của chỉ số cũ hơn của quỹ, cả hai mang `factor.input-stale`. Những điểm khác so với cổ phiếu:

- Cuộc tranh luận dùng khung phân tích vĩ mô và thanh khoản, thay cho định giá và chất lượng doanh nghiệp.
- Không có cảnh báo hạn nộp báo cáo, vì quỹ không nộp báo cáo tài chính như doanh nghiệp.
- Mức dưới giá vào là mốc xem lại, cách ba lần ATR với kỳ hạn dài. Không có gì kéo nó lên theo giá, nên nó không bao giờ nằm sát dưới giá đóng cửa một ATR như cắt lỗ đã kéo theo của cổ phiếu.

#### Một mã đang nắm được lập kế hoạch mà không cần ai hỏi

Khi bạn ghi một lệnh mua mà chưa có kế hoạch nào cho nó, bạn nhận một dòng giữ nguyên chỉ có mức giá (`recorded-entry`) ở giá khớp. Dòng này do đường ghi duy nhất của sổ lệnh tạo ra, nên cách ghi nào cũng có: lệnh gạch chéo, công cụ ghi sổ của agent, một lần đồng bộ với sàn, và một lần khớp được sao lại. Dòng xác nhận ghi của bạn in nó ra; biên nhận của agent thì không.

Nhịp cảnh báo cũng ghi đúng dòng đó, từ giá đóng đã chốt, cho mã đang nắm nào chưa có gì theo dõi, rồi gửi một thông báo.

Cắt lỗ, mục tiêu và mức cắt lỗ kéo theo giá của mã đều đi theo kế hoạch này, cho tới khi `/suggest` thay nó. Kế hoạch đã ghi không bao giờ được tính cho cổng dùng lại và không bao giờ bắt đầu thời gian chờ.

Một phiên chạy mà phần tranh luận không trả lời được (chưa có khóa mô hình, một vai bị lỗi, hết ngân sách) thì chưa quyết định gì. Bạn vẫn thấy kết quả kèm lý do, nhưng nó không được lưu, nên không bao giờ thay kế hoạch đang có.

- Kế hoạch của một đề xuất hết hiệu lực khi nhịp kết cục chốt nó; kế hoạch đã ghi hết hiệu lực khi giá đóng đã chốt vượt qua một trong hai mức.
- Dù cách nào, nhịp kế tiếp lập kế hoạch mới từ mức mã đang giao dịch, với sàn là mức cắt lỗ cũ chừng nào mức đó còn dưới giá.
- Kế hoạch do phiên bản chiến lược cũ định giá cũng được thay theo cách đó, tối đa một lần mỗi phiên, để chính sách mức giá mới áp tới các mã đang nắm. Thông báo chỉ gửi khi cắt lỗ hoặc chốt lời đã dịch.

#### Một đề xuất đã lưu mà giá đã rời khỏi các mức của nó thì trả về với dấu vô hiệu

Mỗi thị trường khai mức rủi ro-lợi nhuận mà các mức giá vẫn phải đạt ở giá hiện tại. `equity-vn` và `crypto` đều là 1:1.

Trần đuổi giá trong kế hoạch (mức giá cao nhất còn đáng mua) chính là ngưỡng đó quy ra giá: (mục tiêu + R x cắt lỗ) / (1 + R). Kế hoạch và phép kiểm dùng lại đọc cùng một giá trị. Nên khi một thị trường chỉnh mức sàn, giá kế hoạch in ra và giá phép kiểm áp dụng thay đổi cùng lúc.

- Trên trần: câu trả lời hôm nay giữ nguyên.
- Dưới trần, hoặc giá vượt cắt lỗ hay mục tiêu: dòng được phục vụ kèm `suggestion.levels-void`. `/suggest <mã> force` chạy một đề xuất mới.
- Cắt lỗ suy từ ATR, nên quy tắc co giãn theo độ biến động của từng thị trường chứ không theo một phần trăm phẳng.
- Thị trường không khai mức sàn thì không đọc giá trực tiếp và giữ câu trả lời suốt thời gian chờ. Thị trường không đọc được giá thì nói rõ bằng `suggestion.standing-unverified`.

#### Đặt cắt lỗ và mục tiêu theo từng thị trường

`[trading.markets.<id>]` nhận:

- `stop_loss_atr` - khoảng cắt lỗ tính bằng số lần ATR;
- `reward_risk` - mục tiêu bằng bao nhiêu lần khoảng rủi ro;
- `maximum_stop_loss` - trần cứng, tính bằng phần của giá vào.

`stop_loss_atr` và `reward_risk` thay giá trị riêng của thị trường cho cả hai tầm nhìn.

Khi cắt lỗ theo ATR nằm xa hơn trần, cắt lỗ được kéo vào sát ngay trong trần, không bao giờ vượt một tick. Mục tiêu và chốt lời đầu tiên sau đó được đặt theo khoảng rủi ro nhỏ hơn này. Tỷ lệ lợi/rủi ro giữ nguyên, còn cỡ lệnh lớn lên cho vừa khoảng ngắn hơn. Kế hoạch mang `market.stop-capped`. Với `gold-vn`, trần tính xuống từ giá tiệm mua lại, nên chênh lệch mua/bán cộng thêm ở trên.

Đặt bất kỳ khóa nào trong ba khóa này sẽ thêm hậu tố vào phiên bản chiến lược của thị trường đó (`1.0.0+3f9a1c0b`). Với bạn, điều đó có nghĩa:

- kế hoạch định giá theo khóa của bạn có bảng thành tích riêng;
- chúng không bao giờ được trả lại khi khóa đã đổi;
- mã đang nắm được lập kế hoạch lại một lần;
- cắt lỗ chỉ đi lên, nên nới khóa không bao giờ hạ một mức cắt lỗ bạn đang giữ.

Các khóa và khoảng giá trị: [Cấu hình](cau-hinh.md).

#### Lệnh mua crypto sau một đợt tăng nóng nằm dưới giá

Khi một mã đã tăng 25% trở lên qua bảy phiên đã chốt gần nhất, kế hoạch không đuổi theo nó. Giá vào thành một lệnh limit mua thấp hơn giá trực tiếp nửa ATR, để chờ trong năm phiên. Cắt lỗ, chốt lời, mục tiêu và giá vô hiệu đều được định giá từ mức limit đó.

Quy tắc này được đo ngày 2026-10-15 trên nến theo giờ của 81 mã, chỉ tính lệnh limit là khớp khi có giao dịch đi qua nó sau lúc đặt. Theo các mức thoát của chính kế hoạch, nó hơn mua ở giá hiện tại 2,4% mỗi lệnh (t 3,2; 85% khớp).

Kế hoạch dặn bạn đặt lệnh chờ trên sàn dạng good-til-cancelled (giữ tới khi hủy), vì `/trade` chỉ đặt lệnh khớp ngay. Quy tắc này thuộc chính sách mức giá của thị trường, không phải một cài đặt.

#### Cỡ lệnh

Cỡ lệnh được tính ngân sách theo cắt lỗ lúc vào, và trạng thái thị trường (regime) co cả lệnh. Trần rủi ro chia ngân sách mỗi lệnh cho khoảng ATR từ giá vào tới cắt lỗ. Nó không bao giờ dùng một mức cắt lỗ sau này đã được kéo lại gần hơn, vì lối thoát chặt hơn không làm ván cược nhỏ đi.

Hệ số trạng thái thị trường của nhóm giảm cỡ lệnh cuối cùng, cùng với mức tin cậy và ý định của vai trader. Vì vậy thị trường phòng thủ sẽ thu nhỏ lệnh mua kể cả khi tiền mặt không phải thứ giới hạn nó. `suggestion.size-scaled-by-regime` báo cho bạn khi trạng thái thị trường là giới hạn chặt nhất trong ba.

Trần tiền mặt chừa chỗ cho chi phí của lệnh: phí mua và mức trượt giá `maximum_price_drift` mà trần tiền mặt của lệnh thị trường cho phép khi khớp. Phần chừa phí áp cho mọi lệnh mua, còn phần chừa trượt giá áp cho thị trường mà sàn mặc định có đặt lệnh, vì lúc tính cỡ lệnh chưa biết bạn sẽ dùng loại lệnh nào. Nên một lệnh mua tính theo số tiền bạn đang có sẽ không bị `/trade` từ chối vì thiếu phần chừa đó. Thị trường bạn tự giao dịch tay, như cổ phiếu VN hay vàng VN, không bao giờ có lệnh thị trường do OpenAlpha đặt, nên chỉ chừa phần phí.

Mọi mã trong một lượt `/suggest` đều được tính cỡ trên cùng cuốn sổ như nó đứng trước lượt đó. Nên mỗi
lệnh mua tự nó vừa với tiền mặt và phần rủi ro mở còn lại.

Sau các kết luận, "Nếu bạn thực hiện mọi đề xuất ở trên" liệt kê những gì hai lệnh mua trở lên cùng
vượt:

- trần ngành hoặc nhóm;
- số tiền mặt sổ có thể chi (và, khi venue của một thị trường chạm tới ít hơn, tiền mặt của thị trường
  đó);
- phần còn lại dưới trần rủi ro mở.

Lệnh bán chưa giải phóng tiền mặt hay rủi ro mở cho tới khi nó chốt, nên chỉ lệnh mua được tính. Đây
là một ghi chú, không phải lời từ chối. Con số rủi ro mở đọc cắt lỗ đã lưu của từng lệnh mua, nên khi
một cắt lỗ đã được nâng cho khớp mức đang nắm, ghi chú nghiêng về phía không nói gì.

#### Dùng lại trên thị trường không có ranh giới phiên

"Ngày" của crypto chỉ là quy ước để vẽ biểu đồ, nên việc dùng lại tính theo tuổi chứ không theo ngày. Một phiên chạy lúc 23:00 UTC và một phiên lúc 01:00 cách nhau hai giờ, không phải hai ngày. Dòng nào chưa quá 4 giờ thì qua cổng, dù rơi vào ngày nào. Thời gian chờ vẫn đếm theo phiên.

Một lệnh mua cũng giữ hiệu lực cho tới khi không còn thực hiện được như đã viết. Giá vào của nó là giá trực tiếp, mà giá này có thể đi xa giữa hai phiên chạy: định giá lại cùng một ý tưởng crypto mỗi ngày có thể dời cắt lỗ tới 21%. Phiên chạy trả lại đúng lệnh mua đó, đánh dấu `reused`, khi tất cả điều sau đều đúng:

- đề xuất mới nhất trên mã là một lệnh mua chưa chốt, nằm trong cửa sổ kết cục của nó;
- bạn chưa giao dịch mã đó;
- giá trực tiếp nằm giữa cắt lỗ và giá vô hiệu của nó;
- không phiên đã chốt nào kể từ đó giao dịch xuyên qua cắt lỗ.

Cái gì không đọc được thì chạy mới, và `force` luôn chạy mới.

#### Một phạm vi, một đề xuất mỗi ngày

Một đề xuất được nhận diện bằng thị trường, mã, phiên bản chiến lược, **khóa phạm vi** và ngày. Đề xuất của chính bạn dùng phạm vi `default`. Một agent có `[focus]` lưu đề xuất dưới một khóa dựng từ bảng đó. Khóa đã được sắp xếp và bỏ trùng, nên đổi thứ tự một danh sách không bao giờ tách đôi hồ sơ.

Mọi thứ cần tra "đề xuất trước" đều tra theo phạm vi: các cổng thời gian chờ và dùng lại, luận điểm đang đứng mà phiên chạy mới kiểm lại, và phép hiệu chỉnh định cỡ lệnh mua. Một phạm vi chỉ đặt kỳ hạn không được trộn vào phạm vi của bạn.

- Kế hoạch thoát, kết luận mà `/rebalance` đọc và việc kéo cắt lỗ lên theo giá chỉ đọc `default`: một cuốn sổ, một kế hoạch.
- Mọi phạm vi đều được chấm điểm.
- Lịch sử giá bị viết lại sẽ vô hiệu các đề xuất đang mở của mọi phạm vi trên mã đó.

Phép hiệu chỉnh làm hạ độ tin cậy và định cỡ lệnh mua chỉ đọc những đề xuất đã hết cửa sổ theo dõi, nên các lệnh bị cắt lỗ sớm không làm bảng thành tích trông tệ hơn thực tế.

Một mã nằm ngoài phạm vi của agent đang gọi thì bị từ chối trước khi gọi mô hình, và lời từ chối nêu tên phạm vi. Bảng sàng lọc của agent được thu hẹp về các thị trường và ngành của nó trước khi xếp hạng, nên bảng và tiêu đề đếm theo ngành, không theo cả thị trường. `/suggest`, bản tin, `/suggest stops` và kế hoạch đã ghi luôn dùng phạm vi của chính bạn.

Một đề xuất theo phạm vi riêng được đọc như ý kiến thứ hai, và mở đầu bằng chính câu đó. Nó có mức giá, luận điểm, tranh luận và lưu ý. Nó không có cỡ lệnh, số đơn vị, số tiền, ghi chú lệnh hay gợi ý `/record`, và cả JSON lẫn thẻ của nó đều không cho thấy vị thế đang nắm. Làm theo nó sẽ mở một vị thế mà không kế hoạch nào theo dõi.

### Kết cục và bảng thành tích

Mỗi đề xuất sau đó được đối chiếu với các cây nến tiếp theo. Nó kết thúc là `target`, `stop` hoặc `expired`, kèm lợi suất và, nếu thị trường có chuẩn so sánh, lợi suất của chuẩn trong cùng cửa sổ.

Nếu chuẩn lấy từ bộ đệm cũ, hoặc dừng sớm hơn phiên thoát quá một phiên, thì bạn không nhận phép so sánh nào, thay vì một phép so trên quãng ngắn hơn.

**Cửa sổ.** Một đề xuất được đọc ở cuối cửa sổ nắm giữ của chính nó.

- Đề xuất nằm chờ trong lúc dịch vụ nền tắt, kể cả quá mốc nhìn lại một năm, vẫn được chấm như lẽ ra được chấm lúc đó.
- Nếu không còn nến của cửa sổ ấy, đề xuất đóng mà không có kết quả (không phải `expired` phẳng) và nằm ngoài mọi phép đếm có chấm điểm. `/reflect` đếm nó chung với các dòng đóng vì lịch sử giá bị viết lại.

Một mức giá luôn nằm trong biên độ của chính phiên nó. Nên nếu nến phiên của một đề xuất không còn bao được mức giá lúc nó được định giá, thì một đợt cổ tức hay chia tách đã điều chỉnh chuỗi từ đó. Khi đó đề xuất đóng theo cùng cách, thay vì chấm các mức giá trên một thang giá mà chuỗi không còn dùng.

**Phí.** Mọi lợi suất đã chốt là lợi suất ròng sau phí mua và bán tại sàn mặc định của thị trường (`fees` của từng sàn, qua `default_for`).

- Đề xuất VN trả phí môi giới và thuế bán.
- Đề xuất crypto trả phí taker.
- Thị trường không có sàn nào có biểu phí thì trả cố định 0,1%.

Phiên bản công thức kết quả giữ các dòng chấm có phí và không phí tách riêng.

**Khóa giá trần/sàn VN.** Khi một phiên giao dịch cả ngày ở một giá kẹt biên, một phía không có ai giao dịch. Bộ chấm điểm không ghi gì ở phía đó.

- Kẹt sàn: cắt lỗ của lệnh long được giữ tới khi bảng mở lại, rồi khớp ở giá mở cửa của phiên đó hoặc ở mức cắt lỗ, tùy cái nào thấp hơn.
- Kẹt trần: giá vào của lệnh mua dời tới giá mở cửa của phiên kế tiếp có giao dịch, và T+2 cùng phép so chuẩn đều đếm từ lần khớp đó.
- Lệnh bán chốt mục tiêu vào trần kẹt vẫn khớp, vì bên mua xếp hàng ở trần.
- Đề xuất mà trần chặn suốt cửa sổ đóng là `unfilled`: không giao dịch, không kết quả, nằm ngoài mọi phép đếm có chấm điểm.
- Mã bạn đang nắm đóng cửa ở giá trần hoặc sát trần được đề xuất giảm bớt một phần ngay phiên mở cửa kế tiếp (`ceiling-close`, trong mục Bán một mã đang nắm).

**Lệnh mua treo.** Lệnh mua treo khớp ở phiên đầu tiên giao dịch dưới limit của nó (chạm chưa phải
khớp), ở giá mở cửa phiên đó nếu phiên mở thấp hơn.

- Trong ngày của chính đề xuất, chỉ mức dịch từ giá tới giá đóng được tính, vì đáy ngày có thể in
  trước khi lệnh tồn tại.
- Ở chính phiên khớp, mục tiêu chỉ được tính khi phiên mở thấp hơn limit (khớp lúc mở cửa do giá
  nhảy). Phiên mở bằng hoặc cao hơn limit là khớp giữa chừng, và một nến ngày không nói được đỉnh có
  in trước hay không. Nên mục tiêu được đọc từ phiên kế tiếp.
- Cắt lỗ vẫn được thử ngay ở phiên khớp, như ở mọi phiên, trước mục tiêu.
- Limit chưa khớp tới ngày cuối cùng của nó đóng là `unfilled` theo cách tương tự. `/reflect` đếm các
  đề xuất này riêng khỏi những đề xuất đã diễn ra.

Biên độ được dùng là biên độ đã lưu cho phiên đặt lệnh. Nên biên độ ngày đầu rộng hơn của một mã mới niêm yết cũng áp cho các phiên sau, và một lần kẹt biên trong vài tuần đầu có thể bị bỏ sót.

**Bảng thành tích cho thấy gì.** Nó bắt đầu bằng các đề xuất làm nền cho nó:

- đã có bao nhiêu đề xuất;
- bao nhiêu đã diễn ra;
- bao nhiêu còn mở;
- bao nhiêu nằm trên thị trường không có chuỗi giá nên không bao giờ chấm được.

Rồi nó báo tỷ lệ thắng, lợi suất trung bình và trung vị, phép so với chuẩn, và **hiệu chỉnh theo dải mức tin cậy**. Một tỷ lệ không kèm mẫu số thì không nói lên gì. Và nếu các đề xuất tin cậy cao không thắng nhiều hơn đề xuất tin cậy thấp, đó chính là con số đáng đọc cạnh con số tiêu đề.

Mọi tỷ lệ chỉ đếm các đề xuất độc lập. Một đề xuất lặp lại một đề xuất còn mở, trên cùng mã và cùng chiều, thì đi theo cùng một nhịp giá, nên được gộp vào đề xuất đầu. Bản tin nhắc lại một ý tưởng đang nắm mỗi phiên, và nếu không gộp thì mỗi dòng đó sẽ bị đếm như một kết quả riêng. `/reflect` báo đã gộp bao nhiêu.

Hồ sơ theo phạm vi và theo agent bên dưới gộp cùng cách, trên các đề xuất của riêng từng phạm vi (giống `/reflect` đọc một phạm vi). Nên một phạm vi chỉ đạt mức tối thiểu để báo cáo bằng các đề xuất độc lập, và mẫu của nó khớp với điều `/reflect` báo về nó.

Khoảng nằm cạnh mỗi tỷ lệ cho biết con số đó chắc đến đâu: ít đề xuất thì khoảng rộng, và hai tỷ lệ có khoảng chồng lên nhau thì thực ra chưa khác nhau.

`/reflect` cũng cho biết bạn đã làm gì với các đề xuất đã diễn ra. Nó đọc việc này từ sổ lệnh lúc làm báo cáo và không bao giờ lưu lại. Một đề xuất được tính là đã làm theo khi có một lần khớp cùng chiều, trên cùng mã, nằm giữa phiên đặt lệnh của nó và ngày nó được chấm xong. Nó in hai con số, mỗi con chỉ khi nhóm của nó đạt mức tối thiểu để báo cáo của bảng thành tích:

- lợi suất trung bình của các đề xuất đã làm theo so với các đề xuất bạn bỏ qua;
- chênh lệch trung bình giữa mỗi lần khớp và giá vào được đề xuất (implementation shortfall; dương nghĩa là khớp tệ hơn).

Một lần khớp vàng VN được ghi theo đơn vị của tiệm, còn đề xuất của nó báo giá theo lượng. Trước khi tin dòng shortfall cho vàng, hãy đối chiếu một lệnh mua vàng đã ghi với đề xuất của nó.

#### Thành tích của chính bảng giá

Đề xuất chỉ là vài mã mỗi phiên; màn hình sàng lọc chấm cả trăm. Vì vậy mỗi phiên đã chốt, dịch vụ
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

`/reflect` in nó thành khối quy kết thứ hai. Khi lớn dần, đây sẽ là mẫu để khớp các trọng số yếu tố và dải mức tin cậy. Mỗi yếu tố được chấm theo phiên bản chiến lược, hai bản mới nhất mỗi thị trường, vì một phiên bản mới có thể đổi thứ mà yếu tố đo.

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

Đôi khi một mã ngừng giao dịch trong khi chuẩn của thị trường vẫn chạy. Khi chuẩn đã có mười phiên mà không có mã đó và đã tới cuối cửa sổ, đề xuất được chốt ở giá đóng cuối của mã, đánh dấu là đã dừng. `/reflect` báo bao nhiêu mã. Không gì được điền bằng phỏng đoán.

Nếu danh sách niêm yết của thị trường vẫn ghi mã là đang hoạt động, nó chờ ba mươi phiên thay vì mười. Danh sách đến từ nguồn khác với nến, nên một nguồn làm mất chuỗi của một mã có sáu tuần để sửa trước khi mã bị coi là dừng giao dịch. Một đợt đình chỉ mà danh sách không bao giờ báo vẫn được ghi nhận.

#### Hồ sơ theo phạm vi, và độ trùng

`/reflect` cho thấy hồ sơ của chính bạn (chỉ phạm vi `default`), rồi một khối "Theo phạm vi" khi một agent đã gọi dưới phạm vi riêng. Với mỗi phạm vi nó cho thấy:

- các đề xuất đã chốt (đề xuất độc lập, như trên) và tỷ lệ thắng;
- tần suất nó chọn cùng hành động với các phạm vi khác trên cùng mã và ngày;
- khi nó đi ngược các phạm vi khác và cả hai phía đã được chấm, ai đúng.

Hồ sơ của một agent trên mọi phạm vi nó từng dùng nằm ở `agent show`. Sửa một phạm vi không bao giờ bắt đầu một hồ sơ mới, và khóa cũ với khóa mới không bao giờ được đem so với nhau.

Quy tắc giống nhau ở mọi nơi đo:

- Đề xuất nhóm theo mã và ngày. "Các phạm vi khác" là mọi phạm vi khác trừ phạm vi của chính agent đó.
- Đa số là hành động mà hơn một nửa trong số đó chọn. Hòa hay chia ba thì không so.
- Giữ nguyên là một hành động. Một lần giữ nguyên chưa quyết (phiên chạy hỏng) và một kế hoạch đã ghi không phải một đề xuất và không bỏ phiếu.
- Một ca đối nghịch cần cả hai phía đã chấm và đa số không phải giữ nguyên, nên đa số giữ nguyên bị loại.
- Hai phạm vi bị đánh dấu là một góc nhìn khi chúng cùng đưa ra một quyết định từ 95% trở lên trên ít nhất 20 mã cả hai đều gọi, không tính mã cả hai cùng giữ. Hai agent chờ mọi thứ không bị coi là bản sao.
- Dưới 20 ca so sánh được thì chỉ in số đếm, không bao giờ in tỷ lệ.

Công cụ `suggestion_track_record` trả hồ sơ và độ trùng của phạm vi riêng agent đang hỏi. `GET /v1/suggestions?focus=` liệt kê các đề xuất của một phạm vi.

### Cảnh báo và bản tin

**Cảnh báo** là các ngưỡng giá (`above` / `below`) nổ đúng một lần và gửi tới một kênh.

**Việc gửi.** Mỗi lần nhận một lượt gửi có thời hạn 60 giây. Gửi hỏng thì được thử ba lần, chờ 30 giây rồi một phút giữa các lần. Sau đó lượt gửi bị bỏ, thay vì thử lại mãi:

- cảnh báo do hệ thống dựng bị tắt. Vì thông báo chưa hề tới bạn, nó được dựng lại sau 15 phút nếu mức đó vẫn còn được kỳ vọng. Cảnh báo mà một lượt đối soát đã tắt thì nghỉ hẳn chừng nào dòng của nó còn được giữ (`[retention] days`);
- ngày của một bản tin bị bỏ và ngày mai được lên lịch;
- cảnh báo bạn tạo bằng `/alert` không bao giờ bị tắt vì gửi hỏng. Nó là của riêng bạn và không có gì khác dựng lại nó. Nên nó cứ thử lại, mỗi lần chờ gấp đôi lần trước và tối đa một giờ, cho tới khi kênh nhận hoặc bạn chạy `/alert disable`.

Chat đã bị `pair revoke` thì khác, vì không lần thử lại nào tới được. Ngay lần gửi đầu tiên bị từ chối, cảnh báo đó tắt luôn, dù do bạn tạo hay do hệ thống dựng, và bản tin sáng cũng tắt.

Cảnh báo thoát và cảnh báo sàng lọc gửi tới chat của bản tin. Nên chừng nào chat đó còn bị thu hồi thì chúng không được dựng, kể cả khi bản tin đã tắt từ trước. Ghép nối lại chat đó, hoặc chạy `/brief enable` từ một chat khác, là chúng được dựng lại.

**Việc đánh giá** có giới hạn và dùng chung:

- Mỗi nhịp duyệt qua mọi cảnh báo đang hoạt động, nên cắt lỗ hay mục tiêu được kiểm mỗi phút dù có bao nhiêu cảnh báo.
- Mỗi **công cụ mỗi nhịp** chỉ lấy một giá, dùng chung cho mọi cảnh báo theo dõi mã đó. Vừa nhanh vừa nhẹ cho giới hạn tốc độ của nguồn. Nó chỉ sống trong một nhịp.
- Ngưỡng được so với **đỉnh và đáy của phiên**, không chỉ giá cuối, nên một mức bị chạm giữa hai lần kiểm vẫn nổ. Cảnh báo tạo sau khi phiên đã mở chỉ đọc giá cuối trong phiên đó, vì đỉnh và đáy của phiên gồm cả các biến động trước khi nó bắt đầu theo dõi.
- Cảnh báo trên thị trường đóng hẳn (cuối tuần, nghỉ trưa) bị bỏ qua để khỏi tốn giá trực tiếp. Trước giờ mở và sau giờ đóng vẫn đánh giá theo giá đóng đã chốt.
- Giá thiếu hoặc không hữu hạn thì cảnh báo vẫn hoạt động và nói rõ lý do. Một cảnh báo lặng lẽ ngừng theo dõi tệ hơn một cảnh báo nói rằng nó không nhìn được.

**Hai loại cảnh báo.** **Cảnh báo của operator** là cái bạn tạo bằng `/alert`. **Cảnh báo do hệ thống dựng** mang một danh tính cố định mà lượt dựng đối soát theo. Phát hiện cắt ngưỡng, thử lại và tắt hoạt động giống nhau ở cả hai.

| Dựng cho | Ngưỡng |
|---|---|
| Mỗi đề xuất hành động đứng sau một vị thế bạn nắm (cảnh báo thoát) | Cắt lỗ của kế hoạch như đã trail tới hôm nay, và mục tiêu của nó |
| Mọi mã trong danh sách theo dõi và đang nắm (cảnh báo sàng lọc) | Một dải mỗi bên của giá đóng đã chốt |

Thị trường nào khai một trail (cắt lỗ kéo theo giá) thì nâng cắt lỗ đã lưu sau mỗi phiên đã chốt. Mức mới được dựng thành một cảnh báo mới, và cảnh báo cũ nghỉ hẳn. Nếu lần ghi đó hỏng, nó được thử lại ở nhịp kế tiếp thay vì chờ phiên sau.

Nếu bạn chạy lại `/suggest` trong ngày và phiên chạy đó thay một lệnh mua, mức mà trail đã đạt tới vẫn được giữ khi nó nằm trên cắt lỗ của kế hoạch mới. Cắt lỗ không bao giờ đi xuống.

Mỗi nhịp cảnh báo gửi những gì đến hạn trước, rồi chạy hai lượt dựng, mỗi lượt độc lập.

- Nếu một lượt hỏng, lỗi được ghi log (`trading.alert_arming_failed`) và lượt kia vẫn chạy. Cảnh báo giá vẫn được gửi dù các lượt dựng gặp chuyện gì.
- Trong lượt thoát, nếu lập kế hoạch cho một mã bị hỏng, lỗi được ghi log kèm mã đó (`trading.exit_holding_failed`). Mã ấy giữ kế hoạch đang có, còn các mã khác vẫn được lập như thường.
- Nếu chính bước gửi bị hỏng thì vòng lặp vẫn dừng, như trước.

Cả hai lượt đều **đối soát** chứ không chỉ thêm vào: tính ra những cảnh báo nào nên có lúc này, dựng cái còn thiếu, và tắt cái không còn cần. Cảnh báo thoát đi theo cuốn sổ, nên một chỉnh sửa sổ lệnh làm đổi vị thế sẽ bật hoặc tắt cảnh báo ở nhịp kế tiếp. Một dải sàng lọc thuộc về ngày chốt của nó, nên các dải hôm qua nghỉ hẳn ở nhịp đầu tiên sau lần chốt kế tiếp.

Dải sàng lọc là `biên độ ngày trung bình x breakout_range` ở mỗi bên của giá đóng đã chốt, đo trên `breakout_sessions` phiên (cả hai ở `[trading.alerts]`). Hai cài đặt này quyết định khi nào bạn được báo, không quyết định một đề xuất nghĩa là gì. Mã nào có dưới năm phiên dùng được trong cửa sổ thì không dựng gì, vì một mức trung bình dựng trên lịch sử thiếu sẽ nổ theo nhiễu.

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

Một bản tin đọc theo thứ tự này:

1. khối **operator** mở đầu bằng cuốn sổ, để bạn thấy mình đang nắm gì trước mọi bình luận thị trường;
2. mỗi thị trường một khối **thị trường**, mang tên và glyph của chính thị trường đó, chỉ gồm các mục thị trường đó công bố;
3. khối **hành động** ở cuối.

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

Mỗi thị trường chỉ công bố các mục riêng mà nó có dữ liệu, nên thêm một thị trường là thêm một khối chứ không thêm mục mới. Crypto công bố chỉ số tổng hợp riêng nhưng không đại diện cho khu vực của mình. Nó hiện chỉ số đó trên khối `/overview` của chính nó, với cùng các dòng điểm, yếu tố dẫn dắt, phần thiếu và độ phủ, còn số đọc khu vực phía trên thuộc về thị trường đại diện khu vực.

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

**Thanh nhóm** chỉ hiện trên điện thoại, dưới dòng đầu của mỗi nhóm. Mỗi thanh có 20 ô, mỗi ô 5% NAV, nên so được các thanh giữa các dòng.

- `█` là phần bạn đang nắm (`▌` là nửa ô).
- `○` là mức duy nhất dùng để đọc dòng đó: mục tiêu trong `/rebalance`, trần trong `/portfolio`. Chú giải dưới mỗi bảng nêu tên nó. `○` để rỗng nên vẫn nhìn thấy khi nằm trong phần đã tô.

REPL giữ lưới thường, vì các con số thẳng hàng đã nói đủ. `/profile` không vẽ thanh, vì nó hiện cài đặt chứ không hiện số nắm giữ.

**Đợt cơ cấu chỉ số kế tiếp.** Bản tin nêu phiên cơ cấu FTSE GEIS hoặc VN30 kế tiếp, tính từ quy tắc rà soát chứ không từ một danh sách do ai đó cập nhật tay.

- Ngày hôm trước, mọi đề xuất VN cho một mã trong rổ chỉ số mang ngày đó như một lưu ý.
- Đến chính phiên đó, lệnh mua mới bị từ chối và các mã đang nắm hiện lưu ý thay vào.

Không có cài đặt nào cho việc này: các ngày là của sàn, không phải của bạn.

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

Vào ngày không hưởng quyền, giá mở cửa ở giá tham chiếu mà sở điều chỉnh: trừ cổ tức tiền mặt, chia đều
cho số cổ phiếu mới khi trả cổ tức bằng cổ phiếu hay thưởng cổ phiếu, hoặc pha với giá mua khi phát hành
quyền mua. Trong khi đó giá lịch sử đã lưu chỉ được điều chỉnh ở lần cập nhật dữ liệu tới. Từ sáng hôm đó,
kể cả trước giờ mở cửa, phiên chạy quy đổi giá lịch sử, giá hiện tại nếu nó vẫn là giá đóng cửa hôm trước,
và cắt lỗ, chốt lời đang đứng theo cùng tỷ lệ, làm tròn theo bước giá. Nhờ vậy khoảng hụt không bị đọc
thành một cú giảm, cắt lỗ giữ đúng khoảng cách, và cảnh báo thoát lệnh cả phiên đọc kế hoạch của bản tin
sáng theo mặt bằng giá mới. Tối hôm trước vẫn tính theo giá đóng cửa đang theo dõi. Quyền mua có giá bằng
hoặc cao hơn giá đóng cửa thì không làm đổi gì. Sự kiện mà nhà cung cấp chưa công bố đủ điều kiện thì không
quy đổi được, nên kế hoạch ngày đó được tính lại từ đầu thay vì giữ mức cũ. Cả hai trường hợp đều có ghi chú
trong kế hoạch.

Các sự kiện cùng ngày không hưởng quyền được tính bằng một công thức, đúng cách sở đặt giá tham chiếu:
trừ tiền cổ tức, rồi chia đều cho toàn bộ cổ phiếu mới, nên thứ tự nhà cung cấp liệt kê không làm đổi kết
quả. Khi có hai ngày không hưởng quyền trước lúc dữ liệu lịch sử bắt kịp, kế hoạch đã quy đổi cho ngày đầu
chỉ được quy đổi thêm cho ngày sau, không bao giờ hai lần. Kế hoạch lập từ một lệnh mua bạn ghi sau ngày
không hưởng quyền cũng được đọc theo cách đó, nên giá vào và cắt lỗ của nó đứng trên cùng một mặt bằng giá.

Lịch sự kiện của bản tin ghi điều kiện của từng sự kiện khi nhà cung cấp có công bố: số tiền cổ tức mỗi cổ
phiếu và ngày trả, tỷ lệ cổ phiếu mới, và giá mua của quyền mua. Mã đang giữ có cổ tức tiền mặt hoặc cổ tức
bằng cổ phiếu trong khoảng đó còn có thêm một dòng ở phần việc nên làm trước: tiền hoặc cổ phiếu về sau ngày
không hưởng quyền vài tuần, và chỉ khi bạn ghi dòng `dividend` hoặc `distribution` thì sổ mới có. Phần sự
kiện trên thẻ mã ghi các điều khoản đó trên một dòng: cổ tức tiền mặt mỗi cổ phiếu, số cổ phiếu mới trên mỗi 100 cổ phiếu đang giữ, giá mua và ngày trả tiền.

Bước hạ mức tin cậy khi mua thêm mà bình quân giá xuống so giá hiện tại với giá vốn đã trừ phần cổ tức tiền
mặt mà số cổ phiếu đang giữ được hưởng: mỗi lô được hưởng mọi đợt cổ tức có ngày không hưởng quyền sau ngày
mua lô đó, dù tiền đã về hay chưa. Nếu không, mỗi ngày không hưởng quyền sẽ bị đọc thành một khoản lỗ. Bước
này đọc cổ tức trong lịch sự kiện mà phiên chạy đã lấy, khoảng sáu tháng gần nhất. Lô mua từ trước khoảng
đó có thể đã được hưởng cổ tức mà lần đọc không tới, nên đề xuất nói rằng có thể một số cổ tức chưa được tính.

Cảnh báo chỉ ghi "sau cổ tức" khi thật sự có cổ tức được trừ khỏi giá vốn. Cổ tức chưa công bố số tiền thì
không được tính, lịch sự kiện không đọc được cũng vậy; khi đó cảnh báo nói có cổ tức chưa tính được, nên
mức giảm có thể trông lớn hơn thực tế.

Một mã đã được đề xuất trong ngày thì được phục vụ từ dòng của nó mà không tốn gì.

`next-actions` chạy sau cùng vì nó đọc kết quả thật của các mục khác. Nó chỉ gợi ý `/rebalance` khi có gì đó đã lệch và chỉ gợi ý `/alert` khi có cảnh báo đã nổ.

Chi phí của bản tin nằm dưới một đường kẻ ở tận cuối, vì nó thuộc về cả bản tin. Việc tách theo thị trường giúp một con số không bị báo hai lần dưới hai tiêu đề: mức chênh vàng trong nước thuộc khối của `gold-vn`, còn vị thế hợp đồng tương lai thuộc khối của `gold`.

**Thời điểm.** Giờ gửi mặc định là 08:15 theo múi giờ **của thị trường**: 08:15 ở TP.HCM, không phải 08:15 UTC và không phải giờ ở nơi bạn đang ngồi.

Bản tin chỉ được gửi trước giờ mở cửa. Thị trường giao dịch suốt ngày, hoặc ngày thị trường nghỉ, vẫn tính là trước giờ mở. Nên bản tin không bao giờ được dựng hay gửi giữa phiên hoặc sau giờ đóng. Trước khi tốn token nào, một phép kiểm nhanh xác nhận phiên trước đã tạo ra một cây nến.

Sau thời gian ngừng hoạt động, các buổi sáng đã lỡ không được phát lại.

- Một ngày đã lên lịch mà đã qua bị bỏ qua với cảnh báo `trading.brief_stale_day_skipped`, và lịch
  chuyển sang hôm nay.
- Bản tin hôm nay vẫn được gửi muộn nếu dịch vụ nền khởi động sau giờ gửi nhưng trước giờ mở.
- Nếu dịch vụ nền khởi động sau giờ mở, hoặc một lần gửi lại rơi vào sau giờ mở, bản tin hôm nay bị bỏ
  qua với cảnh báo `trading.brief_past_open_skipped`. Chat nhận một dòng báo điều này, và bản tin sáng
  hôm sau là bản kế tiếp.
- Bản tin bắt đầu dựng trước giờ mở nhưng xong sau đó vẫn được gửi, kèm dòng đầu báo giá đã chạy từ
  lúc viết.

Nếu cả ba lần gửi đều hỏng, chỉ ngày đó bị bỏ, đăng ký của bạn vẫn còn. Lịch chuyển sang ngày mai, `trading.brief_day_abandoned` được ghi log, và một thông báo cho biết bản tin hôm nay đã bị bỏ. Thông báo này được gửi theo kiểu cố gắng hết sức qua đúng kênh vừa hỏng, nên có thể không tới. Chỉ `/brief disable` mới tắt bản tin sáng.

- `/brief enable 07:30` đặt giờ riêng của bạn.
- `/brief enable` không kèm giờ thì theo `[trading.briefs] send_time`, nên sửa cấu hình sau này vẫn dời bản tin.
- Bật lại sau khi bản tin hôm nay đã gửi thì bắt đầu từ ngày mai. Lệnh bị từ chối khi một bản tin đang được gửi. Việc từ chối được kiểm ngay lúc ghi, nên một lần gửi bắt đầu giữa lúc kiểm tra và lúc bật vẫn tiếp tục, và lệnh báo cho bạn rằng một bản tin đang được gửi.
- `/brief` đứng một mình hiện bản tin mới nhất, dựng một bản nếu chưa có.
- `/brief disable` dừng việc gửi.

#### Những tin chỉ nằm trong chuông

Có ba loại tin chỉ vào chuông trong ứng dụng mà không tới chat nào, để ngày yên ắng thì điện thoại cũng yên ắng: kết quả đề xuất đã chấm, tin về mã bạn giữ, và chỉ số của khu vực giảm mạnh. Muốn nhận cả ở chat, hãy thêm loại tin
vào `[notices] chat` trong `config.toml`: `call-scored`, `held-news` hoặc `index-drop`. Tên nào
khác sẽ làm dịch vụ nền dừng ngay lúc khởi động, kèm danh sách tên hợp lệ. Mọi thứ khác dịch vụ nền gửi tới chat vẫn như cũ.

- **Một đề xuất đã được chấm.** Khi bảng thành tích đóng một đề xuất bạn đã nhận, ở mục tiêu, mức cắt lỗ hoặc lúc hết hạn,
  bạn được báo một lần. Bạn thấy kết quả sau phí, cạnh kết quả của chuẩn thị trường trong cùng quãng, nếu thị trường có
  nêu chuẩn.
  - Chỉ đề xuất có cửa sổ vừa kết thúc trong vài ngày gần đây mới được báo, nên lượt chấm đầu tiên sau khi nâng cấp
    không làm chuông ngập kết quả cũ.
  - Chỉ đề xuất thuộc thành tích của chính bạn mới vào chuông hay chat. Ý kiến thứ hai của một agent có phạm vi riêng
    chỉ hiện trực tiếp trên trang văn phòng, ở chỗ agent đó.
  - Thẻ của đề xuất đó có đủ bức tranh.
- **Tin về mã bạn đang giữ.** Mỗi mã đang giữ có một thông báo mỗi ngày, kèm tiêu đề và nguồn, cho tin đăng trong
  ngày. Tin cũ mà dịch vụ nền lưu sau đó thì không được báo.
  - Nó chỉ gồm những mã dịch vụ nền đã đọc. Tiêu đề được lưu lại khi một `/suggest` hay một cuộc trò chuyện về mã đó
    đọc đến chúng; không có gì tự đi lấy tin cho các mã bạn giữ theo lịch.
  - Sau khi khởi động lại, nó không lặp lại tiêu đề của ngày hôm đó.
- **Chỉ số giảm mạnh.** Khi chỉ số của khu vực giảm ít nhất 1,5% trong một phiên. Thông báo nổ mỗi phiên một lần, và
  được kiểm vài phút một lần trong lúc phiên đang chạy.
  - Nó cho biết bao nhiêu mã bạn giữ trên thị trường của chỉ số đó đang giảm, chỉ tính theo giá trực tiếp của phiên
    này, và có mã nào thủng mức cắt lỗ chưa.
  - Nếu có mã không định giá được, nó nói bao nhiêu mã chưa kiểm được, và không bao giờ khẳng định là không có mã nào
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

**Code chấm điểm, mô hình đọc.** Điểm của một chủ đề, một ngành hay một công ty là phép tính số học trên
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

**Code giữ cho mô hình trung thực.** Code dựng gói bằng chứng và gắn id cho mọi mục trong đó (`M1`, `C3`, `N12`); mô hình chỉ được trích dẫn các id này. Chuyên viên phân tích chủ đề là persona giao dịch duy nhất có công cụ, `research`.

- Nó cập nhật các chủ đề `active` và `weakening` từng cái một, rồi đề xuất cái mới đối chiếu với các tiêu đề và luận điểm đã biết.
- Một khẳng định trích id mà gói không có thì bị bỏ, mô hình được hỏi lại một lần, và một lần đọc vẫn thiếu bằng chứng phản bác thì bị bỏ.
- Một đề xuất cần hai nguồn ủng hộ, một trong hai là vĩ mô hoặc hàng hóa, và từ một đến ba ngành hưởng lợi.
- Điều kiện kết thúc của một đề xuất được yêu cầu nêu một con số, một ngưỡng và một khoảng thời gian, bám vào động lực hoặc ngành hưởng lợi, và chưa xảy ra ở thời điểm đề xuất. Quy tắc này nằm trong lời nhắc; code không kiểm.
- Một chủ đề chỉ bị đánh dấu `invalidated` khi một điều kiện của chính nó được dữ liệu cứng chống lưng. Từ đó ngành và công ty của nó không được đọc nữa, và báo cáo gợi ý `/themes retire <id>`.
- Chỉ bạn mới đặt một chủ đề thành `active`, từ chối hay cho nghỉ hẳn.

**Một ngân sách, một phiên chạy tại một thời điểm.** Một phiên chạy dùng một ngân sách, thấp hơn giữa `[trading.themes] maximum_cost_usd` và `[budget]`, và một hạn mức research. Mỗi tiến trình chỉ chạy một lượt tại một thời điểm.

- Nó không ghi gì cho tới khi mọi bước đã trả lời, và đổi trạng thái chỉ chạm các chủ đề còn đang theo dõi.
- Hết ngân sách thì dừng giai đoạn đó và nêu tên các bước bị bỏ.
- Bảng không đọc được thì bỏ giai đoạn công ty và báo một khoảng trống `screen`.
- Mỗi chủ đề bắt đầu từ lần đọc mới nhất của chính nó, nên phiên chạy cuối không bao giờ là toàn bộ bức tranh.
- Tin tức là mọi tin đã lưu kể từ lần đọc cũ nhất trong các chủ đề của phiên chạy, bất kể đăng lúc nào, nên tin lưu muộn không bị sót. Chủ đề nào được đọc gần đây hơn mốc đó có thể gặp lại vài tin.

**Từ chủ đề tới công ty.** Với mỗi chủ đề `active`, việc diễn ra theo bốn bước:

1. Code đọc bảng, các ngành, các quý đã lưu và một ngày tỷ số định giá, một lần.
2. Chuyên viên phân tích gắn chủ đề với tối đa ba siêu ngành ICB, mỗi ngành kèm một phản biện có trích dẫn.
3. Code lập danh sách ngắn tối đa năm mã mỗi ngành, từ những mã còn lại trên bảng mà yếu tố chất lượng đã bật. Nó loại các mã có điểm Piotroski yếu, cờ Beneish, dòng tiền tự do âm và lợi nhuận trên vốn đầu tư không dương.
4. Chuyên viên phân tích đọc các mã ba mã một lần, không có `research`.

**Các lần đọc công ty được kiểm tra.** Code hỏi lại một lần, rồi bỏ mã kèm một ghi chú, khi một lần đọc cổ phiếu:

- có tỷ lệ các kịch bản không cộng ra 100;
- có P/E mục tiêu cao hơn đỉnh năm năm của mã; hoặc
- đưa nhận định "lợi nhuận" mà không trích con số nào trong báo cáo.

Code, không phải mô hình, tính độ chen chúc và mức bất ngờ lợi nhuận. Một tín hiệu chưa đọc không bao giờ làm một mã bị coi là chen chúc, và một mã có quý mới nhất chậm hơn lịch quá hai quý thì không được đọc.

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
| `refresh` | theo phiên | - | luôn | Làm mới mọi thị trường còn dùng, rồi ghi dòng lệnh, rồi ghi bảng đã chốt của mỗi thị trường và chấm các bảng cũ đã tới cuối cửa sổ của chúng (xem [thành tích của chính bảng giá](#thành-tích-của-chính-bảng-giá)) |
| `intraday` | theo lịch | - | luôn | Gửi bản đọc trong phiên vào các giờ đã cấu hình của khu vực, nghỉ giữa các lần; lần gửi trễ quá `[schedule] late_grace_ms` thì bị bỏ qua, không gửi trễ |
| `exits` | 60s | 50 | một sàn có khóa giao dịch | Đối soát những gì đang treo ở sàn với cuốn sổ, và trail các cắt lỗ nó giữ |
| `intents` | 5m | - | có dịch vụ đặt lệnh | Chốt một lệnh mà sàn đã nhận mà cuốn sổ chưa có; không chạm sàn nào |

Hai tác vụ cuối không có trên bản cài không có khóa sàn, nên hai cuốn sổ có thể có số vòng lặp khác nhau. Sàn không có khóa thì không treo được lệnh thoát nào, và không có dịch vụ đặt lệnh thì không có lệnh nào chưa chốt cần xử lý.

Vòng cảnh báo chạy theo thứ tự (gửi, dựng cảnh báo thoát, dựng cảnh báo sàng lọc), nên một cảnh báo không bao giờ được gửi ngay trong nhịp đã dựng nó. Dòng lệnh chạy cùng refresh vì nó ghi một dòng mỗi mã mỗi phiên đã chốt, đúng thời điểm refresh vốn đã chờ.

Chỉ nhịp `[trading.refresh]` là cấu hình được. Vòng cảnh báo và đối soát lệnh thoát đang treo chạy mỗi 60 giây, còn việc chốt lệnh khớp bị lỡ chạy mỗi 5 phút; các nhịp này cố định. Phần còn lại (`briefs`, `outcomes`, `macro-extract`, `theme-outcomes`) được điều nhịp theo chi phí của chúng.

#### Refresh được lên lịch thế nào

Refresh đi theo lịch giao dịch, không theo một khoảng cố định. Nó chạy vào hai thời điểm:

- khi mỗi phiên chốt (giờ đóng cộng độ trễ khớp lệnh, cũng là thời điểm quyết định một phiên có được coi là đã chốt không);
- 60 phút trước mỗi giờ mở, để bản tin sáng và lần sàng lọc đầu tiên đọc dữ liệu mới mà không phải chờ tải.

Thị trường nào có giờ riêng thì có nhịp riêng. Khoảng đã cấu hình vẫn áp dụng, như một mức trần, cho thị trường không bao giờ đóng cửa và cho một registry rỗng.

Refresh phủ mọi thị trường bạn còn dùng. Một thị trường được tính là còn dùng khi:

- nhóm của nó đang bật trong hồ sơ; hoặc
- bạn đang nắm một mã ở đó, theo dõi một mã, chờ một đề xuất được chấm, hoặc có bản tin lên lịch dựng trên đó.

Một nhóm đã tắt chỉ bị bỏ khi không còn gì trong số đó cần nó, nên cắt lỗ của một khoản đang nắm không bao giờ bị bỏ mặc không có giá. Chưa có hồ sơ thì mọi thị trường đều được làm mới. Không đọc được danh sách đó thì làm mới tất cả. Bản tin sáng mô tả đúng danh sách đó, và nêu tên một thị trường trên `/refresh` thì thị trường đó vẫn được làm mới.

Các thị trường được làm mới cùng lúc, không lần lượt. Chúng gần như không dùng chung nguồn, bộ điều tốc kiểm soát vài nguồn ít ỏi dùng chung, và bắt thị trường này chờ thị trường kia chỉ cộng dồn thời gian chờ của các máy chủ không liên quan.

Bên trong thị trường chứng khoán Việt Nam cũng vậy. Lịch sử giá, chỉ số tài chính và dòng tiền được tải cùng lúc. Bối cảnh vĩ mô và báo cáo tài chính chờ ba phần đó xong, vì cả hai đọc đúng dữ liệu ba phần đó vừa lưu.

**Mỗi thị trường chỉ một lượt quét tại một thời điểm.** Nếu bạn gõ `/refresh` trong lúc nhịp đã lên lịch đang chạy, lệnh sẽ nhập vào lượt tải đó thay vì chạy song song. `/refresh force` là trường hợp duy nhất xếp hàng chờ thay vì nhập vào. Một lượt quét không force có thể bỏ qua dữ liệu mà nó cho là còn mới, và làm lại đúng phần đó là điều `force` yêu cầu.

`/refresh <thị trường>` chỉ quét thị trường đó. Tên không phải thị trường đã đăng ký thì nhận dòng hướng dẫn cách dùng, thay vì lặng lẽ không làm gì. Lệnh nhập vào một lượt quét đang chạy sẽ báo vậy và nêu tên thị trường nó đang chờ. Mọi dòng tiến độ đều nêu tên thị trường; không có tên, dòng đó sẽ nhấp nháy giữa các thị trường dùng chung nó.

**Chi phí đọc bảng đi cùng phiên chạy.** Lượt quét crypto lập kế hoạch trên bảng vốn hóa xếp hạng, và các nguồn của bảng này công bố độ sâu khác nhau (750 dòng, 250 và 100). Một lượt quét phải lùi về nguồn nông hơn chỉ phủ một phần thị trường, nhưng mọi số đếm nó báo lại mô tả phần đó như thể là toàn bộ.

Vì vậy các lưu ý của chính bảng cùng `market-data.universe-shallow` được chuyển tới kết quả, giống cách `/screen` và `/overview` vốn đã báo về cùng lượt quét. Một kết quả mà mọi mục tiêu đều hỏng vẫn nhận `source.no-available-provider`.

**Một lưu ý refresh nêu tên loại dữ liệu của nó.** `/refresh` in mỗi loại dữ liệu thành một dòng. `/overview` và `/brief` gom mọi lưu ý vào một danh sách không trùng lặp, nơi một ghi chú như `1 of 23 pulls landed` sẽ khiến bạn hỏi "của cái gì?". Nên câu của mỗi lưu ý nêu tên loại dữ liệu dù nó hiện ở đâu, và màn hình refresh in các ghi chú dưới thị trường chứ không dưới một dòng sẽ lặp lại tên loại.

**Ai đã điều khiển một phiên được ghi một lần, hoặc không ghi.** Mỗi lần refresh ghi tỷ lệ bên mua/bên bán chủ động (bên nào đã chủ động khớp lệnh) cho mỗi mã bạn nắm hoặc theo dõi. Không nguồn nào đứng sau nó cho phép hỏi theo ngày. `kbsec` trả về phiên mà bảng của nó đang giữ lúc đó, còn `vietcap` lật trang ngược từ các lệnh khớp mới nhất. Nên tỷ lệ này chỉ đọc được trong khoảng từ lúc phiên chốt tới lần mở cửa kế tiếp.

Lịch refresh đặt hai lượt trong khoảng đó (15:15 và 08:00 với bảng VN). Sau giờ mở cửa thì phiên đó mất hẳn. Vì vậy mã nào lượt quét không ghi được sẽ được nêu tên dưới thị trường của nó trong màn hình `/refresh`: một chỗ hụt mà không lượt nào sau lấp được là một lỗ hổng vĩnh viễn trong chuỗi. Lượt quét chỉ phủ các thị trường mà refresh phủ, nên `/refresh crypto` không tốn ngân sách của nguồn VN nào.

Mã bạn không nắm cũng không theo dõi thì không bao giờ bị quét, và đó là mọi ứng viên mua. Với những mã này, `/suggest` tự đọc tỷ lệ mua/bán của phiên nó đang xét, và không lưu gì. Nếu lưu, dòng đó sẽ lọt vào một mục bản tin liệt kê các mã bạn theo dõi. Cả hai bên đọc đều hỏi cùng một ngày, nên một dòng đã lưu của phiên trước không bao giờ thay cho phiên đang được xét.

**Một tín hiệu dòng tiền trên mọi dòng sàng lọc VN:** *foreign flip* (khối ngoại quay đầu). Nó bật khi khối ngoại, vốn đang mua ròng trung bình, bỗng bán: tỷ phần bán ròng trên giá trị giao dịch xuống thấp hơn mức trung bình đó hai độ lệch chuẩn, sau một đợt tăng 3% hoặc hơn qua bốn phiên.

Nó không đổi điểm nào. Một đề xuất trên mã đang có tín hiệu này mang nó như một lưu ý. Nhật ký yếu tố cũng ghi lại nó, để bảng theo dõi về sau cho thấy nó đáng giá bao nhiêu trước khi nó được nhận trọng số.

**Crypto đọc băng giá của riêng nó.** Hai tín hiệu đi theo mọi dòng sàng lọc crypto và được ghi cùng điểm yếu tố:

- Một *cú rũ bỏ giữ được*: một phiên giảm ít nhất 5% qua bốn phiên, trên khối lượng tương đối từ 1,5 trở lên, đóng trong một phần năm thấp nhất của biên độ, mà đáy của nó mọi phiên sau đều giữ được, đọc trong hai tới bốn phiên sau đó.
- Một *đợt tăng do đòn bẩy dẫn*: số hợp đồng open interest tăng ít nhất gấp đôi mức tăng của giá qua cùng ba phiên, trên một đợt tăng 5% hoặc hơn.

Không tín hiệu nào đổi điểm. Một đề xuất trên mã đang có một trong hai tín hiệu mang một lưu ý. Tín hiệu đầu nói rằng bán ở đây là bán đúng đáy; tín hiệu sau nói rằng đợt tăng đang được đòn bẩy gánh chứ không phải lực mua spot. Không có cài đặt: các ngưỡng là chính sách chiến lược, được đánh phiên bản cùng chiến lược crypto.

**Các yếu tố crypto, trọng số bằng nhau:** xu hướng, funding, độ lệch long/short của nhà đầu tư nhỏ lẻ, tốc độ quay vòng giao dịch và độ biến động.

- Xu hướng là số đọc sức mạnh giá duy nhất, có chủ ý. Động lượng và khoảng cách tới đỉnh 200 phiên đã được kiểm tra so với diễn biến của các coin trong một tới bốn tuần sau đó. Chúng không thêm được gì và đi cùng nhịp với xu hướng, nên giữ cả ba sẽ là đếm một ý kiến ba lần.
- Funding và độ lệch long/short là ngược chiều đám đông: bên đang trả tiền để ở lại, và đám đông đã vào rồi, còn ít thứ để mua hơn.
- Độ lệch là tỷ lệ tài khoản long/short toàn cầu của Binance, lưu cùng dòng funding. Không có cài đặt cho nó.

**Khởi động.** Lượt refresh đầu tiên có **ngân sách 60 giây**, sau đó nó chạy tiếp ở nền.

- Nếu kho đã có dữ liệu gần đây, lượt refresh xong trong ngân sách.
- Nếu kho trống hoặc đã cũ, ngân sách hết, dịch vụ nền vẫn bắt đầu nhận việc, và lượt quét hoàn tất ở nền. Dữ liệu sẽ mới dần, và luôn đúng.

Không gì dừng lượt quét ở hạn chót, vì một phạm vi bị dừng không ghi dòng thử nào và nhịp sau sẽ phải làm lại toàn bộ.

### Chi phí và giới hạn

Chi phí được theo dõi theo từng phiên chạy. Trần theo ngày, theo tháng và theo phiên chạy đều là **tùy chọn bật**: `0` nghĩa là không giới hạn, và đó là mặc định. Cảnh báo mềm ở mức 80%. Vòng lặp bị chặn bởi trần số lượt, trần thời lượng và một bộ phát hiện vòng lặp.

Bộ phát hiện vòng lặp không dừng cả phiên chạy:

- Ở lần gọi công cụ gần giống hệt thứ hai, nó chặn riêng lần gọi đó kèm một chỉ dẫn chuyển hướng mà mô hình đọc được.
- Ở lần thứ ba, nó **đóng bề mặt công cụ** trong phần còn lại của phiên chạy. Bản ghi hội thoại đã có mọi kết quả mô hình lấy được, nên một phiên chạy kết thúc bằng câu trả lời dựng từ chúng tốt hơn một lần kết thúc bằng mã dừng.

Ngân sách số lần gọi công cụ thì vẫn dừng, vì nó là ngân sách.

Tranh luận chạy các persona trên nhóm mô hình `debate` khi có cấu hình, nếu không thì trên chuỗi chính. Một bảng tranh luận năm mã mỗi lượt.

### Bề mặt

Mọi năng lực đều với tới được qua các bề mặt này, từ cùng các dịch vụ.

**Công cụ** (cho agent), thêm `order_place` và `order_exits` khi một sàn có khóa giao dịch. Một số được đưa cho mô hình ngay từ đầu: `market_overview`, `market_screen`, `market_price`, `market_bars`, `market_events`, `market_sector_strength`, `macro_risk`, `vn_foreign_flow`, `portfolio_view`, `portfolio_record`, `profile_update`, `suggestion_run`, `suggestion_batch` (và `skill_view`). Phần còn lại được tìm qua tìm kiếm công cụ khi một lượt cần.

Danh sách đưa sẵn được giữ ngắn có chủ ý. Một công cụ chỉ được đưa sẵn khi mô hình không thấy nó sẽ quay sang trả lời từ web, bằng những con số nghe có vẻ đúng cho các dữ kiện mà sản phẩm này đã có. Mỗi công cụ đưa sẵn tốn token ở mọi lượt, nên cả tập đưa sẵn giới hạn ở 23.

Tìm kiếm công cụ chỉ chặn một lần gọi mà nó phải *đoán*.

- Gọi đúng tên thì công cụ được nạp và chạy.
- Gọi chỉ khớp theo độ tương tự thì bị chặn. Kết quả nêu tên các công cụ đã nạp và kết thúc bằng một `hint` bảo nên gọi gì.

Tối đa tám công cụ tìm được giữ ở trạng thái đã nạp, cái cũ nhất bị bỏ ra trước.

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

Cảnh báo được gọi bằng mã sáu ký tự (phần đuôi của mã dài) trong `/alert list`, trong lời xác nhận và trong mọi thông báo. `/alert disable <mã cảnh báo>` nhận mã đó, và liệt kê mã đầy đủ khi nó khớp nhiều cảnh báo.

Cảnh báo giá hay cảnh báo thoát lệnh khi chạm sẽ mở đầu bằng tiêu đề và bước tiếp theo. Với thoát lệnh, đó là dòng `/record sell` để bạn điền khi bán xong, rồi `/suggest` để xem lại.

Trong chat, `/transactions` mặc định hiện 10 dòng. `/portfolio` liệt kê các vị thế ngay sau phần cảnh báo, rồi mới đến tiền mặt, lãi lỗ và phân bổ, với tối đa ba lần đóng vị thế gần nhất trên điện thoại.

`/alert create` và `/brief enable` cần một nơi để gửi tới, như Telegram hay Zalo.

- Gõ trong một kênh đã kết nối thì gửi về chính chat đó.
- Gõ trong terminal thì gửi về chat của bạn. Kênh được cấu hình đầu tiên được chọn (Telegram, rồi Zalo, rồi Zalo Personal), và `fallback_chat_id` chọn chat, nếu không có thì dùng chat duy nhất đã ghép nối.
- Chưa cấu hình kênh nào thì lệnh bị từ chối.

Tin chỉ đến khi OpenAlpha đang chạy nền (`openalpha start --background`).

Dùng chat ngôn ngữ tự nhiên cho mọi thứ cú pháp gạch chéo không phủ: nến, tin tuyển chọn, sức mạnh ngành, dòng tiền ngoại, rà soát danh mục, bảng thành tích. Agent gọi các công cụ giao dịch có kiểu.

Bạn có thể bỏ thị trường khi mã chỉ khớp một thị trường. Nếu hai thị trường cùng nhận mã, đề xuất báo `ambiguous-market` và hỏi thị trường thay vì đoán.

**HTTP** (chỉ trên máy này, xác thực bằng bearer token). `openalpha start` mở một API cục bộ theo mặc định (`[api] enabled = false` để tắt) (xem [`[api]`](cau-hinh.md)).

Các route trả về **mã và dữ liệu, không bao giờ là câu chữ**: client nhận `{ code: 'suggestion.reused-same-day' }` và tự hiển thị bằng ngôn ngữ của người đọc. Mọi yêu cầu đều đại diện cho một operator cục bộ duy nhất, cố định lúc khởi động, nên không yêu cầu nào chọn hay giả mạo được người dùng khác. Danh sách route: [trang dành cho lập trình viên](dev/giao-dich.md).

### Ngôn ngữ

Mọi chuỗi bạn thấy đều lấy từ một khóa dịch, có cả tiếng Anh và tiếng Việt. Các mã lấy từ những danh sách cố định, nên một giá trị mới không thể tồn tại mà thiếu bản dịch: khởi động sẽ lỗi, và một phép kiểm lúc build còn báo lỗi sớm hơn.

Thuật ngữ tiếng Việt được kiểm tự động lúc build. Lỗi nguy hiểm không phải một bản dịch trông sai, mà là một bản dịch trông ổn: một đề xuất `reduce` bị dịch thành *bán* sẽ bảo bạn bán sạch, trong khi sản phẩm chỉ đề xuất giảm bớt.

### Lưu trữ

Schema bắt đầu gọn và lớn dần bằng migration. Các migration chạy theo thứ tự id, chỉ những cái chưa áp, và một migration đã áp thì không bao giờ đổi.

Thời gian giữ dữ liệu thị trường được **tính ra, không cấu hình**. Đó là cửa sổ bằng chứng dài nhất mà một thị trường đã đăng ký khai, quy từ phiên ra ngày lịch theo quy tắc cuối tuần của chính thị trường đó, cộng 5% dự phòng.

Một giá trị cấu hình vừa sai theo mặc định vừa không có cách nào đánh giá. Một lượt dọn ngắn hơn cửa sổ bằng chứng dài nhất sẽ xóa các dòng mà quy trình tính yếu tố lại cần tới ở phiên chạy kế tiếp.

---

## Cuốn sổ

Sổ lệnh là nguồn sự thật duy nhất. Vị thế, tiền mặt và NAV đều được tính từ các dòng sổ lệnh, không bao giờ là số dư lưu riêng có thể lệch khỏi các bút toán đã tạo ra chúng.

Một vị thế được xác định theo mã **và sàn**. Cùng một coin ở hai nơi lưu ký là hai vị thế, với hai giá vốn và hai số lượng đã chốt. Một lệnh bán ở sàn này giải phóng giá vốn của sàn đó, không phải một mức bình quân gồm cả coin nằm ở nơi khác.

`/portfolio` gộp chúng lại thành một dòng (một mức phơi nhiễm, một tỷ trọng, một giá vốn trộn). Nó chỉ thêm một dòng sàn bên dưới khi một khoản nắm thật sự nằm trên nhiều sàn. Tiền mặt cũng được giữ theo từng sàn; điều đó dẫn tới gì được nói rõ ở cuối trang này.

Ghi một giao dịch là cập nhật sổ lệnh của bạn. Nó không bao giờ gửi lệnh đi đâu.

### Sổ lệnh

Mỗi dòng có một id, thời điểm được ghi lần đầu, thời điểm sửa lần cuối và chính giao dịch. Một giao dịch là một dòng, sửa và xóa tại chỗ. Gõ nhầm ngày nghĩa là sửa ngày đó, không phải thêm một dòng để thay.

Đây là một đánh đổi có chủ ý. Cuốn sổ được tính từ các dòng **đúng như chúng đang có lúc này**, nên sửa một bút toán sẽ tính lại mọi con số phụ thuộc vào nó, kể cả các đề xuất được lập trước lần sửa. Không có nhật ký kiểm toán, và `/reflect` không thể chứng minh cuốn sổ trông thế nào vào ngày một đề xuất được lập. Sự tiện khi sửa sai được chọn thay cho sự bảo đảm đó.

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

**Phí.** `buy` hay `sell` có thể bỏ trống phí. Khi đó phí được tính theo tỷ lệ `fees` bạn cấu hình cho sàn đó ở `[trading.venues.<id>]`. Nó không bao giờ bằng 0, vì như vậy cuốn sổ sẽ bị ghi thiếu chi phí mãi mãi.

- Sàn nào cũng có tỷ lệ, vì một công ty chứng khoán bạn tự khai bằng tay phải nêu tỷ lệ.
- `rights` luôn nêu phí của chính nó, vì một đợt phát hành quyền mua không tính theo phí môi giới chuẩn.
- Dòng đã lưu luôn có một khoản phí; chỉ phần bạn phải gõ là khác nhau.

Dòng xác nhận ghi cho biết phí lấy từ tỷ lệ nào, hoặc phí bạn gõ lệch khỏi tỷ lệ đó bao xa.

**Khối lượng được hỏi từ sàn, không bao giờ tự tính từ một tỷ lệ.** Một sàn đặt `fee_asset = "base"` trong `fees` (OKX và Binance mặc định, như phần lớn sàn crypto) trừ phí **mua** ngay vào số coin nó giao. Nên một lệnh mua 3 coin chỉ ghi có cho bạn ít hơn 3. Dòng phải mang đúng con số thực sự được ghi có, vì vị thế cộng `quantity` nguyên như vậy, còn phí chỉ làm đổi tiền mặt.

Phần hụt đó không tính được từ tỷ lệ đã cấu hình. Một lệnh khớp theo kiểu maker hay taker, và chỉ sàn biết là kiểu nào. Một khối lượng tự tính sẽ là phỏng đoán nhưng lại được lưu như dữ kiện đã ghi. Lệnh bán không bị ảnh hưởng: phí của nó trừ vào tiền thu về, mà phía tiền mặt đã ghi phần đó.

Phí sàn chỉ được ghi khi đó là một khoản bị thu. Khoản hoàn phí (OKX báo là phí dương) được ghi là không có phí, vì sổ không có phí âm. Binance in phí của một lần khớp trên các dòng giao dịch của nó, nên lần khớp chưa có dòng nào thì chưa có phí để ghi: nó được để chưa ghi thay vì ghi là miễn phí, và `/record sync` ghi nó khi các dòng xuất hiện.

Khi bạn ghi một giao dịch ở sàn có khóa giao dịch, OpenAlpha tra xem sàn đó thật sự đã khớp gì trong ngày, cùng chiều, trên cùng mã. Nếu có **đúng một** lần khớp lệch không quá 1% so với cỡ bạn nêu, lần khớp đó tạo ra dòng: khối lượng khớp đã trừ phí tính bằng coin, giá bình quân, và phí quy ra tiền tệ giao dịch.

Mọi trường hợp khác thì dòng giữ đúng như bạn gõ: sàn không có client, ngày nằm ngoài cửa sổ lịch sử của sàn, không khớp lần nào, có hai lần khớp mà lần nào cũng có thể đúng, hoặc sàn không trả lời. Phí bạn nêu không bao giờ bị ghi đè; nêu phí là cách ghi một giao dịch mà không hỏi được sàn. Dòng xác nhận nói rõ trường hợp nào đã xảy ra.

**`fee` và `loss`.** Cả hai đều lấy tiền ra và không cái nào chạm vào nạp ròng. Nhưng phí là chi phí giao dịch, còn loss là kết quả giao dịch. `loss` dùng cho khoản tiền mất trên các giao dịch đã đóng trước khi cuốn sổ bắt đầu ghi (một lần nhập snapshot chỉ nêu được nó thành một tổng), để khoản này không bị ghi như phí môi giới.

**Ngày.** Ngày của một dòng là ngày giao dịch (`YYYY-MM-DD`), không bao giờ kèm giờ. Hai bút toán cùng ngày được sắp theo id, giữ đúng thứ tự bạn ghi trong ngày. Ngày thanh toán theo lịch của chính thị trường: T+2 cho cổ phiếu Việt Nam, cùng ngày cho mọi thị trường khác. Nó được tính lại mỗi khi bạn sửa ngày.

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

`/update` nhận mã ngắn rồi tới đủ cả dòng `/record`: cả giao dịch, không chỉ phần thay đổi. Câu trả lời cho xem dòng như trước khi sửa, rồi tới xác nhận.

Khi sửa, bạn phải nêu rõ khối lượng và phí, trong khi `/record` cho phép viết `all` hoặc để phí theo tỷ lệ. Dòng bạn sửa vốn đã có cả hai. Tính lại một trong hai theo một cuốn sổ mới hơn hay một tỷ lệ đã đổi sẽ làm dịch một con số đã chốt mà bạn chưa hề gõ lại.

`/delete <mã bút toán>` cho xem dòng đó và hỏi lại trước (một nút trên Telegram, một dòng để gõ ở nơi khác). `/delete <mã bút toán> confirm` xóa hẳn ngay, dùng cho một dòng trùng hoặc một giao dịch chưa từng xảy ra. Script nào xóa trong một bước thì phải thêm `confirm`. Cả hai cũng nhận mã bút toán đầy đủ, là thứ agent truyền qua `portfolio_update` hay `portfolio_remove`.

Mã ngắn là **sáu ký tự cuối** của mã bút toán, không phải sáu ký tự đầu. Id bắt đầu bằng dấu thời gian, nên các dòng ghi trong cùng một mili giây có chung các ký tự đầu. Một mã ngắn khớp nhiều hơn một dòng thì bị từ chối, không bao giờ bị đoán.

Mọi trường đều đổi được, gồm cả ngày. Ghi lùi ngày không bị hạn chế.

#### Một lần ghi kiểm những gì

Mọi lần chèn, sửa và xóa đều kiểm **toàn bộ cuốn sổ như nó sẽ trông sau lần ghi đó**, trong cùng giao dịch ghi dòng ấy. Điều này quan trọng vì một lần sửa có thể làm hỏng một dòng mà nó chưa từng chạm tới:

- thu nhỏ một lệnh mua tháng Một có thể khiến một lần rút tiền tháng Hai bị âm quỹ, dù lúc ghi nó vốn đủ tiền;
- dời một lệnh mua ra trước lần nạp tiền đã cấp vốn cho nó sẽ khiến bạn tiêu một khoản chưa có.

Cả hai đều bị từ chối, kèm ngày và phần thiếu được nêu rõ:

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

Giá trị thị trường được quy đổi theo tỷ giá hôm nay của đồng tiền của chính thị trường. Giá vốn được quy đổi theo tỷ giá đã lưu trên dòng lúc giao dịch được ghi, nên một bút toán cũ giữ đúng số tiền bạn thật sự bỏ ra. Phần chênh giữa hai con số là mức biến động tỷ giá trên những gì bạn nắm. Cuốn sổ báo nó thành một dòng riêng, thay vì gộp vào biến động giá.

Đồng tiền thuộc về thị trường. Crypto thanh toán bằng **USDT** và vàng bằng **USD**, và mỗi bên quy đổi theo tỷ giá mà chính thị trường đó dùng để giao dịch: `USDTVND` cho coin, `USDVND` cho vàng.

Tỷ giá USD liên ngân hàng cố ý không dùng cho coin. USDT không phải USD, và người nắm crypto không thể giao dịch ở tỷ giá liên ngân hàng. Đo ngày 2026-09-08, hai mức lệch nhau 0,3%, toàn bộ theo chiều làm cuốn sổ trông lớn hơn thực tế.

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

- `live` - số quan sát của nó mới hơn giá đóng cửa của phiên đã chốt gần nhất trên lịch thị trường của chính công cụ đó;
- `close` - nó chính là giá đóng đã chốt đó.

Mỗi thị trường trả lời theo lịch của chính nó, nên một cuốn sổ có thể giữ cả hai cùng lúc: cổ phiếu VN chốt lúc 15:00 giờ Hà Nội trong khi crypto chưa từng ngừng giao dịch.

Cả cuốn sổ là `live` chỉ khi **mọi** vị thế đã định giá đều live; nếu không thì là `close`.

- Cuốn sổ live hiện giờ của mức giá mới nhất.
- Cuốn sổ đã chốt nêu tên phiên nó được định giá.
- Cuốn sổ lẫn lộn được coi là đã chốt, và đánh dấu các ngoại lệ trên dòng riêng của chúng. Tiêu đề không bao giờ khẳng định một độ mới mà chỉ vài khoản nắm có.

Nhờ vậy một tổng lấy lúc 11 giờ sáng không bị hiểu là giá trị đóng cửa, và một tổng lấy lúc nửa đêm không bị hiểu là giá trực tiếp.

**Lãi/lỗ đã thực hiện** là ngoại lệ. Nó bằng tiền mặt + giá vốn - nạp ròng, nên không có mức giá nào tham gia, và nó vẫn hiện cả khi không có NAV. Khoản nạp nào không còn là tiền mặt, cũng không nằm trong giá vốn của một vị thế đang mở, thì đã lãi hoặc lỗ trên một giao dịch đã đóng.

Lãi/lỗ chưa thực hiện là biến động trên giấy của những gì bạn vẫn nắm; lãi/lỗ đã thực hiện là phần đã chốt xong. Chúng hiện thành hai dòng riêng.

Khi có khoản nắm nào chưa có giá, NAV bị giữ lại và bản đánh giá mang `portfolio.valuation-partial`.

- Các phép kiểm theo tỷ trọng tự bỏ qua, thay vì chia cho một tổng chưa đủ.
- Lệnh mua qua `/trade` hay `order_place` bị từ chối vì cùng lý do.
- Các phép kiểm loại trừ và thanh khoản vẫn chạy, vì "bạn vẫn nắm thứ nằm trong danh sách loại trừ" đúng dù giá là bao nhiêu.

### Danh mục đã đi thế nào

`/portfolio nav [1m|3m|6m|1y|all]` (mặc định `3m`) cho thấy cuốn sổ đã đi thế nào theo thời gian. Nó được dựng từ một snapshot mỗi ngày:

- **Một snapshot mỗi ngày.** Sau mỗi lượt `trading.refresh`, dịch vụ nền định giá cuốn sổ đúng như `/portfolio` và giữ một dòng cho ngày đó; lượt cuối của ngày thắng. Lịch sử bắt đầu từ khi bạn nâng cấp. Không gì được dựng lại từ sổ lệnh, vì giá đóng VN đã lưu được điều chỉnh ngược còn khối lượng trong sổ lệnh thì không.
- **Lợi suất trọng số thời gian.** Một khoản nạp hay rút làm đổi giá trị cuốn sổ mà không phải là lãi, nên nó bị trừ khỏi ngày nó rơi vào. Cổ tức, phí và loss vẫn nằm trong lợi suất.
- **Sụt giảm từ đỉnh.** Mức sụt sâu nhất và hiện bạn đang thấp hơn đỉnh bao nhiêu, cả hai trên cùng một chỉ số.
- **Một thước đo từ cơ cấu mục tiêu của chính bạn.** Mỗi nhóm bạn đã đặt mục tiêu đi theo chỉ số chuẩn của thị trường nó, còn tiền mặt thì không sinh lời. Nhóm nào mà thị trường không có chuẩn thì bị bỏ ra, và phần còn lại được co lại cho đủ một; hiện vàng không có chuẩn. Câu trả lời nêu tên các phần.
  - Nếu không nhóm nào bạn đặt mục tiêu có chuẩn, thì không có thước đo, và câu trả lời nói vậy.
  - Nếu một chỉ số không có giá phủ toàn cửa sổ (không có từ snapshot đầu tiên, hoặc không có gần snapshot cuối), thước đo bị bỏ chứ không tính từ một phần cửa sổ.
- **Khoảng trống.** Ngày nào có khoản nắm chưa có giá thì không ghi dòng, và log `trading.nav_snapshot_skipped` kèm tên các mã; dòng trước đó của ngày ấy (nếu có) được giữ. Ngày dịch vụ nền tắt thì không có điểm trên biểu đồ, nhưng lợi suất qua khoảng trống vẫn chính xác, vì các khoản nạp được đọc từ sổ lệnh. Cuốn sổ rỗng không ghi gì.

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
- `reserve-pct-nav` - phần tiền mặt luôn giữ lại. Mục tiêu tiền mặt không bao giờ thấp hơn mức này: nâng mức dự trữ vượt mục tiêu tiền mặt thì mục tiêu được kéo lên bằng nó và các nhóm khác co lại theo tỷ lệ; tỷ trọng bạn tự đặt giữ nguyên, và lệnh bị từ chối nếu chúng không còn vừa. Tự đặt mục tiêu tiền mặt thấp hơn mức dự trữ cũng bị từ chối. Hạ mức dự trữ thì mục tiêu tiền mặt giữ nguyên; `/profile reset` đặt lại từ đầu
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

Một nhóm mà không sàn nào giao dịch thì luôn tắt, và lệnh bật nó bị từ chối. Hiện đó là vàng thế giới, được giữ lại vì giá của nó và vì mức chênh `gold-vn`.

- `/suggest` trên một mã của nhóm đó vẫn đưa số đọc yếu tố và các mức giá, như một lần giữ nguyên với lý do `reference-only`, và không chạy tranh luận.
- Hướng dẫn cách dùng của `/profile`, `/record` và `/rebalance` không nhắc tới nó.
- `/overview` in số đọc vĩ mô của nó mà không có dòng về mức nên chi bao nhiêu cho một lệnh mua đã lên kế hoạch, vì ở đó không mua gì.

Một nhóm có tỷ trọng mục tiêu 0% thì không mở vị thế mới nào. Mức `conservative` mặc định để crypto như vậy: `/suggest` một coin bạn chưa nắm sẽ trả lời giữ nguyên với lý do `segment-target-zero`, còn các mã đang nắm vẫn giữ nguyên điểm thoát và lệnh giảm bớt. Muốn mua lại trong nhóm đó, hãy đặt cho nó một tỷ trọng bằng `segment-target`.

`maximum-open-risk-pct-nav` chặn tổng mức mà mọi mã đang nắm có thể mất tại cắt lỗ đã lên kế hoạch của chúng. Một lệnh mua mới được định cỡ vào phần còn lại dưới nó, và một mã đang nắm không có cắt lỗ đã lên kế hoạch thì được báo chứ không bị tính là an toàn.

`risk-level` và cặp `risk-capacity`/`risk-willingness` **loại trừ lẫn nhau**. Level là cách đặt nhanh, còn cặp kia là thứ dùng để tính ra nó. Một lần ghi gửi cả hai sẽ bị từ chối. Công cụ `profile_update` đưa quy tắc đó vào chính schema của nó, nên mô hình được bảo thử lại trước khi bạn phải duyệt một lần ghi chắc chắn thất bại.

**Đơn vị.** Các trường chính sách trong hồ sơ là **phân số** (`0.25`), còn mọi tỷ trọng hiện trong một khung nhìn là **phần trăm** (`25`). Hậu tố `pct-nav` là một phần của tổng tài sản (NAV) và xuất hiện ở cả hai.

Risk level đặt các mặc định, và các biên giới hạn những gì bạn đặt được. Rủi ro mỗi lệnh 40% NAV bị từ chối, không phải được nhận rồi lặng lẽ bỏ qua. Lời từ chối nêu tên trường bạn gõ và khoảng nó cho phép.

Đổi risk level sẽ đặt lại các trần về mặc định của mức mới, nhưng hai thứ bạn tự đặt vẫn được giữ: mục tiêu của một nhóm và lõi ETF của một nhóm. Một lõi vượt trần ETF mới thì bị giữ ở trần, và quay về số của bạn khi trần nới ra lần nữa. Tắt rồi bật một nhóm cũng giữ nguyên hai thứ đó. `/profile reset` xóa cả hai.

Mọi màn hình có con số chịu ảnh hưởng của hồ sơ đều nêu tên hồ sơ một lần, ở dòng cuối của tiêu đề: `/portfolio`, `/rebalance` và một đề xuất đã lưu. Dấu này chỉ cho biết đó là hồ sơ nào (rủi ro, kỳ hạn, mục tiêu, cộng một dấu hiệu khi chưa lưu gì), vì mọi giới hạn đã được in ở chỗ nó áp dụng.

Một đề xuất đã lưu mang dấu của lúc nó được định cỡ. Xem lại nó sẽ thấy chính sách mà các con số của nó dựa vào, không phải chính sách đang hiệu lực lúc bạn xem. `/reflect` không mang dấu nào vì cùng lý do: mỗi dòng của nó được định cỡ theo chính sách áp dụng vào ngày của dòng đó.

### Lời khuyên

Lời khuyên hoặc là **ready** (phân bổ nhóm, tái cân bằng từng vị thế, một thế đứng cho nhóm tiền mặt và các khoản nắm yếu) hoặc **unavailable**, với một trong bốn lý do:

| Lý do | Nghĩa là |
|---|---|
| `zero-nav` | không có gì để phân bổ |
| `incomplete-valuation` | ít nhất một khoản nắm không định giá được |
| `insufficient-policy-input` | một công cụ đang nắm không có dữ liệu sàng lọc |
| `unresolved-names` | một mã bạn nêu không khớp thị trường nào đã đăng ký |

Một câu trả lời unavailable vẫn mang các phát hiện, vì "bạn đang vượt trần ngành" vẫn đúng khi một khoản nắm chưa có giá.

Một nhóm mà kế hoạch không cấp vốn đủ tới mục tiêu thì nêu một lưu ý gọi tên nhóm đó. Mỗi nhóm có phần riêng của quỹ có thể triển khai, nếu không một khoản hụt toàn kế hoạch sẽ đổ ngân sách đã cạn của một nhóm bên cạnh lên mã nào tình cờ đứng dưới mục tiêu.

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

- Kế hoạch lấy khoảng cách tới mục tiêu và giữ nó trong ngân sách nhóm, trần mỗi mã và lô chẵn. Ngân sách này trả cả phí mua, nên kế hoạch dùng hết nó vẫn để nguyên phần dự trữ.
- Đề xuất lấy trần chặt nhất trong các trần của chính nó và co nó theo cái chặt nhất trong mức tin cậy, ý định của trader và trạng thái thị trường (không bao giờ là tích của chúng).

Nên một mã mà kế hoạch liệt kê có thể là mã mà đề xuất từ chối hôm đó. Kế hoạch nói vậy ở chỗ nó liệt kê một lệnh mua. Nó không chạy tranh luận, nên không tốn lời gọi mô hình nào.

Một khoảng cách mà kế hoạch không khép được trong một lô thì được nói thẳng, thay vì để trông như đang khép dần, nhưng chỉ khi bạn còn hành động được với nó. Khi khoảng cách nhỏ hơn mức câu chữ in ra được, mã đó coi như đã ở mục tiêu. Một ghi chú nói nó lệch `0%` sẽ đọc như kế hoạch đang tự cãi chính mình.

Có một kết luận mà kế hoạch không đi vòng qua. Nếu kết luận đã lưu mới nhất của một mã đang nắm là `reduce` trên bằng chứng, mã đó không nhận lệnh tăng, dù nó nằm dưới mục tiêu bao xa. Kế hoạch nêu tên nó thay vì lặng lẽ bỏ dòng đó đi.

Lệnh giảm bớt mang lý do của chính kế hoạch (`over-target`, `weak-signal`, `over-cap`) không phải kết luận đó. Nó là chính quy tắc của kế hoạch này được lưu ngược vào kho, nên làm theo nó sẽ khiến kế hoạch tự chặn mình. Ngoài ra kế hoạch không đổi gì: phần thiếu chưa lấp của nhóm vẫn để trống và được báo là tiền mặt.

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
  khoản và thanh khoản của mã vẫn giới hạn số giảm bớt được trong ngày. Một mã không có giao dịch nào
  trong cửa sổ đó có thanh khoản bằng 0: nó được tính cỡ về không, còn kế hoạch cho mọi mã khác vẫn chạy tiếp.
- **Lô lẻ.** Mọi lệnh bán đều theo lô chẵn. Một mã yếu được bán hết vẫn có thể còn lại phần lẻ dưới một
  lô (trên sàn VN là 1-99 cổ phiếu). Kế hoạch bán phần chẵn không hiện dòng "nên theo dõi" cho mã đó;
  bạn tự bán phần lẻ trong phiên lô lẻ.

Dòng đó đọc "đang vượt trần mỗi mã trong hồ sơ 10% - giảm bớt cho vừa trần, không phải vì điểm yếu" và
nằm dưới mục làm trước. Nó không bao giờ đóng mã khỏi `/rebalance`.

Mã nằm trong danh sách loại trừ mà bạn vẫn đang nắm cũng được giảm về trần: danh sách đó chặn lệnh mua
mới, còn trần là để giới hạn rủi ro. Muốn giữ một mã tập trung có chủ ý thì nâng trần bằng `/profile`.

Một quỹ ETF không bao giờ bị bán vì điểm yếu. Điểm xấu của một chỉ số là nhận định về cả thị trường, và tỷ trọng của nhóm cùng trạng thái thị trường đã lo phần đó. Nên một ETF đang nắm có điểm dưới ngưỡng giữ vẫn giữ tỷ trọng. Luật lệch tỷ trọng vẫn có thể cắt bớt nó, và trần vẫn có thể giảm bớt nó.

Lõi ETF của nhóm ở lại với quỹ bạn đang nắm cho tới khi một quỹ khác cao điểm hơn 0,15. Các quỹ theo những chỉ số trùng nhau đi gần như cùng nhau, nên chênh lệch nhỏ không đáng trả phí và thuế cho một vòng mua bán.

Không nêu mã thì `/rebalance` định cỡ các khoản nắm của bạn cộng danh sách theo dõi đã lưu. Nêu mã thì định cỡ đúng những mã đó.

Mỗi dòng lệnh nêu số tiền theo tiền tệ gốc của cuốn sổ, và giá theo tiền tệ báo giá của chính thị trường (thứ mà sàn nhận). Nên thị trường tính theo bảng điện in điểm không kèm tiền tệ, còn coin in tiền tệ của nó. Mức giá dùng đúng số chữ số thập phân mà đồng tiền đó có: VND, JPY và KRW không có đơn vị nhỏ hơn, nên giá bằng đồng in thành số nguyên.

```bash
openalpha chat --message "/portfolio"
openalpha chat --message "/rebalance"
openalpha chat --message "/rebalance FPT MWG"
openalpha chat --message "Show my valued portfolio and its risk findings."
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
- Lệnh mua vào một nhóm bạn đã tắt (cả hai trần của nó đều bằng 0) cũng là vượt trần: `/trade` hiện ra và
  `order_place` từ chối. Nhóm mà hồ sơ chưa ghi trần nào thì không phải là nhóm đã tắt.

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

Tiền tố `sàn:` là tùy chọn và chỉ cần khi có hơn một sàn có thể trả lời. Định tuyến chọn đúng một sàn khớp được lệnh, thu hẹp lệnh bán về các sàn thật sự đang nắm một phần bán được, và từ chối mọi trường hợp khác kèm các ứng viên được nêu tên. Nó không bao giờ chọn hộ bạn, vì một lệnh tiền thật không được phụ thuộc vào một mặc định mà không ai đọc lại. Một lệnh bán bị từ chối khi vượt phần đã chốt và chưa được bảo vệ ở sàn đã định tuyến:

- vượt phần đã chốt: `order.sell_unsettled`;
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

- **Đã tắt mua từ ...** - chỉ có sau `/trade halt`, và đứng đầu vì nó đổi nghĩa mọi dòng khác.
- **Đang chờ bạn xác nhận** - mọi lệnh đã dàn dựng còn trong cửa sổ năm phút, mỗi lệnh kèm token đặt nó.
- **Lệnh thoát đang chờ trên sàn** - những gì đang đứng ở một sàn, kèm trigger của chúng.
- **Chưa có gì bảo vệ** - các vị thế ở một sàn bạn đặt lệnh được, có lối thoát bên dưới ít hơn cuốn sổ nói bạn đang nắm, mỗi cái nêu lệnh để chữa.
- **Đã đặt trên sàn, chưa có trong sổ** - danh sách đối soát, kèm cách chữa.

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
- [ ] **Xác nhận trong năm phút**, cùng chat, cùng người dùng - nó đặt, thay vì lặng lẽ không làm gì.
- [ ] **Cỡ theo đơn vị gốc** - một lệnh thị trường mua `0.001 BTC` khớp khoảng 0,001 BTC. Đọc biên nhận, không đọc yêu cầu.
- [ ] **Treo và hủy** - một lệnh limit xa thị trường thì treo, rồi bị hủy ở trần số lần hỏi (khoảng 20s).
- [ ] **Khớp một phần** - một lệnh gần thị trường mà khớp nửa thì tiếp tục hỏi chứ không ghi nửa đó.
- [ ] **Vòng đi-về của lối thoát** - biên nhận hiện cả hai chân, một OCO sống ở OKX. Đẩy giá demo qua chốt lời và nhịp đối soát kế tiếp (khoảng 60s) ghi lối thoát. **Chạy hai lần: một dòng sổ, không phải hai.**
- [ ] **Lối thoát trên một vị thế đang nắm** - có vị thế mở và không lối thoát nào đang treo, `/trade exit <mã> sl <giá>` đặt một chân OCO ở OKX và biên nhận nêu khối lượng được phủ.
- [ ] **Dời một lối thoát** - chạy lại với một `sl` khác: OKX báo cùng algo order id với trigger mới, không phải một algo order thứ hai. Đường này được dựng từ danh sách tham số OKX công bố, nên hãy kiểm ở đây trước khi tin nó.
- [ ] **Một lần chỉnh bị từ chối giữ lối thoát cũ** - gửi một `sl` mà sàn bác (trên giá cuối): lần chỉnh hỏng và lối thoát gốc vẫn sống ở OKX.
- [ ] **Từ chối do dạng chân** - có một lối thoát chỉ cắt lỗ đang treo, `/trade exit <mã> tp <giá> sl <giá>` từ chối và nêu lệnh hủy, để nguyên cắt lỗ.
- [ ] **Co lại sau một lệnh bán tay** - `/record sell` một phần vị thế, rồi `/trade exit`: cỡ lối thoát đang treo giảm xuống bằng cái cuốn sổ giờ đang nắm.
- [ ] **Phủ một phần** - `/trade exit <mã> qty <một nửa> sl <giá>`: biên nhận nêu phần để lại chưa được bảo vệ, và `/trade` trần liệt kê vị thế đó dưới *Chưa có gì bảo vệ*.
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
- [ ] **Một kế hoạch không phải bảo vệ** - có cắt lỗ của một đề xuất trên một khoản nắm và không lối thoát nào treo, `/portfolio` đọc `... cách cắt lỗ ... · chưa đặt lệnh cắt lỗ`. Đặt một cái bằng `/trade exit` và dòng bổ nghĩa biến mất.
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
