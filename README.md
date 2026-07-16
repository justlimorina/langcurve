# LangCurve — Hướng dẫn khởi chạy Server

## Yêu cầu hệ thống

- **Node.js** >= 18.x
- **npm** >= 9.x

## Cài đặt lần đầu

```bash
git clone https://github.com/justlimorina/langcurve.git
cd langcurve
npm install
npm run build
```
Lưu ý, việc cài đặt phụ thuộc vào đường dẫn bạn lưu file.
## Khởi chạy Server

```bash
npm start
```

Server sẽ chạy tại **http://localhost:3000**.

> Nếu chưa có PostgreSQL / MongoDB / Redis trên máy, server tự động chuyển sang chế độ **SQLite Fallback** — không cần cài thêm gì.

## Các lệnh khác

| Lệnh | Mô tả |
|---|---|
| `npm run build` | Biên dịch TypeScript → `dist/` |
| `npm start` | Chạy server từ bản build (`dist/server.js`) |
| `npm run dev` | Chạy dev server (tự restart khi sửa code) |

## Cấu trúc URL

| URL | Chức năng |
|---|---|
| `http://localhost:3000` | Giao diện chính |
| `http://localhost:3000/api/topics` | API danh sách chủ đề |
| `http://localhost:3000/api/stats` | API thống kê |
