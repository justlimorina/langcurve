[19/07/2026]
CẬP NHẬT:
- Đẩy ô nghĩa tiếng Việt lên đầu, thêm API dịch vào từng ô nghĩa cụ thể của tiếng Anh, nhằm đảm bảo người dùng hiểu cụ thể từng nghĩa.
- Thay đổi cách thức hoạt động của chế độ luyện tập: Phân chia chế độ luyện tập thành luyện tập từng từ theo topic và luyện tập tổng hợp các từ thuộc nhiều topic.
- Sửa lỗi không thể xóa topic.
- Khắc phục lỗi trùng từ ở nhiều chủ đề khác nhau (Notebook fix): Cho phép lưu một từ vào nhiều chủ đề với định nghĩa cụ thể khác nhau; nâng cấp cơ sở dữ liệu (Prisma & SQLite migrations) và tối ưu hóa tốc độ tải trang.
- Tích hợp công cụ phân tích và kiểm tra lỗi ngữ pháp/cấu trúc câu ví dụ (Grammar Checker) thông qua LanguageTool API khi người dùng tự đặt câu trong phần Ôn tập.
- Cập nhật lại API.
# API ĐÃ SỬ DỤNG:
- API dịch nghĩa: https://api.mymemory.translated.net/get
- API kiểm tra ngữ pháp: https://api.languagetool.org/v2/check