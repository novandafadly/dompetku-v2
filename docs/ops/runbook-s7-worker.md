# Runbook S7: worker di VM DB

Keputusan K1: worker ikut image rilis `ghcr.io/novandafadly/dompetku-web` (berkas `/app/worker/worker.mjs`), compose project yang sama, dan deployer cosign yang sudah ada. Tanpa rahasia di dokumen ini; nilai diisi pemilik langsung di VM, tidak lewat chat.

## Yang berubah

| Bagian                                  | Perubahan                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/Dockerfile`                   | Tahap build juga membangun `apps/worker` (esbuild, satu berkas ESM); runtime menyalinnya ke `/app/worker/worker.mjs`. Tetap distroless, nonroot, tanpa RUN di runtime.                                                                                                                                                             |
| `infra/db-vm/compose.yml`               | Layanan `worker` (profil `web`): image `dompetku-web:current` (sama dengan web), `command: ['worker/worker.mjs']`, `env/worker.env` (opsional bagi compose), network `internal` (Postgres) + `worker_egress` (hanya Healthchecks), read-only, `cap_drop: ALL`, user 65532, 256 MiB, 0,5 CPU, `stop_grace_period: 30s`, tanpa port. |
| `infra/db-vm/deploy/deploy`             | Sesudah web sehat, worker diganti ke image yang sama. Sehat = container `running` dari image baru dan `RestartCount` tidak naik selama 20 detik. Worker gagal = web dan worker kembali ke digest lama (kode 3).                                                                                                                    |
| `infra/db-vm/deploy/worker.env.example` | Contoh `/opt/dompetku/env/worker.env` tanpa nilai.                                                                                                                                                                                                                                                                                 |

Deployer **melewati** worker (bukan gagal, kode 0, web tetap terpasang) dan menulis alasannya di `detail` baris audit `"result":"ok"`:

- `worker_env_missing`: `/opt/dompetku/env/worker.env` belum ada.
- `worker_service_missing`: `/opt/dompetku/compose.yml` di VM belum memuat layanan `worker`.

Jadi urutan langkah di bawah boleh sebelum atau sesudah PR S7 di-merge. Deployer di VM adalah salinan manual: sampai langkah 2 dikerjakan, deployer lama hanya mengganti web dan worker tidak pernah berjalan.

Job (semua WIB, `apps/worker/src/jobs.ts`): `dq_reconcile` 01:00 (check `dompetku-dq`); `purge_voided` Senin 01:15, `purge_idempotency` 01:20, `purge_unfinished_users` 01:25, `purge_audit` 01:30 (keempatnya **berbagi** check `dompetku-jobs`). Isi ping hanya nama job, SQLSTATE, id cek DQ, severity, dan jumlah pelanggaran.

## Langkah

Isi `infra/db-vm/deploy/` disalin ke `/tmp/dompetku-s7/`, dan `infra/db-vm/compose.yml` ke `/tmp/dompetku-s7/compose.yml`, lebih dulu (dari branch yang sudah di-merge ke `main`).

### 1. [PEMILIK] Healthchecks.io

Buat 2 check di project yang sama dengan `dompetku-backup` (alert ke email pemilik):

| Check           | Schedule (Cron) | Time zone      | Grace | Catatan                                                                        |
| --------------- | --------------- | -------------- | ----- | ------------------------------------------------------------------------------ |
| `dompetku-dq`   | `0 1 * * *`     | `Asia/Jakarta` | 2 jam | `dq_reconcile` harian                                                          |
| `dompetku-jobs` | `20 1 * * *`    | `Asia/Jakarta` | 2 jam | 4 job purge berbagi check ini; ping pertama tiap hari 01:20 (Senin juga 01:15) |

Salin URL ping masing-masing (bentuk `https://hc-ping.com/<uuid>`) untuk langkah 3. URL ini rahasia ringan (siapa pun yang tahu bisa memalsukan ping): jangan tempel di chat atau repo.

Karena 4 job berbagi `dompetku-jobs`, satu job gagal mengirim `/fail` (email "down" langsung), lalu job berikutnya yang sukses mengembalikannya ke "up" (email kedua). Email "down" tetap berarti ada job yang gagal malam itu; cek `jobs.job_runs` (langkah 5).

### 2. Berkas (sesi VM)

```bash
sudo cp /opt/dompetku/compose.yml /opt/dompetku/compose.yml.s6
sudo cp /opt/dompetku/bin/deploy /opt/dompetku/bin/deploy.s6
cd /tmp/dompetku-s7
sudo install -m 755 deploy /opt/dompetku/bin/deploy
sudo install -m 644 compose.yml /opt/dompetku/compose.yml   # menambah layanan worker + network worker_egress
sudo install -m 644 README.md /opt/dompetku/deploy/README.md
sudo install -m 600 worker.env.example /opt/dompetku/env/worker.env
```

Verifikasi:

- `cd /opt/dompetku && sudo docker compose --profile web config --services` memuat `web` dan `worker`; tanpa profil tetap `gw`, `postgres`.
- `diff /opt/dompetku/compose.yml.s6 /opt/dompetku/compose.yml` hanya menambah blok `worker`, network `worker_egress`, dan komentar baris 3.
- `sudo stat -c '%a %U' /opt/dompetku/env/worker.env` = `600 root`.

Catatan: `worker.env` dari contoh berisi `DATABASE_URL=` kosong. Sampai langkah 3 selesai, jangan jalankan `docker compose --profile web up -d` tanpa nama layanan (worker akan restart berulang); deployer sendiri selalu menyebut layanan.

### 3. [PEMILIK] Rahasia worker

Password `dompetku_worker` sudah ada di `/opt/dompetku/env/db-roles.env` (dibuat S2). Perintah ini menulis `DATABASE_URL` dari sana tanpa menampilkannya (`printf` builtin bash, tidak muncul di daftar proses):

```bash
sudo bash -c 'set -eu; . /opt/dompetku/env/db-roles.env; f=/opt/dompetku/env/worker.env; umask 077
  { printf "DATABASE_URL=postgres://dompetku_worker:%s@postgres:5432/dompetku?sslmode=verify-full&sslrootcert=/etc/dompetku/ca.crt\n" "$DOMPETKU_WORKER_PASSWORD"
    grep -v "^DATABASE_URL=" "$f"; } >"$f.new"
  chmod 600 "$f.new"; mv "$f.new" "$f"'
```

Lalu isi `HC_DQ_URL` dan `HC_JOBS_URL` (URL langkah 1, tanpa `/start` atau `/fail`) dengan editor:

```bash
sudo nano /opt/dompetku/env/worker.env
```

Verifikasi tanpa mencetak isi:

```bash
sudo grep -c '^DATABASE_URL=postgres://dompetku_worker:[0-9a-f]\{48\}@postgres:5432/dompetku?sslmode=verify-full&sslrootcert=/etc/dompetku/ca.crt$' /opt/dompetku/env/worker.env   # 1
sudo grep -c '^HC_DQ_URL=https://hc-ping.com/.\{20,\}$' /opt/dompetku/env/worker.env     # 1
sudo grep -c '^HC_JOBS_URL=https://hc-ping.com/.\{20,\}$' /opt/dompetku/env/worker.env   # 1
sudo stat -c '%a %U' /opt/dompetku/env/worker.env                                          # 600 root
```

(Bila Healthchecks memakai domain lain, sesuaikan pola dua baris HC.) Beri tahu sesi Claude; langkah 4 dan seterusnya bisa dijalankan agen.

### 4. Pemasangan

Bila rilis S7 (image dengan `/app/worker/worker.mjs`) **sudah** terpasang (`sudo /opt/dompetku/bin/deploy --status`, lalu `deploy.log` terakhir memuat `worker_env_missing` atau `worker_service_missing`):

```bash
cd /opt/dompetku
sudo docker compose --profile web run --rm --no-deps worker worker/worker.mjs --check-config
# harapan satu baris: {"t":"...","event":"config_ok"}  (gagal: config_invalid + nama field, tanpa nilai)
sudo docker compose --profile web up -d --no-deps worker
```

Bila **belum**: tidak perlu apa-apa; deploy berikutnya memasang web lalu worker. `deploy.log` baris terakhir `"result":"ok"` dengan `"detail":""`.

### 5. Verifikasi

```bash
cd /opt/dompetku
sudo docker compose --profile web logs --tail 20 worker          # worker_started, tanpa *_failed
c=$(sudo docker compose --profile web ps -q worker)
sudo docker inspect -f '{{ .State.Status }} {{ .RestartCount }}' "$c"   # running 0; ulangi 1 menit kemudian: tetap 0
sudo docker compose exec -T postgres gosu postgres psql -X -d dompetku -Atc \
  "select a.application_name, s.ssl from pg_stat_activity a join pg_stat_ssl s using (pid) where a.usename = 'dompetku_worker' order by 1"
# dompetku-worker|t dan dompetku-worker-job|t (bisa lebih dari satu baris per nama)
sudo docker compose exec -T postgres gosu postgres psql -X -d dompetku -Atc \
  "select name, cron, timezone from pgboss.schedule order by name"
# 5 baris, timezone Asia/Jakarta
```

Pagi berikutnya (setelah 01:30 WIB):

```bash
sudo docker compose exec -T postgres gosu postgres psql -X -d dompetku -Atc \
  "select job, status, coalesce(error_code, '-'), started_at from jobs.job_runs order by started_at desc limit 6"
```

Harapan: `dq_reconcile`, `purge_idempotency`, `purge_unfinished_users`, `purge_audit` berstatus `ok`; kedua check Healthchecks hijau. `dompetku-dq` merah dengan isi `DQxx error n` = pelanggaran data nyata (BSD §10), bukan gangguan worker.

### 6. Latihan gagal

Jalankan saat tidak ada PR yang akan di-merge. Timer deploy dimatikan selama latihan, supaya worker yang sengaja rusak tidak membuat rilis berikutnya di-rollback dan tercatat `failed`.

1. Alert sampai ke email (tanpa mencetak URL):

   ```bash
   sudo bash -c 'set -a; . /opt/dompetku/env/worker.env; curl -fsS -m 10 --data-raw "latihan runbook S7" "$HC_DQ_URL/fail" >/dev/null && echo terkirim'
   ```

   Harapan: email "dompetku-dq is DOWN" berisi `latihan runbook S7`. Kembalikan: perintah yang sama dengan `"$HC_DQ_URL"` (tanpa `/fail`) dan isi `latihan selesai`.

2. Worker dengan `DATABASE_URL` salah:

   ```bash
   sudo systemctl stop dompetku-deploy.timer
   sudo cp -p /opt/dompetku/env/worker.env /opt/dompetku/env/worker.env.bak
   sudo sed -i 's|^DATABASE_URL=postgres://dompetku_worker:|DATABASE_URL=postgres://dompetku_worker_salah:|' /opt/dompetku/env/worker.env
   cd /opt/dompetku && sudo docker compose --profile web up -d --no-deps worker
   ```

   - Harapan worker: log `worker_start_failed` dengan `code` `28000` atau `28P01` (tanpa URL atau password), `RestartCount` naik tiap inspeksi (perintah langkah 5). Ini juga yang dilihat deployer: rilis dengan worker seperti ini di-rollback (kode 3).
   - Harapan alert: worker tidak mengirim ping. Di Healthchecks, ubah sementara `dompetku-dq` ke Cron 5 menit dari sekarang dengan grace 1 menit; email "DOWN" harus datang dalam ±7 menit. Kembalikan ke `0 1 * * *`, grace 2 jam.

   Pulihkan:

   ```bash
   sudo mv /opt/dompetku/env/worker.env.bak /opt/dompetku/env/worker.env
   cd /opt/dompetku && sudo docker compose --profile web up -d --no-deps worker
   sudo systemctl start dompetku-deploy.timer
   ```

   Lalu ulangi verifikasi langkah 5 (`running 0`, `worker_started`), dan kirim ping sukses (perintah 1 tanpa `/fail`) agar `dompetku-dq` kembali hijau tanpa menunggu 01:00.

### 7. Rollback pemasangan

```bash
cd /opt/dompetku
sudo docker compose --profile web rm -sf worker
sudo mv /opt/dompetku/compose.yml.s6 /opt/dompetku/compose.yml
sudo mv /opt/dompetku/bin/deploy.s6 /opt/dompetku/bin/deploy
sudo docker network rm dompetku_worker_egress || true
```

`env/worker.env` boleh tetap ada (tidak dibaca deployer lama) atau dihapus; jeda kedua check di Healthchecks. Image rilis tetap memuat `worker.mjs`, tidak berpengaruh pada web. Tabel `pgboss.*` dan `jobs.job_runs` tetap (migrasi expand-only).

## Operasi

- Log: `sudo docker compose --profile web logs --since 24h worker` (JSON per baris: event, nama job, kode, tanpa nominal/deskripsi/email).
- Ganti isi `worker.env` (mis. rotasi URL ping): edit, lalu `sudo docker compose --profile web up -d --no-deps worker` (compose membuat ulang container saat env berubah).
- Restart: `sudo docker compose --profile web restart worker`. Stop berhenti graceful (SIGTERM, job aktif diselesaikan, maksimal 30 detik).
- Matikan sementara: `sudo docker compose --profile web stop worker`. Deploy berikutnya menyalakannya lagi selama `worker.env` ada; untuk mematikan lebih lama, pindahkan `worker.env` (deployer lalu melewati worker; container yang sudah dihentikan tetap berhenti).
- Worker yang terlewat jadwal (deploy, restart) menjalankan kejadian terakhir sekali saat start (`missed: 'once'`); job yang terputus > 1 jam ditutup `failed` saat start berikutnya.
