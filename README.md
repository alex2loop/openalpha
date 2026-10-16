<h1 align="center">OpenAlpha</h1>
<h3 align="center">Hội đồng AI tranh luận. Nhiều lớp kiểm tra. Không tự đặt một lệnh nào.</h3>

<p align="center">
  <strong>🇻🇳 Tiếng Việt</strong> &bull; <strong><a href="README.en.md">🇬🇧 English</a></strong>
</p>

<p align="center">
  Trợ lý phân tích đầu tư chạy ngay trên máy bạn, mạnh nhất ở <strong>cổ phiếu Việt Nam</strong> nhờ nguồn dữ liệu trong nước, và theo dõi cả <strong>crypto</strong> lẫn vàng.<br/>
  Mỗi sáng trước giờ mở cửa, nó lọc cả thị trường, chọn ra vài mã đáng xem, tính sẵn nên mua bao nhiêu cho vừa danh mục của bạn, và nêu cả lý do nên mua lẫn lý do nên tránh.<br/>
  <strong>Nó dừng ở đó. Đặt lệnh hay không là quyết định của riêng bạn.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/alex2loop/openalpha/check.yml?branch=main&style=flat-square&label=check" alt="check" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <a href="https://zalo.me/g/yl7iqyfovvtyosujulea"><img src="https://img.shields.io/badge/Zalo-nh%C3%B3m%20h%E1%BB%97%20tr%E1%BB%A3-0068FF?style=for-the-badge" alt="Nhóm Zalo hỗ trợ" /></a><br/>
  <sub>Cài chưa được, hay muốn nhận tin bản mới? Hỏi trong <a href="https://zalo.me/g/yl7iqyfovvtyosujulea">nhóm Zalo OpenAlpha</a>, bằng tiếng Việt.</sub>
</p>

<p align="center">
  <img src="assets/readme/hero.vi.png" alt="Đề xuất yếu bị loại trước khi tới tay bạn, qua sáu bước: dữ liệu, bằng chứng, cổng chặn, tranh luận, kiểm tra, kết luận" width="100%" />
</p>

<p align="center">
  <em>AI đọc được mọi thứ về mã bạn hỏi, trừ một thứ: số tiền của bạn.</em>
</p>

---

<p align="center">
  <a href="#chạy-thử-trong-3-lệnh">Chạy thử</a> · <a href="#bắt-đầu">Bắt đầu</a> · <a href="#dùng-mỗi-ngày">Dùng mỗi ngày</a> · <a href="#an-toàn">An toàn</a> · <a href="#câu-hỏi-thường-gặp">Hỏi đáp</a> · <a href="#nâng-cao">Nâng cao</a>
</p>

## Vì sao dùng OpenAlpha

- **Con số do code tính, AI chỉ giải thích.** Giá vào, cắt lỗ, mục tiêu và khối lượng được tính sẵn; AI tranh luận vì sao nên mua và vì sao nên tránh.
- **AI không thấy tiền của bạn.** Khối lượng gợi ý vừa với danh mục của bạn, nhưng mô hình chỉ biết tỷ trọng.
- **Mạnh ở cổ phiếu Việt Nam.** Dữ liệu trong nước, số liệu vĩ mô chính thức kèm câu trích gốc, và luôn tính đến T+2.
- **Không tự đặt lệnh.** Bạn quyết, bạn đặt, rồi ghi sổ. Vài tuần sau, `/reflect` cho biết nó đúng được bao nhiêu.

**Hợp với bạn nếu** bạn tự quản danh mục của mình, muốn thấy lập luận đằng sau mỗi đề xuất thay vì chỉ thấy một mã được phím, và muốn khóa API nằm trên máy mình. **Không hợp nếu** bạn tìm một con bot tự chạy lệnh, hoặc muốn có ai đó quyết định thay bạn. Cả hai đều không có ở đây, và đó là chủ ý.

## Chạy thử trong 3 lệnh

```bash
curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh   # cài đặt
export OPENROUTER_API_KEY="..."   # khóa AI, lấy ở openrouter.ai
openalpha chat                    # rồi gõ /refresh, nạp xong thì gõ /suggest FPT
```

<p align="center">
  <img src="assets/readme/demo.vi.gif" alt="Gõ /suggest và nhận về kế hoạch: giá vào, cắt lỗ, chốt lời, khối lượng, cách quản lý vị thế" width="100%" />
</p>

Windows, công ty chứng khoán khác VPS, crypto, vàng và bản tin sáng: xem [Bắt đầu](#bắt-đầu).

## Khác gì hỏi một chatbot AI

| | Chatbot thông thường | OpenAlpha |
|---|---|---|
| Số liệu Việt Nam | có thể tự đoán, không nguồn | lấy từ nguồn trong nước, kèm câu trích gốc |
| Giá vào, cắt lỗ | AI tự nghĩ ra | code tính, chạy lại cho kết quả y hệt |
| Nên mua bao nhiêu | không biết danh mục của bạn | tính theo sổ của bạn, AI không thấy số tiền |
| Đúng hay sai | không ai chấm | `/reflect` chấm từng đề xuất cũ |
| Sổ của bạn | nằm trên dịch vụ của bên khác | nằm trên máy bạn |

---

## Hỏi một câu, nhận về cái này

Trước khi mua, bạn cần biết hai điều: mã này có đáng mua không, và lời khuyên đó dựa vào đâu.

Một lần chạy thật, rút gọn, mã và giá đã che:

```
Bạn:  /suggest XXX

💡 XXX (16/10/2026): nên MUA, Mức tin cậy trung bình. Mua khoảng 400 XXX (~9.280.000 VND, chiếm 4,65% danh mục).
  Vào lệnh xx,xx · Cắt lỗ xx,xx (▼ -7,54%) · Chốt 33% tại xx,xx (▲ 7,97%) · Mục tiêu xa xx,xx (▲ 23,92%)

🎯 Cách quản lý vị thế
  Đừng mua đuổi trên xx,xx. Mua trước 200 XXX, phần còn lại mua sau nếu giá quay lại và đứng vững.
  Đã trừ phí: nếu chạm cắt lỗ, bạn mất khoảng 737.120 VND (0,37% danh mục).

🚩 Tôi sai khi
  Báo cáo năm 2026 ghi nhận dòng tiền hoạt động thấp hơn lợi nhuận.

💬 Tranh luận (3 bước sàng lọc)
  🐂 Lý do nên mua: định giá hấp dẫn, lợi nhuận tăng, tiền ròng dương.
  🐻 Lý do nên chờ: lợi nhuận đang cao hơn hẳn bình quân lịch sử; bốn quý gần nhất chưa kiểm toán.

Đây là phân tích, không phải lệnh đặt - quyết định luôn thuộc về bạn.
  Sau khi khớp lệnh, dán dòng này: /record buy vps equity-vn:XXX 400 xxxxx VND 2026-10-16
```

Sáu nhà phân tích AI đã tranh luận về mã này: phe mua, phe bán, người tổng hợp, rồi bên giao dịch, quản trị rủi ro và người soát lại số liệu. Mười bước kiểm tra của cổ phiếu Việt Nam đều có quyền chặn nó lại. **Nhưng không ai trong số đó được viết ra một con số nào.** Giá vào, cắt lỗ, mục tiêu, khối lượng đều do mã nguồn tính xong trước khi cuộc tranh luận bắt đầu. AI chỉ lo phần *vì sao* và phần *điều gì có thể khiến nhận định đó sai*.

<p align="center">
  <img src="assets/readme/debate.vi.png" alt="Hội đồng AI tranh luận theo ba vòng: hai phe, tổng hợp, kế hoạch và soát lại" width="100%" />
</p>

---

https://github.com/user-attachments/assets/bea5ab46-72bd-48f5-8a51-9260f09824d9

<p align="center">
  <sub>Một ngày của dân văn phòng (70 giây)</sub>
</p>

---

## Kỷ luật thay cho cảm xúc

<p align="center"><img src="assets/readme/discipline.vi.png" alt="Bỏ cảm xúc, giữ kỷ luật: thói quen cảm xúc và quy tắc OpenAlpha thay thế" width="100%" /></p>

**Không FOMO, không gồng lỗ, không "chắc nó hồi".** Cái khó hiếm khi là kiến thức, mà là lúc bấm nút. OpenAlpha chốt kế hoạch khi bạn còn tỉnh táo, rồi giữ bạn đi đúng kế hoạch đó.

<details>
<summary><b>Cách nó giữ kỷ luật, kể cả khi thị trường đi xuống</b></summary>

- **Con số chốt trước, không mặc cả giữa chừng.** Giá vào, cắt lỗ, chốt lời và khối lượng do mã nguồn tính, AI không sửa được.
- **Cắt lỗ chỉ được nâng, không được hạ.** Không có nút "dời xuống thêm chút nữa".
- **Không cần dán mắt vào bảng điện.** Trong Telegram hoặc Zalo, đặt mốc bằng `/alert create FPT above 130` (giá bảng điện), giá chạm là hệ thống nhắn bạn.
- **Đoán sai thì bị ghi lại, và lần sau bớt tự tin.** Thành tích trong `/reflect` giới hạn mức tin cậy của các đề xuất tiếp theo.

**Khi thị trường đi xuống,** mục tiêu không phải đoán đáy, mà là còn đủ vốn để chơi tiếp:

- **Thị trường xấu thì tự thu nhỏ.** Trần từng nhóm tài sản siết lại và khối lượng đề xuất nhỏ đi.
- **Có trần cho cả danh mục.** Nhiều lệnh nhỏ không cộng dồn thành một khoản cược lớn.
- **Một lệnh tắt mua.** Khi đã khai khóa sàn, `/trade halt` chặn mọi lệnh mua mới qua OpenAlpha cho tới khi bạn gõ `/trade resume`; bán và cắt lỗ vẫn chạy.

</details>

OpenAlpha không hứa bạn không lỗ. Nó giúp mỗi khoản lỗ nhỏ, có kế hoạch và biết trước.

---

## Thị trường và dữ liệu

<p align="center">
  <img src="assets/readme/markets.vi.png" alt="Một trợ lý, bốn thị trường: cổ phiếu Việt Nam, tiền mã hóa, vàng thế giới, vàng trong nước" width="100%" />
</p>

| Thị trường | Mã thị trường | Có gì |
|---|---|---|
| **Cổ phiếu Việt Nam** | `equity-vn` | Sâu nhất: theo dõi khối ngoại và tự doanh, lịch công bố thông tin, sức khỏe tài chính, và luôn tính đến T+2. |
| **Tiền mã hóa** | `crypto` | Chỉ giao ngay. Mua khi giá vượt đỉnh gần đây, cắt lỗ dời lên theo giá, đọc thêm dữ liệu phái sinh để biết thị trường đang dùng đòn bẩy nhiều hay ít. |
| **Vàng trong nước** | `gold-vn` | So với giá thế giới để biết vàng thật sự tăng hay chỉ là tiệm nới chênh lệch. |
| **Vàng thế giới** | `gold` | Chỉ để tham chiếu: xem giá và làm mốc cho vàng trong nước. |

Chỉ cần gõ mã (`/price FPT`). Khi hai thị trường có cùng một mã thì ghi thêm tên thị trường: `/suggest crypto:UNI`.

<p align="center">
  <img src="assets/readme/sources.vi.png" alt="35 nguồn dữ liệu, chia theo từng thị trường" width="100%" />
</p>

Dữ liệu lưu trong SQLite có sẵn trên máy, không cần cài thêm. Dùng được hơn 70 nhà cung cấp AI, nhà nào treo thì tự chuyển sang nhà kế tiếp. Nói chuyện với nó qua terminal, Telegram, Zalo hoặc Zalo cá nhân.

<details>
<summary><b>Các nhà cung cấp AI dùng được</b></summary>

Đã có khóa của hãng nào thì dùng luôn hãng đó: Anthropic, OpenAI, Google Gemini, xAI, Mistral, DeepSeek, Cohere, Meta AI, Moonshot Kimi, Z.AI, MiniMax, Alibaba Qwen, StepFun, Xiaomi MiMo, Perplexity và nhiều hãng khác.

Muốn một khóa dùng được nhiều mô hình thì qua cổng trung gian như OpenRouter, Requesty, Vercel AI Gateway, Hugging Face hay GitHub Models. Cần nhanh hoặc rẻ thì có Groq, Cerebras, SambaNova, Fireworks, Together, DeepInfra, Novita, Nebius, NVIDIA, Cloudflare Workers AI.

Đang trả tiền ChatGPT thì đăng nhập bằng `openalpha auth login`, khỏi cần khóa. Công ty dùng Azure, Google Cloud hay AWS thì gọi mô hình qua Azure OpenAI, Vertex AI hoặc Bedrock bằng tài khoản sẵn có. Ở Trung Quốc có Baidu ERNIE, Doubao, Hunyuan, Yi, Baichuan, iFlytek Spark, SiliconFlow, ModelScope và cổng nội địa của Kimi, Qwen, GLM, MiniMax. Muốn chạy hẳn trên máy mình thì dùng Ollama, LM Studio hoặc vLLM.

Gõ `openalpha provider list` để xem đủ danh sách cùng tên ghi vào cấu hình ([hướng dẫn](docs/cau-hinh.md)). Không có khóa nào cũng được: nối OpenAlpha vào Claude Code, Codex hay Cursor qua MCP để mô hình của ứng dụng đó suy luận ([Nâng cao](#nâng-cao)).

</details>

---

## An toàn

- **AI không thấy tiền của bạn.** Nhà phân tích chỉ biết tỷ trọng, không bao giờ thấy số dư, giá đã mua hay tổng tài sản.
- **Không tự đặt lệnh.** Mặc định chỉ gợi ý. Chưa khai khóa sàn thì đường đặt lệnh không tồn tại; có khóa thì lệnh nào cũng chờ bạn xác nhận.
- **Mọi thứ nằm trên máy bạn.** Sổ và cấu hình lưu ngay trên máy; khóa API chỉ đọc từ biến môi trường, không ghi vào tệp nào.
- **Có trần chi phí AI** theo ngày và theo tháng, để một vòng lặp lỗi không đốt tiền của bạn.

Đủ 16 lớp bảo vệ: [SECURITY.md](SECURITY.md).

---

## Bắt đầu

Bạn cần một máy macOS, Linux hoặc Windows 10/11 và một khóa API của nhà cung cấp AI. [OpenRouter](https://openrouter.ai) có cả mô hình miễn phí; dùng mô hình trả phí thì thường chỉ tốn vài đô la mỗi tháng.

**1. Cài đặt.** Một dòng, tải về một tệp chạy duy nhất rồi hỏi bạn vài câu (ngôn ngữ, mô hình AI, mức chi mỗi ngày, Telegram nếu muốn). Muốn đổi lại thì chạy `openalpha onboard`.

```bash
curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh
```

```powershell
powershell -c "irm https://raw.githubusercontent.com/alex2loop/openalpha/main/install.ps1 | iex"   # Windows
```

**2. Đặt khóa AI và kiểm tra.** Mở một terminal mới:

```bash
export OPENROUTER_API_KEY="..."   # thêm dòng này vào cuối ~/.zshrc (macOS) hoặc ~/.bashrc (Linux) để giữ lâu
openalpha doctor --online         # gửi một tin ngắn để thử mô hình
```

Trên Windows: `setx OPENROUTER_API_KEY "..."`, mở PowerShell mới, rồi `openalpha doctor --online`.

**3. Nạp dữ liệu và khai khẩu vị.** Chạy `openalpha chat`, rồi gõ:

```text
/refresh     # lần đầu: nạp danh sách mã, giá, báo cáo tài chính (miễn phí, vài phút)
/setup       # chọn mức rủi ro và thị trường bạn chơi
```

**4. Ghi số tiền bạn có, theo thị trường bạn chơi.** Khối lượng của mọi gợi ý đều tính từ sổ này, nên đây là bước không được bỏ.

<details open>
<summary><b>Cổ phiếu Việt Nam</b></summary>

```text
/record deposit vps 100000000 VND 2026-08-14              # nạp 100 triệu vào tài khoản VPS
/suggest FPT                                              # soi một mã
/record buy vps equity-vn:FPT 100 62000 VND 2026-08-14    # tự đặt lệnh, khớp rồi thì ghi lại
```

Giá ghi bằng VND nguyên: bảng điện hiện `62,00` thì ghi `62000`. Phí bỏ trống thì sổ tự tính. Tài khoản ở công ty khác (SSI, TCBS, VNDIRECT...) thì thêm vào `~/.openalpha/config.toml` với biểu phí của bạn, rồi ghi `ssi` thay cho `vps`:

```toml
[trading.venues.ssi]
default_for = ["equity-vn"]                                # cổ phiếu VN ghi ở SSI thay vì VPS
fees = { buy = 0.0015, sell = 0.0015, sell_tax = 0.001 }
```

Có tài khoản ở cả VPS lẫn SSI thì thay dòng `default_for` bằng `markets = ["equity-vn"]`.

</details>

<details>
<summary><b>Crypto</b></summary>

Nạp USDT mua qua P2P thì ghi kèm `fx` ở dòng nạp, là giá bạn thật sự trả cho mỗi USDT. Lệnh mua sau đó trả bằng số USDT này theo giá vốn ấy, nên không cần `fx`:

```text
/record deposit binance 1000 USDT 2026-08-14 fx 26600
/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14
```

Nạp VND vào sàn thì lệnh mua bằng USDT được quy theo tỷ giá thị trường ngày đó. Trợ lý cho bạn xem trước, đúng thì gõ `/record confirm` để ghi:

```text
/record deposit binance 26000000 VND 2026-08-14
/record buy binance crypto:BTC 0.01 60000 USDT 2026-08-14
/record confirm
```

- Mới chơi crypto? Từng bước từ nạp USDT tới rút về, chênh lệch tỷ giá và đối chiếu USDT với sàn: [cẩm nang](docs/cam-nang.md#crypto-qua-p2p-từng-bước-cho-người-mới).
- `binance` và `okx` có sẵn. Sàn khác (Bybit, Bitget...) thì khai như SSI ở trên, với `markets = ["crypto"]` và `fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }`.
- Đã đặt khóa API của Binance hoặc OKX thì `/record sync binance` tự lấy lệnh đã khớp, và `/trade` dựng sẵn lệnh để bạn duyệt:

```text
/trade spot binance:BTC buy 0.001 limit 60000 tp 70000 sl 56000   # mua giới hạn, kèm chốt lời và cắt lỗ
/trade confirm                                                     # chỉ lúc này lệnh mới lên sàn
```

</details>

<details>
<summary><b>Vàng trong nước</b></summary>

Nhóm này tắt sẵn. Bật nó, khai nơi bạn mua vàng, rồi ghi như cổ phiếu:

```text
/profile enable gold-vn
/price SJC                     # giá mua vào, bán ra và chênh lệch hôm nay
```

```toml
[trading.venues.sjc]
markets = ["gold-vn"]
fees = { buy = 0, sell = 0 }   # tiệm vàng không thu phí riêng; chênh mua bán đã nằm trong giá
```

```text
/record deposit sjc 150000000 VND 2026-08-14
/record buy sjc gold-vn:SJC 1 120000000 VND 2026-08-14   # 1 lượng
```

Mua lẻ thì ghi theo lượng: 1 chỉ là `0.1`, giá vẫn ghi theo lượng. Vàng nhẫn dùng `gold-vn:PNJ-RING` hoặc `gold-vn:DOJI-RING`. Cắt lỗ và mục tiêu tính theo giá tiệm mua lại, tức số tiền bạn thực nhận khi bán.

</details>

Bán thì `/record sell vps equity-vn:FPT all 65000 VND 2026-08-20` (`all` là bán hết, hoặc ghi số lượng). Rút tiền: `/record withdrawal vps 1000000 VND 2026-08-21`. Ngày luôn ghi theo dạng năm-tháng-ngày. Ghi nhầm thì gõ `/transactions` để xem mã giao dịch, rồi `/update <mã> ...` để sửa hoặc `/delete <mã>` để xóa. Gõ `/record` không kèm gì để xem mọi loại dòng ghi được (cổ tức, chia tách, chuyển tiền...).

**5. Bật bản tin sáng.** `openalpha start --background` để chương trình chạy nền (dữ liệu cũng tự nạp từ đó). Nối Telegram hoặc Zalo ([hướng dẫn kênh](docs/kenh.md)), rồi gõ `/brief enable 08:00` trong kênh đó. `openalpha status` cho biết nó còn chạy không, `openalpha stop` để dừng. Vài tuần sau, `/reflect` cho biết các đề xuất cũ đúng được bao nhiêu.

<details>
<summary><b>Windows, cấu hình tối giản, cập nhật, gỡ cài đặt</b></summary>

- **Không cần quyền admin.** `openalpha.exe` nằm ở `%USERPROFILE%\.local\bin` và thư mục này được thêm vào PATH của tài khoản bạn. Gõ `openalpha` mà báo không nhận ra lệnh thì mở một cửa sổ PowerShell mới, hoặc chạy thẳng `& "$HOME\.local\bin\openalpha.exe"`. Dữ liệu và cấu hình nằm ở `%USERPROFILE%\.openalpha`, cũng chính là `~/.openalpha` trong hướng dẫn này.
- **Windows Defender chặn `openalpha.exe`?** Tệp chạy chưa được ký số nên đôi khi bị báo nhầm. Trình cài đã đối chiếu tệp với `SHA256SUMS` của bản phát hành; muốn tự kiểm thì chạy `Get-FileHash "$HOME\.local\bin\openalpha.exe"` rồi so với dòng `openalpha-windows-x64.exe` trên trang [Releases](https://github.com/alex2loop/openalpha/releases). Khớp rồi thì thêm ngoại lệ cho cả thư mục, trong PowerShell chạy bằng quyền Admin: `Add-MpPreference -ExclusionPath "$HOME\.local\bin"`. Đừng tắt hẳn diệt virus.
- **Tiếng Việt hiện thành ký tự lạ?** Dùng Windows Terminal thay cho cửa sổ console cũ. **Thích WSL2?** Lệnh `curl ... | sh` chạy được trong WSL2, với thư mục `~/.openalpha` riêng.
- **Không muốn trả lời từng câu lúc cài?** Lấy [config.minimal.toml](config.minimal.toml): chạy được ngay, chỉ cần khóa OpenRouter, mỗi dòng đều có chú thích. Lệnh này ghi đè `config.toml` nếu bạn đã có:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.toml -o ~/.openalpha/config.toml --create-dirs
  ```

  ```powershell
  New-Item -ItemType Directory -Force "$HOME\.openalpha" | Out-Null; irm https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.toml -OutFile "$HOME\.openalpha\config.toml"
  ```

- **Mọi tùy chọn cấu hình:** [config.sample.toml](config.sample.toml) · [docs/cau-hinh.md](docs/cau-hinh.md). Không muốn dùng khóa AI thì chạy mô hình ngay trên máy qua Ollama hoặc vLLM.
- **Cài trên máy chủ hay trong CI?** Đặt `OPENALPHA_NO_ONBOARD=1` để bỏ bước hỏi; đầu [install.sh](install.sh) và [install.ps1](install.ps1) liệt kê đủ các tùy chọn, ví dụ `OPENALPHA_VERSION` để cài đúng một bản.
- **Cập nhật:** CLI nhắc mỗi ngày một lần khi có bản mới; `openalpha upgrade` lên bản mới mà giữ nguyên dữ liệu và cấu hình.
- **Gỡ cài đặt:** `openalpha stop`, rồi xóa tệp `openalpha` (mặc định ở `~/.local/bin`; trên Windows là `openalpha.exe` và `openalpha.exe.old` nếu có). Thư mục `~/.openalpha` chứa toàn bộ sổ và cấu hình: chạy `openalpha db export --out <thư-mục>` trước nếu muốn giữ.

</details>

---

## Dùng mỗi ngày

Phần lớn việc hằng ngày đều **miễn phí**: các lệnh đó chỉ tính trên dữ liệu đã có trong máy, không gọi AI. Các con số dưới đây đo thật ngày 2026-10-15 với mô hình rẻ (`gpt-6-luna` cho tranh luận, `claude-haiku-5.5` cho nghiên cứu); mô hình đắt hơn thì tốn hơn, và `[budget]` luôn chặn trần.

| Bạn muốn | Gõ | Tốn tiền? |
|---|---|---|
| Bản tin trước giờ mở cửa | `/brief` · `/brief enable 08:00` | có: một lượt ngắn cho mỗi mã đang giữ hay theo dõi; mã đã soi trong ngày thì miễn phí |
| Soi kỹ một mã | `/suggest FPT` | khoảng $0,01 |
| Nghiên cứu một câu hỏi, có trích nguồn | `/research <câu hỏi>` | khoảng $0,03 (`quick`) |
| Chủ đề đầu tư đang hình thành | `/themes` | có, tối đa $1 mỗi lần theo mặc định |
| Xếp hạng cả thị trường | `/screen equity-vn 20` | **miễn phí** |
| Theo dõi giá vài mã | `/watchlist add FPT HPG` · `/watchlist` | **miễn phí** |
| Nạp dữ liệu còn thiếu cho các thị trường bạn đang dùng (`force`: nạp lại hết) | `/refresh` · `/refresh equity-vn force` | **miễn phí** |
| Bảng giá, vĩ mô, một mã | `/market` · `/overview` · `/price FPT` | **miễn phí** |
| Xem danh mục, kéo về tỷ trọng mục tiêu | `/portfolio` · `/rebalance` | **miễn phí** |
| Danh mục thật sự lời lỗ bao nhiêu, đã trừ tiền nạp rút | `/portfolio nav` | **miễn phí** |
| Ghi nạp, rút, mua, bán | `/record` | **miễn phí** |
| Đồng bộ sổ với sàn (cần khóa API của sàn) | `/record sync okx` · `/reconcile` | **miễn phí** |
| Xem mình đúng được bao nhiêu | `/reflect` | **miễn phí** |
| Đặt lệnh (cần khóa API của sàn và xác nhận) | `/trade` rồi `/trade confirm` | - |

Các con số trong README chỉ minh họa cú pháp, không phải gợi ý mua bán. Đầy đủ: `/help` trong chat, hoặc [cẩm nang tiếng Việt](docs/cam-nang.md).

---

## Nghiên cứu có trích nguồn

Hỏi một câu cần dữ liệu mới từ bên ngoài, nhận về một báo cáo mà mỗi nhận định đều chỉ ra được nó đến từ đâu. Ví dụ dưới đây là một lần chạy thật, rút gọn.

<details>
<summary><b>Xem một lần chạy thật và cách nó kiểm nguồn</b></summary>

```
Bạn:  /research quick Lợi nhuận 8 tháng 2026 của FPT là bao nhiêu,
      và các công ty chứng khoán dự báo cả năm thế nào?

2 lượt tìm kiếm · 3 trang đã đọc
2 nguồn được dùng · 4 nhận định có bằng chứng
⚠️ 2 vấn đề về bằng chứng
  • Chưa tìm thấy đủ nguồn ủng hộ cho một nhận định. ×2
✓ Hoàn tất nhưng còn thiếu sót · Mức độ bằng chứng: một phần

⏺ Chưa tìm thấy số liệu lợi nhuận 8 tháng 2026 của FPT, cũng chưa có dự báo cả năm
từ công ty chứng khoán nào. Số liệu gần nhất tìm được:
- 5 tháng: lợi nhuận sau thuế cổ đông công ty mẹ 4.199 tỷ đồng, +16% (Vietcap).
- 6 tháng: lợi nhuận trước thuế 5.714 tỷ đồng, +18,1% (Báo Đầu tư).
- Kế hoạch cả năm do FPT đặt (không phải dự báo): lợi nhuận trước thuế 11.629 tỷ đồng.

$0.0111 · xong trong 34,4 giây
```

- **Mô hình không tự lên mạng.** Code tìm và tải trang trước, mô hình chỉ đọc những gì code đã lấy về, nên không thể bịa ra một nguồn.
- **Trích dẫn được kiểm từng chữ.** Một nhận định phải dựa trên đoạn trích có thật trên trang đã tải; trích dẫn không khớp, hay nhận định chưa đủ nguồn, đều bị gắn cờ như dòng ⚠️ ở trên.
- **Dự báo là dự báo.** Giá mục tiêu, ước tính hay kế hoạch công ty được đánh dấu và trình bày đúng là dự báo của ai, không bao giờ thành "đã đạt".
- **Thiếu thì nói thiếu.** Không có số 8 tháng thì báo cáo nói chưa có và đưa số gần nhất, chứ không đoán. Hai nguồn lệch nhau về một con số thì báo là mâu thuẫn.
- **Ba mức sâu:** `quick`, `standard` (mặc định) và `thorough`, ở mức `thorough` bạn được xem và sửa kế hoạch nghiên cứu một lần trước khi chạy.

</details>

- **Nguồn tìm kiếm quyết định độ sâu.** Mặc định là DuckDuckGo: miễn phí, không cần khóa, nhưng ít kết quả, nên câu hỏi về số liệu mới thường về tay không. Khai `[web_search]` bằng Exa, Tavily, Brave hay Serper ([cấu hình](docs/cau-hinh.md)) thì báo cáo có nhiều nguồn hơn hẳn.

Chi tiết: [docs/nghien-cuu.md](docs/nghien-cuu.md)

---

## Câu hỏi thường gặp

- **Tốn bao nhiêu tiền?** Phần mềm miễn phí, bạn chỉ trả cho nhà cung cấp AI: soi một mã khoảng $0,01, nghiên cứu nhanh khoảng $0,03 với mô hình rẻ. Phần lớn lệnh còn lại không gọi AI. Bạn đặt trần chi tiêu mỗi ngày lúc cài.
- **Có cần máy mạnh không?** Không. AI chạy ở nhà cung cấp, máy bạn chỉ chạy một tệp nhỏ. Chỉ khi muốn chạy mô hình ngay trên máy (Ollama) mới cần máy mạnh.
- **Không biết lập trình có dùng được không?** Được. Bạn chỉ cần chép vài lệnh vào terminal một lần; sau đó hỏi bằng tiếng Việt, hoặc chat qua Telegram, Zalo.
- **AI có thấy tiền hay tự đặt lệnh không?** Không. Xem [An toàn](#an-toàn).
- **Tôi không dùng VPS, hoặc có crypto, vàng?** Đều ghi được. Xem các khối trong [Bắt đầu](#bắt-đầu).
- **Đề xuất có đáng tin không?** Có thể sai. `/reflect` cho thấy thành tích thật, và đề xuất sau bị hạ mức tin cậy khi các đề xuất trước đoán sai nhiều.
- **Dữ liệu của tôi nằm ở đâu?** Trong thư mục `~/.openalpha` trên máy bạn. Sao lưu bằng `openalpha db export --out <thư-mục>`.

---

## Nâng cao

<details>
<summary><b>Nhà phân tích của riêng bạn</b></summary>

Ngoài nhà phân tích chính, bạn tạo thêm được nhà phân tích riêng chỉ bằng một tệp TOML: một đoạn dặn dò, danh sách công cụ được dùng và trần chi phí. Thêm `[focus]` là có một **ý kiến thứ hai** với khẩu vị riêng. Đề xuất của nó được chấm điểm tách riêng, không bao giờ đụng vào cắt lỗ, cảnh báo hay bản tin sáng của danh mục chính:

```bash
openalpha agent add ngan-hang      # tạo tệp mẫu, rồi `agent edit ngan-hang` để sửa
```

```toml
system_prompt = "Chỉ xem cổ phiếu ngân hàng, nắm giữ dài hạn, ưu tiên cổ tức đều."
max_daily_usd = 0.5                 # trần chi phí riêng mỗi ngày

[focus]
markets = ["equity-vn"]
sectors = ["banks"]
horizon = "long"

[capabilities]
tools = ["suggestion_run", "suggestion_track_record", "market_screen", "market_price", "market_news"]
```

Hỏi nó bằng `openalpha chat --agent ngan-hang`, hoặc gắn nó vào một nhóm Telegram/Zalo bằng `/agent ngan-hang`. `openalpha agent list` cho thấy nó đúng được bao nhiêu và hay đồng ý với các agent khác tới đâu; `agent pause ngan-hang` tắt nó ngay mà không cần khởi động lại. Chi tiết: [docs/tro-ly.md](docs/tro-ly.md)

</details>

<details>
<summary><b>Cắm vào Claude Code, Cursor, VS Code... (MCP)</b></summary>

Cắm vào Claude Code, Codex, Cursor, VS Code, Gemini CLI... như một máy chủ MCP - khi đó AI của chính ứng dụng ấy làm phần suy nghĩ, bạn không cần khóa AI riêng:

```bash
openalpha mcp install      # hoặc --host codex, cursor, vscode, gemini, opencode, zed
```

Đề xuất tạo theo cách này được chấm điểm riêng trong `/reflect` (dưới tên `client:<model>`), và cách này không bao giờ đặt được lệnh. Chi tiết: [docs/dev/mo-rong.md](docs/dev/mo-rong.md)

</details>

<details>
<summary><b>Nhúng như thư viện (SDK)</b></summary>

Runtime vừa là chương trình chạy độc lập, vừa là thư viện (SDK) để nhúng. Hiện nhúng từ bản clone của repo; gói chưa phát hành lên npm:

```ts
import { boot } from '@openalpha/runtime/app'
const { app, dispose } = await boot({
  mode: 'cli',
  env: process.env,
  configPath: './config.toml',
  shutdownSignal: AbortSignal.timeout(60_000),
  tools: [],
  agents: [],
})
```

</details>

---

## Hỗ trợ

- **Hỏi cách cài, cách dùng, nhận tin bản mới:** [nhóm Zalo OpenAlpha](https://zalo.me/g/yl7iqyfovvtyosujulea). Nhóm chỉ hỗ trợ dùng phần mềm, không bàn mã nào nên mua. Che khóa API trước khi dán cấu hình. Admin không bao giờ nhắn riêng để xin khóa hay tiền.
- **Báo lỗi, đề xuất tính năng:** [GitHub Issues](https://github.com/alex2loop/openalpha/issues/new/choose). Lỗi chỉ được theo dõi khi có issue.
- **Lỗ hổng bảo mật:** báo riêng theo [SECURITY.md](SECURITY.md), không đăng lên nhóm hay issue.

Thấy hữu ích? Cho repo một ⭐ để nhiều người biết tới, và vào [nhóm Zalo](https://zalo.me/g/yl7iqyfovvtyosujulea) để nhận tin bản mới.

---

## Phát triển

```bash
git clone https://github.com/alex2loop/openalpha.git && cd openalpha
bun install
bun run dev -- onboard

bun run check       # lint + typecheck + các cổng hợp đồng
bun run lint:arch   # các cổng kiến trúc
```

Một thay đổi chỉ được nhận khi cả hai lệnh trên đều qua. Quy tắc nội bộ và bất biến nghiệp vụ: [AGENTS.md](AGENTS.md). Bản clone cập nhật bằng `git pull`.

Kiến trúc: 15 mô-đun, phụ thuộc một chiều về phía lõi, không vòng lặp; 30 cổng chặn tự động làm build thất bại ngay khi một mô-đun vượt ranh giới. Góp mã: [CONTRIBUTING.md](CONTRIBUTING.md) · [Quy tắc ứng xử](CODE_OF_CONDUCT.md).

**Nói trước về độ ổn định.** Đây là giai đoạn đầu của một công cụ đã được dùng thật hằng ngày trong nhiều tháng: ổn định ở những việc dùng mỗi ngày, còn thô ở những phần khác. Chưa có bộ test; giữa hai phiên bản có thể có thay đổi không tương thích; và chưa chuyển được tài sản giữa các sàn.

---

## Giấy phép và miễn trừ

Mã nguồn theo giấy phép MIT, dùng thế nào tùy bạn. Tên, logo và Bé Alpha thì không nằm trong giấy phép:
xem [NOTICE.md](NOTICE.md#tên-và-logo-không-đi-kèm-giấy-phép).

**Dữ liệu là chuyện khác.** OpenAlpha không đóng gói sẵn dữ liệu thị trường nào: nó lấy dữ liệu từ
từng nhà cung cấp khi chạy, ngay trên máy bạn, và điều khoản sử dụng là chuyện giữa bạn với họ.
[NOTICE.md](NOTICE.md) liệt kê mọi trang mà nó có thể đọc, và những gì nên kiểm tra trước khi bật một nguồn.

OpenAlpha là trợ lý nghiên cứu và ghi sổ. Đề xuất ở đây mang tính tham khảo, **có thể sai, và không phải lời khuyên đầu tư**. OpenAlpha không biết hết hoàn cảnh của bạn, chỉ đặt lệnh khi bạn duyệt, và không ai đoán chắc được thị trường. Mọi quyết định là của bạn. Đừng đầu tư số tiền bạn không chịu mất được.
