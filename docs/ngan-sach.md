# Chi phí và ngân sách

Mỗi lần gọi mô hình đều tốn tiền. OpenAlpha ước lượng trước khi chi, ghi lại điều đã thật sự xảy ra, và dừng **khi** chạm
hạn mức chứ không phải sau đó.

Hạn mức là tùy chọn. Không khai gì thì chi tiêu không bị chặn, chỉ được theo dõi - bạn luôn biết được nó tốn bao nhiêu.
`openalpha onboard` và các file cấu hình tối giản đặt sẵn `max_daily_usd = 2` để tuần đầu không có bất ngờ;
khi đã quen mức dùng của mình, nâng lên hoặc đặt `0` để bỏ chặn.
Nhà cung cấp tìm kiếm dùng chung cuốn sổ đó: khoản Exa tự báo, và `[web_search] cost_per_search_usd` bạn khai cho Brave,
DeepSeek, Serper hay Tavily, đều rơi vào cùng một tổng với chi phí mô hình.

## Đặt hạn mức

Khai trong `config.toml` rồi khởi động lại. Cấu hình chỉ đọc một lần lúc khởi động.

```toml
[budget]
max_daily_usd   = 5
max_monthly_usd = 50
soft_warn_ratio = 0.8
max_per_run_usd = 0
```

| Thiết lập | Mặc định | Ý nghĩa |
| --- | ---: | --- |
| `max_daily_usd` | `0` | Mức chi tối đa trong một ngày. `0` là không chặn. |
| `max_monthly_usd` | `0` | Mức chi tối đa trong một tháng dương lịch. `0` là không chặn. |
| `soft_warn_ratio` | `0.8` | Cảnh báo một lần mỗi tiến trình và mỗi chu kỳ, khi chi tiêu dự phóng chạm tỷ lệ này của hạn mức. |
| `max_per_run_usd` | `0` | Mức chi tối đa của một phiên chạy gốc và toàn bộ việc nó ủy quyền. `0` là không chặn. |

Một workflow chạy tính là một phiên chạy: mọi bước và mọi lần thử lại của nó dùng chung một trần `max_per_run_usd`.

Ngày và tháng tính theo `[locale] timezone` (múi giờ của máy, `UTC` khi máy không báo gì) - cũng là lịch mà
`openalpha cost` đọc.

Trần của một phiên chạy là số nhỏ hơn giữa `max_per_run_usd` và `max_daily_usd`. Để cả hai bằng `0` thì không có trần
nào. `chat --max-cost-usd <số tiền>` thay trần đó cho đúng một phiên chạy; các cổng kiểm theo ngày và theo tháng vẫn áp lên
trên. Một lượt `/themes` còn dừng ở `[trading.themes] maximum_cost_usd` (mặc định `1.0`) khi đó là con số nhỏ hơn.

### Mức trần theo agent

Mỗi agent của chính bạn có thể mang `max_daily_usd` trong `agent.toml`: phần của hôm nay, nằm dưới
`[budget] max_daily_usd`. Giá trị cao hơn mức trần chung bị từ chối khi agent được nạp. `0` hoặc bỏ trống nghĩa là chỉ áp
mức trần chung của bạn.

Mức trần này cố ý để mềm:

- Nó đọc agent đã tiêu bao nhiêu hôm nay (theo ngày trên lịch của bạn) đúng một lần, khi phiên chạy **bắt đầu**, và không
  giữ chỗ gì.
- Hai phiên chạy được nhận cùng lúc đều qua, và một lượt đã nhận có thể xong vượt trần. Mức trần mỗi phiên chạy vẫn giới
  hạn từng lượt.
- Một cuộc tranh luận do công cụ của agent khởi động, một con nó ủy quyền và một con nghiên cứu đều tính vào mức trần này
  và không bao giờ bị từ chối giữa chừng.
- Khi lần đọc chi phí hỏng, phiên chạy cứ đi tiếp (lỗi được ghi `agents.cap_read_failed`).

Agent chạm trần trả lời "Agent này đã tiêu hết phần ngân sách của hôm nay" trên CLI, trên Telegram và qua socket
(`haltDetail: agent_daily_cap`). Đề xuất nó được nhờ chạy báo "Đã dừng: agent này hết ngân sách trong ngày". Tác vụ theo lịch
của nó bị bỏ qua mà không tính là một lần lỗi, nên không bao giờ leo lên nấc ba lần thì tắt.

Các đường tính vào persona chứ không vào một agent thì không có mức trần agent: `/suggest` và `/themes` của chính bạn, các
lô của bản tin và bộ trích số liệu vĩ mô.

## Xem đã tốn bao nhiêu

```bash
openalpha cost                                   # hôm nay
openalpha cost --period week
openalpha cost --period month
openalpha cost --from 2026-07-01 --to 2026-07-22 # bao gồm hai đầu, tối đa 366 ngày
openalpha cost --period week --breakdown         # tách theo agent và mô hình
```

`week` là tuần này tính từ thứ Hai đến hôm nay, `month` là tháng tính đến hôm nay. Bản in theo ngày và theo tháng nêu luôn hạn
mức khi có bật; theo tuần và theo khoảng tự chọn thì chỉ báo tổng.

`--breakdown` tách đúng cái tổng đó theo agent và mô hình, nên các dòng luôn cộng lại đúng bằng tổng. Đây là cách nhanh
nhất để trả lời "đổi sang mô hình kia có đáng không?": chạy trước và sau rồi so cả tiền lẫn độ trễ. Nó còn in một khối
**Theo agent** trước các dòng theo mô hình, mỗi agent chịu chi phí một dòng kèm số đã tiêu. Với `--period day` mặc định, mỗi
dòng còn cho thấy mức trần của agent ("$0.02 / $0.50 hôm nay"); tuần hoặc tháng thì bỏ nó, vì mức trần ngày đặt cạnh chi
phí cả tuần dễ gây hiểu lầm.

`status` cũng hiện chi tiêu hôm nay. Một phiên chạy bị ngân sách dừng sẽ đi theo đường `budget` thông thường, và phần chi
phí đã phát sinh vẫn được ghi lại.

Ở mọi nơi hiển thị, một phiên chạy có tốn tiền đều kết thúc bằng cùng một dòng cuối. Trong phiên chưa gọi mô hình lần nào (ví dụ chỉ tra giá) dòng cuối chỉ có thời gian chạy; sau bất kỳ lượt chat nào, chi tiêu đang chạy của phiên quay lại. Dòng đầy đủ gồm: chi phí, số token, số lần gọi mô hình,
thời gian trôi. Tên mô hình chỉ hiện khi đúng một mô hình phục vụ mọi lời gọi tính tiền. Nếu chuỗi dự phòng đổi mô hình giữa
chừng thì không còn một cái tên duy nhất, nên dòng cuối chỉ còn số đếm và lần đổi được in ở dòng ngay bên trên.

## Một lời gọi được chấp nhận như thế nào

Trước mỗi lời gọi, runtime ước lượng chi phí trong trường hợp xấu nhất và kiểm tra phiên chạy, ngày và tháng còn chỗ hay
không. Nếu còn, lời gọi chờ bộ giới hạn tần suất, các hạn mức toàn cục được kiểm thêm một lần nữa, rồi lời gọi mới đi. Phần
giữ chỗ cũng được tính khi xét duyệt, nên hai phiên chạy song song không thể cùng được duyệt trên cùng một đồng còn lại.

- **Việc bắt buộc** (một lượt thường, khâu nén hội thoại) dừng khi không được duyệt.
- **Việc tùy chọn** (như trích xuất sở thích người dùng) bị bỏ qua và ghi log.
- Hàng đợi của kênh cũng ngừng nhận phiên chạy mới một khi ngày hoặc tháng đã chạm hạn mức.

Khi chi phí thật vượt hạn mức, lần thử vẫn được tính tiền và giữ lại, rồi phiên chạy mới dừng. Phần đã trả tiền không bao
giờ bị vứt bớt cho tổng vừa với hạn mức - một cuốn sổ nói dối để nằm dưới giới hạn còn tệ hơn là không có sổ.

## Các con số nằm ở đâu

Mỗi lần thử, kể cả lần hỏng, lần thử lại và lần dự phòng, đều được ghi vào sổ chi phí trong cơ sở dữ liệu của bạn. Tổng theo
ngày, theo tháng và theo khoảng đều cộng từ các dòng đó, nên không có tổng nào riêng để mà lệch. Lúc khởi động, ngày và
tháng hiện tại được dựng lại từ sổ trước khi duyệt bất cứ việc gì.

Lần thử chưa tới được nhà cung cấp (kết nối bị từ chối, tên máy chủ không phân giải được, hoặc không đọc được thông tin
đăng nhập) được ghi với chi phí bằng 0: chưa gửi gì đi thì cũng chưa bị tính tiền.

Nếu một lần ghi vẫn hỏng sau ba lần thử lại, khoản chi được nối vào `unrecorded-spend.jsonl` trong thư mục dữ liệu. Lúc
khởi động, tệp đó được cộng ngược vào tổng ngày và tháng cho đến hết tháng của nó, nên khởi động lại không trả tiền về cho
các hạn mức. Khi cả lần nối đó cũng hỏng, hoặc tệp không đọc được hay bị hỏng lúc khởi động, thì không việc tốn tiền nào
được duyệt thêm chừng nào còn đặt hạn mức ngày hoặc tháng (`ledger_unavailable`). Không đặt hạn mức thì đó chỉ là một
khoảng hở trong báo cáo.

Chính sách lưu giữ có thể xóa phiên chat và tin nhắn cũ, nhưng nó tách rời các dòng lần thử chứ không xóa, nên lịch sử chi
phí vẫn còn.

---

## Ngân sách trên một cây phiên chạy

Khi một phiên chạy ủy quyền, tiền được chia sao cho con không thoát khỏi cái trần mà cha đang chịu.

- Phiên chạy con không bao giờ tự tạo ngân sách. Nó nhận một lát từ ngân sách của cha.
- Hạn mức ngày và tháng được kiểm ở mọi lời gọi, ở mọi độ sâu, nên một con không thể tiêu quá hạn mức ngày ngay cả khi lát
  của chính nó vẫn còn chỗ.
- Mỗi lần thử còn ghi **agent chịu chi phí**: agent có mức trần được tính khoản chi, không phải lúc nào cũng là agent chạy.
  Một con ủy quyền, một con nghiên cứu và một persona tranh luận do một công cụ khởi động đều tính cho agent đã nhờ. Dòng
  không ghi agent chịu chi phí thì tính cho agent đã chạy nó.

### Con nhận được gì

Cha giữ chỗ **85% ngân sách còn lại ngay từ đầu** thành một bể chung cho các con rút, ai tới trước dùng trước. 15% còn lại ở
với cha để đọc kết quả và viết câu trả lời. Một con làm xong rẻ sẽ để phần còn lại cho đứa anh em đang cần, nên không đồng
nào bị kẹt lại vô ích.

Đánh đổi của cách này: một con mất kiểm soát có thể hút cạn bể trước cả lời gọi đầu tiên của một đứa chậm hơn. Đứa đó khi ấy
báo `budget`, đúng như khi nó tiêu hết một lát riêng. Đây là lựa chọn có chủ ý - ngân sách bị kẹt là lãng phí **chắc chắn**,
còn một con mất kiểm soát chỉ là lãng phí **thỉnh thoảng**.

Cha còn $1,00, ba con chạy cùng lúc:

| | USD |
| --- | ---: |
| Giữ chỗ từ cha | 0,850 |
| Bể chung cho ba đứa rút | 0,850 |
| Cha giữ lại để viết câu trả lời | 0,150 |
| Dưới mức này thì từ chối cả nhóm (3 con x $0,001) | 0,003 |

Cả nhóm bị từ chối khi bể chia cho số con rơi xuống dưới $0,001 mỗi con. Thà nói không còn hơn khởi động ba con không đủ tiền
cho nổi một lời gọi. Ở phiên chạy không bị chặn thì toàn bộ phép tính này không cắn vào đâu cho tới khi bạn đặt hạn mức.

### Nghiên cứu nhận một bể theo giai đoạn

`research` chạy cây worker riêng, nên nó giữ chỗ đúng 85% một lần và chia theo giai đoạn:

| Độ sâu | plan | crawl | synthesize | review |
| --- | ---: | ---: | ---: | ---: |
| `light` | 0 | 0,70 | 0,30 | 0 |
| `medium` | 0,10 | 0,45 | 0,25 | 0,20 |
| `deep` | 0,10 | 0,50 | 0,20 | 0,20 |

Phí tìm kiếm đến theo hai đường. Exa báo đúng khoản thật và con số đó được dùng nguyên. Brave, DeepSeek, Serper và Tavily tính tiền
theo mỗi truy vấn nhưng không trả về gì, nên mỗi lần bị tính theo `cost_per_search_usd` bạn khai - không khai thì không bị
tính. DeepSeek chỉ bị tính khi lượt tìm có kết quả. DuckDuckGo và SearXNG tự dựng thì miễn phí thật. Một lần trúng cache và một lời gọi hỏng không bao giờ bị tính tiền.

### Khi một lát cạn

Chi tiêu được ghi, **rồi** lệnh dừng mới được ném ra. Ở một con, nó hiện ra như sau:

| Ở đâu | Bạn thấy gì |
| --- | --- |
| Kết quả của con | lý do `budget` |
| Kết quả công cụ | một lỗi kèm `budget_exhausted: true` |
| Cha | Chạy tiếp với phần văn bản dở dang cùng một thông báo, và **không được** gọi lại y nguyên |

Một người cha bị chính ngân sách của mình chặn sẽ dừng ở lần tính tiền kế tiếp. Kết quả bạn đã trả tiền không bao giờ bị vứt
đi.

### Những giới hạn không phải tiền

Chỉ ngân sách thì chưa chặn nổi một cây phiên chạy. Ba bộ đếm trong `[loop]` làm việc đó:

| Giới hạn | Ý nghĩa | Có hoàn lại? |
| --- | --- | --- |
| `delegation_depth` | Số tầng con tối đa từ phiên chạy gốc; tự ủy quyền và vòng lặp tổ tiên bị từ chối | không áp dụng |
| `max_delegations` | Một hạn ngạch dùng chung cho cả cây, giữ chỗ trước khi con khởi động | Không - con chạy xong không trả lại hạn ngạch |
| `max_parallel_delegations` | Số mục tối đa trong một lời gọi `delegate_parallel` | không áp dụng |

Hạn ngạch và ngân sách độc lập nhau: một cây có thể cạn số nhánh trong khi vẫn còn nhiều tiền, và ngược lại.

## Khi có sự cố

| Điều kiện | Kết quả |
| --- | --- |
| Ước lượng vượt ngân sách còn lại của phiên chạy | Việc bắt buộc dừng trước khi gọi nhà cung cấp |
| Ước lượng sẽ vượt một hạn mức ngày hoặc tháng đang bật | Việc bắt buộc dừng trước khi gọi nhà cung cấp; tác vụ theo lịch chờ hạn mức mở lại, không tính lỗi |
| Một agent đã tiêu hết `max_daily_usd` của chính nó | Phiên chạy gốc nó sở hữu dừng trước khi bắt đầu (`agent_daily_cap`); tác vụ của nó bị bỏ qua, không tính lỗi |
| Việc tùy chọn không xin được ngân sách | Bỏ qua; phiên chạy tiếp tục |
| Chi phí thật vượt một hạn mức | Lần thử vẫn bị tính tiền và được giữ, rồi phiên chạy dừng |
| Ghi lần thử bị hỏng | Thử lại, rồi khoản chi vào tệp chi chưa ghi và lỗi lan ra; nếu bước đó cũng hỏng thì việc tốn tiền dừng khi đang có hạn mức (`ledger_unavailable`) |
| Tiến trình khởi động lại | Tổng ngày và tháng dựng lại từ sổ chi phí và tệp chi chưa ghi |

Xem thêm [tham chiếu `config.toml`](cau-hinh.md), [tham chiếu lệnh](lenh.md), và
[đội agent](tro-ly.md#đội-và-ủy-quyền) cho chính hợp đồng ủy quyền.

Bên trong: [dev/ngan-sach.md](dev/ngan-sach.md).
