[24/07/2026]
CẬP NHẬT:
- Tích hợp biểu đồ "Đường cong học tập" (Curve Analytics) sử dụng Chart.js trực tiếp trên màn hình Dashboard, hiển thị tiến độ học từ vựng và chỉ số Easiness Factor (EF) trung bình.
- Triển khai bảng lưu lịch sử ôn tập `ReviewLog` trên cả PostgreSQL (Prisma) và SQLite fallback, giúp lưu vết lịch sử ôn tập thay vì bị ghi đè thông tin cũ.
- Tự động phân loại cấp độ từ vựng theo CEFR (A1-C2) và trích xuất từ đồng nghĩa/trái nghĩa từ API từ điển trực tuyến để làm giàu dữ liệu học thuật.
- Thay đổi cơ chế tra từ điển từ phía client sang sử dụng API backend `/api/dictionary/lookup` để khai thác tối đa tính năng Redis caching & MongoDB fallback.
- Tích hợp danh sách video học tập tiếng Anh trực quan từ YouTube (sử dụng Iframe Player) thay thế khung video placeholder tĩnh trên Dashboard.
- Sửa lỗi căn lề khoảng cách (margin-bottom) của khối Từ đồng nghĩa/Trái nghĩa để không bị dính vào các thẻ định nghĩa bên dưới trong màn hình tra cứu từ điển.

[20/07/2026]
CẬP NHẬT:
- Tối ưu hóa nguồn phát âm UK/US: Nâng cấp lên Enriched Free Dictionary API tích hợp tự động phát âm chất lượng cao từ Wiktionary và cơ chế tự động fallback thông minh sang Google Translate Text-to-Speech (TTS) cho cả hai dialect UK và US. Nhờ đó đảm bảo 100% từ vựng tra cứu đều có đầy đủ phiên âm và phát âm chuẩn của cả hai giọng.

[19/07/2026]
CẬP NHẬT:
- Sửa lỗi tương phản màu chữ tiếng Việt (dịch tự động) và ví dụ tiếng Anh trong các thẻ nghĩa từ điển để hiển thị sắc nét trên cả Light và Dark Theme.
- Tích hợp menu Cài đặt (Settings) trực quan ở chân của Navigation Rail (Desktop) và Navigation Drawer (Mobile) bao gồm các thiết lập: chuyển đổi theme, xuất/nhập tiến trình JSON.
- Triển khai tính năng Sao lưu (Export) và Phục hồi (Import) tiến độ học tập (XP, chủ đề, từ vựng) dưới dạng file JSON tĩnh mà không cần tài khoản, đi kèm cơ chế cảnh báo ghi đè dữ liệu.
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