# Deployer pull-based (S3)

Dasar: Spec §9.2, TRD §2.4, IPD S3, `docs/ops/runbook-s2.md`. Timer systemd di VM DB menarik digest tag `main` dari `ghcr.io/novandafadly/dompetku-web` tiap 5 menit, memverifikasi tanda tangan cosign dan attestation SBOM dengan kunci publik pemilik, menolak rilis lebih tua, menjalankan migrasi dbmate dari image rilis, mengganti `web`, mengecek `/api/health`, lalu (S7) mengganti `worker` dari image yang sama dan mengecek kestabilannya, dan rollback otomatis keduanya bila gagal. Sesudah itu (Catat via WhatsApp) `openwa` dinaikkan bila `env/openwa.env` ada; `openwa` tidak memengaruhi hasil deploy web.

## Berkas

| Repo                                             | VM DB                                                            | Mode       |
| ------------------------------------------------ | ---------------------------------------------------------------- | ---------- |
| `deploy`                                         | `/opt/dompetku/bin/deploy`                                       | `755 root` |
| `../compose.yml` (`web`, `worker`, profil `web`) | `/opt/dompetku/compose.yml`                                      | `644 root` |
| `deploy.env.example`                             | `/opt/dompetku/env/deploy.env`                                   | `600 root` |
| `web.env.example`                                | `/opt/dompetku/env/web.env`                                      | `600 root` |
| `worker.env.example` (S7)                        | `/opt/dompetku/env/worker.env`                                   | `600 root` |
| `../env/openwa.env.example` (WA)                 | `/opt/dompetku/env/openwa.env`                                   | `600 root` |
| (dari pemilik, bagian Tanda tangan image)        | `/opt/dompetku/keys/cosign.pub` (hanya kunci publik)             | `644 root` |
| `systemd/dompetku-deploy.{service,timer}`        | `/etc/systemd/system/`                                           | `644 root` |
| `README.md`                                      | `/opt/dompetku/deploy/README.md`                                 | `644 root` |
| (dibuat deployer)                                | `/var/lib/dompetku/deploy/{current,history.tsv,failed}`          | `700 root` |
| (dibuat deployer)                                | `/var/log/dompetku/deploy.log` (satu baris JSON per hasil)       | `600 root` |
| (dibuat deployer)                                | `/opt/dompetku/migrations` (dari image rilis), `migrations.prev` | `755 root` |

Langkah DB yang dijalankan deployer (S2 sudah live; tanpa hook terpisah):

1. Preflight: container `postgres` `healthy` dan `pg_stat_archiver` menunjukkan arsip WAL terakhir berhasil.
2. Berkas migrasi diambil dari image rilis (`/app/db/migrations`, salinan `packages/db/migrations`) ke `/opt/dompetku/migrations`, yang dipasang read-only ke layanan `migrate`.
3. `select pg_create_restore_point('deploy-<sha12>')` sebagai `postgres` (peer, lewat `gosu`).
4. `docker compose run --rm -T migrate --wait up` (dbmate 2.36.0, profil `tools`, `env/migrate.env` = `dompetku_owner`). Gagal = web tidak diganti.

Image hanya ditarik dari GHCR (`docker pull`); VM tidak perlu BuildKit.

## Worker (S7)

Worker ada di image yang sama (`/app/worker/worker.mjs`, layanan compose `worker` dengan image `dompetku-web:current`), jadi satu digest = satu versi web + worker dan rollback mengembalikan keduanya. Pemasangan dan rahasia: `docs/ops/runbook-s7-worker.md`.

1. Preflight (bila worker akan dipasang): `docker run --rm --network none --read-only --cap-drop ALL --user 65532:65532 --env-file env/worker.env <image rilis> worker/worker.mjs --check-config`. Tidak valid = kode 2, audit `rejected` dengan detail `worker_config_invalid <NAMA_VARIABEL,...>` (tanpa nilai), sebelum migrasi dan sebelum web diganti; tidak dicatat `failed`, timer mencoba lagi.
2. Web diganti dan dicek lebih dulu (alur di atas). Web gagal = worker tidak disentuh.
3. Sesudah web sehat: `docker compose up -d --no-deps worker`. Sehat = container `running`, label `org.opencontainers.image.revision` container (diwarisi dari image) sama dengan SHA rilis, dan `RestartCount` tidak naik selama 20 detik (`WORKER_STABLE_CHECKS` x `WORKER_INTERVAL`). Worker tidak punya HTTP; `HEALTHCHECK` image dimatikan untuk layanan ini.
4. Worker gagal = digest masuk `failed`, web dikembalikan ke digest lama, worker dikembalikan ke digest lama bila sebelumnya berjalan atau dihentikan bila belum (rilis pertama yang memuat worker), kode 3, audit `rolled_back` dengan detail `health worker ...`.
5. Worker dilewati (kode 0, web tetap terpasang), alasan di `detail` audit `ok`: `worker_env_missing` (`env/worker.env` tidak ada; worker lama yang masih berjalan dihentikan dan dihapus, detail `worker_env_missing worker_stopped`) `worker_service_missing` (`compose.yml` di VM belum memuat `worker`; worker lama tidak disentuh), atau `worker_db_not_ready` (container postgres belum ikut network `dompetku_worker_db`, atau `pg_hba_file_rules` tidak memuat aturan `dompetku_worker` untuk `172.16.25.0` atau punya baris galat; runbook S7 langkah 2 baru sebagian; worker lama tidak disentuh, tanpa rollback web). Deploy pertama sebelum pemilik mengisi env tidak gagal.
6. Rollback manual `--allow-older` ke digest pra-S7 (tanpa `worker.mjs`): pindahkan `env/worker.env` dulu, kalau tidak ditolak di langkah 1.

## OpenWA (Catat via WhatsApp)

Layanan compose `openwa` memakai image pihak ketiga `ghcr.io/rmyndharis/openwa` yang dipatok tag + digest di `compose.yml`, bukan image rilis DompetKu: tidak diverifikasi cosign (tidak ada kunci pemilik untuknya), tidak ikut `current`, dan tidak ikut rollback. Pemasangan, rahasia, dan pemasangan nomor: `docs/ops/runbook-wa.md`.

1. Hanya di jalur sukses, sesudah web sehat dan worker sehat atau dilewati, dan sesudah `current` ditulis: `docker compose up -d --no-deps openwa`. Compose tidak membuat ulang container yang konfigurasinya tidak berubah; digest baru di `compose.yml` ditarik di langkah ini.
2. Hasil di field audit `openwa` (baris audit `ok`), tidak mengubah kode keluar, `failed`, atau `detail`:
   - `openwa_ok`: `compose up` berhasil.
   - `openwa_up_failed`: `compose up` gagal (mis. image tidak bisa ditarik). Web tetap terpasang tanpa rollback; `HC_PING_URL/fail` dipanggil bila diisi.
   - `openwa_env_missing`: `env/openwa.env` tidak ada; container `openwa` yang masih ada dihentikan dan dihapus (`compose rm -sf openwa`, volume `openwa_data` tetap), penanda `openwa_stopped`.
   - `openwa_service_missing`: `compose.yml` di VM belum memuat `openwa`; tidak disentuh.
   - `openwa_error`: galat tak terduga di langkah openwa; web tetap terpasang.
   - kosong: openwa tidak disentuh (deploy ditolak, migrasi gagal, health gagal, atau rollback).
3. Rollback web (kode 3/4) dan `failed_no_previous` tidak pernah menghentikan, mengganti, atau menyalakan `openwa`.

## Kode keluar dan perilaku

| Kode | Arti                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0    | Selesai, tidak ada rilis baru, deploy lain sedang berjalan, atau digest pernah gagal                                          |
| 2    | Ditolak: tanda tangan/SBOM tidak valid, commit lebih tua, digest pernah berjalan, preflight (termasuk env worker tidak valid) |
| 3    | Rilis gagal health (web atau worker), sudah kembali ke digest sebelumnya                                                      |
| 4    | Rilis gagal dan rollback juga gagal (tindakan manual)                                                                         |
| 1    | Galat lain (GHCR tidak terbaca, migrasi gagal, konfigurasi)                                                                   |

- "Lebih tua" = label `org.opencontainers.image.created` (waktu commit UTC, diisi workflow `release`) lebih kecil dari yang berjalan, atau digest yang pernah berjalan lalu digantikan.
- Digest yang gagal health, gagal migrasi, atau ditolak karena lebih tua dicatat di `failed` dan tidak dicoba ulang oleh timer; rilis baru di `main` atau `deploy --digest` manual yang melanjutkan.
- Rollback hanya mengganti image (tanpa down-migration). Aman karena migrasi wajib expand/contract (TRD §2.4).
- Kegagalan memanggil `HC_PING_URL/fail` bila diisi.

## Pemasangan (sesi VM, setelah S2)

Satu langkah, verifikasi, lanjut. Isi `infra/db-vm/deploy/` disalin ke `/tmp/dompetku-s3/`, dan `infra/db-vm/compose.yml` ke `/tmp/dompetku-s3/compose.yml`, lebih dulu. Simpan salinan compose yang berjalan: `sudo cp /opt/dompetku/compose.yml /opt/dompetku/compose.yml.s2`.

1. **Alat.** cosign v3.0.6 (sama dengan workflow `release`): biner `cosign-linux-arm64` dari rilis `sigstore/cosign` v3.0.6, cek `sha256` dengan `cosign_checksums.txt` rilis yang sama, pasang ke `/usr/local/bin/cosign` (`755 root`). `gh` tidak diperlukan.
   - Verifikasi: `cosign version` memuat `v3.0.6`.
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

3. **[PEMILIK] Rahasia.** Isi `GHCR_USER` dan `GHCR_TOKEN` (read-only, `read:packages`) di `/opt/dompetku/env/deploy.env` dengan editor di VM. Tidak lewat chat. Pasang kunci publik cosign (bagian Tanda tangan image, langkah 3).
   - Verifikasi tanpa mencetak isi: `sudo grep -c '^GHCR_TOKEN=.\{20,\}' /opt/dompetku/env/deploy.env` = 1; `sudo grep -c '^VERIFY=cosign-key$' /opt/dompetku/env/deploy.env` = 1; `head -n 1 /opt/dompetku/keys/cosign.pub` = `-----BEGIN PUBLIC KEY-----`.
4. **Uji verifikasi sekali** (butuh satu rilis `main` sudah ada di GHCR):

   ```bash
   sudo /opt/dompetku/bin/deploy --status   # "belum ada deploy"
   sudo /opt/dompetku/bin/deploy; echo "kode $?"
   ```

   Bila ditolak dengan `tanda tangan/attestation cosign tidak valid`, cek bahwa `cosign.pub` di VM pasangan dari secret `COSIGN_PRIVATE_KEY` dan bahwa run `Release` terakhir lulus langkah tanda tangan.

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

## Tanda tangan image

Artifact attestation GitHub tidak tersedia untuk repo private milik akun pribadi (`Feature not available for user-owned private repositories`), dan cosign keyless menulis entri publik ke log transparansi Rekor. Karena itu workflow `release` menandatangani digest dengan **pasangan kunci cosign milik pemilik, tanpa log transparansi**:

- `cosign sign --key env://COSIGN_PRIVATE_KEY` dan `cosign attest --type spdxjson` (SBOM) dengan signing config tanpa layanan (tanpa Fulcio, Rekor, TSA; padanan `--tlog-upload=false` di cosign v3). Tanda tangan dan attestation disimpan di GHCR di samping image.
- Bila secret kosong, job gagal dengan pesan jelas sebelum tag `main` dipindah; deployer tidak melihat rilis tanpa tanda tangan.
- Deployer (`VERIFY=cosign-key`) menjalankan `cosign verify` lalu `cosign verify-attestation --type spdxjson`, keduanya `--key /opt/dompetku/keys/cosign.pub --insecure-ignore-tlog=true`. Tanpa Rekor, satu-satunya jangkar kepercayaan adalah kunci itu.

### [PEMILIK] Membuat dan memasang kunci

Kunci pribadi tidak pernah ada di VM dan tidak pernah dikirim lewat chat.

1. Di mesin tepercaya milik pemilik (bukan VM, bukan sandbox agen), dengan cosign v3:

   ```bash
   mkdir -p ~/dompetku-cosign && cd ~/dompetku-cosign
   cosign generate-key-pair      # minta password; hasil cosign.key (terenkripsi) + cosign.pub
   ```

   Simpan `cosign.key` dan password-nya di password manager.

2. GitHub repo `novandafadly/dompetku-v2`, Settings, Secrets and variables, Actions, **New repository secret**:
   - `COSIGN_PRIVATE_KEY` = isi lengkap `cosign.key` (termasuk baris `BEGIN`/`END`).
   - `COSIGN_PASSWORD` = password langkah 1 (wajib tidak kosong).
   - Variabel lama `IMAGE_SIGNING` (bila pernah dibuat) boleh dihapus; tidak dipakai lagi.
3. Salin **hanya** `cosign.pub` ke VM DB, lalu:

   ```bash
   sudo install -d -m 755 /opt/dompetku/keys
   sudo install -m 644 cosign.pub /opt/dompetku/keys/cosign.pub
   ```

4. Picu rilis (push ke `main` atau re-run workflow `Release`), lalu di VM: `sudo /opt/dompetku/bin/deploy; echo "kode $?"`.

Rotasi: ulangi langkah 1 sampai 3 dengan kunci baru, picu rilis baru, lalu deploy. Digest lama yang ditandatangani kunci lama tidak lolos verifikasi lagi (rollback manual ke digest lama perlu ditandatangani ulang atau kunci lama dipasang sementara).
