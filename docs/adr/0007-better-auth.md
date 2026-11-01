# ADR 0007: Better Auth 1.7.12 untuk auth S4

Status: diterima (2026-11-01).

## Konteks

S4 (IPD §3) butuh auth sungguhan: kata sandi, passkey, TOTP, kode pemulihan untuk semua akun, sesi idle 7 hari dan absolut 30 hari, jeda bertahap tanpa kunci permanen, undangan lewat email, dan pendaftaran tertutup yang ditegakkan DB (BSD §5, §9.3; TRD §3.4; keputusan pemilik #1 sampai #5). ADR 0001 sudah memilih Better Auth; yang belum ada: versi, cara pasang, dan opsi.

## Keputusan

- **Versi dipatok persis:** `better-auth` 1.7.12 dan `@better-auth/passkey` 1.7.12 (rilis 2026-10-20). 1.7.13 dan 1.7.14 belum lolos `minimumReleaseAge` 7 hari saat dipasang; 1.8 masih beta. Pendamping: `pg` 8.23.1, `@simplewebauthn/browser` 13.3.0 (sama dengan dependensi plugin passkey), `@noble/hashes` 2.4.0 (argon2id), `zod` 4.6.7, `uqr` 0.1.3 (QR TOTP dirender server).
- **Tanpa handler HTTP Better Auth.** Tidak ada `/api/auth/*`. Semua endpoint dipanggil dari Server Action lewat `auth.api.*` (`apps/web/src/server/auth/`), sehingga permukaan publik hanya Server Action yang lebih dulu menegakkan aturan faktor kuat, jeda, dan respons seragam. Cookie `Set-Cookie` hasil `returnHeaders` dipasang sendiri (`next.ts`); plugin `nextCookies` tidak dipakai.
- **Database:** pool `pg` sebagai `dompetku_web` dengan `search_path=auth`; pool domain terpisah dengan `withUser` (BSD §4). Skema dari `compileMigrations()` Better Auth, ditulis tangan sebagai `packages/db/migrations/0009_better_auth.sql`: `auth."user"` tidak dibuat ulang (kolom `twoFactorEnabled` ditambah), id dan FK `uuid` cascade, `generateId: 'uuid'` (Postgres mengisi `gen_random_uuid()`).
- **Opsi wajib TRD §3.4:** `minPasswordLength` 12 (maks 128) + Have I Been Pwned; `revokeSessionsOnPasswordReset`; `cookieCache` mati; `session.expiresIn` 7 hari + `updateAge` 1 hari (idle), absolut 30 hari ditegakkan `sessionAccess` (sesi dihapus) dan umur cookie 30 hari; `freshAge` 10 menit (step-up passkey); cookie `__Host-dompetku.*` HttpOnly Secure SameSite=Lax Path=/; `ipAddressHeaders: ['x-forwarded-for']`; `changeEmail` dan account linking mati; telemetri mati.
- **`amr` di baris sesi** (kolom `auth.session.amr`, CHECK daftar tertutup) diisi `databaseHooks.session.create.before` dari jalur pembuat sesi: `passkey`, `password+totp`, `password` (enrolling), `recovery` (endpoint server-only `/recovery/sign-in`). Naik ke `passkey` saat `/amankan` selesai bila passkey dibuat oleh sesi itu.
- **Kode pemulihan sendiri** (`auth.recovery_codes`, 10 kode 50-bit, argon2id PHC m=4 MiB t=3 di JS murni). Kode cadangan plugin two-factor tidak dipakai (terikat TOTP, terenkripsi, bukan hash). JS murni karena image produksi menolak biner native (Dockerfile).
- **Jeda bertahap sendiri** di `auth.login_throttle` (hash kunci per IP dan per akun; 5/10/20 gagal = 1 menit/15 menit/1 jam). Rate limit bawaan Better Auth mati karena hanya berlaku untuk handler HTTP. Kunci TOTP bawaan plugin (10 gagal = 15 menit) tetap aktif, juga sementara.
- **Undangan:** pendaftaran dari tautan undangan menandai `emailVerified` lewat `AsyncLocalStorage` (tautan membuktikan kotak masuk); undangan baru dipakai (`api.accept_invitation`) setelah faktor kuat dan kode pemulihan ada. Akun pertama memakai verifikasi email Better Auth (email dari `app.settings.owner_email`), respons "periksa email" selalu sama.

## Akibat

- Menaikkan Better Auth = ubah pin, jalankan `pnpm test:int` dan `pnpm e2e:auth`, bandingkan `compileMigrations()` dengan 0009; kolom baru = migrasi baru.
- `BETTER_AUTH_SECRET` mengenkripsi rahasia TOTP: rotasi hanya saat insiden dengan skrip enkripsi ulang (TRD §3.4).
- Menambah fitur Better Auth (daftar perangkat, ganti kata sandi, hapus faktor) berarti Server Action baru dengan pemeriksaan sesi penuh + step-up; tidak ada endpoint yang muncul otomatis.
- JS rute auth (diukur e2e auth): `/masuk` 152,3 kB, `/buat-akun` 147,9 kB, `/lupa-sandi` 147,3 kB, di bawah 162 kB (ADR 0002). `@simplewebauthn/browser` dimuat saat tombol passkey ditekan.
