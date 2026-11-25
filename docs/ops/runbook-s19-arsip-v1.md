# Runbook S19 (M7): Arsip Ekspor v1, Matikan v1, dan Bongkar Pratinjau Vercel

Dokumen ini adalah panduan operasional penutupan **M7 / S19** (lihat `docs/product/PRD.md` §5–§6, `docs/product/IPD.md` §6 S19, dan `docs/adr/0003-preview.md`). Tanpa rahasia; seluruh langkah destruktif dijalankan langsung oleh **pemilik** sesudah semua prasyarat terverifikasi.

> **Aturan mutlak:** Jangan mematikan, men-pause, atau menghapus proyek v1 (`novandafadly/dompetku`, Supabase `yvapmbjtuhqvsunkmkxw`) sebelum arsip ekspor v1 **selesai diambil, diverifikasi isinya, dihitung ulang, dan disimpan di minimal dua lokasi terpisah**. Selama belum diverifikasi, v1 tetap **read-only**.

## 1. Prasyarat sebelum memulai (Gerbang M2 + Produksi Sehat)

Pastikan seluruh prasyarat di bawah sudah terpenuhi di produksi DompetKu v2 (`dompet.novandafadly.com`):

1. **Gerbang M2 (PRD §6.1):** Novanda dan Farida telah memakai DompetKu v2 selama **7 hari kalender WIB berturut-turut** (minimal 1 catatan atau tekan "Tidak ada pengeluaran hari ini" setiap hari per orang).
2. **Rekonsiliasi bersih (`T18`):** `dompetku-dq` melaporkan `0` selisih pada setiap hari dalam 7 hari tersebut (termasuk DQ01–DQ20; tidak ada anomali `net_worth_snapshot`).
3. **Backup & uji restore hijau (`BR5`):** Timer mingguan `dompetku-restore-test.timer` di VM DB (`docs/ops/runbook-s2.md`) hijau dengan RTO ≤ 1 jam dan ping Healthchecks tercatat.
4. **Deploy & keamanan hijau (`K11`, `K12`):** Rilis `main` terbaru berjalan sehat (`GET /api/health` → `200`), CI + `osv-scanner` + Trivy + `openwa-image` bersih (atau pengecualian bertanggal masih berlaku).
5. **Screenshot portofolio otomatis terbentuk:** `docs/screenshots/portfolio/` berisi 40 PNG (10 layar × 390 & 1280 × gelap & terang) dari data demo fiktif (Raka & Nadia) dan sudah diperiksa pemilik.

## 2. Tahap 1 — Ekspor & Verifikasi Arsip v1 (Read-Only)

Jalankan di mesin lokal pemilik (bukan di repo git; simpan di folder sementara di luar repo, mis. `~/arsip-dompetku-v1`).

### 2.1 Ambil ekspor baca-saja dari Supabase v1

Gunakan koneksi **read-only** ke Supabase v1 (`yvapmbjtuhqvsunkmkxw`) dari kredensial yang sudah ada di password manager pemilik:

```sh
mkdir -p ~/arsip-dompetku-v1
cd ~/arsip-dompetku-v1
TANGGAL=$(date +%Y-%m-%d)

# 1. Dump Postgres lengkap (skema + data, format custom terkompresi; baca-saja).
pg_dump "$SUPABASE_V1_READONLY_URL" \
  --format=custom --no-owner --no-privileges \
  --schema=public \
  --file="dompetku-v1-${TANGGAL}.dump"

# 2. Ekspor CSV manusia-baca untuk setiap tabel utama v1 (daftar tabel dicek dulu lewat \dt public.*).
psql "$SUPABASE_V1_READONLY_URL" -Atc \
  "select tablename from pg_tables where schemaname = 'public' order by tablename" \
  | while read -r tbl; do
      psql "$SUPABASE_V1_READONLY_URL" </dev/null \
        -c "\copy public.\"${tbl}\" TO 'csv-${tbl}-${TANGGAL}.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
    done
```

### 2.2 Verifikasi arsip (wajib sebelum mematikan v1)

Arsip **belum dianggap aman** sampai dibuka kembali dan angkanya dihitung ulang:

1. **Checksum integritas:**

   ```sh
   sha256sum dompetku-v1-*.dump csv-*.csv > SHA256SUMS.txt
   sha256sum -c SHA256SUMS.txt
   ```

2. **Uji buka dump di Postgres lokal sementara:**

   ```sh
   createdb dompetku_v1_verify
   pg_restore --no-owner --no-privileges -d dompetku_v1_verify "dompetku-v1-${TANGGAL}.dump"
   psql -d dompetku_v1_verify -c "
     analyze;
     select schemaname, relname, n_live_tup
     from pg_stat_user_tables
     where schemaname = 'public'
     order by relname;
   "
   ```

3. **Hitung ulang angka kunci:**
   - Bandingkan jumlah baris tiap tabel utama (`transactions`/`entries`, `wallets`/`accounts`, `categories`) antara hasil `dompetku_v1_verify` dan CSV (`wc -l csv-*.csv`).
   - Pastikan tanggal transaksi paling awal dan paling akhir cocok dengan riwayat pemakaian v1.
   - Cek ulang jumlah total pemasukan dan pengeluaran per tahun pada `dompetku_v1_verify` vs aplikasi v1 yang masih jalan.
   - Hapus database sementara setelah selesai: `dropdb dompetku_v1_verify`.

4. **Enkripsi & simpan di minimal dua tempat terpisah:**
   - Bungkus dan enkripsi folder arsip (hanya berkas ekspor agar arsip tidak membungkus dirinya sendiri, mis. `tar -czf - "dompetku-v1-${TANGGAL}.dump" csv-*-"${TANGGAL}.csv" SHA256SUMS.txt | age -p > "../dompetku-v1-arsip-${TANGGAL}.tar.gz.age"`, simpan passphrase di password manager).
   - Simpan salinan di minimal **2 lokasi terpisah** (contoh: penyimpanan lokal pemilik + penyimpanan cloud terenkripsi / drive eksternal).
   - **Jangan pernah** menaruh berkas arsip, dump, atau CSV data asli di dalam repo `dompetku-v2`.

## 3. Tahap 2 — Matikan v1 (Hanya sesudah Tahap 1 terverifikasi)

1. **Arsipkan repo GitHub `novandafadly/dompetku`:**
   - Buka `https://github.com/novandafadly/dompetku/settings` → Danger Zone → **Archive this repository**.
   - Repo tetap read-only sebagai arsip sejarah tanpa menghapus riwayat commit.
2. **Hentikan proyek Supabase v1 (`yvapmbjtuhqvsunkmkxw`):**
   - Buka Supabase Dashboard → proyek `yvapmbjtuhqvsunkmkxw` → Project Settings → General → **Pause project** (atau Delete sesudah masa tunggu yang dirasa nyaman oleh pemilik).
   - Cabut/hapus API key atau service key v1 yang tidak dipakai lagi.
3. **Hentikan deployment & DNS v1 (bila masih ada):**
   - Hapus/matikan proyek deployment frontend v1 (Vercel proyek v1 atau host lain).
   - Cek panel DNS `novandafadly.com`: pastikan tidak ada record atau redirect usang ke v1, dan pastikan `dompet.novandafadly.com` tetap sehat.

## 4. Tahap 3 — Pembongkaran Pratinjau Vercel M0a (`dompetku-v2`, ADR 0003)

Pratinjau Vercel `dompetku-v2` hanya dibuat untuk penilaian prototipe M0a (`NEXT_PUBLIC_PROTOTYPE=1`). Setelah M7 disetujui:

1. **Cabut Shareable Link:** Di Vercel proyek `dompetku-v2`, cabut semua Shareable Link aktif.
2. **Cek Branch Protection GitHub terlebih dahulu:** Jika aturan proteksi branch `main` di GitHub mewajibkan check `Vercel` atau `Vercel Preview Comments`, **hapus dua nama check itu dari daftar required checks** sebelum menghapus proyek Vercel agar PR mendatang tidak tertahan.
3. **Hapus proyek Vercel `dompetku-v2`:** Settings → Advanced → **Delete Project**.
4. **Cabut akses GitHub App Vercel (opsional):** Di GitHub Settings → Applications → Installed GitHub Apps → Vercel → cabut akses ke repo `novandafadly/dompetku-v2` jika tidak ada proyek lain yang membutuhkannya.
5. **Kode prototipe tetap bisa dijalankan lokal kapan saja** tanpa Vercel:

   ```sh
   NEXT_PUBLIC_PROTOTYPE=1 pnpm build
   NEXT_PUBLIC_PROTOTYPE=1 pnpm --filter @dompetku/web start
   ```

## 5. Daftar Periksa Persetujuan M7 (PRD §6.1)

Pemilik mencentang setiap butir sebelum menyatakan M7 selesai:

- [ ] Gerbang M2 terpenuhi: Novanda & Farida 7 hari WIB berturut-turut di DompetKu v2.
- [ ] `dompetku-dq` = 0 selama 7 hari penuh (`T18` di produksi).
- [ ] Uji restore mingguan `dompetku-restore-test.timer` hijau (`BR5`).
- [ ] Smoke produksi (`GET /api/health` 200) & pemindaian keamanan CI hijau (`K11`, `K12`).
- [ ] Arsip ekspor v1 diambil (dump + CSV), checksum `SHA256SUMS.txt` lulus, dibuka di DB sementara, angka dihitung ulang, dan disimpan terenkripsi di ≥ 2 lokasi.
- [ ] Screenshot portofolio otomatis di `docs/screenshots/portfolio/` (390 & 1280, gelap & terang, data demo fiktif) diperiksa dan disetujui.
- [ ] v1 dimatikan (repo `novandafadly/dompetku` diarsipkan, Supabase `yvapmbjtuhqvsunkmkxw` dihentikan, frontend/DNS v1 dibersihkan).
- [ ] Pratinjau Vercel `dompetku-v2` dibongkar sesuai ADR 0003.
