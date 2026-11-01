# Runbook S3: pemasangan deployer di VM DB

Panduan: `infra/db-vm/deploy/README.md` (bagian Pemasangan). Dokumen ini mencatat eksekusinya. Tanpa rahasia.

## Status (2026-11-01): **S3 selesai**

| Langkah README           | Status                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. cosign v3.0.6         | Selesai. `cosign-linux-arm64` dicek dengan `cosign_checksums.txt` rilis yang sama (OK), `/usr/local/bin/cosign` 755 root                               |
| 2. Berkas                | Selesai. `bin/deploy`, `compose.yml` (salinan lama `compose.yml.s2`), `deploy/README.md`, `env/deploy.env` dan `env/web.env` (600 root, dari contoh)   |
| 3. Rahasia               | Selesai. `cosign.pub`, `GHCR_USER`/`GHCR_TOKEN` (classic, `read:packages`) diisi pemilik; dicek dengan `grep -c` tanpa mencetak isi                    |
| 4. Deploy manual pertama | Selesai 21:07 UTC: kode 0, 34 detik, `"result":"ok"`, digest `sha256:748e0af2…`, SHA `2e58c3e` (PR #5). `cosign verify` dan `verify-attestation` lulus |
| 5. gw ke web             | Selesai. Caddyfile dari branch ini terpasang (salinan lama `gw/Caddyfile.s2`), `docker compose restart gw`                                             |
| 6. Timer                 | Selesai. `dompetku-deploy.timer` aktif; run pertama lewat systemd: sukses, tanpa rilis baru (keluar diam)                                              |
| 7. Uji rollback          | Lulus 2026-10-31/11-01 (lihat Hasil uji rollback)                                                                                                      |
| 8. Smoke K12             | Lulus (lihat di bawah)                                                                                                                                 |

Verifikasi langkah 2: `--profile web config --services` = `gw postgres web`; tanpa profil = `gw postgres`; diff ke `compose.yml.s2` hanya blok `web` dan komentar baris 2.

## Smoke pasca-deploy (dari VM App, lewat domain publik)

- `GET /api/health` = `{"status":"ok","sha":"2e58c3e4be164b6a91d922d6ac3b22f3c5f4309c"}`.
- `GET /` 200 HTTP/2 dengan HSTS, `Content-Security-Policy` (frame-ancestors, object-src, base-uri), `Content-Security-Policy-Report-Only` (nonce, strict-dynamic), COOP, Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options.
- `http://` 301 ke `https://`; `/manifest.webmanifest` 200 `application/manifest+json`.
- Header `X-Middleware-Subrequest` palsu tidak berpengaruh (200, dibuang gw dan edge).

## [PEMILIK] Token GHCR

1. GitHub, Settings, Developer settings, Personal access tokens, **Tokens (classic)**, Generate new token (classic). Scope **hanya** `read:packages`. Kedaluwarsa sesuai kebiasaanmu (catat tanggal rotasi).
   Pakai classic: setahu saya token fine-grained belum bisa membaca GHCR. Kalau GitHub sudah mendukungnya, fine-grained dengan akses baca package juga boleh.
2. Di VM DB:

   ```bash
   sudo nano /opt/dompetku/env/deploy.env   # isi GHCR_USER=novandafadly dan GHCR_TOKEN=ghp_...
   ```

3. Verifikasi tanpa mencetak isi:

   ```bash
   sudo grep -c '^GHCR_TOKEN=.\{20,\}' /opt/dompetku/env/deploy.env   # 1
   ```

Lalu beri tahu sesi Claude; langkah 4 sampai 8 dijalankan agen.

## Hasil uji rollback

Semua lewat timer (tanpa campur tangan), `deploy.log`:

| Waktu (UTC) | Rilis                            | Hasil         | Detik | Catatan                                                               |
| ----------- | -------------------------------- | ------------- | ----- | --------------------------------------------------------------------- |
| 10-31 21:07 | `2e58c3e` (PR #5)                | `ok`          | 34    | deploy manual pertama                                                 |
| 10-31 21:14 | `caf272f` (PR #6, gw + runbook)  | `ok`          | 25    | timer                                                                 |
| 10-31 21:22 | `a39455e` (PR #7, sengaja rusak) | `rolled_back` | 119   | kode 3, systemd `Failed`; kembali ke `caf272f`; digest masuk `failed` |
| 11-01 04:04 | `ebb7b0d` (revert PR #7)         | `ok`          | 24    | timer; `/api/health` lewat domain = `ebb7b0d`                         |

Selama rilis rusak, `/api/health` lewat domain tetap melaporkan `caf272f`. Timer berikutnya tidak mencoba ulang digest rusak (keluar 0, "pernah gagal"). Restore point `deploy-<sha12>` dibuat di setiap deploy. Revert didorong langsung ke `main` oleh agen atas izin pemilik.

PWA: `/manifest.webmanifest` (standalone, `start_url /`, ikon 192, 512, maskable 512, SVG) dan semua ikon 200 lewat domain; `<link rel="manifest">` ada di HTML.

## Prosedur uji rollback (langkah 7)

Branch `claude/m0b-s3-rollback-test` (commit `36bacd3`): `/api/health` menjawab 500 hanya bila `BUILD_SHA` berisi SHA asli (build rilis); build lokal dan e2e tetap 200 sehingga CI hijau.

Urutan, setelah langkah 4 sampai 6 hijau:

1. Pemilik membuat PR `claude/m0b-s3-rollback-test` ke `main` dan merge.
2. Workflow `Release` menandatangani image rusak; timer menariknya. Harapan: kode 3, `deploy.log` memuat `"result":"rolled_back"`, `/api/health` lewat domain tetap SHA lama.
3. Pemilik me-revert PR itu di GitHub (tombol Revert, merge). Rilis berikutnya terpasang normal (`"result":"ok"`, SHA revert).

## Catatan eksekusi

- Deploy pertama me-recreate `postgres` sekali (sekitar 6 detik). Sebabnya config drift: `env/backup.env` diubah (URL Healthchecks) setelah container S2 dibuat, dan `compose run migrate` (depends_on) menyamakannya. Data, role, dan arsip WAL utuh; dry-run setelahnya `Running`, jadi deploy berikutnya tidak menyentuh postgres. Pelajaran: setelah mengubah `env/*.env` milik postgres, jalankan `docker compose up -d postgres` sengaja, jangan menunggu deploy.
- `dbmate --wait` mencoba database `postgres` lebih dulu sehingga log postgres memuat satu `FATAL: pg_hba.conf rejects ... database "postgres"` per deploy. Migrasi tetap jalan ke `dompetku`. Tidak diubah (pg_hba sengaja hanya `dompetku`).

- Branch `claude/m0b-s3-vm` dibuat dari `main` 2e58c3e (PR #5).
