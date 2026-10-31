# Runbook S2: Postgres, role, backup, restore

Dasar: IPD §3 S2, TRD §2 dan §3.3, BSD §3 dan §12, `docs/ops/backup-oci.md`. Gerbang awal terpenuhi 2026-10-31 (BSD disetujui, `bsd-check` lulus di 17.11). Pola sama dengan S1: satu langkah, verifikasi, rollback tertulis; tidak menyentuh app lain.

## Kriteria keluar (IPD)

1. Restore ke container sementara berhasil dan cek rekonsiliasi hijau.
2. Alert terkirim saat backup sengaja digagalkan.
3. RPO ≤ 5 menit dan RTO ≤ 1 jam terukur pada latihan.

## Rancangan

| Bagian           | Pilihan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image            | `dompetku-postgres:17.11-1`, dibangun di VM DB dari `infra/db-vm/postgres/Dockerfile`: `postgres:17.11-bookworm` (digest dipatok) + `postgresql-17-pgaudit` dan `postgresql-17-pgtap` dari PGDG + WAL-G v3.0.9 `wal-g-pg-20.04-aarch64` (sha256 dicek). Debian, bukan Alpine, karena pgaudit/pgTAP tersedia sebagai paket PGDG. Pindah ke GHCR di S3.                                                                                                                                                                                                                          |
| Data             | Volume `dompetku_pgdata` diinisialisasi ulang (Postgres sementara S1 tanpa data). `initdb --data-checksums`, `scram-sha-256`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Jaringan dan TLS | Tetap tanpa port host. Network `internal` (subnet dipatok `172.24.0.0/16`) untuk klien, plus network `egress` khusus postgres agar WAL-G bisa ke bucket (`internal` tidak punya akses keluar). `ssl=on` dengan sertifikat dari CA DompetKu (`pki.sh` ditambah leaf `postgres`); `pg_hba`: hanya `hostssl` + `scram-sha-256` dari subnet `dompetku_internal`, semua lainnya `reject`; superuser hanya lewat socket lokal di container.                                                                                                                                          |
| Role dan skema   | BSD blok 1 (role + database) dijalankan sekali oleh superuser lewat skrip runbook; blok 2 (skema, `app.now()`/`app.today()`) jadi migrasi dbmate pertama di `packages/db/migrations`. Password role login dibuat acak oleh `db-init.sh` di `/opt/dompetku/env/db-roles.env` (tidak pernah ditampilkan; `log_statement` dan pgaudit dimatikan untuk sesi itu saja).                                                                                                                                                                                                             |
| Audit            | `pgaudit.log` untuk role `postgres` dan `dompetku_owner`, `log_connections`/`log_disconnections` on (BSD §12). Pengiriman log ke luar VM DB menyusul (TRD §7 butir 6).                                                                                                                                                                                                                                                                                                                                                                                                         |
| Backup WAL       | `archive_mode=on`, `archive_command='wal-g wal-push %p'`, `archive_timeout=300` (RPO ≤ 5 menit), `WALG_PREVENT_WAL_OVERWRITE=true` (retention bucket), kompresi `zstd`, enkripsi libsodium.                                                                                                                                                                                                                                                                                                                                                                                    |
| Base backup      | Timer systemd host `dompetku-backup.timer` harian 02:00 WIB: `wal-g backup-push`, lalu ping Healthchecks `dompetku-backup` (gagal = `/fail`).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Bulanan          | Tanggal 1, 03:00 WIB: `pg_dump -Fc` dienkripsi dan diunggah lewat `wal-g st put` ke prefix `pg17-monthly/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Pembersihan      | Lifecycle rule bucket (dijalankan pemilik di Cloud Shell): `pg17/` dihapus setelah 35 hari, `pg17-monthly/` setelah 400 hari, `_test/` setelah 31 hari. WAL-G tidak pernah menghapus.                                                                                                                                                                                                                                                                                                                                                                                          |
| Uji restore      | Timer `dompetku-restore-test.timer` mingguan, Minggu 04:00 WIB: `pg_create_restore_point` di produksi, tunggu segmennya terarsip, lalu container sementara dari image yang sama (archive mati, tidak tersambung ke network Postgres produksi) memulihkan `backup-fetch LATEST` + WAL sampai titik itu (`recovery_target_name`; titik tidak tercapai = gagal), cek: database `dompetku` ada, role lengkap, `app.today()`, semua tabel terbaca, `restore-checks.sql` (pgTAP rekonsiliasi) bila sudah ada, lalu ping Healthchecks `dompetku-restore-test` dan catat durasi (RTO). |
| Batas sumber     | Postgres `mem_limit` 1 GiB, `cpus` 1; uji restore `mem_limit` 1 GiB, `cpus` 1, jalan saat VM sepi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Yang dibutuhkan dari pemilik

1. **Healthchecks.io:** buat 2 check:
   - `dompetku-backup`: period 1 hari, grace 2 jam.
   - `dompetku-restore-test`: period 7 hari, grace 6 jam.

   Lalu isi URL ping-nya di `/opt/dompetku/env/backup.env` (`HC_BACKUP_URL`, `HC_RESTORE_URL`). Alert diarahkan ke email pemilik.

2. **Password role** di `/opt/dompetku/env/db-roles.env` (`dompetku_owner`, `dompetku_web`, `dompetku_worker`, `dompetku_monitor`); disediakan perintah satu baris yang mengisi nilai acak tanpa menampilkannya.
3. **Lifecycle rule:** satu perintah Cloud Shell disiapkan di `infra/oci/`.
4. **Persetujuan** untuk mengganti container `postgres` sementara S1 (volume kosong) dengan image S2.

## Langkah (ringkas)

1. Tulis `Dockerfile`, `postgresql.conf` override, `pg_hba.conf`, skrip `backup.sh`, `monthly.sh`, `restore-test.sh`, unit systemd, migrasi dbmate pertama di repo; validasi lokal di container sekali pakai dengan bucket `_test/`.
2. Bangun image di VM DB, cek `wal-g --version` dan enkripsi libsodium aktif.
3. `pki.sh` leaf `postgres`; `docker compose down postgres` + hapus volume sementara S1; `up` image baru; cek tanpa port host, `ssl=on`, `pg_hba` menolak non-SSL.
4. Blok role BSD (superuser), lalu `dbmate up` sebagai `dompetku_owner`; cek role, `app.now()`, `app.today()`.
5. Aktifkan archive; paksa `pg_switch_wal()`, cek WAL masuk bucket ≤ 5 menit.
6. Base backup pertama manual, lalu aktifkan timer harian dan bulanan.
7. Uji restore manual: ukur waktu sampai database siap (RTO) dan selisih waktu transaksi terakhir yang ikut pulih (RPO).
8. Latihan gagal: salah-kan sementara kredensial backup di salinan env uji, pastikan Healthchecks mengirim alert; kembalikan.
9. Lifecycle rule (pemilik), lalu kunci retention rule setelah langkah 7 lulus (keputusan pemilik terpisah).
10. Commit `infra/**`, `packages/db/**`, `docs/ops/runbook-s2.md` dengan catatan eksekusi.

Rollback umum: `docker compose down` + hapus volume `dompetku_pgdata` (belum ada data nyata sampai M1), disable timer, hapus image. Tidak ada yang menyentuh bucket selain menambah objek.

## Risiko

- WAL-G biner prebuilt untuk glibc 20.04: diuji di image bookworm sebelum dipakai; bila tidak cocok, dibangun dari sumber di tahap build.
- Retention memblokir penimpaan: diuji dengan `wal-push` ganda pada segmen yang sama di langkah 5.
- Beban VM DB: base backup dan uji restore dijadwalkan di luar jam kerja; data DompetKu masih kecil.

## Catatan eksekusi (2026-10-31/11-01)

Langkah 1 sampai 8 dan 10 dijalankan dari sesi Claude Code di VM App. Penyimpangan dan temuan (semua sudah masuk berkas di repo):

1. **Builder Docker VM DB tanpa BuildKit:** `COPY --chmod` tidak didukung; diganti `COPY` + `RUN chmod`.
2. **Postgres butuh egress untuk WAL-G:** network `internal` sengaja tanpa akses keluar; postgres ditambah network `egress` yang hanya berisi dirinya. `pg_hba` tetap hanya menerima subnet `internal`.
3. **Healthcheck sebagai root memenuhi log dengan `FATAL: Peer authentication`;** diganti `gosu postgres pg_isready -q`.
4. **`PGOPTIONS=-c pgaudit.log=ddl` untuk migrate ditolak** (parameter superuser). Dibuang, BSD §12 diperbarui; owner tidak diberi hak `SET` agar tidak bisa mematikan auditnya.
5. **dbmate mewajibkan penanda `-- migrate:down`;** migrasi 0001 diberi blok down kosong (maju-saja).
6. **Kunci TLS Postgres** dimiliki uid 999 (user postgres di container; di host tercatat `dnsmasq`, hanya nama).

Hasil verifikasi:

| Hal            | Hasil                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image          | `dompetku-postgres:17.11-1`: WAL-G v3.0.9 (sha256 cocok), pgaudit 17.1, pgTAP 1.3.4                                                                                                                                      |
| Enkripsi WAL-G | Objek uji di bucket tidak memuat teks asli; terbaca hanya dengan `--decrypt`                                                                                                                                             |
| Postgres       | Tanpa port host; `ssl=on` TLS 1.3; `data_checksums=on`; `scram-sha-256`; `archive_mode=on`, `archive_timeout=5min`; pgaudit dimuat; isolasi default `read committed`                                                     |
| `pg_hba`       | Ditolak: tanpa SSL, superuser lewat TCP, role aplikasi ke DB `postgres`, password salah. Diterima: `dompetku_web` SSL `verify-full` ke `dompetku`. Timeout web 5s/3s/15s                                                 |
| Role + migrasi | 8 role (`dompetku_*` + `dompetku_auditlog`), password acak di `db-roles.env` (600). dbmate `0001` lewat TLS `verify-full`; skema `app api private jobs audit auth` milik `dompetku_owner`; `app.today()` WIB; `env=prod` |
| Archive WAL    | Segmen setelah `pg_switch_wal()` terarsip dalam 3 s; kirim ulang segmen sama dilewati ("already archived with equal content"), aman terhadap retention                                                                   |
| Base backup    | Manual 2 s; timer harian 02:00 WIB aktif                                                                                                                                                                                 |
| Dump bulanan   | `pg_dump -Fc` terenkripsi ke `pg17-monthly/` (zstd); timer tanggal 1, 03:00 WIB aktif                                                                                                                                    |
| Uji restore    | Lulus 2x: titik pulih tercapai, DB terbuka, semua tabel terbaca; **RTO 16 s dan 11 s**. Timer Minggu 04:00 WIB aktif                                                                                                     |
| Latihan RPO    | Detak tiap 5 s selama 6 menit, "bencana" tanpa switch WAL, pulih sampai WAL terakhir di bucket: **RPO 117 s** (≤ 300 s), RTO 6 s. DB latihan dihapus                                                                     |
| Latihan alert  | `DRILL_FAIL=1 backup.sh` gagal upload dan mengirim `/fail` ke Healthchecks `dompetku-backup`; lalu backup normal mengirim sukses. Email alert **diterima pemilik** (dikonfirmasi 2026-11-01)                             |

Lifecycle rule terpasang 2026-11-01 (4 aturan aktif: `pg17/` 35 hari, `pg17-monthly/` 400 hari, `_test/` 31 hari, multipart gagal 2 hari). Retention rule dikunci pemilik 2026-11-01 (berlaku setelah jeda 14 hari). **S2 selesai.** Data DompetKu nyata belum ada (M1), jadi RTO akan diukur ulang saat data tumbuh.
