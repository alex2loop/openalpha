# Góp phần

🇻🇳 Tiếng Việt &bull; [🇬🇧 English](CONTRIBUTING.en.md)

Cảm ơn bạn đã ghé xem. Đây là công cụ mã nguồn mở do một người vận hành, nên tiêu chuẩn ở đây
không phải "có giống phong cách nhà này không" mà là "sáu tháng nữa nó còn đúng không".

## Trước khi bắt đầu

**Mở issue trước cho mọi thay đổi về cấu trúc.** Một thị trường mới, một sàn mới, một nguồn
dữ liệu mới, một thay đổi trong chuỗi xử lý đề xuất, hoặc bất cứ thứ gì chạm vào đường đặt
lệnh. Những chỗ này đã được thiết kế có chủ ý, nên điều cần review là thiết kế chứ không phải
đoạn diff. Sửa nhỏ và tài liệu thì không cần.

**Chưa có bộ test.** Đây là chủ ý, nên các cổng kiểm chính là hợp đồng.
Cả hai phải xanh:

```bash
bun run check      # biome + typecheck + 15 cổng hợp đồng
bun run lint:arch  # 15 cổng kiến trúc
```

Chúng chạy nhanh và báo đúng dòng gây lỗi. Hai lệnh này cùng bắt được: một import vòng,
một API kernel bị nới rộng, một thị trường chạm vào thị trường bên cạnh, một con số được in ra
mà bỏ qua hợp đồng hiển thị, một log key dùng hai lần, một chuỗi locale còn thiếu, một tệp quá
400 dòng, một export không có ai dùng, và một tệp không entry point nào tới được.

**Kiểm chứng hành vi bằng một lượt chạy thật**, vì các cổng chỉ chứng minh được cấu trúc. Sửa
một thị trường thì phải chạy `/suggest` hoặc `/screen` trên thị trường đó và đọc kết quả.

## Cài đặt

```bash
git clone https://github.com/alex2loop/openalpha.git && cd openalpha
bun install
cp config.sample.toml config.toml   # điền một khóa nhà cung cấp
bun run dev -- doctor
```

Bun 1.3 trở lên. Không cần cài cơ sở dữ liệu nào.

## Những quy tắc đáng kể

[AGENTS.md](AGENTS.md) là bộ quy tắc đầy đủ - kiến trúc, biên giữa các module, các bất biến
nghiệp vụ, và quy ước viết code. Nó dài vì phần lớn nội dung là lý do đằng sau từng quy tắc. Sửa một lỗi chính tả thì không cần đọc hết; nhưng trước khi đổi một hệ thống con,
hãy đọc đúng mục liên quan.

Bản ngắn:

- **Các module không phụ thuộc vòng tròn và đều hướng về kernel.** API công khai của một module là
  `api.ts` của nó, không sâu hơn. `core` không chứa từ vựng tài chính.
- **Lỗi có kiểu.** Không bao giờ `throw new Error()`; dùng cây lỗi đã có.
- **Không có chuỗi hiển thị cho người dùng nằm ngoài catalog locale**, và cả `en` lẫn `vi`
  phải có đủ mọi khóa. Thiếu khóa nào thì hệ thống báo lỗi ngay lúc khởi động và liệt
  kê đúng khóa đó. Thuật ngữ tiếng Việt được `scripts/check-vi-terminology.ts` (trong `lint:arch`)
  canh: `reduce` là *giảm bớt*, không bao giờ là *bán*.
- **Mọi giá trị được in ra đều đi qua hợp đồng hiển thị** trong `trading/render/`. Một mức
  giá, một phần trăm và một số lượng - mỗi loại chỉ có một nơi lo việc hiển thị, và cổng kiểm
  quét tới từng chỗ gọi.
- **Không `any` ngoài `catch`, không ép kiểu `as`, không `!`.** Hãy thu hẹp kiểu thay vì ép.
- **Đọc đồng hồ một lần cho mỗi thao tác logic** rồi truyền giá trị đó đi.
- **Mọi timer, listener và handle đều có một lệnh dọn tương ứng** trên nhánh throw, nhánh
  abort và nhánh return sớm. Rò rỉ được coi là lỗi, không phải chuyện phong cách.

## Mở rộng

Thêm bất kỳ thứ nào dưới đây đều là thay đổi cục bộ, không động tới phần khác. Mỗi cái đều có tài liệu đầy đủ trong
AGENTS.md:

- **Một thị trường** - một thư mục dưới `trading/markets/<ref>/`, các factor id của nó, một
  dòng `markets.register(...)`, các nguồn dữ liệu, và các khóa locale trong cả hai catalog.
- **Một sàn** - một thư mục dưới `trading/venues/<id>/`, một dòng `venues.register(...)`, và
  một khóa locale trong cả hai catalog.
- **Một nguồn dữ liệu** - một adapter dưới `trading/sources/adapters/`, một route trong
  `SOURCE_ROUTES`, và một lần đăng ký. Endpoint và giới hạn tần suất do code nắm
  theo thiết kế, nên không cấu hình nào chuyển hướng được một request.
- **Một nguồn dạng plugin** - một tệp `sources.ts` ở gốc plugin của bạn. Không cần fork,
  nhưng operator phải bật `plugins.allow_code`.

Hệ thống báo lỗi ngay lúc khởi động và nêu đúng chỗ còn thiếu, nên một thị trường hay
một sàn đăng ký dở dang không thể tới tay người dùng.

## Pull request

- **Một việc cho một PR.** Đừng tiện tay dọn code ngoài phạm vi. Chỉ dọn những gì thay đổi
  của bạn bỏ lại, còn vấn đề có từ trước thì nêu ra chứ đừng sửa trong cùng PR.
- **Conventional commits**: `feat:`, `fix:`, `docs:`, `chore:`. Dòng tiêu đề nói cái gì đã
  đổi với người dùng, không nói tệp nào đã di chuyển.
- **Nói rõ bạn đã kiểm chứng những gì.** Cổng nào, và lệnh thật nào bạn đã chạy.
- **Nêu rõ các thay đổi hành vi.** Một thay đổi âm thầm trong cách tính một mức giá, một khối
  lượng hay một hạn mức là thứ duy nhất review không bắt được khi chỉ đọc
  diff.

## Những thứ sẽ bị từ chối

Không phải để làm bạn mất hứng - đây là những quyết định đã chốt, và lý do nằm trong AGENTS.md:

- **Tự động đặt lệnh, hoặc bất kỳ đường thứ hai đi tới sàn.** Có con người ở giữa chính là
  sản phẩm.
- **Một bộ backtest.** Chỉ hiệu chỉnh bằng track record đi về phía trước; `/reflect` là câu
  trả lời.
- **Trừu tượng hóa cho nhu cầu chưa có.** Không thêm tầng gián tiếp, cache hay framework khi chưa có
  nhu cầu đo được và chưa có hai chỗ dùng cụ thể.
- **Nới một cổng kiểm để đưa thay đổi vào.** Các ngưỡng chỉ đi theo một chiều. Nếu tệp của
  bạn vượt vạch, hãy tách nó ra.
- **Cấu hình có thể chuyển hướng một request mạng.** Endpoint vẫn do code nắm.

## Báo lỗi

Mở issue kèm lệnh bạn đã chạy, bạn mong đợi gì, và bạn nhận được gì. Nhớ nêu thị trường, vì
hành vi phụ thuộc thị trường ở nhiều chỗ hơn bạn tưởng.

Với bất cứ chuyện gì có ảnh hưởng tới bảo mật, hãy dùng [SECURITY.md](SECURITY.md) thay vì mở
issue.
