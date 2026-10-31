# Deployer pull-based (S3)

Dasar: Spec §9.2, TRD §2.4, IPD S3, `docs/ops/runbook-s2.md`. Timer systemd di VM DB menarik digest tag `main` dari `ghcr.io/novandafadly/dompetku-web` tiap 5 menit, memverifikasi attestation, menolak rilis lebih tua, menjalankan migrasi dbmate dari image rilis, mengganti `web`, mengecek `/api/health`, dan rollback otomatis bila gagal.

## Berkas

| Repo                                           | VM DB                                                            | Mode       |
| ---------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `deploy`                                       | `/opt/dompetku/bin/deploy`                                       | `755 root` |
| `../compose.yml` (layanan `web`, profil `web`) | `/opt/dompetku/compose.yml`                                      | `644 root` |
| `deploy.env.example`                           | `/opt/dompetku/env/deploy.env`                                   | `600 root` |
| `web.env.example`                              | `/opt/dompetku/env/web.env`                                      | `600 root` |
| `systemd/dompetku-deploy.{service,timer}`      | `/etc/systemd/system/`                                           | `644 root` |
| `README.md`                                    | `/opt/dompetku/deploy/README.md`                                 | `644 root` |
| (dibuat deployer)                              | `/var/lib/dompetku/deploy/{current,history.tsv,failed}`          | `700 root` |
| (dibuat deployer)                              | `/var/log/dompetku/deploy.log` (satu baris JSON per hasil)       | `600 root` |
| (dibuat deployer)                              | `/opt/dompetku/migrations` (dari image rilis), `migrations.prev` | `755 root` |

Langkah DB yang dijalankan deployer (S2 sudah live; tanpa hook terpisah):

1. Preflight: container `postgres` `healthy` dan `pg_stat_archiver` menunjukkan arsip WAL terakhir berhasil.
2. Berkas migrasi diambil dari image rilis (`/app/db/migrations`, salinan `packages/db/migrations`) ke `/opt/dompetku/migrations`, yang dipasang read-only ke layanan `migrate`.
3. `select pg_create_restore_point('deploy-<sha12>')` sebagai `postgres` (peer, lewat `gosu`).
4. `docker compose run --rm -T migrate --wait up` (dbmate 2.36.0, profil `tools`, `env/migrate.env` = `dompetku_owner`). Gagal = web tidak diganti.

Image hanya ditarik dari GHCR (`docker pull`); VM tidak perlu BuildKit.

## Kode keluar dan perilaku

| Kode | Arti                                                                                        |
| ---- | ------------------------------------------------------------------------------------------- |
| 0    | Selesai, tidak ada rilis baru, deploy lain sedang berjalan, atau digest pernah gagal        |
| 2    | Ditolak: attestation tidak valid, commit lebih tua, digest pernah berjalan, preflight gagal |
| 3    | Rilis gagal health, sudah kembali ke digest sebelumnya                                      |
| 4    | Rilis gagal dan rollback juga gagal (tindakan manual)                                       |
| 1    | Galat lain (GHCR tidak terbaca, migrasi gagal, konfigurasi)                                 |

- "Lebih tua" = label `org.opencontainers.image.created` (waktu commit UTC, diisi workflow `release`) lebih kecil dari yang berjalan, atau digest yang pernah berjalan lalu digantikan.
- Digest yang gagal health, gagal migrasi, atau ditolak karena lebih tua dicatat di `failed` dan tidak dicoba ulang oleh timer; rilis baru di `main` atau `deploy --digest` manual yang melanjutkan.
- Rollback hanya mengganti image (tanpa down-migration). Aman karena migrasi wajib expand/contract (TRD §2.4).
- Kegagalan memanggil `HC_PING_URL/fail` bila diisi.

## Pemasangan (sesi VM, setelah S2)

Satu langkah, verifikasi, lanjut. Isi `infra/db-vm/deploy/` disalin ke `/tmp/dompetku-s3/`, dan `infra/db-vm/compose.yml` ke `/tmp/dompetku-s3/compose.yml`, lebih dulu. Simpan salinan compose yang berjalan: `sudo cp /opt/dompetku/compose.yml /opt/dompetku/compose.yml.s2`.

1. **Alat.** `gh` ≥ 2.60 dari repo apt resmi `cli.github.com` (paket `gh`, arsitektur arm64). Hanya bila `VERIFY=cosign`: biner `cosign-linux-arm64` dari rilis `sigstore/cosign`, cek `sha256` dengan berkas checksum rilis, pasang ke `/usr/local/bin/cosign`.
   - Verifikasi: `gh --version`; `gh attestation verify --help | grep -c bundle-from-oci` = 1.
2. **Berkas.**

   ```bash
   cd /tmp/dompetku-s3
   sudo install -m 755 deploy /opt/dompetku/bin/deploy
   sudo install -m 644 compose.yml /opt/dompetku/compose.yml   # menambah layanan web (profil web)
   sudo install -d -m 755 /opt/dompetku/deploy && sudo install -m 644 README.md /opt/dompetku/deploy/
   sudo install -m 600 deploy.env.example /opt/dompetku/env/deploy.env
   sudo install -m 600 web.env.example /opt/dompetku/env/web.env
   ```

   - Verifikasi: `cd /opt/dompetku && sudo docker compose --profile web config --services` memuat `web`; `sudo docker compose config --services` tanpa profil tetap `gw`, `postgres`; `diff /opt/dompetku/compose.yml.s2 /opt/dompetku/compose.yml` hanya menambah blok `web` dan komentar baris 2.

3. **[PEMILIK] Rahasia.** Isi `GHCR_USER` dan `GHCR_TOKEN` (read-only, `read:packages`) di `/opt/dompetku/env/deploy.env` dengan editor di VM. Tidak lewat chat.
   - Verifikasi tanpa mencetak isi: `sudo grep -c '^GHCR_TOKEN=.\{20,\}' /opt/dompetku/env/deploy.env` = 1.
4. **Uji verifikasi sekali** (butuh satu rilis `main` sudah ada di GHCR):

   ```bash
   sudo /opt/dompetku/bin/deploy --status   # "belum ada deploy"
   sudo /opt/dompetku/bin/deploy; echo "kode $?"
   ```

   Bila `gh attestation verify` menolak karena izin, lihat bagian Attestation di bawah.

5. **gw ke web.** Di `/opt/dompetku/gw/Caddyfile` ganti blok `handle { ... respond ... }` sementara dengan `reverse_proxy web:3000` sesuai komentar S3 di berkas itu (`header_up X-Forwarded-For {client_ip}`, `header_up X-Forwarded-Proto https`, `header_up -X-Forwarded-Host`), validasi (`caddy validate`), lalu `docker compose up -d gw`. Perubahan Caddyfile masuk repo lewat sesi pemilik berkas itu (`infra/db-vm/gw/`).
   - Verifikasi dari VM App: `curl -s https://dompet.novandafadly.com/api/health` = `{"status":"ok","sha":"<sha main>"}`; header `Content-Security-Policy-Report-Only` ada.
6. **Timer.**

   ```bash
   sudo install -m 644 systemd/dompetku-deploy.service systemd/dompetku-deploy.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now dompetku-deploy.timer
   ```

   - Verifikasi: `systemctl list-timers dompetku-deploy.timer`; `journalctl -u dompetku-deploy -n 20`.

7. **Uji rollback (kriteria keluar S3).** Rilis sengaja rusak ke `main` (mis. commit yang membuat `/api/health` 500), tunggu timer. Harapan: kode 3, `deploy.log` memuat `"result":"rolled_back"`, `/api/health` tetap melaporkan SHA lama. Lalu revert commit itu; rilis berikutnya terpasang normal.
8. **Smoke pasca-deploy (K12)**: `curl` halaman utama 200 lewat domain publik, header keamanan lengkap.

Rollback pemasangan: `sudo systemctl disable --now dompetku-deploy.timer`, hapus kedua unit, `docker compose --profile web rm -sf web`, `sudo mv /opt/dompetku/compose.yml.s2 /opt/dompetku/compose.yml`, hapus `bin/deploy`, `env/{deploy,web}.env`, `/var/lib/dompetku/deploy`.

## Operasi

- Status: `sudo /opt/dompetku/bin/deploy --status`.
- Rollback manual ke digest tertentu (tetap diverifikasi): `sudo /opt/dompetku/bin/deploy --digest sha256:... --allow-older`. Timer berikutnya tidak menimpanya selama `main` belum berubah ke rilis yang lebih baru (digest `main` lama tercatat di `history.tsv`).
- Coba ulang digest yang tercatat gagal: `sudo /opt/dompetku/bin/deploy --digest sha256:...`.
- CSP: setelah satu minggu report-only tanpa pelanggaran, hapus `CSP_REPORT_ONLY=1` dari `env/web.env`, lalu `docker compose --profile web up -d web`.

## Attestation

Workflow `release` memakai `actions/attest-build-provenance` (provenance SLSA, disimpan juga di GHCR) dan deployer memverifikasi dengan `gh attestation verify --bundle-from-oci --signer-workflow .../release.yml --source-ref refs/heads/main`.

**Perlu dicek pemilik:** menurut dokumentasi GitHub yang diketahui agen, artifact attestation untuk repo **private** hanya tersedia di GitHub Enterprise Cloud; repo ini private milik akun pribadi. Bila langkah `Attest` di workflow `release` gagal karena itu, pilihannya:

1. Set variabel repo `IMAGE_SIGNING=cosign` (Settings, Variables): workflow menandatangani digest dengan cosign keyless (Sigstore publik). Konsekuensi: entri publik di log transparansi Rekor memuat nama repo, path workflow, dan SHA commit (bukan kode). Di VM: `VERIFY=cosign` di `deploy.env` dan pasang `cosign` (langkah 1).
2. Menjadikan repo publik (tidak disarankan; repo juga berisi dokumen produk).
