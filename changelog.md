[19/07/2026]
CẬP NHẬT:
- Thiết kế lại giao diện điều hướng thích ứng theo chuẩn Material Design 3: Thay thế sidebar tĩnh cũ bằng Navigation Rail (Desktop) và Navigation Drawer di động + Scrim backdrop + Mobile AppBar.
- Cập nhật lại tông màu giao diện chuẩn M3 sang hệ màu Tím đất (màu tím `#8d437f` làm Primary và hồng nhạt `#ffd7f1` làm Primary Container) trên cả hai chế độ Sáng/Tối, lưu trữ qua localStorage.
- Sửa lỗi tràn viền (overflow) làm thò lề trái của Navigation Drawer khi ở trạng thái ẩn bằng việc áp dụng `box-sizing: border-box`.
- Chỉ định thư mục cấu hình agent `.agents/` vào `.gitignore` để tránh rò rỉ dữ liệu cấu hình.
- Đẩy ô nghĩa tiếng Việt lên đầu, thêm API dịch vào từng ô nghĩa cụ thể của tiếng Anh, nhằm đảm bảo người dùng hiểu cụ thể từng nghĩa.
- Thay đổi cách thức hoạt động của chế độ luyện tập: Phân chia chế độ luyện tập thành luyện tập từng từ theo topic và luyện tập tổng hợp các từ thuộc nhiều topic.
- Sửa lỗi không thể xóa topic.
- Khắc phục lỗi trùng từ ở nhiều chủ đề khác nhau (Notebook fix): Cho phép lưu một từ vào nhiều chủ đề với định nghĩa cụ thể khác nhau; nâng cấp cơ sở dữ liệu (Prisma & SQLite migrations) và tối ưu hóa tốc độ tải trang.
- Tích hợp công cụ phân tích và kiểm tra lỗi ngữ pháp/cấu trúc câu ví dụ (Grammar Checker) thông qua LanguageTool API khi người dùng tự đặt câu trong phần Ôn tập.
- Phân tách và đối chứng phiên âm IPA & file phát âm (audio) của giọng Anh-Anh (🇬🇧 UK) và Anh-Mỹ (🇺🇸 US) song song trên các giao diện: Tra từ điển, Notebook và thẻ Ôn tập (Practice).
- Cập nhật lại API.
# API ĐÃ SỬ DỤNG:
- API dịch nghĩa: https://api.mymemory.translated.net/get
- API kiểm tra ngữ pháp: https://api.languagetool.org/v2/check