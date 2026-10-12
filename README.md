# U N M E Online — starter

Backend real-time chat berbasis Node.js + Socket.IO + PostgreSQL. Database eksternal membuat riwayat pesan tidak bergantung pada filesystem hosting.

## Hosting yang cocok untuk percobaan
- Backend: Render Web Service (paket gratis bisa tidur setelah idle; cold start bisa sekitar satu menit).
- Database: Neon PostgreSQL Free.
- Catatan: paket gratis memiliki batas dan kebijakan yang bisa berubah. Cocok untuk uji coba, bukan layanan produksi yang dijamin selalu tersedia.

## Deploy dari HP Android (browser)
1. Buat akun GitHub dan buat repository baru bernama `unme-online`.
2. Unggah semua file dalam folder ini ke repository (termasuk `package.json`, `server.js`, `.gitignore`; jangan unggah `.env`).
3. Buat database PostgreSQL di Neon, lalu salin connection string-nya. Simpan rahasia ini dengan aman.
4. Di Render, buat **New > Web Service**, hubungkan repository GitHub tersebut.
5. Build command: `npm install`; Start command: `npm start`.
6. Di bagian Environment Render tambahkan:
   - `DATABASE_URL` = connection string Neon
   - `JWT_SECRET` = string acak rahasia minimal 32 karakter
   - `CLIENT_ORIGIN` = `*` untuk uji awal saja (nanti batasi ke URL aplikasi)
7. Deploy. Buka `https://NAMA-SERVICE.onrender.com/health`. Harus muncul `ok: true` dan `database: connected`.

## Frontend
File `unme_online.html` adalah klien chat yang bisa login/register dan memakai server. Setelah deploy, buka file itu di browser dan masukkan URL server `https://NAMA-SERVICE.onrender.com` pada layar awal. Untuk berbagi ke orang lain, frontend HTML perlu di-host sebagai static site atau dikemas sebagai aplikasi.

## Endpoint
- `POST /api/register` body `{ "username":"andi", "password":"password-minimal-8" }`
- `POST /api/login` body sama
- `GET /api/users` Authorization Bearer token
- `GET /api/messages/:userId` Authorization Bearer token
- Socket.IO auth `{ token }`; emit `private_message` `{ "recipientId": 2, "body":"Halo" }`.

## Keamanan dan batasan
Starter untuk prototipe, belum siap produksi. Sebelum mengundang publik, tambahkan rate limiting, verifikasi akun, pemulihan kata sandi, perlindungan spam/abuse, kebijakan privasi, monitoring dan audit keamanan. Pesan belum dienkripsi end-to-end. Jangan gunakan untuk pesan rahasia atau data sensitif.
