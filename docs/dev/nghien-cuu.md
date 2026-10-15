# Nghiên cứu sâu - bên trong

Dành cho người đóng góp mã. Trang này nói một lần nghiên cứu được dựng thế nào, bằng chứng được nhận ra
sao và các giới hạn cố định đến từ đâu. Phần dành cho operator ở [Nghiên cứu sâu](../nghien-cuu.md). Vị
trí của nghiên cứu giữa các tính năng khác: [Bên trong](ben-trong.md).

## Quy trình

Một lần chạy gồm một khâu điều phối và bốn worker, mỗi worker một việc: `research-planner`,
`research-crawler`, `research-synthesizer` và `research-reviewer` (hồ sơ ở `src/engine/agents/`). Mỗi
worker chạy như một phiên chạy con tách biệt, chỉ lưu tạm và không đọc được bản ghi của worker khác. Các
giai đoạn là `plan`, `crawl`, `synthesize` và `review`. `/research` chạy quy trình này qua agent
`deep-researcher` có sẵn.

```text
/research "câu hỏi"
  |
  +- planner ................. một câu hỏi cho mỗi hướng bằng chứng độc lập
  |
  +- với từng câu hỏi, song song (chặn bởi [loop] max_parallel_delegations):
  |    nhà cung cấp tìm kiếm ... các trang ứng viên       (mã tất định)
  |    tải và rút trích ........ văn bản trang            (mã tất định)
  |    mô hình crawler ......... luận điểm + câu trích nguyên văn (không công cụ)
  |    kiểm neo bằng chứng ..... đầu ra không neo bị loại  (mã tất định)
  |
  +- xét nhận và độ phủ ...... các luận điểm còn sống
  |
  +- synthesizer ............. báo cáo chỉ trên luận điểm đã được nhận
  |
  +- reviewer ................ duyệt, hoặc yêu cầu sửa -> câu hỏi bổ sung -> crawl lại
```

Hồ sơ ánh xạ sang độ sâu nội bộ: `quick` là `light`, `standard` là `medium`, `thorough` là `deep`
(`RESEARCH_PROFILE_DEPTHS`). `light` bỏ qua planner và chỉ hỏi một câu. Chạy `thorough` ở tầng gốc cần
một người duyệt kế hoạch tương tác, không có thì bị hủy trước khi tốn đồng nào.

## Truy hồi chạy trước mô hình

Mọi worker nghiên cứu đều khai `tools = []`: không worker nào tìm kiếm, tải trang hay chạm tới mạng
được. Khâu truy hồi là mã tất định chạy trước; mô hình chỉ được gọi sau đó, trên phần tài liệu mã đã thu.

Với mỗi câu hỏi, lượt truy hồi:

1. Lấy các từ khóa tìm kiếm mà planner đã sinh.
2. Ghi từng từ khóa vào sổ truy vấn con của lần chạy trước khi lần tìm nào bắt đầu. Từ khóa đã dùng thì
   bị bỏ qua (`duplicate_subquery`); chạm 42 truy vấn con thì dừng và ghi khoảng trống `content_limit`.
   Sổ này dùng chung cho mọi câu hỏi, nên trần áp cho cả lần chạy.
3. Tìm trên nhà cung cấp mặc định đã cấu hình, cho mọi từ khóa còn lại cùng một lúc, nên mỗi câu hỏi tốn
   cỡ một lần chờ hết giờ của nhà cung cấp. Kết quả được gom, khử trùng theo URL và xếp hạng trước khi
   đọc gì: trang có tiêu đề hay đoạn trích nêu đúng các thực thể của câu hỏi xếp trước. Cửa sổ độ mới
   được yêu cầu chỉ hạ bậc trang cũ chứ không loại, vì ở bước này ngày tháng mới là ước lượng của nhà
   cung cấp. Giữ 8 trang tốt nhất; dưới hai trang thì ghi khoảng trống `low_recall`.
4. Làm đúng một bước tiếp theo, không lặp: đọc các trang vừa tìm được, hoặc, nếu nhà cung cấp mặc định
   hỏng hay không trả về gì dùng được, một lần thử với nhà cung cấp dự phòng đã cấu hình.
5. Đọc văn bản trang. Với Exa, các lần đọc được gom lô qua Contents API của Exa; với nhà cung cấp khác,
   3 trang tốt nhất được tải thẳng cùng một lúc. Trang vượt giới hạn được ghi là khoảng trống
   `content_limit`.

Văn bản trang được lưu chung cho cả lần chạy theo URL đã chuẩn hóa, nên hai câu hỏi cùng gặp một trang
chỉ đọc nó một lần. Tài liệu đã thu còn được cache theo từng câu hỏi, nên lần crawl thử lại chạy lại mô
hình mà không mất thêm tiền truy hồi.

## Mô hình rút trích, mã quyết định

Prompt của crawler gồm câu hỏi và tài liệu đã lấy. Mô hình trả về JSON phẳng: các luận điểm, mỗi luận
điểm kèm nguồn và các câu trích đúng từng ký tự. Nó không bao giờ tự đặt mã định danh: hệ thống tạo mọi
mã (nguồn, trích đoạn, luận điểm, liên kết số) và tự nối các tham chiếu.

Các phép kiểm sau chạy trên đầu ra đó trước khi nhận bất cứ gì:

| Phép kiểm | Mã lỗi |
| --- | --- |
| URL được dẫn đúng là URL khâu truy hồi thật sự đã tải | `source_not_retrieved` |
| Câu trích xuất hiện nguyên văn trong văn bản đã lưu của trang đó | `quote_not_in_content` |
| Giá trị, đơn vị và khoảng ngày của luận điểm số neo được vào câu trích của nó | `numeric_fields_absent` |

Phép kiểm câu trích so sánh văn bản đã chuẩn hóa: khác khoảng trắng hay định dạng thì qua, khác từ ngữ
thì không. Nguồn chưa từng được đọc thì không neo được điều gì; đoạn trích tìm kiếm và bản tóm tắt của
nhà cung cấp chỉ để khám phá.

## Từ các nhánh tới một kết quả

Mỗi câu hỏi sinh ra một nhánh bằng chứng. Các nhánh được gộp thành một kết quả:

1. **Xét nhận** gộp các nhánh, chuẩn hóa và khử trùng nguồn, giới hạn trích đoạn, và quét tiêm prompt
   trên cả siêu dữ liệu nguồn lẫn văn bản câu trích.
2. **Độ phủ** gộp các luận điểm nói cùng một điều giữa các câu hỏi, loại mọi luận điểm mất hậu thuẫn, và
   nêu xung đột với những con số không khớp câu trích.
3. **Phân định** xét xem phần còn lại có trả lời được câu hỏi không và cắt bằng chứng cho vừa 128 KiB.
   Luận điểm của mục trả lời được giữ chỗ trước để tài liệu hậu thuẫn không chèn mất phần trả lời bắt
   buộc; trong từng bậc ưu tiên, luận điểm có nhiều nguồn độc lập hơn được giữ trước.
4. **Tổng hợp** viết báo cáo từ các luận điểm còn sống. Báo cáo chỉ là các danh sách mã luận điểm, không
   có văn xuôi riêng.

### Chuỗi bằng chứng và lý do bị loại

Nguồn là một trang, trích đoạn là một câu trích nguyên văn, luận điểm là phát biểu dẫn một hoặc nhiều
trích đoạn. Luận điểm là `factual`, `numeric` hoặc `inference`. `factual` và `numeric` là loại rút trích
và bắt buộc dẫn trích đoạn; `numeric` còn mang giá trị, đơn vị và khoảng ngày nguyên văn, phải xuất hiện
đúng từng chữ trong trích đoạn được dẫn. `inference` là lập luận của chính mô hình và được gắn nhãn như
vậy. `forecast: true` đánh dấu luận điểm mà nguồn nói về kỳ vọng, dự phóng, giá mục tiêu, ước tính hay
kế hoạch công ty; một dự báo không bao giờ gộp với kết quả thực tế nó dự đoán, và hai dự báo lệch nhau
không bao giờ tạo `factual_contradiction`.

Một nguồn hoặc trích đoạn bị loại khi:

| Lý do | Mã khoảng trống |
| --- | --- |
| URL không chuẩn hóa được về `https:` | `validation` |
| Tiêu đề, nhà xuất bản hay tên tác giả trượt phép quét tiêm prompt | `unsafe_content` |
| Văn bản trích đoạn trượt phép quét tiêm prompt | `unsafe_content` |
| Trích đoạn dẫn một nguồn chưa từng được nhận | `unresolved_reference` |
| Cùng một tham chiếu được dùng hai lần trong một nhánh | `duplicate_reference` |
| Trích đoạn bị cắt cho vừa 4.000 ký tự | `truncation` |
| Nguồn vượt 8 trích đoạn | `content_limit` |
| Ngày công bố nằm ngoài cửa sổ độ mới được yêu cầu | `freshness_out_of_window` |
| Ngày công bố thiếu hoặc độ tin cậy thấp | `freshness_uncertain` |
| Bằng chứng phải cắt cho vừa 128 KiB | `artifact_limit` |

URL trùng và câu trích giống nhau từng byte bị khử trùng trong im lặng. URL được chuẩn hóa trước khi so
sánh: bỏ fragment, hạ chữ thường tên host, bỏ cổng mặc định và dấu gạch chéo cuối, sắp xếp các tham số
truy vấn.

Độ mới không loại nguồn chỉ vì tín hiệu yếu. Ngày nằm ngoài cửa sổ chỉ bị từ chối khi chính ngày đó có
độ tin cậy cao. Ngày công bố đến từ hai tín hiệu độc lập: siêu dữ liệu của nhà cung cấp tìm kiếm (chỉ là
ước lượng) và chính markup của trang (JSON-LD, các meta published-time, thẻ `<time>` có ngày). Hai bên
khớp thì ghi ngày ở độ tin cậy cao; lệch nhau thì ghi ngày của trang ở độ tin cậy thấp, tức là nhận
nguồn nhưng bị trừ điểm. Chỉ có ngày từ trang thì tính là rút trích ở độ tin cậy trung bình.

### Quy tắc độ phủ

- Luận điểm `factual` sống sót nếu còn ít nhất một trích đoạn được dẫn vẫn được nhận và nguồn của nó còn
  sống; nếu không, nó bị loại kèm `missing_support`.
- Luận điểm `numeric` chỉ sống sót ở nơi giá trị, đơn vị và phần ngày của nó xuất hiện nguyên văn trong
  trích đoạn được dẫn. Có liên kết mà không cái nào khớp thì bị loại và nêu xung đột `numeric_mismatch`;
  một số khớp thì được giữ nhưng bị giới hạn vào đúng phần bằng chứng khớp.
- Luận điểm `inference` sống sót nếu còn dẫn ít nhất một trích đoạn.

`factual_contradiction` được nêu khi hai luận điểm số đã nhận cùng nói về một đại lượng (cùng đơn vị,
phạm vi, ngày hiệu lực) mà giá trị lệch nhau quá mức làm tròn. Đơn vị chỉ được so sánh, không quy đổi,
nên các con số khác đơn vị bị bỏ qua. Mọi luận điểm trả về cho agent gọi đều mang `independentSources`,
được suy ra ở ranh giới đó từ đồ thị bằng chứng: số host xuất bản khác nhau, hai bản y hệt từng byte
tính là một.

## Vòng soát

Reviewer chấm sáu chiều (`factualSupport`, `citationAccuracy`, `completeness`, `sourceQuality`,
`relevance`, `clarity`). Duyệt khi mọi chiều đạt từ 0,4 trở lên, điểm tổng hợp từ 0,7 trở lên, không
luận điểm nào thiếu hậu thuẫn và không còn vấn đề tồn đọng; thiếu một điều là phải sửa.

Một lần sửa biến các vấn đề reviewer nêu thành câu hỏi bổ sung và chỉ crawl lại những câu đó. Reviewer
cũng thấy có bao nhiêu nhà xuất bản độc lập đứng sau mỗi luận điểm, và mỗi vòng soát được dùng một lần
bổ sung để tìm thêm nguồn cho luận điểm trả lời chỉ có một nguồn. Lần bổ sung lấy tài liệu mới, không
dùng lại cache.

Khâu tổng hợp chỉ chạy lại khi bằng chứng đổi hoặc còn một chỉnh sửa ngoài phần nghiên cứu chưa xử lý.
Một lần sửa không tạo ra điều nào trong hai điều đó là bế tắc và vòng lặp kết thúc ngay. Vòng lặp cũng
dừng khi chạm trần số vòng, và kết quả khi đó là `completed_with_gaps`.

## Thử lại và dự phòng

Mỗi câu hỏi được crawl tối đa hai lần. Lần hai gửi lại cho mô hình chi tiết lỗi kiểm của lần đầu như một
lời nhắc sửa và dùng lại tài liệu truy hồi đã cache. Các lỗi dứt điểm (bị hủy, cạn ngân sách hay sức
chứa, phát hiện vòng lặp, mô hình không tương thích) không bao giờ được thử lại.

Nếu mọi câu hỏi trong kế hoạch đều hỏng và mọi lỗi đều thử lại được, phiên lùi về một lần tìm kiếm đúng
nguyên câu hỏi, ưu tiên nguồn chính thức. Kết quả dự phòng là `completed_with_gaps`, mang mức bằng chứng
`limited` và bỏ qua vòng soát. Khi khâu tổng hợp hỏng, phiên khôi phục bằng một báo cáo chọn mục tất định
và ghi khoảng trống `synthesis_recovery`.

## Sức chứa và ngân sách

Nghiên cứu giữ chỗ trước các lời gọi ủy quyền. Độ sâu được yêu cầu cần nhiều hơn lượt chat còn có thể cấp
thì nó hỏng ngay với `capacity_exhausted`. Nó giữ chỗ 85% ngân sách còn lại của lượt chat
(`AGENT_BUDGET_FRACTION`) và để phần còn lại cho lượt cha.

Lời gọi tùy chọn dùng phần còn lại ngoài khoản đó: thêm câu hỏi, các vòng soát mà kế hoạch phức tạp được
hưởng, lần sửa lại, lần hỏi lại một câu hỏi và phần bổ sung sau soát. Số câu hỏi của planner chỉ tính
những lời gọi còn giữ chỗ được. Lời gọi nào không đủ suất thì nghiên cứu bỏ qua và ghi chú chỗ thiếu,
không hỏng sau khi đã tốn công. Câu hỏi không tìm được nguồn nào thì không tốn lời gọi nhờ crawler đọc,
và lần thử lại sẽ tìm mới từ đầu. Mỗi lát crawl để lại 25% của giai đoạn chưa giữ chỗ, để phí của nhà
cung cấp tìm kiếm trả tiền có chỗ ghi.

## Giới hạn

Cố định trong `RESEARCH_LIMITS` (`src/core/config/resolvers/research.ts`); không có mục `[research]`. Hồ
sơ có thể thu hẹp một giới hạn, không bao giờ nâng.

| Giới hạn | Giá trị |
| --- | --- |
| Số câu hỏi | 7 |
| Từ khóa tìm kiếm mỗi câu hỏi | 3 |
| Truy vấn con | 42 (7 x 3 x 3 lượt, bị chặn) |
| Số vòng soát | 2 |
| Điểm duyệt | 0,7 |
| Cỡ mỗi trích đoạn | 4.000 ký tự, cắt ở ranh giới câu |
| Trích đoạn mỗi nguồn | 8 |
| Gói bằng chứng | 128 KiB (UTF-8) |
| Trang tự đọc mỗi câu hỏi | 3 |
| Văn bản đầy đủ mỗi nguồn | 64 KiB, không bao giờ vào kết quả |

Mức suy luận và trần đầu ra của từng giai đoạn cũng cố định và ghi đè những gì `agent.toml` của worker khai:

| Giai đoạn | Suy luận | Token đầu ra tối đa |
| --- | --- | --- |
| planner | `medium` | 6.000 |
| reviewer | `medium` | 6.000 |
| synthesizer | `low` | 6.000 |
| crawler | `low` | 12.000 |

Token suy nghĩ cũng tính vào trần đầu ra, nên mỗi giai đoạn phải đủ chỗ cho cả phần suy luận lẫn câu trả
lời, nếu không nhà cung cấp cắt ở `finish=length` khi câu trả lời còn chưa có. Mô hình suy luận thích ứng
không giữ `low` trong một ngân sách cố định: với tám trang tiếng Việt, Claude Haiku 5.5 đã tiêu hơn 4.000
token suy nghĩ chỉ riêng ở bước crawler, nên trần của bước này lớn hơn.

Các trần schema (`src/engine/research/contracts.ts`) áp cho mỗi lần chạy dù cấu hình thế nào: 8 luận điểm
mỗi nhánh câu hỏi, 3 nguồn mỗi luận điểm, 8 mục trong mỗi mục báo cáo, 12 khoảng trống, 6 vấn đề soát, 64
lần truy hồi, thông báo lỗi 500 ký tự và câu hỏi 20.000 ký tự. Một lần đọc trang bị chặn ở 1 MiB trước khi
rút trích, và đoạn trích tìm kiếm ở 400 ký tự (`snippetMaxChars` trong
`core/config/resolvers/web-search.ts`).

## Bản đồ mã nguồn

- Quy trình, các giai đoạn và hồ sơ độ sâu: [`engine/research/`](../../src/engine/research)
- Truy hồi (tìm kiếm, xếp hạng, tài liệu, ngày trang): [`engine/research/retrieval/`](../../src/engine/research/retrieval)
- Mô hình bằng chứng, xét nhận, độ phủ, phân định: [`engine/research/evidence/`](../../src/engine/research/evidence)
- Vòng soát: [`engine/research/review/`](../../src/engine/research/review)
- Giới hạn và cài đặt từng giai đoạn: [`core/config/resolvers/research.ts`](../../src/core/config/resolvers/research.ts)
- Hợp đồng, mã lỗi, trần schema: [`engine/research/contracts.ts`](../../src/engine/research/contracts.ts)
- Công cụ `research`: [`tools/research.ts`](../../src/tools/research.ts)
- Tìm kiếm web và tải trang: [`tools/web/`](../../src/tools/web)
- Hồ sơ worker: [`engine/agents/research-planner/`](../../src/engine/agents/research-planner), cùng cấp là `research-crawler/`, `research-synthesizer/`, `research-reviewer/`, `deep-researcher/`
