# Runbook S3: pemasangan deployer di VM DB

Panduan: `infra/db-vm/deploy/README.md` (bagian Pemasangan). Dokumen ini mencatat eksekusinya. Tanpa rahasia.

## Status (2026-10-31)

| Langkah README                  | Status                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. cosign v3.0.6                | Selesai. `cosign-linux-arm64` dicek dengan `cosign_checksums.txt` rilis yang sama (OK), `/usr/local/bin/cosign` 755 root |
| 2. Berkas                       | Selesai. `bin/deploy`, `compose.yml` (salinan lama `compose.yml.s2`), `deploy/README.md`, `env/deploy.env` dan `env/web.env` (600 root, dari contoh) |
| 3. Rahasia                      | `cosign.pub` terpasang (pemilik). `VERIFY=cosign-key` sudah. **Menunggu pemilik:** `GHCR_USER`, `GHCR_TOKEN`        |
| 4. Deploy manual pertama        | Menunggu langkah 3 (package `dompetku-web` private, tarik anonim 401)                                              |
| 5. gw ke web                    | Caddyfile baru di branch `claude/m0b-s3-vm`, `caddy validate` lulus. Dipasang setelah langkah 4 berhasil            |
| 6. Timer                        | Belum diaktifkan: tanpa token, tiap 5 menit hanya galat "GHCR_USER/GHCR_TOKEN kosong"                               |
| 7. Uji rollback                 | Rilis rusak siap di branch `claude/m0b-s3-rollback-test` (lihat di bawah); butuh PR ke `main` oleh pemilik          |
| 8. Smoke K12                    | Setelah langkah 5                                                                                                  |

Verifikasi langkah 2: `--profile web config --services` = `gw postgres web`; tanpa profil = `gw postgres`; diff ke `compose.yml.s2` hanya blok `web` dan komentar baris 2.

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

## Uji rollback (langkah 7)

Branch `claude/m0b-s3-rollback-test` (commit `36bacd3`): `/api/health` menjawab 500 hanya bila `BUILD_SHA` berisi SHA asli (build rilis); build lokal dan e2e tetap 200 sehingga CI hijau.

Urutan, setelah langkah 4 sampai 6 hijau:

1. Pemilik membuat PR `claude/m0b-s3-rollback-test` ke `main` dan merge.
2. Workflow `Release` menandatangani image rusak; timer menariknya. Harapan: kode 3, `deploy.log` memuat `"result":"rolled_back"`, `/api/health` lewat domain tetap SHA lama.
3. Pemilik me-revert PR itu di GitHub (tombol Revert, merge). Rilis berikutnya terpasang normal (`"result":"ok"`, SHA revert).

## Catatan eksekusi

- Branch `claude/m0b-s3-vm` dibuat dari `main` 2e58c3e (PR #5).
