# 🎬 Layar Biru — Backend + Railway Deploy Guide

## Struktur Project

```
layar-biru-railway/
├── server.js          ← Backend Express (API login, auth)
├── package.json       ← Dependencies Node.js
├── .env.example       ← Template environment variables
└── public/
    └── index.html     ← Frontend (otomatis serve dari backend)
```

---

## 🚀 Cara Deploy ke Railway (Langkah demi Langkah)

### 1. Buat akun Railway
- Buka **railway.app**
- Klik **"Start a New Project"** → login dengan GitHub

### 2. Upload project ke GitHub dulu
- Buat repo baru di github.com (nama: `layar-biru`)
- Upload semua file ini ke repo tersebut

> Atau pakai GitHub Desktop kalau tidak familiar dengan git CLI

### 3. Deploy dari GitHub ke Railway
- Di Railway, klik **"New Project"**
- Pilih **"Deploy from GitHub repo"**
- Pilih repo `layar-biru` kamu
- Railway otomatis detect Node.js dan deploy!

### 4. Set Environment Variables di Railway
- Masuk ke project → tab **"Variables"**
- Tambahkan variabel berikut:

```
JWT_SECRET     = isi_string_acak_panjang_misal_layarbiru2024xyz
ADMIN_EMAIL    = filmbiru@gmail.com
ADMIN_PASSWORD = Filmbiru12345
```

> ⚠️ JWT_SECRET harus string acak yang panjang, jangan pakai contoh di atas

### 5. Dapat URL publik
- Masuk ke tab **"Settings"** → **"Domains"**
- Klik **"Generate Domain"**
- Kamu dapat URL seperti: `layar-biru-production.up.railway.app`

---

## 🧪 Test Lokal (opsional)

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env
# Edit .env sesuai kebutuhan

# Jalankan server
npm run dev

# Buka browser: http://localhost:3000
```

---

## 🔑 Kredensial Login

| Field    | Value                  |
|----------|------------------------|
| Email    | filmbiru@gmail.com     |
| Password | Filmbiru12345          |

---

## 📡 API Endpoints

| Method | Endpoint      | Fungsi                          |
|--------|---------------|---------------------------------|
| GET    | /api/health   | Cek server jalan                |
| POST   | /api/login    | Login, return JWT token         |
| GET    | /api/verify   | Verifikasi token masih valid    |
| POST   | /api/logout   | Logout (log ke server)          |
