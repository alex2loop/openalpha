# Các lưu ý

🇻🇳 Tiếng Việt &bull; [🇬🇧 English](NOTICE.en.md)

## Code thì MIT. Dữ liệu không phải của chúng tôi để cấp phép.

[LICENSE](LICENSE) chỉ bao phủ phần code trong repo này, không gì khác. OpenAlpha **không
đóng kèm dữ liệu thị trường** nào: nó đọc từ từng nhà cung cấp lúc chạy, trên máy của bạn,
dưới danh tính mạng của bạn, và lưu kết quả vào cơ sở dữ liệu của bạn. Repo này không phát
hành lại giá, nến, số liệu cơ bản, tin tức hay bảng giá vàng của bất kỳ ai.

Điều đó quan trọng, vì dữ liệu thuộc về những người công bố nó, và điều khoản của họ là
chuyện giữa **bạn** và **họ**. Một giấy phép thoáng trên một HTTP client không cho bạn bất
cứ quyền gì đối với dịch vụ mà nó gọi tới.

## Bạn đang đồng ý điều gì khi chạy nó

Trước khi trỏ OpenAlpha vào một nhà cung cấp, nhất là khi dùng cho việc gì ngoài nghiên cứu
cá nhân:

- **Đọc điều khoản của nhà cung cấp đó.** Một số endpoint ở đây là endpoint mà công ty
  chứng khoán hay sàn giao dịch mở ra cho web và app của chính họ, chứ không phải một API
  công khai có tài liệu. Đọc được một endpoint không có nghĩa là bạn được phép đọc nó, và
  không có giới hạn tần suất nào trong code này là một sự cho phép.
- **Phát hành lại là một câu hỏi khác.** Lưu dữ liệu của một nhà cung cấp về máy mình không
  giống việc công bố lại nó, chuyển tiếp cho người dùng của bạn, hay đưa nó vào một dịch vụ
  bạn bán.
- **Khóa là của bạn.** Khi một nhà cung cấp phát khóa, khóa đó phát cho bạn theo điều khoản
  của họ. Dự án này không bao giờ đóng kèm khóa nào và không bao giờ gửi khóa đi đâu khác
  ngoài chính nhà cung cấp đó.
- **Có thể phải ghi nguồn.** Một số nhà cung cấp yêu cầu ghi nguồn rõ ràng khi hiển thị dữ
  liệu của họ. OpenAlpha in mã nguồn dữ liệu trên mọi số đọc được để bạn biết nhà cung cấp
  nào đã trả lời, nhưng việc thỏa mãn điều khoản ghi nguồn là việc của bạn.

Các request đi ra mang theo một user-agent trình duyệt thông dụng theo mặc định
(`BROWSER_HEADERS`), để hệ thống chống bot của nhà cung cấp không nhận diện một client không
khai báo gì cả. Đó là một mặc định để tương thích, không phải một tuyên bố về quyền, và nó
không làm thay đổi điều khoản của ai áp dụng lên bạn.

## Những nhà cung cấp dự án này có thể đọc

34 adapter dưới [`src/trading/sources/adapters/`](src/trading/sources/adapters/), chạm tới
những host dưới đây. Đọc danh sách này không bật cái nào cả: các route của một thị trường
quyết định cái gì được hỏi, và một nhà cung cấp cần khóa mà chưa có khóa thì không được đăng
ký ngay từ đầu.

**Cổ phiếu và chỉ số Việt Nam** - `api-finfo.vndirect.com.vn`, `iq.vietcap.com.vn`,
`trading.vietcap.com.vn`, `services.entrade.com.vn`, `histdatafeed.vps.com.vn`,
`iboard-query.ssi.com.vn`, `kbbuddywts.kbsec.com.vn`, `api.hsx.vn`, `cafef.vn`

**Vĩ mô và vàng Việt Nam** - `sbv.gov.vn`, `www.nso.gov.vn`, `edge-api.pnj.io`, `giavang.now`,
`vang.today`

**Crypto** - `www.okx.com`, `api.binance.com`, `fapi.binance.com`, `api.bybit.com`,
`api.mexc.com`, `api.exchange.coinbase.com`, `api.coingecko.com`, `pro-api.coinmarketcap.com`,
`api.coinlore.net`, `api.coinpaprika.com`, `api.alternative.me`

**Vĩ mô, lãi suất và vị thế phái sinh Mỹ** - `fred.stlouisfed.org`, `api.stlouisfed.org`,
`api.bls.gov`, `home.treasury.gov`, `www.federalreserve.gov`, `publicreporting.cftc.gov`

**Giá, tỷ giá và tin tức** - `query1.finance.yahoo.com`, `open.er-api.com`, `news.google.com`,
`www.cnbc.com`, `www.coindesk.com`, `vnexpress.net`

Endpoint thuộc quyền của code theo thiết kế: không cấu hình nào chuyển hướng được một request
sang host khác. Xem [docs/nguon-du-lieu.md](docs/nguon-du-lieu.md) để biết quy tắc định tuyến
và dự phòng, hoặc [docs/en/data-sources.md](docs/en/data-sources.md) bằng tiếng Anh.

## Nhà cung cấp mô hình

OpenAlpha gọi tới nhà cung cấp mô hình nào bạn cấu hình, bằng khóa của bạn, theo điều khoản
của họ. Không có gì được gửi tới nhà cung cấp mô hình nào theo mặc định, và không bản cài nào
gọi tới một nhà cung cấp trước khi bạn cấu hình. Những gì tới được mô hình bị giới hạn có chủ
ý: prompt không bao giờ mang theo số tiền, chi phí, khối lượng, lợi nhuận đã chốt hay giá khớp
của bạn. Xem [docs/ngan-sach.md](docs/ngan-sach.md).

## Ghi nguồn theo yêu cầu của nhà cung cấp

OpenAlpha không liên kết với, không được bảo trợ hay chứng nhận bởi nhà cung cấp nào kể tên ở
đây, và mọi tên gọi thuộc về chủ sở hữu của nó. Mỗi số liệu ứng dụng in ra đều ghi tên nhà cung
cấp đã trả lời. Nhà cung cấp nào yêu cầu một dòng ghi nguồn thì dòng đó ở đây:

- **FRED** - This product uses the FRED® API but is not endorsed or certified by the Federal
  Reserve Bank of St. Louis. Một số chuỗi trên FRED thuộc bên thứ ba và có điều khoản riêng; đọc
  ghi chú của chuỗi trước khi dùng lại.
- **BLS** - BLS.gov cannot vouch for the data or analyses derived from these data after the data
  have been retrieved from BLS.gov.
- **Cục Dự trữ Liên bang Mỹ** - nguồn: Board of Governors of the Federal Reserve System.
- **CoinGecko** - Powered by CoinGecko (https://www.coingecko.com/en/api).
- **ExchangeRate-API** - Rates By Exchange Rate API (https://www.exchangerate-api.com).
- **alternative.me** - số liệu chỉ số Crypto Fear & Greed từ alternative.me.
- **Cục Thống kê** - nguồn: Trang Thông tin điện tử Cục Thống kê (www.nso.gov.vn).
- **VnExpress** - tiêu đề tin lấy từ kênh RSS của VnExpress, vốn được cung cấp miễn phí cho cá
  nhân và tổ chức phi lợi nhuận.
- **Yahoo** - Yahoo! và Yahoo! Finance là nhãn hiệu của Yahoo, Inc. OpenAlpha không liên kết với
  Yahoo và chỉ đọc endpoint biểu đồ công khai của họ cho nghiên cứu cá nhân.
- **Open-Meteo** - Weather data by [Open-Meteo.com](https://open-meteo.com/), cấp phép CC BY 4.0.
  Trang văn phòng tự hỏi nó thời tiết từ trình duyệt của bạn và chỉ gửi tọa độ thành phố của bạn.

## Tên và logo không đi kèm giấy phép

Giấy phép MIT cấp cho phần code, không cấp cho thương hiệu. Tên "OpenAlpha", logo chữ α trên
nền gradient và nhân vật Bé Alpha là của dự án, và [LICENSE](LICENSE) không cấp quyền dùng
chúng.

- Bạn được fork, sửa và phát hành lại code theo MIT, kể cả để bán.
- Bản fork hay sản phẩm làm từ code này cần dùng tên và logo riêng, để không ai nhầm nó là
  OpenAlpha.
- Viết "dựa trên OpenAlpha" hay "dùng được với OpenAlpha" để nói đúng nguồn gốc thì được.

## Code của bên thứ ba

Các thư viện chạy thật, tất cả đều thoáng: `@modelcontextprotocol/sdk`, `pg`, `pino`,
`turndown`, `zca-js` và `zod` theo MIT, `smol-toml` theo BSD-3-Clause. Thông báo bản quyền
của chính chúng đi kèm chúng trong `node_modules`. `scripts/check-dep-licenses.ts` làm hỏng
bản dựng nếu một giấy phép copyleft lọt vào cây phụ thuộc, để lời hứa MIT trong README còn
đúng với bất cứ ai nhúng runtime này.

`zca-js` là một client Zalo không chính thức. Kênh Zalo Personal là tùy chọn phải tự bật,
không phải một tích hợp chính thức, và việc dùng nó là chuyện giữa bạn và Zalo.

Vài biểu tượng nét trên trang văn phòng được chép tay từ [Lucide](https://lucide.dev), theo giấy
phép ISC:

> ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
> Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
>
> Permission to use, copy, modify, and/or distribute this software for any purpose with or without
> fee is hereby granted, provided that the above copyright notice and this permission notice appear
> in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
> SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
> AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
> NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
> THIS SOFTWARE.

## Dữ liệu bản đồ và ảnh tham khảo

- **Dữ liệu đường phố** - tên phố và bố cục của gói thành phố Việt Nam lấy từ
  © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), theo Giấy phép
  Cơ sở dữ liệu Mở (ODbL).
- **Ảnh tham khảo** - các con phố của văn phòng được vẽ bằng mắt từ ảnh trên Wikimedia Commons,
  trong đó có ảnh tòa nhà Bitexco Financial Tower. OpenAlpha không kèm ảnh nào; đây là lời ghi
  công cho những người đã chụp, kèm trang Commons của từng ảnh:

| Người chụp | Giấy phép | Ảnh |
|---|---|---|
| Adam Jones | CC BY 2.0 | [1](https://commons.wikimedia.org/?curid=134067021) |
| Andy C | CC BY-SA 3.0 | [1](https://commons.wikimedia.org/?curid=8658063) |
| Biodin | CC BY-SA 3.0 | [1](https://commons.wikimedia.org/?curid=28802643) |
| Busition | CC BY 4.0 | [1](https://commons.wikimedia.org/?curid=176158761) |
| CaptJayRuffins | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=73653399) |
| David Ackerman | CC BY 2.0 | [1](https://commons.wikimedia.org/?curid=139613687) |
| David McKelvey | CC BY 2.0 | [1](https://commons.wikimedia.org/?curid=105760704) |
| Diego Delso | CC BY-SA 3.0 | [1](https://commons.wikimedia.org/?curid=30089027) [2](https://commons.wikimedia.org/?curid=30089036) |
| Dietmar Rabich | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=30454359) [2](https://commons.wikimedia.org/?curid=125644831) |
| Duyenphan0298 | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=106354584) |
| Elvert Barnes | CC BY-SA 2.0 | [1](https://commons.wikimedia.org/?curid=20214454) |
| Epicgenius | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=86742880) |
| Gary Todd | CC0 | [1](https://commons.wikimedia.org/?curid=108935342) |
| Gigi alt | CC BY-SA 3.0 | [1](https://commons.wikimedia.org/?curid=21845395) |
| Giorgio Galeotti | CC BY 4.0 | [1](https://commons.wikimedia.org/?curid=50934532) |
| GV | CC BY-SA 3.0 | [1](https://commons.wikimedia.org/?curid=93905450) |
| hijirin | CC BY 3.0 | [1](https://commons.wikimedia.org/?curid=53460841) |
| Hisi21 | CC BY-SA 3.0 | [1](https://commons.wikimedia.org/?curid=31493151) |
| Jean-Etienne Minh-Duy Poirrier | CC BY-SA 2.0 | [1](https://commons.wikimedia.org/?curid=127208456) |
| Jean-Marie Hullot | CC BY 3.0 | [1](https://commons.wikimedia.org/?curid=34592371) |
| Jim.henderson | CC BY 4.0 | [1](https://commons.wikimedia.org/?curid=100093134) |
| Jim.henderson | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=86879200) |
| Jim.henderson | Public domain | [1](https://commons.wikimedia.org/?curid=12475969) |
| Ken Lund | CC BY-SA 2.0 | [1](https://commons.wikimedia.org/?curid=84810017) |
| King of Hearts | CC BY-SA 3.0 | [1](https://commons.wikimedia.org/?curid=21073689) |
| Lu The Vy | CC0 | [1](https://commons.wikimedia.org/?curid=122475757) |
| Marc Mongenet | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=192255173) |
| Martin Furtschegger | CC BY 3.0 | [1](https://commons.wikimedia.org/?curid=54823056) |
| Metropolitan Transportation Authority of the State of New York | CC BY 2.0 | [1](https://commons.wikimedia.org/?curid=33086217) |
| Mkoff | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=48705102) [2](https://commons.wikimedia.org/?curid=200427125) |
| Nick-philly | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=84618900) |
| Phương Huy | CC0 | [1](https://commons.wikimedia.org/?curid=147525102) [2](https://commons.wikimedia.org/?curid=147157032) |
| RG72 | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=98773046) [2](https://commons.wikimedia.org/?curid=98861245) [3](https://commons.wikimedia.org/?curid=98670489) [4](https://commons.wikimedia.org/?curid=98670910) |
| Rudolph.A.Furtado | CC0 | [1](https://commons.wikimedia.org/?curid=30723703) |
| stanislav baranov | CC BY-SA 2.0 | [1](https://commons.wikimedia.org/?curid=139727705) |
| Steffen Schmitz | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=88858180) |
| Syced | CC0 | [1](https://commons.wikimedia.org/?curid=134022463) |
| Timback | CC BY-SA 4.0 | [1](https://commons.wikimedia.org/?curid=86375078) |
| Tri Nguyen | CC BY 2.0 | [1](https://commons.wikimedia.org/?curid=29738457) [2](https://commons.wikimedia.org/?curid=127208419) [3](https://commons.wikimedia.org/?curid=127208428) |
| trungydang | CC BY 3.0 | [1](https://commons.wikimedia.org/?curid=58727100) [2](https://commons.wikimedia.org/?curid=58812039) [3](https://commons.wikimedia.org/?curid=57962449) [4](https://commons.wikimedia.org/?curid=58914895) [5](https://commons.wikimedia.org/?curid=56705865) [6](https://commons.wikimedia.org/?curid=57666463) [7](https://commons.wikimedia.org/?curid=56918694) |
| 源義信 | CC BY 4.0 | [1](https://commons.wikimedia.org/?curid=143674772) |

## Không phải lời khuyên đầu tư

OpenAlpha là trợ lý nghiên cứu và ghi chép. Các đề xuất của nó mang tính tham khảo, có thể
sai, và không phải lời khuyên đầu tư. Nó chỉ đặt lệnh khi bạn chấp thuận. Mọi quyết định là
của bạn.
