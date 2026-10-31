# Runbook S2: Postgres, role, backup, restore (draf, menunggu persetujuan)

Dasar: IPD §3 S2, TRD §2 dan §3.3, BSD §3 dan §12, `docs/ops/backup-oci.md`. Gerbang awal terpenuhi 2026-10-31 (BSD disetujui, `bsd-check` lulus di 17.11). Pola sama dengan S1: satu langkah, verifikasi, rollback tertulis; tidak menyentuh app lain.

## Kriteria keluar (IPD)

1. Restore ke container sementara berhasil dan cek rekonsiliasi hijau.
2. Alert terkirim saat backup sengaja digagalkan.
3. RPO ≤ 5 menit dan RTO ≤ 1 jam terukur pada latihan.

## Rancangan

| Bagian           | Pilihan                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image            | `dompetku-postgres:17.11-1`, dibangun di VM DB dari `infra/db-vm/postgres/Dockerfile`: `postgres:17.11-bookworm` (digest dipatok) + `postgresql-17-pgaudit` dan `postgresql-17-pgtap` dari PGDG + WAL-G v3.0.9 `wal-g-pg-20.04-aarch64` (sha256 dicek). Debian, bukan Alpine, karena pgaudit/pgTAP tersedia sebagai paket PGDG. Pindah ke GHCR di S3.                                                                                                  |
| Data             | Volume `dompetku_pgdata` diinisialisasi ulang (Postgres sementara S1 tanpa data). `initdb --data-checksums`, `scram-sha-256`.                                                                                                                                                                                                                                                                                                                          |
| Jaringan dan TLS | Tetap tanpa port host, hanya network `internal`. `ssl=on` dengan sertifikat dari CA DompetKu (`pki.sh` ditambah leaf `postgres`); `pg_hba`: hanya `hostssl` + `scram-sha-256` dari subnet `dompetku_internal`, semua lainnya `reject`; superuser hanya lewat socket lokal di container.                                                                                                                                                                |
| Role dan skema   | BSD blok 1 (role + database) dijalankan sekali oleh superuser lewat skrip runbook; blok 2 (skema, `app.now()`/`app.today()`) jadi migrasi dbmate pertama di `packages/db/migrations`. Password role login diisi pemilik di `/opt/dompetku/env/*.env`.                                                                                                                                                                                                  |
| Audit            | `pgaudit.log` untuk role `postgres` dan `dompetku_owner`, `log_connections`/`log_disconnections` on (BSD §12). Pengiriman log ke luar VM DB menyusul (TRD §7 butir 6).                                                                                                                                                                                                                                                                                 |
| Backup WAL       | `archive_mode=on`, `archive_command='wal-g wal-push %p'`, `archive_timeout=300` (RPO ≤ 5 menit), `WALG_PREVENT_WAL_OVERWRITE=true` (retention bucket), kompresi `zstd`, enkripsi libsodium.                                                                                                                                                                                                                                                            |
| Base backup      | Timer systemd host `dompetku-backup.timer` harian 02:00 WIB: `wal-g backup-push`, lalu ping Healthchecks `dompetku-backup` (gagal = `/fail`).                                                                                                                                                                                                                                                                                                          |
| Bulanan          | Tanggal 1, 03:00 WIB: `pg_dump -Fc` dienkripsi dan diunggah lewat `wal-g st put` ke prefix `pg17-monthly/`.                                                                                                                                                                                                                                                                                                                                            |
| Pembersihan      | Lifecycle rule bucket (dijalankan pemilik di Cloud Shell): `pg17/` dihapus setelah 35 hari, `pg17-monthly/` setelah 400 hari, `_test/` setelah 31 hari. WAL-G tidak pernah menghapus.                                                                                                                                                                                                                                                                  |
| Uji restore      | Timer `dompetku-restore-test.timer` mingguan, Minggu 04:00 WIB: container sementara dari image yang sama, `--network` tanpa akses ke Postgres produksi, `backup-fetch LATEST` + replay WAL, cek: database `dompetku` ada, checksum katalog dan jumlah baris tiap tabel `app.*` sama dengan snapshot yang dicatat saat backup, pgTAP rekonsiliasi (bila tabel ledger sudah ada), lalu ping Healthchecks `dompetku-restore-test` dan catat durasi (RTO). |
| Batas sumber     | Postgres `mem_limit` 1 GiB, `cpus` 1; uji restore `mem_limit` 1 GiB, `cpus` 1, jalan saat VM sepi.                                                                                                                                                                                                                                                                                                                                                     |

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
