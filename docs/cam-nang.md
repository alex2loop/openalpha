# Cẩm nang sử dụng

> Viết cho nhà đầu tư bình thường, không cần biết lập trình. Đọc từ trên xuống là dùng được.
>
> **Đã cài xong?** Nhảy tới [mục 5](#5-nhịp-vận-hành-theo-kiểu-nhà-đầu-tư).
> **Chưa cài?** Bắt đầu ở [mục 2](#2-cài-đặt-và-thiết-lập-lần-đầu).
> **Muốn hiểu hệ thống nghĩ thế nào?** [Mục 6](#6-cơ-chế-bên-dưới).
> **Cần chi tiết hơn?** [Giao dịch](giao-dich.md), [Nguồn dữ liệu](nguon-du-lieu.md).

---

## 0. Bảng tra nhanh

**Hai kiểu lệnh, đừng nhầm:**

| Gõ ở đâu | Trông như thế nào | Dùng để |
|---|---|---|
| Terminal | `openalpha status` | cài đặt, cấu hình, vận hành máy |
| Trong chat (`openalpha chat`) | `/portfolio` | mọi việc liên quan tới đầu tư |

Chat chạy được cả qua Telegram/Zalo: khai kênh trong `config.toml` ([Kênh](kenh.md)), rồi ghép nối
bằng `openalpha pair`.

**Mỗi ngày - 2 tới 5 phút:**

```bash
> /brief                 # bản tin sáng (cổ phiếu VN)
> /overview              # phông rủi ro chung và mọi thị trường - miễn phí
> /screen                # top mã theo mô hình yếu tố - miễn phí
> /market                # giá mã đang nắm và mã đang theo dõi - miễn phí
> /suggest FPT           # CHỈ khi có mã đáng chú ý - lệnh này tốn tiền LLM
```

**Mỗi tháng hoặc mỗi quý:**

```bash
> /rebalance             # nên mua thêm, bán bớt hay giữ nguyên - miễn phí
> /reflect               # các gợi ý cũ đúng được bao nhiêu - miễn phí
openalpha cost           # đã tốn bao nhiêu tiền LLM
openalpha db backup      # sao lưu sổ
```

**Khi có việc phát sinh:**

```bash
> /record deposit vps 50000000 VND 2026-08-19
> /record buy vps equity-vn:FPT 100 62000 VND 9300 2026-08-19
> /watchlist add HPG MWG
> /alert create FPT above 100000
```

**Ba quy tắc vàng:**

1. Xem bảng **miễn phí** trước (`/overview`, `/screen`, `/market`, `/portfolio`, `/rebalance`), chỉ
   soi sâu bằng `/suggest` cho mã thật sự đáng chú ý.
2. Lệnh nào khớp thật ngoài sàn cũng phải `/record` lại - trợ lý chỉ tư vấn đúng khi biết bạn đang
   nắm gì.
3. Trợ lý **chỉ đặt lệnh khi bạn gõ `/trade` và xác nhận**. Mọi thứ khác chỉ là gợi ý.

---

## 1. OpenAlpha là gì

OpenAlpha là trợ lý phân tích giao dịch chạy trên máy bạn: đọc dữ liệu thị trường, tính toán, cho
hai phe tranh luận thuận - nghịch, rồi **gợi ý kèm lý do**. Bấm nút mua bán luôn là việc của bạn.

Ba nguyên tắc:

1. **Chỉ một đường đặt lệnh, do bạn mở.** `/trade` là lối duy nhất ra sàn: có duyệt, có hạn mức,
   mọi lệnh khớp đều vào sổ. Chưa khai khóa OKX/Binance thì `/trade` không có mặt. `/record` chỉ ghi
   sổ riêng của bạn, không chạm sàn. Xem [mục 4.2](#42-trade---đường-duy-nhất-ra-sàn).
2. **Trợ lý gợi ý, bạn quyết định.** Mỗi đề xuất kèm lý do, mức tin cậy và lưu ý.
3. **Số liệu do công thức tính, LLM chỉ diễn giải.** Điểm yếu tố, giá vào, cắt lỗ, chốt lời, tỷ
   trọng: cùng đầu vào luôn cho cùng đầu ra. LLM không được bịa giá hay chỉ số, và vai rủi ro chỉ
   được **hạ** mức tin cậy, không bao giờ nâng.

### Sáu từ cần hiểu trước

| Từ | Nghĩa |
|---|---|
| **Hồ sơ** (profile) | Khẩu vị rủi ro của bạn: mức rủi ro, kỳ hạn, mục tiêu, các trần an toàn. Khai một lần. |
| **Danh sách theo dõi** (watchlist) | Mã bạn đang cân nhắc mua, dù chưa nắm. Nuôi `/market`, `/rebalance` và bản tin sáng. |
| **Sổ lệnh** (ledger) | Các bút toán đã ghi (nạp tiền, mua, bán, cổ tức...). Sửa hay xóa từng bút toán bằng `/update`, `/delete`. Vị thế hiện tại được **tính lại** từ sổ mỗi lần cần. |
| **NAV** | Giá trị ròng của danh mục, gồm cả tiền mặt. Mọi trần tỷ trọng tính theo % NAV. |
| **Điểm yếu tố** (factor score) | Điểm tổng hợp từ nhiều chỉ báo của chính thị trường đó, thang -1 tới +1. Càng dương càng hấp dẫn. |
| **Chế độ rủi ro** (regime) | Phông nền vĩ mô: `risk-on`, `neutral` hay `risk-off`. Chỉ dùng để **co** cỡ vị thế, không bao giờ phóng to. |

---

## 2. Cài đặt và thiết lập lần đầu

### 2.1 Cài đặt

```bash
curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh   # cài, rồi tự chạy onboard
# Windows: mở PowerShell rồi chạy
#   powershell -c "irm https://raw.githubusercontent.com/alex2loop/openalpha/main/install.ps1 | iex"

export ANTHROPIC_API_KEY="sk-ant-..."   # key của nhà cung cấp LLM bạn chọn

openalpha onboard      # thiết lập lần đầu, hoặc chạy lại để đổi mô hình, bot Telegram, mức chi, ngôn ngữ
openalpha doctor       # kiểm tra nhanh, không cần mạng
openalpha status       # tổng quan: daemon, kênh, phiên chat gần đây, chi tiêu hôm nay
```

Key đọc từ biến môi trường, mặc định **không** nằm trong file cấu hình, để bạn không vô tình commit
secret lên git. Xem hoặc sửa cấu hình: `openalpha config show`, `openalpha config edit`.

### 2.2 Khai hồ sơ đầu tư

Hồ sơ cho trợ lý biết khẩu vị của bạn để cân tiền và lọc gợi ý. Khai một lần là xong.

```bash
openalpha chat
> /profile show
> /profile set risk-level balanced
> /profile set horizon equity-vn short
> /profile set goal grow
```

`<nhóm>` là `equity-vn`, `crypto` hoặc `gold-vn`. Các trường `...-pct-nav` và `regime-scale` nhận
phân số 0 tới 1 (`0.2` là 20%).

| Trường | Giá trị | Ý nghĩa |
|---|---|---|
| `risk-level` | `conservative` / `balanced` / `aggressive` | mức rủi ro tổng thể (đặt riêng, không đi cùng hai trường dưới trong một lần ghi) |
| `risk-capacity` | như trên | khả năng chịu rủi ro (tài chính) |
| `risk-willingness` | như trên | mức sẵn sàng chịu rủi ro (tâm lý) |
| `horizon <nhóm>` | `short` / `long` | kỳ hạn nắm giữ của từng nhóm |
| `goal` | `preserve` / `income` / `grow` | giữ vốn / lấy dòng tiền / tăng trưởng |
| `maximum-sector-pct-nav` | phân số NAV | trần cho một ngành |
| `maximum-open-risk-pct-nav` | phân số NAV | trần tổng rủi ro đang mở |
| `reserve-pct-nav` | phân số NAV | phần tiền mặt luôn giữ lại |
| `regime-scale` | phân số | mức phản ứng với chế độ rủi ro vĩ mô |
| `risk-per-trade-pct-nav` | phân số NAV | rủi ro tối đa cho một lệnh |
| `segment-target <nhóm> <tỷ lệ>` | phân số NAV | tỷ trọng mục tiêu của một nhóm (các nhóm còn lại nhường phần chênh nên tổng vẫn 100%) |
| `segment-cap <nhóm> <tỷ lệ>` | phân số NAV | mức tối đa một nhóm được chiếm |
| `position-cap <nhóm> <tỷ lệ>` | phân số NAV | mức tối đa cho một mã trong nhóm |
| `preferred-locale` | `vi` / `en` | ngôn ngữ trả lời |

Bật hoặc tắt cả nhóm: `/profile enable <nhóm>` / `/profile disable <nhóm>`. Nhóm đang tắt thì không
mã nào trong đó được tính khối lượng hay mua vào. **Hồ sơ mới chỉ bật sẵn `crypto` và `equity-vn`**;
muốn mua `gold` hay `gold-vn` phải bật trước. Về mặc định: `/profile reset`.

**Chưa biết bắt đầu từ đâu?** Gõ `/setup`: trợ lý chào một dòng, hỏi khẩu vị rủi ro nếu bạn chưa
khai, và đề nghị một phân bổ khởi điểm.

### 2.3 Danh sách theo dõi và tỷ trọng mục tiêu

```bash
> /watchlist                    # xem
> /watchlist add FPT HPG BTC    # thêm (nhiều mã một lần)
> /watchlist remove ROS         # bỏ
```

Tỷ trọng mục tiêu đặt từng nhóm một: `/profile set segment-target equity-vn 0.5`. **Danh sách loại
trừ thì chỉ nói bằng lời** - cứ nói chuyện bình thường trong chat:

```text
"đặt mục tiêu: cổ phiếu VN 50%, crypto 20%, vàng 10%, tiền mặt 20%"
"loại ROS khỏi mọi gợi ý"
```

### 2.4 Ghi sổ danh mục

Ghi lại những gì bạn đang nắm để trợ lý tư vấn sát thực tế. Đây thuần là sổ sách, không lệnh nào
chạm sàn. Cú pháp cố định theo vị trí, ngày dạng `YYYY-MM-DD`:

```text
/record deposit|withdrawal|fee|loss <sàn> <số tiền> <tiền tệ> <ngày>
/record transfer <sàn nguồn> <sàn đích> <số tiền> <tiền tệ> <phí> <ngày>
/record buy|sell <nơi giữ> <thị trường:mã> <khối lượng|all> <giá> <tiền tệ> [phí] <ngày>
/record rights <nơi giữ> <thị trường:mã> <khối lượng> <giá> <tiền tệ> <phí> <ngày>
/record dividend <nơi giữ> <thị trường:mã> <số tiền> <tiền tệ> <ngày>
/record split|distribution <nơi giữ> <thị trường:mã> <thay đổi khối lượng> <ngày>
/record sync <sàn>                      # lấy thẳng các lệnh sàn đã khớp mà sổ chưa có
/record confirm                         # ghi dòng ngoại tệ đang chờ, theo tỷ giá thị trường đã xem

# Dòng bằng USDT: thêm fx <giá bạn trả> hoặc fx auto ở cuối
/record deposit binance 1000 USDT 2026-08-14 fx 26600

/update <mã bút toán> <các trường như /record>
/delete <mã bút toán>
```

`<sàn>` là nơi giữ tiền hay tài sản: `vps` cho chứng khoán VN, `okx` hoặc `binance` cho crypto,
`gold-shop` cho vàng trong nước. Dùng công ty chứng khoán khác (SSI, TCBS, VNDIRECT...) thì khai nó
trong `[trading.venues.<tên>]` ([Cấu hình](cau-hinh.md#trading)) rồi ghi `<tên>` ở đây. **Mỗi dòng
đều phải ghi sàn**, kể cả nạp và rút tiền: cùng một đồng coin ở hai nơi giữ là hai vị thế với hai
giá vốn khác nhau.

```bash
> /record deposit vps 100000000 VND 2026-08-14                    # nạp 100 triệu vào VPS
> /record buy vps equity-vn:FPT 100 62000 VND 9300 2026-08-14     # mua 100 FPT giá 62.000, phí 9.300
> /record buy vps equity-vn:FPT 100 62000 VND 2026-08-14          # bỏ trống phí - sổ tính theo biểu phí
> /record buy okx crypto:BTC 0.05 63000 USDT 2026-08-10           # sổ hỏi OKX xem lệnh khớp thế nào
> /record sell vps equity-vn:FPT 50 98000 VND 9800 2026-08-16
> /record sell okx crypto:BNB all 779.9 USDT 2026-09-06           # bán hết - sổ tự lấy số lượng còn lại
> /record dividend vps equity-vn:FPT 500000 VND 2026-08-12
```

**Sàn crypto trừ phí bằng chính đồng bạn mua.** Đặt 3 DASH thì OKX chỉ cộng 2,997; phần thiếu là
phí. Sổ cộng thẳng khối lượng vào vị thế nên số ghi phải là số sàn **thật sự cộng vào**. Phí 0,08%
hay 0,1% tùy kiểu khớp, chỉ sàn biết, nên sổ **hỏi thẳng sàn**:

- Đã khai khóa API cho sàn đó: sổ tra các lệnh khớp trong ngày, cùng chiều, cùng mã. Có **đúng
  một** lệnh lệch không quá 1% so với số bạn gõ thì sổ lấy khối lượng, giá và phí của sàn.
- Không tra được: sổ giữ số bạn gõ - hãy ghi **đúng số sàn hiển thị**, không ghi số đã đặt, kẻo
  danh mục báo nhiều hơn số bạn có.
- Phí bạn tự gõ thì sổ không đè. Dòng xác nhận luôn nói con số đến từ sàn hay từ bạn.
- Lệnh bán không gặp chuyện này: phí đã trừ vào tiền về.

Bốn điều cần nhớ:

- **Phí bỏ trống được** với `buy` và `sell`: sổ tính theo `fees` của `[trading.venues.<sàn>]`. Dòng
  xác nhận cho biết mức đã dùng, và lệch bao nhiêu nếu phí bạn gõ lệch xa. `rights` luôn phải ghi
  phí vì quyền mua không tính theo biểu phí môi giới thường.
- `<thị trường>` là mã của hệ thống: `equity-vn`, `gold`, `gold-vn`, `crypto`
  ([mục 3](#3-các-thị-trường)), không phải tên sàn như HOSE.
- Ngày là **ngày giao dịch thật**, nên ghi bù lệnh cũ vẫn đúng: sổ tự sắp lại theo ngày. Lệnh mua
  cổ phiếu VN tự đóng dấu thanh toán T+2.
- Ghi nhầm? `/transactions` nhóm bút toán theo ngày và in mã ngắn cuối mỗi dòng, ví dụ `0f9838`. Sửa
  bằng `/update 0f9838 <các trường như /record>` (phải ghi rõ khối lượng và phí, không dùng `all`
  hay bỏ trống phí), xóa bằng `/delete 0f9838`. Nói bằng lời cũng được. Sổ không lưu dấu vết chỉnh
  sửa, và sửa một bút toán sẽ tính lại cả những khuyến nghị cũ.

#### Crypto qua P2P: từng bước cho người mới

Tiền đi một vòng: VND, mua USDT qua P2P, nạp USDT vào sàn, mua coin, bán coin ra USDT, rút USDT, bán
lấy VND. Mỗi lần tiền qua sàn thì ghi một dòng. Điều cần nhớ: **giá bạn trả cho USDT ghi ở dòng nạp**,
các lệnh mua bán sau đó sổ tự tính theo giá ấy.

1. **Nạp USDT, kèm giá bạn đã trả.** Mua 1.000 USDT qua P2P giá 26.600 trong khi tỷ giá thị trường
   hôm đó là 26.036: phần chênh là tiền thật bạn đã bỏ ra, nên ghi đúng giá bạn trả.
2. **Mua coin bằng USDT, không cần `fx`.** Lệnh trả bằng số USDT vừa nạp theo giá vốn ấy. Ghi `fx` ở
   đây thì sổ từ chối và nhắc bạn bỏ đi. Mã coin luôn có `crypto:` phía trước, phí bỏ trống được.
3. **Bán coin.** Tiền bán về lại số USDT ở sàn; `all` là bán hết.
4. **Rút USDT, kèm giá bạn bán ra.** Phần chênh giữa giá mua và giá bán USDT thành lãi hoặc lỗ đã chốt.
5. **Xem lại** bằng `/portfolio` (số USDT, giá vốn, giá trị hôm nay), `/transactions`, và `/reconcile`
   nếu đã khai khóa API của sàn.

```bash
> /record deposit binance 1000 USDT 2026-08-14 fx 26600
> /record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14
> /record sell binance crypto:BTC all 65000 USDT 2026-09-01
> /record withdrawal binance 500 USDT 2026-09-20 fx 26900
```

Không thêm `fx` thì trợ lý chưa ghi vội. Nó cho bạn xem tỷ giá thị trường của ngày đó và tiền mặt sẽ
thay đổi bao nhiêu, rồi chờ: gõ `/record confirm` nếu thấy giá đó đúng, hoặc gõ lại lệnh kèm `fx`.
Lệnh chờ 10 phút, mỗi cuộc trò chuyện giữ một lệnh. Muốn dùng thẳng tỷ giá thị trường mà không bị hỏi
thì thêm `fx auto`. `/record sync` không bao giờ hỏi, nhưng nói rõ dòng nào đã ghi theo giá thị trường
để bạn sửa bằng `/update <mã> ... fx <giá>`.

Từ khi sàn giữ USDT, nó giữ luôn cả giá vốn. Nạp 1.000 USDT ở 26.600 thì sổ ghi 1.000 USDT với giá vốn 26,6 triệu. Mua 0,01 BTC giá 60.000 (phí 0,6) dùng hết 600,6 USDT, tức 15.975.960 đồng giá vốn, và còn lại 399,4 USDT. Sau này rút 399,4 USDT lúc tỷ giá 27.000 thì lãi đã chốt thêm đúng phần chênh +159.760 đồng, tức khoảng 400 đồng cho mỗi USDT. `/portfolio` cho thấy phần chênh đó ngay từ lúc còn giữ USDT, ở dòng "Chênh tỷ giá trên ngoại tệ đang giữ".

**Sàn đã có sẵn USDT hoặc coin khi bắt đầu dùng sổ.** Ghi số dư hiện tại, ngày hôm nay, không cần
ghi lại lịch sử:

- **Chỉ có USDT:** một dòng nạp đúng số USDT đang có, kèm `fx <giá vốn bình quân>`, hoặc `fx auto` nếu
  không nhớ (lãi lỗ tỷ giá trước ngày này khi đó không được tính).
- **Có cả coin:** nạp USDT bằng số đang có cộng với số đã bỏ ra mua coin, rồi ghi mỗi coin một lệnh mua
  theo khối lượng hiện có, giá vốn bình quân và phí `0`. Số USDT trong sổ sau đó về đúng số trên sàn.
  Dòng phí `0` có kèm câu "Phí lệch" - với số dư ban đầu thì bỏ qua.

```bash
> /record deposit okx 1300 USDT 2026-10-16 fx auto        # 1.000 USDT đang có + 300 đã bỏ vào BTC
> /record buy okx crypto:BTC 0.005 60000 USDT 0 2026-10-16
```

`/record sync` chỉ lấy lệnh khớp từ dòng đầu tiên của sổ trở đi, nên không tự ghi được số coin mua
trước đó. Đã khai khóa API thì chạy `/reconcile` để so sổ với số dư thật.

Mấy điều hay làm người mới bối rối:

- **Vừa nạp đã thấy lỗ nhẹ tỷ giá.** P2P thường đắt hơn giá thị trường 0,5-3%, mà sổ tính USDT theo
  giá thị trường. Phần chênh là chi phí thật bạn đã trả.
- **Báo "không đủ USDT".** Chưa ghi khoản nạp USDT, hoặc ngày nạp muộn hơn ngày mua. Câu báo nêu số
  USDT sàn có vào ngày đó; ghi khoản nạp trước.
- **Trước giờ ghi nạp VND vào sàn.** Sổ vẫn đúng, nhưng tiền ở sàn nằm dưới dạng VND nên không theo
  tỷ giá và `/reconcile` chưa so được. Muốn chuyển sang USDT: ghi một dòng rút hết số VND đang ở sàn,
  rồi một dòng nạp đúng số USDT đang có kèm `fx`, cả hai ngày hôm nay. Các dòng cũ giữ nguyên.

Biểu phí khai trong `config.toml` **theo từng sàn**, dạng phân số (`0.0015` là 0,15%):

```toml
[trading.venues.vps]
fees = { buy = 0.0015, sell = 0.0015, sell_tax = 0.001 }

[trading.venues.okx]
fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }
```

Đó là mặc định (`binance` giống `okx`, `gold-shop` không tính phí). Hãy sửa theo bậc phí thật của
tài khoản bạn. Con số này còn dùng cho dòng chi phí trên mỗi khuyến nghị và mức phí ước tính khi đặt
lệnh.

Xem lại bất cứ lúc nào: `/portfolio` (giá trị và phân bổ) và `/transactions` (thêm số dòng, khoảng
ngày như `30d` hay `2026-09-01..2026-09-25`, hoặc mã bút toán để xem tiếp từ đó trở về trước).

### 2.5 Các bảng miễn phí - không tốn tiền LLM

| Lệnh | Cho bạn thấy |
|---|---|
| `/price <mã>` | Giá mới nhất kèm đơn vị và ngày số liệu |
| `/market` | Giá mã đang nắm và mã theo dõi, bên cạnh phiên gần nhất đã chốt |
| `/screen [thị trường] [số lượng] [loại]` | Top mã theo mô hình yếu tố (mặc định 10, tối đa 50); thứ tự tham số tùy ý |
| `/overview` | Mọi thị trường đang ra sao, kèm khối vĩ mô và các yếu tố dẫn dắt |
| `/portfolio` | Giá trị, lãi/lỗ chưa thực hiện, tỷ trọng theo nhóm |
| `/portfolio nav [1m\|3m\|6m\|1y\|all]` | Danh mục đã đi thế nào: lợi nhuận đã loại tiền nạp và rút, mức sụt sâu nhất từ đỉnh, thước đo từ tỷ trọng mục tiêu |
| `/transactions` | Bút toán gần nhất |
| `/rebalance` | Nên mua thêm, bán bớt hay giữ nguyên ngay bây giờ |
| `/reflect` | Các gợi ý cũ đúng được bao nhiêu |
| `/alert list` | Cảnh báo giá đang bật |
| `/watchlist` | Danh sách theo dõi |

Ba lệnh tốn tiền LLM đáng kể: **`/suggest`**, **`/research`**, **`/themes`** (riêng `/themes show`
miễn phí). `/setup` chỉ chạy một lượt chào ngắn; `/brief` tốn một phần nhỏ cho mục gợi ý cuối bản
tin.

---

## 3. Các thị trường

| Thị trường | Khu vực | Loại tài sản | Tiền tệ | Ghi chú |
|---|---|---|---|---|
| `equity-vn` | `vn` | cổ phiếu VN | VND | sâu nhất: có sàng lọc, dòng tiền ngoại, basis phái sinh, bản tin sáng |
| `crypto` | `global` | tiền mã hóa | USD | không bao giờ đóng cửa; có sàng lọc, funding, tâm lý |
| `gold` | `global` | vàng thế giới (XAU) | USD | chỉ để tham chiếu: hỏi giá và làm mốc cho `gold-vn`; không sàn nào giữ nên nhóm này luôn tắt |
| `gold-vn` | `vn` | vàng miếng/nhẫn (SJC, PNJ, DOJI) | VND | định giá chênh lệch so với `gold`; tắt sẵn trong hồ sơ mới |

Mã tự định tuyến: `/price FPT` biết là cổ phiếu VN, `/price BTC` là crypto. Chỉ khi một mã tồn tại ở
nhiều thị trường mới phải ghi `thị-trường:mã` (`/price equity-vn:UNI`).

**Cổ phiếu và ETF Mỹ nằm ngoài phạm vi.** `/suggest NVDA` trả lời "mã chưa được hỗ trợ" thay vì đoán
bừa.

Nguồn dữ liệu từng thị trường: [Nguồn dữ liệu](nguon-du-lieu.md).

---

## 4. Bản đồ lệnh

### 4.1 Lệnh giao dịch (gõ trong chat)

| Lệnh | Cú pháp | Tốn LLM? |
|---|---|---|
| `/setup` | `/setup` | có (một lượt chào ngắn) |
| `/price` | `/price <mã>`, hoặc `thị-trường:mã` khi tên trần có thể trùng | không |
| `/market` | `/market` \| `enable` \| `disable` | không |
| `/watchlist` | `/watchlist` \| `add <mã>...` \| `remove <mã>...` - `remove` với tên trần xóa mã đó ở mọi thị trường | không |
| `/screen` | `/screen [thị trường] [số lượng] [loại]` | không |
| `/overview` | `/overview [thị trường]...` | không |
| `/portfolio` | `/portfolio` \| `nav [1m\|3m\|6m\|1y\|all]` | không |
| `/transactions` | `/transactions [số dòng] [khoảng ngày] [mã bút toán]` | không |
| `/record` | xem [mục 2.4](#24-ghi-sổ-danh-mục) | không |
| `/profile` | `/profile show` \| `set <trường> <giá trị>` \| `reset` | không |
| `/rebalance` | `/rebalance` \| `/rebalance <mã>...` | không |
| `/reflect` | `/reflect` | không |
| `/alert` | `/alert list [n]` \| `create <mã> above\|below <ngưỡng>` \| `disable <id>` | không |
| `/brief` | `/brief` \| `force` \| `enable [HH:mm]` \| `disable` | một phần nhỏ cho mục gợi ý |
| `/refresh` | `/refresh [thị trường] [force]` | không |
| `/suggest` | `/suggest <mã> [full\|lean] [force]` - tùy chọn theo thứ tự tùy ý sau mã; `/suggest stops` đọc lại các vị thế đang giữ chưa có kế hoạch thoát hoặc đã quá hạn cửa sổ | **có** - chạy cả quy trình tranh luận |
| `/sources` | `/sources` - nhà cung cấp dữ liệu nào đang phản hồi | không |
| `/reconcile` | `/reconcile` - đối chiếu sổ với số dư thực tế trên từng sàn | không |
| `/themes` | `/themes` \| `run <id>` \| `show` \| `approve <id>` \| `reject <id>` \| `retire <id>` | **có** với `/themes` (tối đa $1 mỗi phiên theo mặc định) và `run <id>` (một chủ đề nên rẻ hơn); `show` và lệnh duyệt thì không |
| `/trade` | xem [mục 4.2](#42-trade---đường-duy-nhất-ra-sàn) | không |

Viết `thị-trường:mã` ở bất kỳ lệnh nào khi tên trần có thể trùng giữa hai thị trường.

**`/suggest`:**

- Hỏi lại một mã đã có kết luận trong ngày thì **dùng lại miễn phí** (crypto: mọi kết luận trong 4
  giờ gần nhất). Kết luận làm lúc phiên còn chạy sẽ được chạy lại khi đã có giá đóng cửa của phiên đó.
- Mã vừa được đề xuất gần đây thì báo **đang chờ** kèm ngày được hỏi lại - chỉ khi bạn đặt
  `cooldown_sessions` trong `[trading.suggestions]`; mặc định 0 (không chờ).
- `force` bỏ qua cả hai và thay kết luận cũ, ở độ sâu `full` trừ khi bạn gõ rõ `lean`.
- `lean` là bản rút gọn, rẻ hơn nhiều. Mã bạn đang nắm đúng tỷ trọng thì mặc định `lean`, vì tranh
  luận không đổi được kết luận "giữ nguyên" đó.

**`/rebalance`:** không nhập mã thì dùng danh mục đang nắm cộng danh sách theo dõi. Nhập mã thì các
mã đó thay danh sách theo dõi trong lần chạy ấy và không được lưu. **Danh mục đang nắm luôn được
xét**, vì bỏ sót một mã đang nắm thì lời khuyên về cả cuốn sổ sẽ sai.

### 4.2 `/trade` - đường duy nhất ra sàn

Chỉ có khi bạn đã khai khóa OKX hoặc Binance.

```text
/trade                                   # đang treo những gì - không chạm tới sàn
/trade spot <[sàn:]mã> buy|sell <khối lượng> [limit <giá>] [tp <giá>] [sl <giá>]
/trade exit <[sàn:]mã> [qty <khối lượng>] [tp <giá>] [sl <giá>]
/trade confirm [token]
/trade cancel <[sàn:]mã>
/trade reconcile [token]
/trade halt | resume
```

Lệnh mua mặc định phải có `sl`; đặt `require_stop_loss = false` trong `[trading.orders]` nếu muốn mua
không kèm cắt lỗ.

- `spot` **chỉ dựng lệnh và in token**. Không gì ra sàn cho tới khi bạn gõ `/trade confirm`.
- `exit` đặt hoặc dời chốt lời/cắt lỗ cho vị thế đang giữ. Mặc định lấy khối lượng từ sổ; thêm `qty`
  để chỉ bảo vệ một phần. Không cần token vì lệnh này không bao giờ gỡ bớt lớp bảo vệ đang có.
- `/trade` gõ một mình cho bạn xem: lệnh chờ xác nhận, lệnh thoát đang treo trên sàn, vị thế chưa có gì bảo
  vệ, và lệnh sàn đã khớp mà sổ chưa có.

**Hai điều riêng của Binance:**

- Lệnh thoát đã đặt **không dời được**. Muốn đổi mức, hủy bằng `/trade cancel binance:BTC` rồi đặt
  lại bằng `/trade exit`. Giữa hai bước vị thế không có lệnh bảo vệ, nên làm liền tay.
- `/record sync binance` soát lịch sử theo từng mã (mã có trong sổ và mã đang giữ), nên một lệnh mua
  rồi bán hết trên mã chưa từng ghi sổ sẽ không hiện ra.

**`/trade halt` là công tắc khẩn cấp.** Sau khi tắt, không lệnh mua nào đi ra - kể cả lệnh đã dựng
trước mà bạn xác nhận sau - cho tới khi gõ `/trade resume`; trạng thái này giữ qua khởi động lại.
Bán, `/trade exit` và `/trade cancel` vẫn chạy, và không lệnh cắt lỗ nào đang chờ trên sàn bị hủy.
Muốn chặn hẳn từ phía sàn, tắt **Enable Spot & Margin Trading** của API key trong API Management của
Binance (OKX: bỏ quyền Trade của key) - cách này chặn cả lệnh bán.

### 4.3 Lệnh hệ thống (cũng gõ trong chat)

| Lệnh | Dùng để |
|---|---|
| `/help` | Liệt kê mọi lệnh đang có |
| `/cost` | Chi tiêu LLM hôm nay, cùng số token và chi phí của phiên chat này |
| `/config` | Xem ngôn ngữ, mô hình, ngân sách, kênh đang chạy |
| `/model` | Xem hoặc đổi mô hình |
| `/memory` | Xem, tìm, ghi, xóa ghi nhớ |
| `/research` | `/research [quick\|standard\|thorough] <câu hỏi>` - nghiên cứu có trích nguồn (**tốn LLM**) |
| `/new` | Bắt đầu phiên chat mới (lịch sử phiên trước vẫn được giữ) |
| `/continue` | Chạy tiếp một lượt bị dừng giữa chừng |
| `/schedule` | Xem và điều khiển các việc chạy tự động |
| `/health` | Trạng thái hệ thống |
| `/agent` | Xem hoặc đổi agent đang dùng |

### 4.4 Lệnh terminal hay dùng

```bash
openalpha chat                 # mở phiên chat
openalpha start|stop|restart   # daemon (bản tin, cảnh báo, tự nạp dữ liệu); start chạy ngay tại cửa sổ này, thêm --background để chạy nền
openalpha status               # tổng quan
openalpha cost                 # chi phí LLM
openalpha config show|edit|validate
openalpha provider list        # kiểm tra key và nhà cung cấp
openalpha db backup|export|import|cleanup|stats
openalpha logs                 # xem log khi có lỗi
openalpha schedule             # lịch chạy tự động (cron 5 trường)
openalpha pair                 # ghép nối Telegram/Zalo
```

### 4.5 Không nhớ lệnh? Cứ nói chuyện bình thường

Trợ lý đọc được dữ liệu (giá, nến, tổng quan thị trường, sự kiện, tin tức, tâm lý, funding, dòng tiền
ngoại, basis, sức mạnh ngành) và làm được việc danh mục (xem, soát, tái cân bằng, ghi sổ, sửa hoặc
hủy bút toán, hồ sơ, danh sách theo dõi). Những câu này đều hợp lệ:

```text
"so HPG với HSG rồi cho tôi một đề xuất"
"danh mục của tôi đang lệch chỗ nào?"
"tháng vừa rồi các gợi ý đúng được bao nhiêu?"
"tin gì đáng chú ý với FPT tuần này?"
```

---

## 5. Nhịp vận hành theo kiểu nhà đầu tư

Hệ thống cố tình chỉ có **một** lượt nặng mỗi ngày: bản tin trước giờ mở cửa. Không có lượt sau giờ
đóng cửa, để tránh nhiễu và tránh kích thích giao dịch quá tay. Chọn đúng một mục theo kiểu của bạn.

### 5.1 Chỉ chơi cổ phiếu VN

**Thiết lập một lần:**

```bash
openalpha start --background         # bật daemon để bản tin và cảnh báo tự chạy
> /brief enable 08:15                # tự gửi bản tin mỗi sáng
> /watchlist add FPT HPG MWG VNM
```

**Mỗi sáng - khoảng 3 phút, gần như miễn phí:**

| Thứ tự | Lệnh | Bạn đang tìm gì |
|---|---|---|
| 1 | `/brief` | Bản tin sáng, từ "việc của tôi" tới "việc của thị trường". Xem [6.5](#65-brief---bản-tin-sáng) |
| 2 | `/overview` | Phông rủi ro: `risk-on` thì mạnh tay hơn, `risk-off` thì co lại |
| 3 | `/screen` | Top 10 mã theo mô hình yếu tố VN |
| 4 | `/market` | Giá mã bạn đang nắm và đang theo dõi |
| 5 | `/suggest <mã>` | **Chỉ khi** bước 1-4 cho thấy một mã đáng chú ý. Đây là lệnh tốn tiền |

Daemon không chạy và dữ liệu có vẻ cũ thì gõ `/refresh` trước bước 1 để nạp phần còn thiếu của phiên
gần nhất. Nó chỉ nạp các thị trường bạn còn dùng: nhóm đang bật trong hồ sơ, hoặc nơi bạn còn giữ
mã, theo dõi mã hay chờ chấm điểm gợi ý cũ. `/refresh crypto` nạp riêng thị trường đó, kể cả khi đã
tắt; `/refresh force` nạp lại toàn bộ, chỉ dùng khi nghi dữ liệu sai.

**Trong phiên:**

- Đặt lệnh thật bằng app công ty chứng khoán (hoặc `/trade` nếu đã khai khóa sàn).
- Khớp xong, ghi ngay: `/record buy vps equity-vn:FPT 100 62000 VND 9300 2026-08-19`.
- Muốn được nhắc khi giá chạm mốc: `/alert create FPT above 100000`. Daemon kiểm tra mỗi phút.

**Sau giờ đóng cửa: không làm gì.** Đây là chủ ý, không phải thiếu tính năng.

**Riêng cổ phiếu VN:** mua hôm nay thì T+2 mới về tài khoản; hệ thống tự đóng dấu thanh toán và
`/portfolio` phản ánh đúng. Điều kiện để có bản tin sáng ở [6.5](#65-brief---bản-tin-sáng).

#### Đọc hai loại thang trong bảng

**Thang `├──●──┤`** (ở `/overview` và `/portfolio`): đầu trái luôn là phía bất lợi, đầu phải là phía
thuận lợi, `●` là giá trị hôm nay.

- `/overview`: điểm vĩ mô nằm giữa hai vạch `┼` là trung lập; chỉ số dẫn dắt nằm càng sát trái thì
  càng kéo điểm xuống.
- `/portfolio`: vị thế có kế hoạch thì `●` là giá hiện tại, nằm giữa mức cắt lỗ (trái) và chốt lời
  (phải); `●` lọt hẳn ra ngoài khung nghĩa là giá đã vượt một trong hai mức.

**Thanh `████▌░░○░░`** (trên điện thoại, ở `/portfolio` và `/rebalance`): mỗi nhóm một thanh trên
thang 0-100% tổng tài sản. `█` là phần đang nắm, `○` là trần của nhóm (`/portfolio`) hoặc mục tiêu
(`/rebalance`); dòng chú thích dưới bảng luôn ghi rõ `○` là gì.

### 5.2 Chỉ chơi crypto

Crypto không có giờ đóng cửa, nên hãy chọn **một giờ cố định trong ngày** làm "phiên" của bạn. Giữ
đúng một giờ quan trọng hơn việc chọn giờ nào.

**Thiết lập một lần:**

```bash
openalpha start --background
> /watchlist add BTC ETH SOL
> /profile set risk-level balanced
```

Thêm một dòng vào cấu hình (`openalpha config edit`) để `/screen` mặc định về khu vực toàn cầu, hoặc
cứ gõ `/screen crypto` mỗi lần:

```toml
[locale]
region = "global"
```

**Mỗi ngày, đúng giờ bạn chọn - khoảng 3 phút, gần như miễn phí:**

| Thứ tự | Lệnh | Bạn đang tìm gì |
|---|---|---|
| 1 | `/overview` | Chế độ rủi ro toàn cầu (lãi suất thực, lợi suất Mỹ, chỉ số USD, lạm phát, VIX) |
| 2 | `/screen crypto` | Top 10 coin theo mô hình yếu tố - đã tự loại stablecoin, coin gương, cổ phiếu mã hóa, coin vốn hóa dưới 250 triệu USD hoặc khối lượng ngày dưới 10 triệu USD |
| 3 | `/market` | Giá các coin bạn đang nắm và đang theo dõi |
| 4 | `/suggest BTC` | **Chỉ khi** có coin đáng chú ý. Lệnh tốn tiền |

**Ba điểm khác cổ phiếu VN:**

| | Cổ phiếu VN | Crypto |
|---|---|---|
| Bản tin sáng `/brief` | có | **không có** - dùng `/overview` + `/screen crypto` |
| `/refresh` | nạp dữ liệu VN | nạp bảng xếp hạng vốn hóa và nến crypto; daemon cũng tự nạp mỗi khi nến ngày UTC đóng |
| Thanh toán | T+2 | tức thì, `/record` ngay ngày khớp |

Muốn vẫn có bản tin sáng? Để khu vực nhà là `vn` rồi thêm coin vào danh sách theo dõi: bản tin có
các mục **quét chéo theo danh sách theo dõi** cho vàng và crypto, nhưng phần lớn vẫn nói về cổ phiếu
VN.

### 5.3 Vừa cổ phiếu vừa crypto

Chạy nhịp [5.1](#51-chỉ-chơi-cổ-phiếu-vn), thêm hai điều:

- Để cả mã cổ phiếu lẫn coin vào **cùng một** danh sách theo dõi - bản tin sáng và `/rebalance` tự
  lo phần còn lại.
- Đặt tỷ trọng mục tiêu theo nhóm bằng lời một lần. Từ đó `/rebalance` biết bạn đang lệch nhóm nào.

Một lần `/rebalance` xét mọi thị trường cùng lúc, không cần chạy riêng từng loại tài sản.

### 5.4 Việc theo tháng và theo quý

| Việc | Lệnh | Vì sao |
|---|---|---|
| Cân lại danh mục | `> /rebalance` | Sau một quãng giá trôi, tỷ trọng lệch mục tiêu. Chỉ đề xuất khi lệch đủ lớn - tháng êm có khi chẳng cần lệnh nào |
| Soi thành tích gợi ý | `> /reflect` | Tỷ lệ thắng, so với chỉ số chuẩn, độ chuẩn xác theo mức tin cậy. Dữ liệu này cũng quay lại hiệu chỉnh các đề xuất sau ([6.7](#67-reflect---vòng-học)) |
| Soi chủ đề đầu tư | `> /themes` | Chủ đề vĩ mô đổi chậm, một hai lần mỗi tháng là đủ ([6.8](#68-themes---chủ-đề-đầu-tư)) |
| Kiểm chi phí | `openalpha cost --period month --breakdown` | Tháng vừa rồi tốn bao nhiêu, cho trợ lý và model nào |
| Sao lưu sổ | `openalpha db backup` | Sổ lệnh là thứ duy nhất không tái tạo được từ mạng |
| Xuất sổ ra tệp | `openalpha db export --out ./export` | Một tệp cho mỗi bảng; mặc định chỉ lấy phần không nạp lại được từ mạng ([Lưu trữ](luu-tru.md)). Thêm `--format csv` để mở bằng Excel (csv chỉ để đọc) |
| Nạp sổ trở lại | `openalpha db import --in ./export` | Cách giữ sổ khi phải `db reset`: `db backup` khôi phục cả schema cũ, còn export/import chỉ chuyển dữ liệu |
| Rà lại hồ sơ | `> /profile show` | Khẩu vị rủi ro có còn đúng với hoàn cảnh hiện tại không |
| Dọn dữ liệu (mỗi quý) | `openalpha db cleanup --older-than 90d` | Xóa phiên chat và bộ nhớ cũ để giải phóng đĩa. Dừng daemon trước; thêm `--dry-run` để xem trước |

**Không cần nhớ việc soi thành tích.** Nếu đang bật bản tin sáng, mỗi tháng dương lịch bản tin tự
chèn một **bảng điểm tháng** đúng một lần ([6.6](#66-bảng-điểm-tháng)). Coi đó là lời nhắc gõ
`/reflect`.

### 5.5 Bốn thói quen giữ chi phí thấp

1. **Bảng miễn phí trước, `/suggest` sau.** Các bước đầu của nhịp sáng không tốn đồng LLM nào.
2. **`/suggest <mã> lean`** khi chỉ cần một góc nhìn nhanh: một vai phân tích thay vì cả phiên tranh
   luận.
3. **Hỏi lại cùng mã trong ngày không tốn thêm** - hệ thống trả lại bản đã có.
4. **Đặt trần ngân sách** trong `openalpha config edit` nếu muốn chắc không vượt mức (mặc định không
   giới hạn).

---

## 6. Cơ chế bên dưới

Phần này cho ai muốn hiểu vì sao con số ra như vậy. Bỏ qua vẫn dùng bình thường.

### 6.1 `/screen` - "top mã" nghĩa là gì

Mỗi thị trường có đúng một mô hình yếu tố. Sàng lọc có hai bước: **cổng loại**, rồi **xếp hạng**.

- **Cổng loại chạy trước**, kiểm tra rẻ và cơ bản nhất đi đầu. Mã bị loại chỉ ghi đúng một lý do:
  thiếu lịch sử, thanh khoản dưới sàn, trạng thái giao dịch bất thường, kịch trần, biến động quá
  trần, dao động nhiễu. Riêng crypto loại sẵn stablecoin, coin gương, cổ phiếu mã hóa, coin vốn hóa
  dưới 250 triệu USD hoặc khối lượng ngày dưới 10 triệu USD **trước khi** tốn lệnh gọi dữ liệu nào.
- **Mã qua cổng xếp theo điểm tổng hợp** của chính thị trường đó; bằng điểm thì cổ phiếu VN xếp theo
  giá trị giao dịch rồi tới chữ cái, crypto xếp theo chữ cái, để mỗi lần chạy ra cùng một kết quả.

**Không có bảng trọng số thứ hai.** Điểm `/screen` xếp hạng chính là điểm quy trình đề xuất dùng, nên
"đứng đầu bảng" và "đủ mạnh để gợi ý" không mâu thuẫn. Top mã chỉ để tham khảo; không gì tự chạy theo
nó.

Chỉ `equity-vn` và `crypto` có sàng lọc. Với `gold` và `gold-vn`, hỏi giá trực tiếp (`/price XAUUSD`,
`/price SJC`) hoặc `/suggest` theo mã.

### 6.2 Chế độ rủi ro vĩ mô

Mỗi nhóm tài sản có chế độ riêng, chấm từ những yếu tố hợp với thị trường đó. Mỗi yếu tố quy về
thang [-1, 1] theo dải định sẵn, rồi cộng có trọng số (chia cho tổng trọng số của các yếu tố đã có
dữ liệu):

| Chế độ của | Các yếu tố và trọng số |
|---|---|
| Toàn cầu (cũng là phông của `gold` và `gold-vn`) | lãi suất thực Mỹ 0.35, lợi suất Mỹ 10 năm 0.25, chỉ số USD 0.20, lạm phát Mỹ 0.20, VIX 0.15 |
| `equity-vn` | xu hướng VN-Index 0.30, độ rộng thị trường 0.20, lãi suất tiền gửi 12 tháng 0.20, lãi suất thực Mỹ 0.10, chỉ số USD 0.10, VIX 0.10 |
| `crypto` | xu hướng Bitcoin 0.5, độ rộng altcoin 0.3, ETH so với BTC 0.2 |

Từ 0.25 trở lên là `risk-on`, từ -0.25 trở xuống là `risk-off`, còn lại `neutral`. Riêng
`equity-vn`, đã ở `risk-on` hay `risk-off` thì giữ nguyên cho tới khi điểm lùi sâu thêm 0.1 qua
ngưỡng, để điểm lởn vởn quanh vạch không làm chế độ đổi hằng ngày.

**Thiếu dữ liệu không phải trung tính.** Các yếu tố đã có dữ liệu chiếm dưới 60% tổng trọng số thì
chế độ là `risk-off`: một nguồn sập không được mở đường giải ngân tối đa.

`equity-vn` có thêm lớp phủ chỉ được **hạ** chế độ, không bao giờ nâng: mỗi tín hiệu căng thẳng (áp
lực margin, khối ngoại bán ròng, đồng mất giá) và thiên hướng tin chính sách tăng lãi suất hạ thêm
một bậc. Tin chính sách đếm theo **bản tin gốc**, không theo số trang báo: cần ít nhất hai bản tin
khác nhau và nhiều hơn số tin giảm lãi suất; một bản tin hãng thông tấn đăng lại ở năm nơi vẫn là
một.

Chế độ được dùng ở bốn chỗ: `/overview`, bản tin sáng, bộ bằng chứng các vai tranh luận đọc, và thang
co cỡ vị thế (`risk-on` 1, `neutral` 0.85, `risk-off` 0.6 - chỉ co, không bao giờ phóng to quá trần
của chính bạn).

### 6.3 `/rebalance` - một lần tính, hai câu trả lời

`/rebalance` chạy đúng **một** lượt tư vấn bằng công thức, không dùng LLM, và trả về cùng lúc: danh
mục *nên* đứng ở đâu (theo nhóm) và hôm nay *đổi* gì (theo từng mã).

1. **Chụp một lần**: sổ được tính thành vị thế, định giá và đọc cùng lúc với hồ sơ, để phát hiện và
   lời khuyên dựa trên cùng một cuốn sổ.
2. **Ứng viên** = mã đang nắm cộng danh sách theo dõi, trừ danh sách loại trừ.
3. **Cổng sẵn sàng**: chưa định giá đủ, NAV bằng 0, hoặc có mã nắm giữ không định cỡ được thì trả lời
   "chưa thể tư vấn" kèm lý do, không in con số sai.
4. **Chia tỷ trọng**: mục tiêu của từng nhóm chia **tỷ lệ thuận với điểm yếu tố dương trên mỗi
   đơn vị biến động hằng ngày** (mã dao động mạnh thì nhận ít hơn), giới hạn bởi trần chặt nhất
   trong các trần: trần vị thế của hồ sơ, trần của chính mã, phần còn lại của trần ngành trên toàn
   danh mục, trần thanh khoản và, với quỹ ETF, trần ETF của nhóm. Phần tràn từ mã chạm trần chia lại cho mã còn chỗ;
   phần **không ai hấp thụ được thì ở lại tiền mặt** kèm lưu ý - không bao giờ nhồi quá trần.
5. **Chỉ đề xuất khi lệch đủ lớn** (biên 5/25): lấy **ngưỡng chặt hơn** trong hai ngưỡng - 5 điểm
   phần trăm NAV, hoặc 25% mục tiêu của nhóm đó. Hai ngưỡng cắt nhau ở mục tiêu 20%.
6. **Kèm theo**: dòng tiền mặt (phần dự trữ giữ thanh khoản, phần dư đủ điều kiện gửi kỳ hạn) và cờ
   mã-nắm-giữ-yếu (điểm của chính thị trường từ -0.3 trở xuống).

Lệnh không nhận tham số tỷ trọng là chủ ý: mục tiêu nằm trong hồ sơ, chỉ ở một nơi.

### 6.4 `/suggest` - quy trình đề xuất theo giai đoạn

Đường đi cố định: **nhận diện -> kiểm trùng và thời gian chờ -> đọc danh mục -> yếu tố -> các cổng
chặn -> tranh luận -> cổng giao dịch và rủi ro -> chốt -> lưu**. Giai đoạn nào chặn thì kết quả là
"giữ nguyên" kèm mã lý do. Mức tin cậy chỉ hạ, không bao giờ nâng.

1. **Phần cứng (công thức tính)**: điểm yếu tố, mức vào, cắt lỗ, chốt lời. Các vai LLM tranh luận
   *quanh* nó, không sửa được số.
2. **Cổng chặn chạy trước tranh luận** - cổng chi phí: ứng viên đằng nào cũng hỏng thì dừng, không
   tốn lệnh gọi LLM nào.
3. **Tranh luận** (chế độ `full`): phe bò và phe gấu chạy song song, gom bằng chứng ngược chiều (mỗi
   dẫn chứng kèm nguồn); vai quản lý danh mục chọn luận điểm từ cả hai phía; vai trader đề xuất kế
   hoạch vào lệnh; vai rủi ro được quyền chặn hoặc **hạ** mức tin cậy; vai đối chiếu kiểm từng khẳng
   định với bằng chứng. Chế độ `lean` chạy một vai phân tích rồi đối chiếu.
4. **Ngân sách theo vai**: mỗi vai một phần, cắt từ 80% ngân sách còn lại của lần chạy. Cạn ngân sách
   thì kết quả đổ về "giữ nguyên", không báo lỗi giữa chừng.
5. **Định cỡ**: theo rủi ro mỗi lệnh trong hồ sơ, kẹp bởi trần vị thế, tiền mặt khả dụng, lô giao
   dịch và thang chế độ vĩ mô (chỉ co).
6. **Lưu**: đề xuất lưu kèm phiên bản chiến lược và phiên bản công thức.

Một lần chạy kết thúc theo một trong bốn cách: có đề xuất; mã chưa được hỗ trợ (không thị trường nào
nhận mã đó, hoặc hai thị trường cùng nhận và bạn phải chỉ rõ); mã đang trong thời gian chờ; hoặc lỗi
lúc lưu - chạy lại an toàn, không tạo bản trùng.

**"Giữ nguyên" là một câu trả lời thật**, kèm các mã lý do - không phải đề xuất thất bại.

**Cổ phiếu VN có bảng "Nhìn nhanh".** Thay bảng điểm từng yếu tố, đề xuất chia các yếu tố thành ba
nhóm: điểm cộng, điểm trừ và thông tin thêm (tăng trưởng, cùng các yếu tố có điểm gần 0). Trong mỗi
nhóm, yếu tố mạnh nhất đứng đầu. Mỗi dòng có vạch điểm (`▲` cộng, `▼` trừ, càng nhiều vạch càng rõ)
cùng vài con số chính như P/E, P/B, ROE, nợ xấu. Không có ngưỡng cứng kiểu "ROE > 15%": điểm đã so
với chính ngành của mã.

**Bản in nói luôn phí.** Dưới dòng quy mô lệnh có một dòng dạng *"Phí trọn vòng mua-bán khoảng 141 VND
(0,4% giá trị lệnh); giá phải lên 35,46 mới hòa vốn"*, tỷ lệ lấy từ `fees` của sàn mặc định. Với mã
đang nắm, mốc dời cắt lỗ về hòa vốn và lợi nhuận cạnh mỗi mục tiêu đã trừ phí của chính lần bán đó,
nên con số trên bảng là con số bạn thật sự cầm được. Thị trường chưa khai biểu phí thì không in dòng
phí.

### 6.5 `/brief` - bản tin sáng

Bản tin là lượt nặng duy nhất trong ngày. Nó gom mọi thứ cần biết trước giờ mở cửa vào **một** tin
nhắn.

```bash
> /brief enable 08:15    # bật giao tự động mỗi ngày giao dịch (bỏ giờ thì theo cấu hình)
> /brief                 # xem bản mới nhất; chưa có thì tự dựng ngay
> /brief disable         # tắt giao tự động (vẫn xem thủ công được)
```

Một ngày một bản cho mỗi ngôn ngữ. Gõ `/brief` lần hai trong ngày trả lại đúng bản đã dựng,
**không tốn thêm đồng nào**.

#### Bản tin gồm những gì

Các mục luôn theo thứ tự này: từ "việc của tôi" ra "việc của thị trường" rồi quay lại "hôm nay nên
làm gì".

| Nhóm | Các mục | Trả lời câu hỏi |
|---|---|---|
| **Việc của bạn** | đã đổi so với phiên trước, **tổng quan danh mục**, đề xuất đã có kết quả, cảnh báo đã kích hoạt, vị thế chạm mức thoát, vị thế chưa có kế hoạch thoát, vị thế quá hạn mà giá chưa đi đâu, vị thế đang lỗ, nhịp liên thị trường, ai đang chủ động giao dịch, độ lệch danh mục, **bảng điểm tháng** | Từ lần xem trước tới giờ, có gì liên quan trực tiếp tới tiền của tôi? |
| **Bối cảnh vĩ mô** | chuyển trạng thái thị trường, trạng thái vĩ mô, dự phòng tiền mặt (lãi suất tiền gửi), tin vĩ mô, kinh tế thế giới | Nền chung đang thuận hay nghịch? |
| **Từng thị trường** | đọc nhanh, giá, bảng giá, thanh khoản, độ rộng, vùng giá, quy mô thị trường, luân chuyển ngành, dòng tiền khối ngoại, dòng tiền tự doanh, phái sinh, bên mua chủ động, dòng vốn ETF, vị thế đầu cơ (COT), chênh lệch với thế giới, thanh khoản dẫn đầu, biến động mạnh nhất, tâm lý, chênh lệch phái sinh VN30, tỷ giá | Sàn hôm qua ra sao? Vàng và crypto đang ra sao? |
| **Quanh danh sách theo dõi** | mã dẫn đầu danh sách theo dõi, mã bị loại khỏi danh sách theo dõi, thay đổi trên bảng lọc | Các mã tôi đang nhắm thì sao? |
| **Sự kiện và tin** | lịch công bố báo cáo, kỳ cơ cấu chỉ số sắp tới, sự kiện doanh nghiệp, tin nổi bật | Có gì sắp hoặc vừa xảy ra? |
| **Chi phí và việc cần làm** | chi phí nghiên cứu, đề xuất cho mã đang giữ và theo dõi, đề xuất liên thị trường, **việc tiếp theo**, kỷ luật đang áp dụng | Bản tin này tốn bao nhiêu, và giờ tôi nên bấm gì? |

Nhóm **từng thị trường** dùng chung một khuôn, và mỗi thị trường chỉ đăng mục nó có dữ liệu. Nhờ vậy
một con số không bị báo hai lần dưới hai tiêu đề: mức chênh vàng trong nước thuộc khối `gold-vn`, vị
thế phái sinh thuộc khối `gold`.

Các mục **đề xuất** chạy **sau cùng** vì đắt nhất, và dùng lát ngân sách riêng: cạn ngân sách chỉ mất
các mục đó, không mất cả bản tin. Mục **việc tiếp theo** chạy cuối vì đọc kết quả thật của các mục
trước: chỉ nhắc `/rebalance` khi thật sự lệch tỷ trọng, chỉ nhắc xem gợi ý khi có gợi ý, chỉ nhắc xem
cảnh báo khi có cảnh báo nổ.

#### Một mục vắng mặt không có nghĩa là hỏng

| Trường hợp | Nghĩa là | Bạn nên |
|---|---|---|
| Có nội dung | Có dữ liệu để nói | Đọc |
| Bị bỏ qua theo quy tắc | Chạy tốt nhưng không có gì để nói (không cảnh báo nào nổ, chế độ rủi ro không đổi, không mã nào lệch biên) | Bỏ qua - đây là tin tốt |
| Không lấy được dữ liệu | Nguồn không trả lời | Để ý; lặp lại nhiều ngày thì xem `openalpha logs` |

Một mục hỏng **không bao giờ** làm mất các mục còn lại: bản tin thà thiếu một mục còn hơn không giao.

#### Vài giới hạn

- "Từ lần xem trước" tính từ **lúc dựng bản tin trước**. Bản tin đầu tiên thì mốc lùi về 7 ngày
  trước, không liệt kê toàn bộ lịch sử.
- Mỗi mục in tối đa **5 dòng**.
- Danh sách theo dõi bị cắt ở **20 mã cổ phiếu VN và 20 mã tài sản chéo**: để 60 mã thì chỉ 20 mã đầu
  mỗi nhóm vào bản tin.
- Bản tin chỉ có ở `equity-vn`, và chỉ chạy khi khu vực nhà trong cấu hình là `vn`.
- Cần daemon đang chạy (`openalpha start`) mới tự giao đúng giờ. Không có daemon vẫn gõ `/brief` thủ
  công được.

### 6.6 Bảng điểm tháng

Đây là một **mục trong bản tin sáng**, không phải lệnh riêng. Mỗi tháng dương lịch nó xuất hiện đúng
một lần, in: bao nhiêu đề xuất đã chốt kết quả, bao nhiêu vẫn đang mở, và tỷ lệ thắng. Nó để bạn nhìn
lại thành tích thật ít nhất mỗi tháng một lần, kể cả khi bạn không tự gõ `/reflect`.

- **Đếm theo lần giao, không theo bản tin.** Bản tin đầu tháng chưa có đề xuất nào chốt thì mục này
  bị bỏ qua và sẽ hiện ở một bản tin muộn hơn trong tháng - không mất tháng đó.
- **In rồi là xong tháng.** Các bản tin sau trong tháng không lặp lại.
- **Cùng nguồn số liệu với `/reflect`, in ít hơn.** Cả hai đọc cùng một bản báo cáo thành tích (tối
  đa 100 kết quả đã chốt gần nhất) với cùng bộ lưu ý. Bảng điểm tháng rút còn **một dòng**: số kết
  quả đã chốt, số đề xuất **đang mở**, và **tỷ lệ thắng** - số đã chốt đứng cạnh số chưa chốt thì tỷ
  lệ mới đọc đúng.

Ngắn gọn: bảng điểm tháng là lời nhắc tự động, `/reflect` là bản đầy đủ.

### 6.7 `/reflect` - vòng học

`/reflect` trả lời câu hỏi khó chịu nhưng cần thiết: **các gợi ý cũ có đúng không?**

Chỉ đề xuất **có hành động** (mua hoặc giảm) và **đã chốt kết quả** được tính. Kết quả "giữ nguyên"
không bao giờ vào bảng thành tích - hệ thống chặn cứng, không dựa vào quy ước.

#### Một đề xuất chốt kết quả như thế nào

Tác vụ nền chạy mười hai tiếng một lần, đối chiếu từng đề xuất chưa chốt với giá thật:

- **Cửa sổ theo thời hạn của chính lệnh**: khoảng 28 ngày lịch với lệnh ngắn hạn, 91 ngày với lệnh
  dài hạn, quy ra số phiên theo lịch giao dịch của từng thị trường. Bắt đầu từ phiên **sau** phiên
  ra đề xuất.
- Trong mỗi phiên, **cắt lỗ được kiểm trước chốt lời**. Một cây nến ngày không cho biết đỉnh hay đáy
  đến trước, nên hệ thống chọn cách đọc bất lợi hơn - không tô hồng thành tích.
- Ba kết cục: **chạm mục tiêu**, **chạm cắt lỗ**, hoặc **hết hạn** (thoát ở giá đóng cửa phiên cuối).
  Nguồn có lỗ hổng và không bao giờ đủ nến thì một mốc theo số phiên đã trôi qua vẫn cho đề xuất hết
  hạn - dòng đó không chờ mãi.
- Đề xuất **giảm tỷ trọng** tính ngược dấu: giảm đúng lúc để tránh một nhịp rơi là một lần **thắng**.
- **Chỉ số chuẩn** neo **bên trong** khoảng nắm giữ: mở ở phiên đầu tiên từ ngày đề xuất, đóng ở phiên
  cuối cùng tính tới ngày thoát. Chỉ khi không phiên nào lọt vào khoảng đó mới báo "không có so
  sánh".

#### `/reflect` in ra gì

| Dòng | Nội dung |
|---|---|
| Tổng số đề xuất | Đã đưa ra bao nhiêu, bao nhiêu đã có kết quả, bao nhiêu **vẫn đang mở** - và bao nhiêu nằm ở thị trường không có chuỗi giá nên không bao giờ được chấm. Đây là mẫu số của mọi con số bên dưới |
| Tổng quan | Lợi nhuận trung bình và trung vị mỗi lệnh, tỷ lệ đạt mục tiêu, so với chỉ số chuẩn |
| Thắng / thua | Đếm đầu: bao nhiêu lần dương, bao nhiêu lần âm |
| Theo mức tin cậy | Tỷ lệ thắng và lợi nhuận trung bình của từng nhóm `thấp` / `trung bình` / `cao` |
| Cảnh báo lệch chuẩn | Hiện khi nhóm "tin cậy cao" **không** thắng nhiều hơn nhóm "trung bình" - tức mức tin cậy đang không mang thông tin |
| 5 kết quả gần nhất | Từng mã kèm kết cục và lợi nhuận |
| Lưu ý | Mẫu quá nhỏ, hoặc trộn nhiều phiên bản chiến lược |

`/reflect` in cả **số đếm thắng/thua** lẫn tỷ lệ đạt mục tiêu chung ("đạt mục tiêu X số lần");
bảng điểm tháng ([6.6](#66-bảng-điểm-tháng)) chỉ rút lại thành một dòng.

#### Hai lưu ý quan trọng nhất

- **Dưới 20 kết quả đã chốt thì tỷ lệ theo mức tin cậy bị giấu.** Nhóm nào chưa đủ 20 mẫu riêng thì không
  hiện dòng nào - thà không nói còn hơn in con số tính từ bốn lệnh. Tổng thể vẫn có số, kèm lưu ý "mẫu
  còn nhỏ" khi cả tập chưa tới 20 kết quả.
- **Trộn phiên bản thì được cảnh báo.** `lean` và `full` tốn tiền khác nhau và cho kết quả khác nhau;
  chế độ phản biện là một trong các phiên bản công thức được ghi lại, nên hai tập kết quả không bị
  gộp âm thầm.

#### Muốn xem sâu hơn

`/reflect` còn in trung vị lợi nhuận, đóng góp lũy kế vào NAV, mức sụt giảm sâu nhất của chuỗi đó,
và số đếm theo từng phiên bản chiến lược (khi có từ hai phiên bản). Hỏi bằng lời để lọc theo một
phiên bản hoặc xem báo cáo đầy đủ:

```text
"cho tôi báo cáo thành tích đầy đủ"
"thành tích của các gợi ý ở phiên bản chiến lược hiện tại?"
```

Đóng góp lũy kế chỉ là **xấp xỉ**: nó cộng tuần tự theo thứ tự ra đề xuất, cố tình bỏ qua việc các vị
thế chồng lấn và phần tiền mặt nhàn rỗi. Hệ thống tự ghi lưu ý này - đừng đọc nó như đường vốn thật.

### 6.8 `/themes` - chủ đề đầu tư

`/themes` đọc từ trên xuống: vĩ mô, chính sách, giá hàng hóa và tin tức đang đổi gì, thành chủ đề đầu
tư nào, chủ đề lan tới ngành nào, và doanh nghiệp nào thật sự đổi lợi nhuận vì nó. Chỉ áp dụng cho
cổ phiếu VN.

- **Bạn quyết danh sách.** Lần chạy đầu chỉ đề xuất chủ đề. Mỗi đề xuất phải nêu được ngành nào hưởng
  lợi, nên bạn biết trước duyệt nó dẫn tới đâu; áp lực chi phí hay sức cầu yếu mà không có bên thắng
  rõ ràng thì không được đề xuất. `/themes approve <id>` để theo dõi, `reject <id>` để bỏ, `retire
  <id>` khi không muốn theo nữa. Hệ thống tự chuyển một chủ đề sang "đang yếu đi" hoặc "mất hiệu lực"
  khi bằng chứng đổi, nhưng chỉ bạn mới duyệt hoặc gỡ một chủ đề.
- **Mã do hệ thống chọn, không do mô hình.** Với mỗi ngành hưởng lợi, hệ thống lấy tối đa 5 mã đã qua
  bộ lọc thanh khoản và chất lượng báo cáo của `/screen`, rồi mô hình mới phân tích các mã đó, mỗi
  lần ba mã, không tra cứu thêm: mức gắn với chủ đề, chủ đề có đổi lợi nhuận thật hay chỉ là kỳ vọng,
  giá đã phản ánh chưa. Bản in chỉ nêu kịch bản cơ sở dạng "EPS kịch bản cơ sở tăng X% trong N tháng",
  không kèm xác suất. P/E mục tiêu chỉ bị từ chối khi cao hơn mức cao nhất năm năm của chính mã đó.
- **Điểm 0-100 do hệ thống tính.** Mô hình chấm từng tiêu chí; hệ thống ghép thành điểm theo trọng số
  cố định, kèm **độ tin cậy** (thấp, vừa, cao) cho biết điểm đứng trên bao nhiêu dữ liệu. Chủ đề mới
  đề xuất chỉ được xét trên chính luận điểm của nó, vì ngành và doanh nghiệp chỉ được phân tích sau
  khi bạn duyệt. Phần nào không đọc được thì bỏ khỏi trọng số, không tính là 0. Mỗi điểm hiện thay
  đổi so với phiên trước và thành phần kéo nó nhiều nhất, ví dụ "Điểm 80 (trước đó 82), chủ yếu do
  định giá".
- **Một mã nằm dưới hai chủ đề chỉ hiện một lần**, ở điểm cao nhất, kèm dòng "Cũng nằm trong chủ đề".
- **Điểm có đúng không, hệ thống tự kiểm.** Daemon so mỗi mã với VN-Index sau 3, 6 và 12 tháng. Cuối
  báo cáo, mục "Điểm số các lần trước đúng đến đâu" cho biết nhóm điểm từ 80, 60-80 và dưới 60 đã
  thắng hay thua VN-Index. Nhóm nào chưa đủ 20 nhận định thì chỉ in số đếm. **Trước khi bảng này nói
  được điều gì, đừng coi điểm số là tín hiệu mua.**
- **Không phải gợi ý giao dịch.** `/themes` không đưa giá vào, cắt lỗ hay khối lượng. Muốn soi một mã
  để giao dịch thì dùng `/suggest <mã>`.
- **Soát riêng một chủ đề.** Có tin lớn chạm đúng một chủ đề thì gõ `/themes run <id>`: hệ thống chỉ
  soát lại chủ đề đó cùng ngành và mã của nó, không đụng chủ đề khác, không tìm chủ đề mới, nên rẻ
  hơn hẳn một phiên đầy đủ. `/themes show` hiện mỗi chủ đề theo lần soát gần nhất của nó; chủ đề nào
  được soát từ trước lần chạy gần nhất thì có thêm dòng "Soát lần cuối" ghi rõ ngày.
- **Chi phí.** Mỗi lần chạy có trần riêng (`[trading.themes] max_cost_usd`, mặc định $1). Chủ đề được
  cập nhật, tìm mới, rồi lập danh sách ngành và mã theo thứ tự đó; chạm trần thì dừng giai đoạn đang
  làm và nêu tên những mã bị bỏ qua. `/themes show` đọc lại kết quả đã lưu, không tốn gì. Qua MCP chỉ
  có công cụ đọc `themes_view`.

---

## 7. Xử lý sự cố nhanh

| Triệu chứng | Cách xử lý |
|---|---|
| Không kết nối được mô hình | `openalpha provider list` kiểm tra key; `openalpha doctor`; `openalpha logs` xem chi tiết 401/429 |
| Lệnh dừng vì chạm ngân sách | `openalpha config edit` nâng trần, hoặc chờ chu kỳ mới |
| `/brief` báo chưa có bản tin | Bản tin chỉ có ở `equity-vn`; kiểm tra khu vực nhà trong cấu hình có phải `vn` |
| `/screen gold` báo lỗi | `gold` và `gold-vn` không có sàng lọc - dùng `/price` hoặc `/suggest` theo mã |
| `/screen` báo sai tên thị trường | Dùng đúng mã: `equity-vn`, `gold`, `gold-vn`, `crypto` |
| `/suggest NVDA` báo không hỗ trợ | Cổ phiếu Mỹ nằm ngoài phạm vi - xem [mục 3](#3-các-thị-trường) |
| `/market` không có dòng theo dõi nào | `/watchlist add FPT` rồi thử lại |
| Đặt tỷ trọng mục tiêu không ăn | `/profile set segment-target <nhóm> <tỷ lệ>` (0 tới 1, nhóm đang bật); `/profile show` để xem lại |
| Dữ liệu VN có vẻ cũ | `/refresh equity-vn`, hoặc `/refresh equity-vn force` để nạp lại toàn bộ |
| Không rõ đang tốn bao nhiêu | `/cost` trong chat, hoặc `openalpha cost` |
| Đĩa đầy | Dừng daemon rồi `openalpha db cleanup --older-than 90d` (thêm `--dry-run` để xem trước); xem thêm `openalpha db --help` |
| Quên lệnh | `/help` trong chat, `openalpha --help` ở terminal |

Muốn đọc sâu hơn về dữ liệu, nguồn và luồng xử lý: [Giao dịch](giao-dich.md),
[Nguồn dữ liệu](nguon-du-lieu.md).
