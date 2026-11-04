# Runbook S7: worker di VM DB

Keputusan K1: worker ikut image rilis `ghcr.io/novandafadly/dompetku-web` (berkas `/app/worker/worker.mjs`), compose project yang sama, dan deployer cosign yang sudah ada. Tanpa rahasia di dokumen ini; nilai diisi pemilik langsung di VM, tidak lewat chat.

## Yang berubah

| Bagian                                  | Perubahan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/Dockerfile`                   | Tahap build juga membangun `apps/worker` (esbuild, satu berkas ESM); runtime menyalinnya ke `/app/worker/worker.mjs`. Tetap distroless, nonroot, tanpa RUN di runtime.                                                                                                                                                                                                                                                                                                                                                                 |
| `infra/db-vm/compose.yml`               | Layanan `worker` (profil `web`): image `dompetku-web:current` (sama dengan web), `command: ['worker/worker.mjs']`, `env/worker.env` (opsional bagi compose), network `worker_db` (hanya postgres + worker, subnet `172.25.0.0/16`, tanpa egress) + `worker_egress` (egress untuk Healthchecks, tidak difilter); worker tidak satu network dengan gw/web. Read-only, `cap_drop: ALL`, user 65532, 256 MiB, 0,5 CPU, `stop_grace_period: 45s` (di atas batas stop graceful pg-boss 30 s), tanpa port. Postgres ikut network `worker_db`. |
| `infra/db-vm/deploy/deploy`             | Preflight: `worker.mjs --check-config` dengan image rilis dan `env/worker.env` (tanpa jaringan); tidak valid = rilis ditolak (kode 2) sebelum migrasi dan sebelum web diganti. Sesudah web sehat, worker diganti ke image yang sama. Sehat = container `running` dari rilis baru (label revision) dan `RestartCount` tidak naik selama 20 detik. Worker gagal = web dan worker kembali ke digest lama (kode 3).                                                                                                                        |
| `infra/db-vm/postgres/`                 | `pg_hba.conf`: `dompetku_worker` hanya dari `172.25.0.0/16` (`worker_db`), role aplikasi lain tetap dari `172.24.0.0/16`. `postgresql.conf`: `log_error_verbosity = terse` (DETAIL 23505/23514 memuat nama dompet, deskripsi, nominal; klien tetap menerima DETAIL). Keduanya ada di image `dompetku-postgres`, jadi image dibangun ulang (langkah 2).                                                                                                                                                                                 |
| `infra/db-vm/deploy/worker.env.example` | Contoh `/opt/dompetku/env/worker.env` tanpa nilai.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Deployer **melewati** worker (bukan gagal, kode 0, web tetap terpasang) dan menulis alasannya di `detail` baris audit `"result":"ok"`:

- `worker_env_missing`: `/opt/dompetku/env/worker.env` tidak ada. Bila worker lama masih berjalan, deployer menghentikan dan menghapusnya (`docker compose rm -sf worker`) dan menambah penanda `worker_stopped` di detail: worker tidak dibiarkan basi di belakang web baru.
- `worker_service_missing`: `/opt/dompetku/compose.yml` di VM belum memuat layanan `worker`. Worker lama (bila ada) **tidak** disentuh; perbarui `compose.yml` (langkah 2).

Bila `worker.env` ada tetapi ditolak `--check-config` (mis. `DATABASE_URL` kosong), audit `"result":"rejected"` dengan detail `worker_config_invalid <NAMA_VARIABEL,...>` (tanpa nilai), kode 2; timer mencoba lagi tiap 5 menit sampai env diperbaiki (tidak dicatat `failed`).

Urutan langkah di bawah boleh sebelum atau sesudah PR S7 di-merge. Deployer di VM adalah salinan manual: sampai langkah 2 dikerjakan, deployer lama hanya mengganti web dan worker tidak pernah berjalan.

Job (semua WIB, `apps/worker/src/jobs.ts`): `dq_reconcile` 01:00 (check `dompetku-dq`); `purge_voided` Senin 01:15, `purge_idempotency` 01:20, `purge_unfinished_users` 01:25, `purge_audit` 01:30 (keempatnya **berbagi** check `dompetku-jobs`). Isi ping hanya nama job, SQLSTATE, id cek DQ, severity, dan jumlah pelanggaran.

Semua perintah manual yang memanggil `docker compose` untuk worker dibungkus `flock /run/lock/dompetku-deploy.lock` (kunci yang sama dengan deployer), supaya tidak bertabrakan dengan deploy yang sedang berjalan; perintah menunggu sampai deploy selesai.

## Langkah

Isi `infra/db-vm/deploy/` disalin ke `/tmp/dompetku-s7/`, `infra/db-vm/compose.yml` ke `/tmp/dompetku-s7/compose.yml`, dan `infra/db-vm/postgres/` ke `/tmp/dompetku-s7/postgres/`, lebih dulu (dari branch yang sudah di-merge ke `main`).

### 1. [PEMILIK] Healthchecks.io

Buat 2 check di project yang sama dengan `dompetku-backup` (alert ke email pemilik):

| Check           | Schedule (Cron) | Time zone      | Grace | Catatan                                                                        |
| --------------- | --------------- | -------------- | ----- | ------------------------------------------------------------------------------ |
| `dompetku-dq`   | `0 1 * * *`     | `Asia/Jakarta` | 2 jam | `dq_reconcile` harian                                                          |
| `dompetku-jobs` | `20 1 * * *`    | `Asia/Jakarta` | 2 jam | 4 job purge berbagi check ini; ping pertama tiap hari 01:20 (Senin juga 01:15) |

Salin URL ping masing-masing (bentuk `https://hc-ping.com/<uuid>`) untuk langkah 3. URL ini rahasia ringan (siapa pun yang tahu bisa memalsukan ping): jangan tempel di chat atau repo.

Karena 4 job berbagi `dompetku-jobs`, satu job gagal mengirim `/fail` (email "down" langsung), lalu job berikutnya yang sukses mengembalikannya ke "up" (email kedua). Email "down" tetap berarti ada job yang gagal malam itu; cek `jobs.job_runs` (langkah 5).

### 2. Berkas (sesi VM)

`worker.env` **tidak** dibuat di langkah ini; berkas itu baru muncul utuh di akhir langkah 3.

```bash
sudo cp /opt/dompetku/compose.yml /opt/dompetku/compose.yml.s6
sudo cp /opt/dompetku/bin/deploy /opt/dompetku/bin/deploy.s6
sudo cp -a /opt/dompetku/postgres /opt/dompetku/postgres.s6
cd /tmp/dompetku-s7
sudo install -m 755 deploy /opt/dompetku/bin/deploy
sudo install -m 644 compose.yml /opt/dompetku/compose.yml   # layanan worker + network worker_db, worker_egress
sudo install -m 644 postgres/pg_hba.conf postgres/postgresql.conf /opt/dompetku/postgres/
sudo install -m 644 README.md /opt/dompetku/deploy/README.md
sudo install -m 644 worker.env.example /opt/dompetku/deploy/worker.env.example
```

Postgres dibangun ulang (tag sama) dan dibuat ulang agar memakai `pg_hba.conf`/`postgresql.conf` baru dan ikut network `worker_db`. Web putus beberapa detik (koneksi pool dibuka ulang); jalankan di luar jam pakai:

```bash
cd /opt/dompetku
sudo flock /run/lock/dompetku-deploy.lock sh -c 'docker compose build postgres && docker compose up -d postgres'
sudo docker compose exec -T postgres gosu postgres psql -X -d dompetku -Atc "show log_error_verbosity"   # terse
sudo docker network inspect dompetku_worker_db -f '{{ .Internal }} {{ (index .IPAM.Config 0).Subnet }}'  # true 172.25.0.0/16
```

Tunggu `docker compose ps postgres` = `healthy` dan web kembali sehat (`curl` health seperti runbook S3) sebelum lanjut.

Verifikasi:

- `cd /opt/dompetku && sudo docker compose --profile web config --services` memuat `web` dan `worker`; tanpa profil tetap `gw`, `postgres`.
- `diff /opt/dompetku/compose.yml.s6 /opt/dompetku/compose.yml` hanya menambah blok `worker`, network `worker_db` dan `worker_egress`, `worker_db` di daftar network postgres, dan komentar.
- `sudo test -e /opt/dompetku/env/worker.env || echo belum-ada` = `belum-ada`.

### 3. [PEMILIK] Rahasia worker

Env disusun di `worker.env.new` (600 root), diverifikasi, lalu dipindah atomik ke `worker.env`. Deployer tidak pernah melihat berkas setengah jadi; begitu `worker.env` ada, setiap rilis memvalidasinya dengan `--check-config` sebelum mengganti apa pun.

1. Salinan kerja dari contoh, lalu `DATABASE_URL` dari `/opt/dompetku/env/db-roles.env` (password `dompetku_worker`, dibuat S2) tanpa menampilkannya (`printf` builtin bash, tidak muncul di daftar proses):

   ```bash
   sudo install -m 600 /opt/dompetku/deploy/worker.env.example /opt/dompetku/env/worker.env.new
   sudo bash -c 'set -eu; . /opt/dompetku/env/db-roles.env; f=/opt/dompetku/env/worker.env.new; umask 077
     { printf "DATABASE_URL=postgres://dompetku_worker:%s@postgres:5432/dompetku?sslmode=verify-full&sslrootcert=/etc/dompetku/ca.crt\n" "$DOMPETKU_WORKER_PASSWORD"
       grep -v "^DATABASE_URL=" "$f" || true; } >"$f.tmp"
     chmod 600 "$f.tmp"; mv "$f.tmp" "$f"'
   ```

2. Isi `HC_DQ_URL` dan `HC_JOBS_URL` (URL langkah 1, tanpa `/start` atau `/fail`, tanpa tanda kutip):

   ```bash
   sudo nano /opt/dompetku/env/worker.env.new
   ```

3. Verifikasi `.new` tanpa mencetak isi:

   ```bash
   f=/opt/dompetku/env/worker.env.new
   sudo grep -c '^DATABASE_URL=postgres://dompetku_worker:[0-9a-f]\{48\}@postgres:5432/dompetku?sslmode=verify-full&sslrootcert=/etc/dompetku/ca.crt$' "$f"   # 1
   sudo grep -c '^HC_DQ_URL=https://hc-ping.com/.\{20,\}$' "$f"     # 1
   sudo grep -c '^HC_JOBS_URL=https://hc-ping.com/.\{20,\}$' "$f"   # 1
   sudo stat -c '%a %U' "$f"                                          # 600 root
   ```

   (Bila Healthchecks memakai domain lain, sesuaikan pola dua baris HC.)

4. Pindah atomik (satu `rename` di direktori yang sama):

   ```bash
   sudo mv /opt/dompetku/env/worker.env.new /opt/dompetku/env/worker.env
   ```

Beri tahu sesi Claude; langkah 4 dan seterusnya bisa dijalankan agen.

### 4. Pemasangan

Cek apakah image yang berjalan sudah rilis S7 (memuat `worker.mjs`):

```bash
sudo /opt/dompetku/bin/deploy --status   # baris pertama: <digest> <created> <sha>
sudo docker run --rm --network none dompetku-web:current \
  -e "process.exit(require('fs').existsSync('/app/worker/worker.mjs') ? 0 : 1)" && echo rilis-s7 || echo pra-s7
```

SHA dari `--status` juga bisa dibandingkan dengan commit merge PR S7 di `main` (`git merge-base --is-ancestor <sha-merge-s7> <sha-status>` di salinan repo).

- **`rilis-s7`**: worker belum dipasang deployer (env baru ada setelah rilis itu). Pasang manual:

  ```bash
  cd /opt/dompetku
  sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web run --rm --no-deps -T worker worker/worker.mjs --check-config
  # harapan satu baris: {"t":"...","event":"config_ok"}  (gagal: config_invalid + nama field, tanpa nilai)
  sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps worker
  ```

- **`pra-s7`**: tidak perlu apa-apa; deploy rilis S7 memvalidasi env, memasang web, lalu worker. `deploy.log` baris terakhir `"result":"ok"` dengan `"detail":""`.

### 5. Verifikasi

```bash
cd /opt/dompetku
sudo docker compose --profile web logs --tail 20 worker          # worker_started, tanpa *_failed
c=$(sudo docker compose --profile web ps -q worker)
sudo docker inspect -f '{{ .State.Status }} {{ .RestartCount }}' "$c"   # running 0; ulangi 1 menit kemudian: tetap 0
sudo docker compose exec -T postgres gosu postgres psql -X -d dompetku -Atc \
  "select a.application_name, s.ssl from pg_stat_activity a join pg_stat_ssl s using (pid) where a.usename = 'dompetku_worker' order by 1"
# dompetku-worker|t dan dompetku-worker-job|t (bisa lebih dari satu baris per nama)
sudo docker inspect -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' "$c"
# dompetku_worker_db dompetku_worker_egress (tanpa dompetku_internal/dompetku_app)
```

Jadwal pg-boss dibaca **sebagai `dompetku_worker`** (login role itu sendiri lewat TLS dari network `worker_db`, password dari `db-roles.env` tanpa ditampilkan), bukan sebagai `postgres`:

```bash
cd /opt/dompetku
sudo bash -c 'set -eu; . /opt/dompetku/env/db-roles.env; export PGPASSWORD="$DOMPETKU_WORKER_PASSWORD"
  c=$(docker compose ps -q postgres)
  ip=$(docker inspect -f "{{ (index .NetworkSettings.Networks \"dompetku_worker_db\").IPAddress }}" "$c")
  docker exec -i -e PGPASSWORD "$c" psql -X -At \
    "host=postgres hostaddr=$ip dbname=dompetku user=dompetku_worker sslmode=verify-full sslrootcert=/etc/dompetku/tls/ca.crt" \
    -c "select current_user, session_user" -c "select name, cron, timezone from pgboss.schedule order by name"'
# dompetku_worker|dompetku_worker, lalu 5 baris dengan timezone Asia/Jakarta
```

> **Jangan pernah membaca atau menulis objek di skema `pgboss` sebagai `postgres` atau `dompetku_owner`**, juga tidak lewat `set role dompetku_worker` dari sesi superuser. Tabel `pgboss.*` dibuat dan dimiliki `dompetku_worker` (hak CREATE di skema itu). Worker yang disusupi bisa mengganti tabel dengan view yang memanggil fungsi buatannya; fungsi itu berjalan dengan hak pemanggil, jadi satu `select` dari superuser cukup untuk menjadikan worker superuser. `set role` tidak melindungi: kode di dalam sesi bisa `reset role` kembali ke superuser sesi. Pembacaan sebagai `postgres` di runbook ini hanya untuk katalog (`pg_stat_*`, `show`) dan tabel milik owner (`jobs.job_runs`).

Pagi berikutnya (setelah 01:30 WIB):

```bash
sudo docker compose exec -T postgres gosu postgres psql -X -d dompetku -Atc \
  "select job, status, coalesce(error_code, '-'), started_at from jobs.job_runs order by started_at desc limit 6"
```

Harapan: `dq_reconcile`, `purge_idempotency`, `purge_unfinished_users`, `purge_audit` berstatus `ok`; kedua check Healthchecks hijau. `dompetku-dq` merah dengan isi `DQxx error n` = pelanggaran data nyata (BSD §10), bukan gangguan worker.

### 6. Latihan gagal

Jalankan saat tidak ada PR yang akan di-merge. Timer deploy dimatikan selama latihan, supaya worker yang sengaja rusak tidak membuat rilis berikutnya ditolak atau di-rollback.

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
   cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps worker
   ```

   - Harapan worker: log `worker_start_failed` dengan `code` `28000` atau `28P01` (tanpa URL atau password), `RestartCount` naik tiap inspeksi (perintah langkah 5). Ini juga yang dilihat deployer: rilis dengan worker seperti ini di-rollback (kode 3). (`--check-config` tidak menangkap role salah karena tidak menyentuh DB.)
   - Harapan alert: worker tidak mengirim ping. Di Healthchecks, ubah sementara `dompetku-dq` ke Cron 5 menit dari sekarang dengan grace 1 menit; email "DOWN" harus datang dalam ±7 menit. Kembalikan ke `0 1 * * *`, grace 2 jam.

   Pulihkan:

   ```bash
   sudo mv /opt/dompetku/env/worker.env.bak /opt/dompetku/env/worker.env
   cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps worker
   sudo systemctl start dompetku-deploy.timer
   ```

   Lalu ulangi verifikasi langkah 5 (`running 0`, `worker_started`), dan kirim ping sukses (perintah 1 tanpa `/fail`) agar `dompetku-dq` kembali hijau tanpa menunggu 01:00.

### 7. Rollback pemasangan

```bash
cd /opt/dompetku
sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web rm -sf worker
sudo mv /opt/dompetku/compose.yml.s6 /opt/dompetku/compose.yml
sudo mv /opt/dompetku/bin/deploy.s6 /opt/dompetku/bin/deploy
sudo rm -rf /opt/dompetku/postgres && sudo mv /opt/dompetku/postgres.s6 /opt/dompetku/postgres
sudo flock /run/lock/dompetku-deploy.lock sh -c 'docker compose build postgres && docker compose up -d postgres'
sudo docker network rm dompetku_worker_egress dompetku_worker_db || true
```

`env/worker.env` boleh tetap ada (tidak dibaca deployer lama) atau dihapus; jeda kedua check di Healthchecks. Image rilis tetap memuat `worker.mjs`, tidak berpengaruh pada web. Tabel `pgboss.*` dan `jobs.job_runs` tetap (migrasi expand-only).

## Operasi

- Log: `sudo docker compose --profile web logs --since 24h worker` (JSON per baris: event, nama job, kode, tanpa nominal/deskripsi/email).
- Ganti isi `worker.env` (mis. rotasi URL ping): susun `worker.env.new` seperti langkah 3 (salin dari `worker.env`, edit, verifikasi, `mv`), lalu `cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps worker` (compose membuat ulang container saat env berubah).
- Restart: `cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web restart worker`. Stop berhenti graceful (SIGTERM, job aktif diselesaikan, maksimal 30 detik; Docker menunggu 45 detik sebelum SIGKILL).
- Matikan sementara (sampai deploy berikutnya): `cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web stop worker`. Deploy berikutnya menyalakannya lagi selama `worker.env` ada.
- Matikan lebih lama: `sudo mv /opt/dompetku/env/worker.env /opt/dompetku/env/worker.env.off`, lalu stop seperti di atas. Deploy berikutnya melewati worker dan, bila worker masih berjalan, menghentikannya (`worker_env_missing worker_stopped`). Nyalakan lagi: `mv` balik lalu langkah 4 (`rilis-s7`).
- **Rollback manual ke digest pra-S7** (`deploy --digest sha256:... --allow-older` ke image tanpa `worker.mjs`): pindahkan `worker.env` dulu (`mv … worker.env.off`, seperti di atas). Tanpa itu deploy ditolak `worker_config_invalid` (image lama tidak punya worker); sesudahnya deployer menghentikan worker lama (`worker_stopped`) dan memasang web lama. Kembalikan `worker.env` sesudah `main` kembali ke rilis S7 atau lebih baru.
- Worker yang terlewat jadwal (deploy, restart) menjalankan kejadian terakhir sekali saat start (`missed: 'once'`); job yang terputus > 1 jam ditutup `failed` saat start berikutnya.
