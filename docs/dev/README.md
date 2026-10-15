# OpenAlpha cho developer

Các trang này dành cho người sửa OpenAlpha hoặc xây thêm trên nó. Nếu bạn chỉ dùng OpenAlpha để đầu
tư, các [trang hướng dẫn](../README.md) là đủ. Quy ước viết code - các tầng, cổng kiểm, phong cách - nằm
trong [AGENTS.md](../../AGENTS.md) và [CONTRIBUTING.md](../../CONTRIBUTING.md).

| Trang | Nội dung |
|---|---|
| [ben-trong.md](ben-trong.md) | Quyết định kiến trúc, danh sách tính năng, hợp đồng hiển thị, MCP |
| [mo-rong.md](mo-rong.md) | Bề mặt SDK, nhúng runtime, container ứng dụng, plugin |
| [nguon-du-lieu.md](nguon-du-lieu.md) | Hợp đồng nguồn, adapter, đăng ký, định tuyến, lỗi, cache |
| [giao-dich.md](giao-dich.md) | Hợp đồng sau đề xuất, cảnh báo, sổ lệnh, sàn và API HTTP |
| [tro-ly.md](tro-ly.md) | Bộ nạp agent, ủy quyền, kỹ năng, chuỗi mô hình, thử lại, cache |
| [ngan-sach.md](ngan-sach.md) | Xét chi phí, quyết toán và cách chia ngân sách trên cây phiên chạy |
| [kenh.md](kenh.md) | Định nghĩa kênh, hợp đồng adapter, thêm một kênh |
| [an-toan.md](an-toan.md) | Cổng phê duyệt và cây lỗi |
| [luu-tru.md](luu-tru.md) | Dialect, migration, sổ đăng ký bảng, kho phiên |
| [van-hanh.md](van-hanh.md) | Vòng lặp daemon, bộ lập lịch, giao thức heartbeat |
| [nghien-cuu.md](nghien-cuu.md) | Một lượt nghiên cứu được dựng thế nào và bằng chứng được nhận ra sao |

## Tìm code ở đâu

Những chỗ chưa có trang riêng:

- Cấu hình: schema ở [core/config/schema.ts](../../src/core/config/schema.ts), giá trị mặc định ở
  [core/config/resolve.ts](../../src/core/config/resolve.ts) và các resolver cạnh nó.
- Danh mục provider và mô hình: [ai/catalog.ts](../../src/ai/catalog.ts).
- Lệnh CLI: [cli/registry.ts](../../src/cli/registry.ts) (`api` và `setup` do máy chủ API thêm vào).
- Lệnh chat giao dịch: mỗi tính năng giữ lệnh của mình ở `features/<tên>/command.ts`, đăng ký tại
  [trading/wiring/catalog/commands.ts](../../src/trading/wiring/catalog/commands.ts). Phần giao dịch đăng
  ký lệnh, tool và agent ngay lúc khởi động, nên tên thị trường, sàn hay vùng sai, hoặc thiếu khóa
  ngôn ngữ, sẽ làm khởi động thất bại chứ không đợi tới lúc chạy.
- Sàng lọc theo thị trường: [equity-vn/screen.ts](../../src/trading/markets/equity-vn/screen.ts),
  [crypto/screen.ts](../../src/trading/markets/crypto/screen.ts).
- Trạng thái thị trường: [markets/macro-risk.ts](../../src/trading/markets/macro-risk.ts) (công thức
  chung), [equity-vn/evidence/macro.ts](../../src/trading/markets/equity-vn/evidence/macro.ts) (lớp phủ VN).
- Quy trình đề xuất: [features/suggestion/pipeline/](../../src/trading/features/suggestion/pipeline/).
- Bản tin sáng: [equity-vn/brief/](../../src/trading/markets/equity-vn/brief/).
- Sổ và danh mục: [features/ledger/](../../src/trading/features/ledger/),
  [features/portfolio/](../../src/trading/features/portfolio/); tư vấn cân danh mục và phân bổ ở
  [portfolio/folds/](../../src/trading/features/portfolio/folds/).
- Cảnh báo, thoát vị thế và biến động bất thường: [features/alerts/](../../src/trading/features/alerts/).
