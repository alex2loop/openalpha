# Chính sách bảo mật

🇻🇳 Tiếng Việt &bull; [🇬🇧 English](SECURITY.en.md)

OpenAlpha giữ khóa truy cập sàn giao dịch, khóa nhà cung cấp mô hình, và một sổ ghi các vị
thế thật. Nếu bạn thấy điều gì có thể làm hỏng những thứ đó, xin báo riêng, trước khi nó
thành chuyện công khai.

## Báo một lỗ hổng

Dùng **[kênh báo lỗ hổng riêng của GitHub](https://github.com/alex2loop/openalpha/security/advisories/new)**
- tab Security của repo này. Kênh đó là riêng giữa bạn và người bảo trì, và nó giữ toàn bộ
mốc thời gian công bố ở một chỗ.

**Xin đừng mở issue công khai cho một lỗ hổng.** README trỏ issue cho các lỗi thường; lỗ hổng
là thứ duy nhất không nên tới đó trước.

Hãy nêu, trong khả năng của bạn:

- kẻ tấn công được gì, không chỉ cái gì bị sai
- cách tái hiện nhỏ nhất bạn làm được, và commit bạn thấy nó trên đó
- nó cần một nhà cung cấp có ý xấu, một người cùng kênh có ý xấu, một plugin có ý xấu, hay
  chỉ cần một lượt chạy bình thường

Bạn sẽ nhận được phản hồi tiếp nhận trong vòng một tuần. Nếu báo cáo được xác nhận, bản sửa
và thông báo bảo mật ra cùng lúc, và bạn được ghi công trừ khi bạn muốn khác.

## Phiên bản được hỗ trợ

Chỉ `main` được hỗ trợ - bản sửa về đó và không có gì cũ hơn được vá lùi. Hãy ghim một tag
hoặc một commit nếu bạn cần sự ổn định, và đọc [lưu ý về độ ổn định](README.md#độ-ổn-định-giấy-phép-và-miễn-trừ)
trước khi dựa vào bất cứ phần nào.

## Những gì nằm trong phạm vi

Bất cứ thứ gì phá vỡ một trong các điều sau:

**Khóa không lọt ra ngoài.** Khóa lấy từ biến môi trường hoặc từ tệp khóa
(`~/.openalpha/env`, quyền `0600`, chỉ `onboard` và `openalpha key set` mới ghi, bị từ chối khi người
khác đọc được); không tệp cấu hình nào giữ giá trị khóa và không lệnh nào in khóa ra. Một đường đi ghi khóa xuống đĩa mà chưa che, làm khóa lọt vào log, vào một
thông báo lỗi, vào một dòng ký ức đã lưu hay vào prompt của mô hình - đều nằm trong phạm vi.

**Đường đặt lệnh là con đường duy nhất tới sàn.** Việc đặt lệnh nằm sau đúng một service, cần
được chấp thuận, và có hạn mức. Bất cứ thứ gì tới được sàn mà không đi qua đường đó, hoặc
lách được một hạn mức hay một lần chấp thuận, đều nằm trong phạm vi - kể cả một cách làm cho
các hạn mức toàn danh mục đọc phải trạng thái cũ bên trong cửa sổ ghi.

**Hạn mức rủi ro được giữ.** Đây là phần mềm tài chính, nên *một lỗi tính sai khối lượng
lệnh, để một hạn mức bị vượt, hay biến một lần từ chối thành một lần cho qua đều là lỗi bảo
mật ở đây*, không chỉ là lỗi đúng sai thông thường. `maximumOpenRiskPctNav` và
các hạn mức nhóm đều là những thứ chịu lực.

**Mô hình không bao giờ thấy danh mục của bạn bằng tiền.** Vị thế, tiền mặt, NAV và giá vốn
đều được chiếu qua một lớp trước khi tới một persona hay một tool. Những gì mô hình thấy được
là *hình dạng* của một vị thế - tỷ trọng theo phần của NAV, lãi lỗ chưa chốt theo phần trăm,
phần khối lượng đã về, số lô, ngày mua đầu tiên - chứ không bao giờ là một khối lượng, một
giá đã trả, một số dư tiền hay một số tiền. Có hai cơ chế bảo đảm điều đó:

- `AgentPortfolio` là một `Pick` ở mức biên dịch trên portfolio service, đơn giản là bỏ hẳn
  các hàm đọc giá trị tuyệt đối. `viewRelative` và `historyRelative` được mở ra; `view` và
  `history` thì không. Tiền và khối lượng **không thể biểu diễn được với một tool** - không
  có bộ lọc lúc chạy nào để lách, vì hàm đó không tồn tại trên kiểu.
- `OperatorOnlyField` (`held`, `units`, `policyUnits`) bị gỡ khỏi mọi payload đề xuất đưa cho
  mô hình, và `HeldWeight` thay một vị thế bằng tỷ trọng của nó.

Một cách đưa được con số tuyệt đối vào một prompt, một kết quả tool, hay ngữ cảnh của một
persona đều nằm trong phạm vi - kể cả cách phát sinh từ một trường mới trên `Suggestion` mà
không được thêm vào `OperatorOnlyField` trong cùng commit. Danh sách đó được duy trì bằng
tay và là nửa yếu hơn của lời bảo đảm này.

**Dữ liệu không tin được thì vẫn không được tin.** Tin nhắn từ các kênh, payload từ nguồn dữ
liệu, kết quả tool MCP và nội dung plugin đều đến từ bên ngoài. Prompt injection làm chuyển
hướng một lượt chạy, thoát khỏi cửa chấp thuận, hay vào được ký ức đều nằm trong phạm vi.

**Biên mạng được giữ.** Endpoint thuộc quyền của code và các lần fetch đều bị ghim. Một cách
làm cho tiến trình chạm tới một địa chỉ mà code không chọn - SSRF, DNS rebinding, một
redirect vào dải mạng nội bộ hay vào endpoint metadata của nhà cung cấp cloud - nằm trong
phạm vi.

**API cục bộ vẫn cục bộ.** Daemon chỉ bind loopback và xác thực bằng một bearer token lưu ở
quyền `0600`. Bất cứ thứ gì phơi nó ra xa hơn, hoặc nhận một request không có token đó, đều
nằm trong phạm vi.

**Plugin không chạy được khi chưa được đồng ý.** Code plugin chỉ chạy khi
`plugins.allow_code` được bật, và plugin không bao giờ góp được tool hay hook. Một cách lách
hai điều đó nằm trong phạm vi.

**Xử lý đường dẫn an toàn.** Agent ghi vào các thư mục riêng, có phòng vệ chống đua
symlink. Một lần vượt thư mục hay một cuộc đua thoát ra khỏi đó nằm trong phạm vi.

## Những gì không nằm trong phạm vi

- **Cấu hình của chính bạn.** Trỏ `data_dir` vào chỗ cả máy đọc được, commit `config.toml`
  của bạn lên repo, hay export một khóa vào một shell dùng chung - đó là lỗi người vận hành,
  không phải lỗ hổng. `.gitignore` chặn các trường hợp thường gặp; nó không chặn được hết.
- **Mô hình trả lời dở.** Một đề xuất sai, một persona lập luận kém, hay một nhà cung cấp
  trả về nội dung vô nghĩa là vấn đề chất lượng. Nó chỉ thành vấn đề bảo mật nếu nó vượt một
  trong các biên ở trên.
- **Dịch vụ của bên thứ ba.** Một lỗ hổng trong nhà cung cấp dữ liệu, một sàn, hay một nhà
  cung cấp mô hình thuộc về họ. Nhưng hãy nói cho chúng tôi nếu dự án này xử lý sự cố của họ
  một cách không an toàn.
- **Tự mình làm cạn tiền.** Hạn mức chi phí tồn tại để chặn việc đó; một lượt chạy tốn hơn
  bạn tưởng là chuyện cấu hình ngân sách, không phải một cuộc tấn công.
- Bất cứ thứ gì đòi kẻ tấn công đã có sẵn máy của bạn, shell của bạn, hay khóa của bạn.

## Những gì dự án này đã làm

Để bạn có ngữ cảnh khi đánh giá một phát hiện - đây là những thứ đã được thực thi, không
phải mong muốn:

| | |
|---|---|
| Khóa | từ biến môi trường hoặc tệp khóa `0600`; endpoint thuộc quyền code nên không cấu hình nào chuyển hướng được request |
| API cục bộ | bind loopback, bearer token quyền `0600`, danh sách origin cho phép, kiểm tra tiến trình gọi |
| Văn bản không tin được | quét prompt injection trước khi nó kịp lái một lượt chạy hay vào được ký ức |
| Log và lỗi | được che ở biên |
| Mạng | fetch có ghim, qua một chính sách mạng IPv4/IPv6/DNS |
| Hệ tệp | chuẩn hóa đường dẫn kèm phòng vệ chống đua symlink trên các tệp riêng |
| Plugin | không chạy code khi chưa bật `plugins.allow_code`; tool và hook bị cấm về mặt cấu trúc |
| Danh mục | mô hình thấy tỷ trọng và phần trăm, không bao giờ thấy tiền, khối lượng hay giá vốn - bỏ ngay ở mức kiểu |
| Đặt lệnh | một đường duy nhất, có người chấp thuận, giới hạn trong phiên và không bao giờ được ghi nhớ |
| Chi phí | hạn mức ngày, tháng và mỗi lượt chạy, cảnh báo mềm ở mức 80% |
