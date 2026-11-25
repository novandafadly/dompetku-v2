# Rencana S18 — Analisis AI, PWA offline-baca, dan Foto struk terenkripsi (penutup M6)

**Tanggal:** 2026-11-24  
**Arahan pemilik (2026-11-24):** lanjutkan sampai selesai dengan rekomendasi terbaik (semua keputusan default agen dapat diubah tanpa migrasi destruktif).

## Cakupan (`IPD.md` §6 S18, `PRD.md` M6)

1. **Foto struk terenkripsi tanpa OCR (`0151_foto_struk.sql` + `server/ledger/struk.ts` + Route Handlers + Detail transaksi):**
   - **Penyimpanan (K1):** ciphertext `bytea` terenkripsi **AES-256-GCM** disimpan di tabel Postgres `app.entry_attachments` (RLS `ENABLE` + `FORCE`, `on delete cascade` dari `app.entries` saat purge > 90 hari, `uploaded_by` → `auth."user" on delete restrict`). Dipilih karena container `web` produksi `read_only: true` tanpa volume tambahan → **0 langkah VM baru**, otomatis ikut backup WAL-G terenkripsi, dan 100% dilindungi RLS FORCE.
   - **Kunci & AAD:** kunci 32-byte dari `RECEIPT_ENCRYPTION_KEY` (64 hex / 44 base64 di `web.env`, tanpa secret di repo; kosong = unggah baru dinonaktifkan dengan pesan jujur). Setiap lampiran memakai IV acak 12-byte (`crypto.randomBytes(12)`) dan AAD `dompetku:receipt:v1:${spaceId}:${entryId}:${attachmentId}` sehingga ciphertext tidak dapat dipindah antar ruang/entri.
   - **Batas & sanitasi:** maks 2 MiB per foto, maks 3 foto per entri, hanya JPEG / PNG / WebP yang diverifikasi **magic bytes** di server (menolak SVG/HTML/PDF/script); respons unduh memakai `Content-Type` terverifikasi, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Disposition: inline; filename="struk.<ext>"`.
   - **UI:** pulau malas `DetailStrukIsland` di halaman Detail transaksi mode nyata (`DetailReal`); mode prototipe tidak berubah.
2. **Analisis AI (`/[ruang]/analisis`, memakai `LlmProvider` Claude/Gemini + kuota `analysis` 5/hari WIB):**
   - **Privasi B13 (K2):** hanya mengirim agregat angka SQL ruang aktif dari `loadLaporan` (pemasukan, pengeluaran, selisih, daftar kategori teratas + nominal & persentase, perbandingan periode sebelumnya) dan `safeToSpend` — **tanpa deskripsi entri mentah, tanpa nama dompet ruang lain, tanpa kontak, tanpa ruang pasangan**.
   - **Kuota & fallback:** memakai `api.consume_ai_quota('analysis')` (5/hari/user WIB dari `0150_ai_kuota.sql`) dan failover otomatis `LlmProvider` (Gemini ↔ Claude). Jika kunci LLM belum diisi atau kuota 5/5 habis, halaman tetap menampilkan ringkasan angka SQL terstruktur + catatan jujur tanpa galat.
   - **Navigasi:** halaman Server Component `/[ruang]/analisis` (`requireDataUser()` → `ruangContext`, prototipe `404`), tautan `Analisis AI` di `MenuSheet` mode nyata (di samping `Laporan` yang sudah ada agar 0 regresi).
3. **PWA offline-baca & pembersihan cache wajib saat logout (`public/sw.js` + `pwa-cache.ts` + `PwaBridge`):**
   - **Service Worker (`public/sw.js`):** network-first + fallback cache (`dompetku-pages-v1`) untuk navigasi halaman ruang saat offline; cache-first hanya untuk aset statis publik (`/_next/static/`, `/icons/`, `/manifest.webmanifest`, `/icon.svg`, `/apple-icon.png`) di `dompetku-static-v1`. **Tidak pernah meng-cache** non-GET, `/api/*`, `*/struk*`, `*/ekspor*`, rute auth, atau respons `no-store`/redirect.
   - **Pembersihan cache saat logout (K3, anti bocor antar akun):** `clearClientCaches()` menghapus seluruh cache `dompetku-pages-*` (langsung via `caches.delete` + pesan `CLEAR_USER_CACHES` ke SW) dan `sessionStorage` saat tombol `Keluar` diklik **dan** sebagai jaring pengaman kedua di `/masuk?status=keluar`.
   - **Indikator offline:** `PwaBridge` dipasang hanya di `RuangShellReal` (0 byte ke mode prototipe).

## Keputusan desain S18 (default agen, dapat diubah tanpa migrasi destruktif)

| ID | Topik | Pilihan (default) | Alternatif |
| --- | --- | --- | --- |
| **K1** | Penyimpanan foto struk | Ciphertext `bytea` AES-256-GCM di `app.entry_attachments` (Postgres, RLS FORCE, ikut backup WAL-G, 0 langkah VM baru); kunci 32-byte dari `RECEIPT_ENCRYPTION_KEY`. | Volume lokal di VM atau bucket OCI Object Storage |
| **K2** | Privasi prompt Analisis AI | Hanya agregat kategori & total SQL ruang aktif (tanpa deskripsi entri mentah & tanpa ruang lain); keluaran Zod ketat `{ ringkasan, sorotan, saran }`. | Kirim daftar transaksi mentah |
| **K3** | Strategi PWA & logout | Network-first untuk HTML halaman ruang (`dompetku-pages-v1`), dilarang cache `/api/*`, `*/struk*`, `*/ekspor*`, auth; bersihkan seluruh cache halaman + `sessionStorage` saat klik `Keluar` dan di `/masuk?status=keluar`. | IndexedDB lokal terpisah |
| **K4** | Batas foto struk | Maks 2 MiB per foto, maks 3 foto per entri, hanya JPEG/PNG/WebP (magic bytes server), tanpa OCR. | Batas 5 MiB atau izinkan PDF |

## Fokus Review

1. **Enkripsi & keamanan lampiran:** AES-256-GCM dengan IV 12-byte acak per unggahan + AAD terikat `spaceId:entryId:attachmentId`, kunci dari env tidak pernah dilog, validasi magic bytes menolak SVG/HTML/script, `nosniff` + `no-store`, RLS FORCE + `assert_member` di DB.
2. **Privasi B13 Analisis AI:** prompt analisis Bersama tidak pernah membawa data ruang Pribadi pasangan maupun deskripsi transaksi mentah; diuji di unit, integrasi (`s18.int.test.ts`), dan e2e Bersama (`@B13`).
3. **Anti kebocoran cache PWA setelah logout:** SW tidak pernah meng-cache `*/struk*`, `*/ekspor*`, `/api/*`, atau rute auth; setelah logout seluruh cache `dompetku-pages-*` kosong (diuji E2E browser nyata + simulasi offline).
4. **Budget JS & prototipe:** mode prototipe 100% tidak berubah (`budget.spec.ts` 9/9), semua rute nyata baru/terdampak <= 162 kB.
