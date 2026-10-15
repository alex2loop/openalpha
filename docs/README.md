# Tài liệu OpenAlpha

> **Tiếng Việt là ngôn ngữ mặc định của sản phẩm.** Bản tiếng Anh nằm trong [`en/`](en/README.md) và
> là bản gốc của các trang dưới đây.
>
> **Một chữ bạn sẽ gặp nhiều:** *operator* chính là bạn - người giữ sổ, duyệt lệnh và chịu trách nhiệm
> cho mọi quyết định. Tài liệu giữ nguyên chữ này vì nó cũng là tên một khái niệm trong cơ sở dữ liệu.

## Bắt đầu ở đây

Mới biết dự án? Đọc [README](../README.md) trước: OpenAlpha làm gì, từ chối làm gì, và một đề xuất mẫu
từ đầu đến cuối.

Sau đó đọc **[Cẩm nang sử dụng](cam-nang.md)**. Đây là trang duy nhất bạn thật sự cần: cài đặt, hồ sơ
đầu tư, ghi sổ, bản đồ lệnh, nhịp vận hành hằng ngày và ý nghĩa từng con số. Viết cho nhà đầu tư, không
cần biết lập trình. Cẩm nang chỉ có tiếng Việt.

Chưa cài? Vào [phần cài đặt](cam-nang.md#2-cài-đặt-và-thiết-lập-lần-đầu).
Đã cài rồi? Vào [nhịp vận hành hằng ngày](cam-nang.md#5-nhịp-vận-hành-theo-kiểu-nhà-đầu-tư).

## Hướng dẫn tra cứu

Không trang nào cần đọc code.

| Trang | Nội dung |
|---|---|
| [cau-hinh.md](cau-hinh.md) | Mọi khóa trong `config.toml` |
| [lenh.md](lenh.md) | Mọi lệnh CLI và lệnh gạch chéo |
| [giao-dich.md](giao-dich.md) | Dữ liệu thị trường, đề xuất, sổ lệnh, danh mục, đặt lệnh |
| [nguon-du-lieu.md](nguon-du-lieu.md) | Nguồn nào trả lời việc gì, cần khóa nào, khi một nguồn lỗi thì sao |
| [tro-ly.md](tro-ly.md) | Viết một agent, ghép đội, kỹ năng, chọn mô hình |
| [an-toan.md](an-toan.md) | Phê duyệt, các lớp bảo vệ bạn, các lỗi bạn có thể gặp |
| [ngan-sach.md](ngan-sach.md) | Hạn mức chi tiêu và xem một lượt chạy tốn bao nhiêu |
| [van-hanh.md](van-hanh.md) | Vòng lặp nền, lịch chạy, heartbeat, chạy API trên máy chủ |
| [luu-tru.md](luu-tru.md) | SQLite hay Postgres, sao lưu, xuất nhập, phiên và lịch sử |
| [kenh.md](kenh.md) | Telegram và Zalo |
| [nghien-cuu.md](nghien-cuu.md) | Nghiên cứu web có giới hạn, có trích nguồn |
| [mang-xa-hoi.md](mang-xa-hoi.md) | Tham gia mạng xã hội kiểu Moltbook |

## Cho developer

Hợp đồng, cơ chế bên trong và bản đồ mã nguồn nằm ở [dev/](dev/README.md): nhúng runtime, viết plugin,
thêm nguồn dữ liệu hay kênh mới, và lý do code được tổ chức như hiện nay.

## Đóng góp tài liệu

Rất hoan nghênh chỗ sửa hay trang mới. Mỗi trang một chủ đề; đoạn nào hợp với hai trang thì nên dùng
link thay vì chép lại. Viết bản tiếng Anh trong `en/` trước, thêm bản tiếng Việt với tên tiếng Việt, và
thêm một dòng vào cả hai bảng mục lục. Việc operator làm thì vào trang hướng dẫn; thứ chỉ developer cần
thì vào `dev/`.
