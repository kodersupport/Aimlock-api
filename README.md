# AIMLOCK MODE 10 — Deploy Package

Một folder duy nhất: **Web + API + Admin**.

## Deploy (VPS / máy chủ)

```bash
# 1. Giải nén
unzip aimlock-api-deploy.zip
cd aimlock-api

# 2. Chạy (chỉ cần Node.js, không cần npm install)
chmod +x start.sh
./start.sh

# Hoặc:
PORT=3000 ADMIN_TOKEN=mat_khau_cua_ban node server.js
```

Mở trình duyệt:
| URL | Mô tả |
|-----|--------|
| `http://IP:3000/` | Web AIMLOCK (key gate + app) |
| `http://IP:3000/admin` | Panel quản lý key |
| Admin Token | `TIENHOC_ADMIN_2026` (đổi bằng `ADMIN_TOKEN`) |

## Key mặc định

| Key | Thời hạn |
|-----|----------|
| `NTH-31` | Vĩnh viễn |
| `ALM10` | 1 ngày |
| `ALM10.1` | 1 tuần |
| `ALM10.2` | 1 tháng |
| `ALM10.3` | 1 năm |

Tạo key mới trong `/admin`.

## Production với Nginx + HTTPS

```nginx
server {
  listen 80;
  server_name your-domain.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

Rồi dùng certbot cho HTTPS.

Chạy nền bằng pm2:
```bash
npm i -g pm2
PORT=3000 ADMIN_TOKEN=xxx pm2 start server.js --name aimlock
pm2 save
```

## Cấu trúc

```
aimlock-api/
  server.js           # API + phục vụ web
  start.sh            # Chạy 1 lệnh
  public/
    app.html          # Web AIMLOCK (đã gắn API)
    admin.html        # Panel admin
    key-api-client.js # Client key
  data/db.json        # Tự tạo khi chạy
```

Không cần sửa code — chỉ deploy và mở port 3000.
