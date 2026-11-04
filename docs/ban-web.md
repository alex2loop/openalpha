# Bản web

Bản web là OpenAlpha chạy ngay trong một thẻ trình duyệt của bạn. Mở trang là dùng được, không cần tài khoản. Khi muốn chạy phân tích, bạn thêm key AI của chính mình. Sổ giao dịch, danh mục, key và kết quả đều nằm trên máy bạn.

> Bản web đang chạy thử và chưa có địa chỉ công khai. Trang này mô tả cách nó hoạt động khi mở cho mọi người.

Bản web là công cụ phân tích để bạn tự dùng. Mỗi phân tích đặt hai bên cạnh nhau và không kết thúc bằng kết luận nào; không mã nào bị xếp hạng hay gắn nhãn tốt, xấu. Quyết định luôn là của bạn. Nó cũng là cách xem OpenAlpha làm gì trên chính các mã của bạn trước khi cài bản đầy đủ; [bản web và bản cài](#bản-web-và-bản-cài) nói hai bên khác nhau ở đâu và vì sao.

## Bắt đầu

1. **Mở trang** bằng một trình duyệt mới: Chrome, Edge, Firefox hoặc Safari. Trang cần giữ dữ liệu của bạn trên máy (cần kho tệp riêng và khóa giữa các thẻ). Trình duyệt không làm được thì trang báo rõ thay vì chạy dở. Lưu thẳng ra file trên máy chỉ có ở Chrome và Edge.
2. **Dùng ngay, không cần key.** Giá và thị trường, màn lọc, danh sách theo dõi, sổ giao dịch, danh mục, cân đối lại danh mục và `/brief` chạy luôn, không key, không tài khoản. Lần mở đầu tiên, trang tải lịch sử giá ở nền. Bảng yếu tố chưa đủ dữ liệu cho tới khi xong và có báo như vậy; các phần khác dùng được ngay.
3. **Thêm key AI** khi muốn phân tích: Cài đặt, mục "Key AI và tìm kiếm". Hãy tạo một key riêng, đặt hạn mức chi ở nhà cung cấp, để mọi lượt gọi nằm trong mức bạn chọn. OpenRouter là cách bắt đầu dễ nhất: một key dùng được hầu hết các mô hình, và nút "Kết nối OpenRouter" cho bạn đăng nhập ở đó, không cần dán gì và bạn thu hồi được key ngay ở OpenRouter. Dán key thì dùng được với mọi nhà cung cấp. Trước lần gửi đầu tiên tới mỗi nhà cung cấp, trang nói nội dung nào được gửi và hỏi bạn có đồng ý riêng cho nhà cung cấp đó không; chưa đồng ý thì chưa gửi gì.
4. **Ghi một giao dịch.** Bạn đặt lệnh ở công ty chứng khoán hoặc sàn như bình thường, rồi ghi vào sổ để sổ luôn đúng:

   ```
   /record deposit vps 100000000 VND 2026-11-03
   /record buy FPT 100 62000
   /portfolio
   ```

   Đổi mã, khối lượng và giá cho đúng giao dịch của bạn; các dòng trên chỉ minh họa cách gõ. Nếu trang chưa biết một mã, gõ `/refresh equity-vn` rồi thử lại, hoặc nêu rõ thị trường: `equity-vn:FPT`. `/transactions` liệt kê sổ; `/update <mã giao dịch> buy vps equity-vn:FPT 100 61500 VND 0 2026-11-03` (ghi đủ: loại, sàn, mã, khối lượng, giá, tiền tệ, phí, ngày) và `/delete <mã giao dịch>` sửa hoặc xóa một dòng theo mã giao dịch mà `/transactions` in ra, và `/delete` hỏi bạn xác nhận.
5. **Chạy một phân tích.** `/suggest FPT` đặt lập luận bên tăng và bên giảm cạnh nhau trên cùng một bộ dữ liệu, kèm các luận điểm bị dữ liệu phản bác và điều gì sẽ làm mỗi bên sai. Hai bên dùng cùng dữ liệu nên hãy đọc song song, đừng đếm xem bên nào nhiều ý hơn. Bạn bấm "Dừng" giữa chừng được; phiên chạy chưa xong thì không lưu gì. Mọi kết quả ghi mốc dữ liệu và mô hình AI đã dùng, kèm nhãn "do AI tạo" đi theo bản ghi khi bạn lưu hoặc xuất. **Phân tích do AI tạo, có thể sai và không phải khuyến nghị đầu tư. Đầu tư luôn có rủi ro, kể cả có thể mất vốn.**
6. **Lưu dữ liệu ra file.** Trình duyệt có thể xóa dữ liệu của trang khi máy thiếu chỗ, mà sổ giao dịch thì không tải lại được. Xem [dữ liệu nằm ở đâu](#dữ-liệu-nằm-ở-đâu).

## Key nào mở được gì

| Bạn có | Chạy được |
|---|---|
| Không có key | Giá và thị trường, màn lọc, danh sách theo dõi, sổ giao dịch, danh mục và giá trị theo thời gian, cân đối lại danh mục (chênh lệch so với mức bạn đặt), bản tin khi đang mở trang (`/brief`), xuất và mở file |
| Key AI: OpenRouter, OpenAI, DeepSeek, Anthropic, Google Gemini, xAI hoặc Mistral | `/suggest` (phân tích bên tăng và bên giảm) |
| Key AI và key tìm kiếm: Tavily, Serper hoặc DeepSeek | `/research` |
| Key của nhà cung cấp khác (Brave, Exa, mọi nhà cung cấp AI khác), key sàn, đăng nhập gói ChatGPT | Chỉ dùng ở bản cài |

Vì sao danh sách ngắn: một nhà cung cấp chỉ dùng được từ trang web khi API của họ trả lời được cho trình duyệt (phải cho phép trang gọi trực tiếp). Các nhà cung cấp ở trên làm được. Những nhà khác thì không, nên chỉ chạy ở bản cài. OpenRouter dùng được hầu hết các mô hình với một key, nên bắt đầu từ đó. Key tìm kiếm của DeepSeek là một key khác với key AI của DeepSeek.

Mục nào cần key mà bạn chưa thêm thì chưa chạy được, cho tới khi bạn dán key đó trong Cài đặt. Bản web không nhận key sàn nào, kể cả quyền chỉ đọc; bạn đặt lệnh ở công ty chứng khoán hoặc sàn.

## Bản web và bản cài

Mỗi hàng dưới đây là một việc. Cột "Vì sao bản web chưa làm hết" nêu lý do cho từng chỗ thiếu. Trang hiện cùng các hàng này ở mục "Bản web và bản cài", lý do nằm thành một dòng dưới mỗi hàng, và cột "Bản cài" cũng là dòng gợi ý ngắn mà trang hiện đúng chỗ bản web dừng.

| Việc | Bản web | Bản cài | Vì sao bản web chưa làm hết |
|---|---|---|---|
| Giá và thị trường <!--id:market-prices--> | **Một phần.** Cổ phiếu VN, crypto, vàng VN và vàng thế giới, đọc thẳng từ các nguồn công khai ngay trong trình duyệt của bạn (`/market`, `/overview`, `/price`, `/refresh`). | Bản cài thêm cổ phiếu Mỹ, giá vàng thế giới giao ngay và nhiều nguồn dự phòng hơn. | Trình duyệt chỉ đọc được những nguồn cho phép trang web gọi trực tiếp; cổ phiếu Mỹ chưa có ở bản web, còn vàng thế giới lấy theo PAXG, token bảo chứng bằng vàng, có thể lệch dưới 1% so với giá giao ngay. |
| Màn lọc và yếu tố <!--id:screen-factors--> | **Một phần.** Bảng liệt kê từng mã với giá trị và mức phần trăm so với cả bảng của từng yếu tố, tính ngay trong trình duyệt. Bạn chọn cách sắp xếp: không có thứ tự mặc định, không có điểm tổng và không có nhãn "tốt nhất". Bảng nói rõ yếu tố nào còn thiếu. | Bản cài chấm đủ yếu tố cho cả bảng, gồm báo cáo tài chính, danh sách cảnh báo và thành phần chỉ số. | Báo cáo tài chính của cổ phiếu VN chỉ có ở bản cài, vì nguồn không cho trình duyệt đọc trực tiếp; các yếu tố dựa trên báo cáo ấy vì thế thiếu ở bản web. |
| Danh sách theo dõi <!--id:watchlist--> | **Có.** Theo dõi giá các mã bạn chọn (`/watchlist add`, `/watchlist`). | Giống bản web. | - |
| Sổ giao dịch <!--id:ledger--> | **Một phần.** Ghi nạp tiền, mua, bán, cổ tức, phí và sửa hoặc xóa từng dòng (`/record`, `/update`, `/delete`, `/transactions`) cho cổ phiếu VN, crypto và vàng VN. Bạn gõ số liệu khớp lệnh từ công ty chứng khoán hoặc sàn. | Bản cài còn có cổ phiếu Mỹ, và lấy số liệu khớp lệnh từ sàn bạn nối nếu có key. | Cổ phiếu Mỹ chưa có ở bản web, và bản web không nhận key sàn nên không đọc số liệu khớp lệnh từ sàn. |
| Danh mục và giá trị theo thời gian <!--id:portfolio-nav--> | **Có.** Giá trị, tỷ trọng từng nhóm, và giá trị danh mục theo thời gian (`/portfolio`, `/portfolio nav`, `/profile`), tính từ sổ của bạn và giá đã tải. Lịch sử giá trị được giữ theo khoảng thời gian lưu lịch sử mặc định, cũ hơn thì mất. | Giống bản web. | - |
| Cân đối lại danh mục <!--id:rebalance--> | **Một phần.** Cho thấy mỗi nhóm và mỗi mã bạn đang giữ lệch bao nhiêu so với mức bạn tự đặt, theo tỷ trọng và giá trị. Không có câu lệnh mua hoặc bán và không nêu lý do (`/rebalance`). Bạn đặt các mức đó bằng `/profile` hoặc trong Cài đặt; trên web chỉ có những gì bản này đọc: mức rủi ro, mục đích, kỳ hạn, tiền mặt dự phòng, trần ngành, cùng tỷ trọng mục tiêu và trần của từng nhóm. | Bản cài đề ra từng bước đưa danh mục về mức bạn đặt; bạn tự quyết có làm hay không. Hồ sơ của bản cài còn có các thiết lập quyết định cỡ của từng bước (rủi ro mỗi lệnh, rủi ro mở, mức giải ngân, các đợt vào lệnh và chốt lời). | Bản web chỉ làm phép tính chênh lệch so với mức bạn tự đặt, không đưa ra việc phải làm, nên thiết lập nào quyết định cỡ một bước thì không có gì để áp dụng; `/profile set` cho thiết lập đó sẽ trả lời rằng nó thuộc bản cài. |
| Phân tích bên tăng và bên giảm <!--id:analysis--> | **Cần key AI.** Hai bên lập luận trên cùng một bộ dữ liệu, kèm luận điểm bị dữ liệu phản bác và điều gì sẽ làm mỗi bên sai. Không có kết luận (`/suggest <mã>`). | Bản cài chạy đủ phiên tranh luận của mình (xem hàng kế). | Phân tích chạy bằng mô hình AI qua key của bạn (OpenRouter, OpenAI, DeepSeek, Anthropic, Google Gemini, xAI hoặc Mistral); chưa có key thì mục này không chạy được. |
| Phạm vi của phân tích <!--id:verdict-levels--> | **Một phần.** Mỗi phân tích đưa hai lập luận cạnh nhau để bạn tự cân nhắc, không có kết luận cho mã nào. | Bản cài đi xa hơn phần phân tích của bản web; chi tiết nằm trong hướng dẫn của bản cài. | Bản web đưa phân tích hai chiều để bạn tự cân nhắc. |
| Bản tin khi đang mở trang <!--id:brief-open--> | **Có.** Bản tin thị trường kèm tóm tắt sổ của bạn, mình dựng từ số liệu đã tải khi bạn gọi lúc đang mở trang (`/brief`). Không cần key AI, và không có phần nào nêu hướng đi cho từng mã. | Bản cài tự dựng bản tin vào giờ bạn chọn và gửi sẵn cho bạn. | - |
| Bản tin đúng giờ qua Telegram hoặc Zalo <!--id:brief-schedule--> | **Chỉ có ở bản cài.** | Bản cài gửi bản tin qua Telegram hoặc Zalo vào giờ bạn chọn, kể cả khi bạn không mở gì. | Trình duyệt không chạy khi bạn đóng thẻ, nên bản tin đúng giờ chỉ có ở bản cài. |
| Cảnh báo giá <!--id:alerts--> | **Chỉ có ở bản cài.** | Bản cài canh giá cả khi bạn không mở gì và gửi cảnh báo qua Telegram hoặc Zalo. | Cảnh báo phải canh liên tục, mà trình duyệt ngừng chạy khi bạn đóng thẻ. |
| Nghiên cứu có trích nguồn <!--id:research--> | **Cần key AI và key tìm kiếm.** Một câu hỏi được nghiên cứu có giới hạn, có trích nguồn, chạy trong trình duyệt (`/research <câu hỏi>`). | Bản cài dùng thêm công cụ tìm kiếm Brave và Exa. | Cần cả key AI và key tìm kiếm (Tavily, Serper hoặc DeepSeek); thiếu một trong hai thì chưa chạy được. |
| Chủ đề <!--id:themes--> | **Chỉ có ở bản cài.** | Bản cài theo dõi các chủ đề bạn đặt và chạy lại khi bạn muốn (`/themes`). | Bản web đầu tiên chưa có chủ đề; bản cài có đầy đủ. |
| Theo dõi kết quả các nhận định <!--id:track-record--> | **Chỉ có ở bản cài.** | Bản cài đối chiếu từng nhận định cũ với diễn biến giá thật sau đó (`/reflect`). | Phân tích của bản web không nêu kết luận hay mức giá nào, nên chưa có gì để đối chiếu với diễn biến giá sau đó. |
| Đồng bộ với sàn và đặt lệnh <!--id:venue-orders--> | **Chỉ có ở bản cài.** Bạn đặt lệnh ở công ty chứng khoán hoặc sàn, rồi ghi vào sổ. | Bản cài đồng bộ giao dịch từ sàn bạn nối và chỉ đặt lệnh khi bạn duyệt. | Bản web không nhận key sàn nào, kể cả quyền chỉ đọc, nên không đồng bộ giao dịch và không đặt lệnh. |
| Dùng gói ChatGPT của bạn <!--id:chatgpt-plan--> | **Chỉ có ở bản cài.** | Dùng gói ChatGPT của bạn: có trong bản cài. | Máy chủ mô hình của ChatGPT không cho trang web gọi trực tiếp, nên đăng nhập bằng gói ChatGPT chỉ chạy ở bản cài. |
| Trò chuyện với công cụ <!--id:chat-tools--> | **Chỉ có ở bản cài.** | Bản cài cho bạn trò chuyện và để trợ lý tự gọi công cụ như giá, sổ giao dịch, nghiên cứu. | Bản web đầu tiên chưa có trò chuyện với công cụ; bản cài có. |
| MCP <!--id:mcp--> | **Chỉ có ở bản cài.** | Bản cài chạy như máy chủ MCP để ứng dụng AI khác của bạn dùng các công cụ của OpenAlpha. | MCP là máy chủ chạy trên máy bạn để ứng dụng khác nối vào; một trang web không mở cổng cho ai nối vào được. |
| Chọn mô hình AI <!--id:model-tiers--> | **Một phần.** Chỉnh được bốn hạng: phân tích hai chiều, nghiên cứu, nghiên cứu sâu, và đọc và trích số liệu, với OpenRouter, OpenAI, DeepSeek, Anthropic, Google Gemini, xAI hoặc Mistral. Cài đặt lưu trong trình duyệt; đổi xong trang hỏi bạn rồi khởi động lại phần xử lý. | Bản cài chỉnh mọi hạng mô hình và mọi nhà cung cấp trong tệp cấu hình. | Bản web chỉ gọi được nhà cung cấp cho phép trang web gọi trực tiếp, và chưa có các hạng đọc tiêu đề, chủ đề và giao việc. |
| Nguồn dữ liệu <!--id:data-sources--> | **Một phần.** Bản web đọc các nguồn trả lời được cho trình duyệt: cổ phiếu VN, vàng VN, vàng thế giới (theo PAXG), crypto, một số chuỗi vĩ mô, tin từ CNBC và tin cổ phiếu VN từ VNDIRECT. Chưa có ở bản web: báo cáo tài chính VN, danh sách cảnh báo và kiểm soát, lãi suất SBV, chuỗi FRED (đô la, VIX), cổ phiếu Mỹ, thành phần VN30 và VN100 (khi nguồn không trả lời), và phần lớn nguồn tin. | Bản cài đọc đủ các nguồn trên, có nguồn dự phòng khi một nguồn lỗi. | Nhiều nguồn không cho trình duyệt gọi trực tiếp, hoặc cần tiêu đề mà trình duyệt không đặt được; chỗ nào thiếu, màn hình nói rõ thiếu gì. |
| Dữ liệu nằm ở đâu <!--id:where-data-lives--> | **Một phần.** Trong chính trình duyệt này, ở kho lưu trữ của trang. Bạn có thể lưu thêm một bản sao ra file (Chrome, Edge) hoặc xuất file bất cứ lúc nào. | Trên máy bạn, trong thư mục dữ liệu, có sao lưu hằng ngày. | Trình duyệt có thể xóa dữ liệu của trang khi máy thiếu chỗ, và Safari xóa sau 7 ngày không ghé nếu bạn chưa thêm trang vào màn hình chính. Giá tải lại được, sổ giao dịch thì không, nên hãy lưu ra file. |
| Chi phí <!--id:cost--> | **Một phần.** Bên vận hành không thu tiền của bạn. Chi phí duy nhất là các lượt gọi AI và tìm kiếm, tính vào key của bạn ở nhà cung cấp; hãy tạo key riêng có hạn mức chi. Chip chi phí ở đầu trang cho thấy mình ước tính đã dùng bao nhiêu hôm nay. | Bản cài cho thấy chi phí mỗi phiên chạy và có hạn mức chi theo ngày, theo tháng và theo từng phiên chạy (tùy chọn). | Trang có một hạn mức chi theo ngày (5 USD) để chặn chạy quá tay, nhưng nó tính theo giá niêm yết nên chỉ là ước tính; hạn mức thật là hạn mức bạn đặt cho key ở nhà cung cấp. |

## Dữ liệu nằm ở đâu

- **Cơ sở dữ liệu làm việc** nằm trong kho riêng của trang trong trình duyệt này, cùng cấu trúc với bản cài. Bên vận hành không nhận, không lưu và không xem nó. Trang được phục vụ dưới dạng tệp tĩnh; bên vận hành tắt Workers Logs, Logpush và web analytics và không đọc nhật ký nào, còn việc Cloudflare làm gì với một yêu cầu thì theo chính sách của Cloudflare, có đường dẫn ở trang quyền riêng tư của bản web.
- **Cái gì rời khỏi trình duyệt.** Các lần đọc nguồn công khai (giá, tin, số liệu vĩ mô) đi thẳng từ trình duyệt của bạn tới nguồn đó và không mang số tiền nào. Khi bạn dùng tính năng AI, trình duyệt gửi nội dung thẳng tới nhà cung cấp bạn chọn, bằng key của bạn. Số tiền, giá vốn, khối lượng, giá khớp và chi phí chạy AI của bạn không bao giờ được gửi cho mô hình. `/brief` không gọi mô hình nào. Trang quyền riêng tư của bản web liệt kê từng tính năng gửi gì.
- **Key** mặc định chỉ ở bộ nhớ của thẻ và mất khi bạn đóng thẻ. "Ghi nhớ trên máy này" tắt sẵn; bật thì key nằm trong kho của trình duyệt trên máy này. Key không bao giờ nằm trong cơ sở dữ liệu đã xuất, và key bạn dán nhầm vào thanh lệnh chỉ được che trong lịch sử khi engine đã giữ key đó, tức là sau khi bạn đồng ý gửi tới nhà cung cấp; trước đó, và với key dạng không nhận ra được, key vẫn nằm trong lịch sử. "Xóa key" xóa key của một nhà cung cấp cùng việc bạn đã đồng ý gửi tới nhà cung cấp đó, ở mọi thẻ của trình duyệt này đang mở trang. Đổi key thì áp dụng từ yêu cầu kế tiếp, kể cả các yêu cầu sau của một phiên chạy đang diễn ra. Thanh lệnh không gửi một dòng có đoạn dài toàn chữ và số trông như key, mà nhắc dán key ở Cài đặt, mục "Key AI và tìm kiếm"; dòng vẫn nằm trong ô. Một đường dẫn dài có đoạn như vậy (slug bài báo dài có chứa số) cũng bị từ chối; hãy bỏ phần gây ra.
- **Lưu ra file** (Chrome và Edge): trong Cài đặt, mục "Dữ liệu trên máy", chọn "Lưu vào file trên máy" rồi chọn một file. Sau mỗi lần bạn ghi sổ và khi bạn rời thẻ, trang ghi một bản đầy đủ vào file đó, qua một file tạm rồi mới thay, nên đóng thẻ giữa chừng cũng không làm hỏng file. Chrome có thể hỏi lại quyền ghi ở mỗi lần ghé; khi chưa có quyền, trang hiện nút "Tiếp tục lưu vào file" và không tự bật cửa sổ hỏi. Firefox và Safari không có tùy chọn này; hãy dùng "Xuất ra file".
- **Xuất và mở file.** "Xuất ra file" tải về một bản đầy đủ: sổ giao dịch, danh mục, phân tích đã lưu và cài đặt, không có key. "Mở file" nạp một file do bản web lưu, từ máy hoặc trình duyệt khác, và thay dữ liệu ở đây sau khi bạn xác nhận. File của bản cài chưa mở được trên bản web; trang nói vậy và không đổi gì. File mang bảng, chỉ mục, trigger hoặc view mà bản web không tự tạo ra bị từ chối như một file trang không đọc được, và dữ liệu giữ nguyên.
- **Trình duyệt có thể xóa dữ liệu của trang** khi máy thiếu chỗ. Trang xin trình duyệt giữ bền nhưng điều đó không được bảo đảm; Cài đặt cho biết trình duyệt có đồng ý không. Safari còn xóa dữ liệu của trang nếu 7 ngày không ghé, trừ khi bạn thêm trang vào màn hình chính. Giá tải lại được, sổ giao dịch thì không, nên hãy lưu ra file hoặc xuất đều đặn. Khi máy hết chỗ, trang nói rõ, ngừng ghi và giữ nguyên phần đang có; bạn giải phóng bớt dung lượng hoặc xuất dữ liệu ra, rồi tải lại trang.
- **Giữ được bao lâu.** Trang dọn những gì tải lại hoặc dựng lại được, theo cùng các khoảng thời gian như [`[retention]`](cau-hinh.md#retention) của bản cài: các phiên chạy đã xong và thông báo, các cuộc trò chuyện cũ, bản tin đã lưu cũ hơn bản mới nhất, và bản ghi các lượt gọi mô hình trước đây. Không bao giờ bị dọn: dòng sổ giao dịch, hồ sơ và mức bạn đặt, phân tích đã lưu và cài đặt. Giá trị danh mục theo thời gian theo khoảng thời gian lưu lịch sử (`history_days`, mặc định ba năm); điểm cũ hơn thì mất và không tải lại được.
- **Hai thẻ cùng lúc.** Chỉ một thẻ được ghi vào dữ liệu. Thẻ thứ hai hỏi bạn có muốn dùng thẻ đó thay không ("Dùng ở thẻ này"); thẻ bị thay báo là đã bị thay và dừng lại.
- **"Dữ liệu lúc ..."** là mốc của số liệu mới nhất đang có trong trình duyệt, không phải giờ hiện tại. Trang tải thêm khi bạn mở trang, theo định kỳ trong lúc trang còn mở và khi bạn gõ `/refresh`. Mất mạng thì phần đã lưu vẫn đọc được và trang nói là chưa lấy được gì mới.
- **Xóa.** "Xóa toàn bộ dữ liệu trên máy", trong Cài đặt, xóa cơ sở dữ liệu đã lưu, key, các lần bạn đã đồng ý, file đang nhớ và cài đặt sau khi bạn xác nhận, đồng thời làm trống key đang giữ ở các thẻ khác của trình duyệt này. Không khôi phục được, nên hãy xuất trước nếu muốn giữ gì đó.

## Chuyển sang bản cài

Bản cài khôi phục cơ sở dữ liệu bạn xuất ra, nên mọi thứ bạn đã ghi đi cùng bạn. Key thì không: key không bao giờ nằm trong file.

1. Trong Cài đặt, mục "Dữ liệu trên máy", bấm "Xuất để chuyển" và giữ file.
2. Cài OpenAlpha theo [hướng dẫn cài](../README.vi.md). Bản cài phải cùng bản phát hành với bản web hoặc mới hơn: file mang những migration mà bản cài không biết thì bị từ chối khi nó khởi động.
3. Nếu dịch vụ nền của bản cài đang chạy, dừng nó: `openalpha stop`.
4. Nạp file: `openalpha db restore <đường dẫn tới file>`. Câu lệnh này kiểm file có phải cơ sở dữ liệu SQLite nguyên vẹn không, hỏi xác nhận, rồi giữ cơ sở dữ liệu bị thay trong `backups/` của thư mục dữ liệu ([hướng dẫn lưu trữ](luu-tru.md#sao-lưu-và-khôi-phục-sqlite)).

Chiều ngược lại chưa có: bản web chưa mở được file của bản cài.

## Nguồn còn thiếu ở v1

Bản web chỉ đọc được những nguồn cho phép trình duyệt gọi trực tiếp. Chỗ nào thiếu, màn hình nói rõ thiếu gì và không tính nó là số không.

| Thiếu | Ảnh hưởng |
|---|---|
| Danh sách cảnh báo và kiểm soát của sở giao dịch | Cờ cảnh báo của một mã không hiện |
| Lãi suất chính sách của Ngân hàng Nhà nước | Phần vĩ mô VN thiếu mục này |
| Chuỗi FRED (chỉ số đô la, VIX) | Phần vĩ mô Mỹ thiếu các mục đó |
| Cổ phiếu Mỹ | Không có giá, màn lọc hay sổ cho cổ phiếu Mỹ |
| Vàng thế giới giao ngay | Giá vàng thế giới lấy theo PAXG trên Binance, có thể lệch dưới 1% so với giá giao ngay; vàng trong nước vẫn có |
| Thành phần VN30 và VN100 | Nguồn duy nhất trình duyệt đọc được đang đăng một danh sách mà ứng dụng từ chối, nên bảng yếu tố không biết mã thuộc rổ nào |
| Báo cáo tài chính năm của cổ phiếu VN | Các yếu tố dựa trên báo cáo ấy thiếu ở bảng của bản web; bảng nói rõ yếu tố nào |
| Phần lớn nguồn tin | Còn tin từ VNDIRECT (cổ phiếu VN) và CNBC (kinh tế, thị trường Mỹ) |

Nguồn có thể đổi hoặc chặn trình duyệt bất cứ lúc nào; khi đó tính năng cần nó tạm dừng và trang nói rõ. Bản cài đọc đủ các nguồn trên, có nguồn dự phòng khi một nguồn lỗi.

## Giới hạn cần nhớ

- Bản web chỉ phân tích; mỗi phân tích kết thúc bằng một dòng nói bản web khác bản cài thế nào, không bao giờ bằng kết luận về một mã.
- Mọi phân tích và báo cáo nghiên cứu do AI tạo, có nhãn ghi rõ và ghi tên mô hình. Nhãn đi cùng bản ghi khi lưu và khi xuất.
- Bản web chạy khi trang đang mở. Bản tin đúng giờ, cảnh báo giá và những gì cần chạy lúc bạn đóng thẻ chỉ có ở bản cài.
- Phân tích có thể sai và không phải khuyến nghị đầu tư. Đầu tư luôn có rủi ro, kể cả có thể mất vốn.
