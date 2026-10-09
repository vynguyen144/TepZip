Novel Downloader Chrome V2.4.2
================================

TÍNH NĂNG
- Chọn khoảng chương để tải, ví dụ chương 1–100 rồi 101–198.
- Chương được lưu theo chỉ số gốc của danh sách quét; khi chọn khoảng khác, chương đã lưu trong khoảng đó sẽ được bỏ qua.
- Quét lại cùng trang truyện không tự xóa dữ liệu chương.
- Nút “Xuất EPUB phần đã tải” xuất tất cả chương còn trong kho thành một EPUB, theo thứ tự chương.
- Khi một khoảng tải hoàn tất, tiện ích tạo EPUB từ toàn bộ chương hiện lưu. Vì vậy sau khi tải đủ các khoảng, EPUB cuối sẽ gồm các chương của các đợt trước và đợt mới.
- Khi website trả về giới hạn truy cập, tiện ích dừng lại. Chỉ bấm thử lại thủ công sau khi trang truyện đọc bình thường; không tự gửi request lặp lại.
- Thời gian chờ có mức tối thiểu 30 giây. Không có cách đảm bảo website không chặn.

CÁCH DÙNG
1. Sao lưu và xuất EPUB dữ liệu hiện có trước khi cập nhật.
2. Mở chrome://extensions, bật Developer mode nếu cần.
3. Sao chép các file bên trong thư mục noveldl_work của ZIP đè lên các file trong ĐÚNG thư mục đang được tiện ích V2.3.0 dùng.
4. Vào chrome://extensions và bấm Reload trên tiện ích hiện tại. Không gỡ tiện ích rồi cài từ thư mục mới, vì ID/origin có thể đổi khiến IndexedDB cũ không còn được tiện ích mới nhìn thấy. Không xóa dữ liệu extension.
5. Mở trang truyện trên bhttpo.top rồi bấm “Quét chương”.
6. Nhập chương bắt đầu và kết thúc (ví dụ 1 và 100), sau đó bấm “Bắt đầu tải”.
7. Sau khi phần đầu xong, chọn khoảng tiếp theo (ví dụ 101 và 198) rồi bấm “Tải khoảng khác”.
8. Nút “Xuất EPUB phần đã tải” có thể dùng bất cứ lúc nào để tạo bản dự phòng.

BẢO VỆ DỮ LIỆU
- Nút “Xóa dữ liệu” mới là thao tác xóa chương khỏi kho; yêu cầu xác nhận.
- Không chuyển sang truyện khác khi còn dữ liệu chương trong kho. Hãy xuất EPUB và xóa dữ liệu có chủ đích trước khi đổi truyện.
- EPUB chỉ có các chương thực sự được lưu; nếu chương chưa tải thì sẽ không có trong tệp.
- Nếu bản V2.3.0 đang chạy, nên tạm dừng, xuất EPUB dự phòng, rồi mới Reload/cập nhật. Reload có thể làm gián đoạn yêu cầu đang chạy.

LƯU Ý
Đã kiểm tra cú pháp JavaScript, JSON manifest và cấu trúc ZIP. Chưa chạy thử trực tiếp trên website thật; cấu trúc trang web có thể làm thay đổi khả năng quét/trích nội dung.


V2.4.2: EPUB được nén bằng DEFLATE (mimetype giữ nguyên không nén theo yêu cầu EPUB) để giảm dung lượng so với gói ZIP lưu nguyên dữ liệu.
