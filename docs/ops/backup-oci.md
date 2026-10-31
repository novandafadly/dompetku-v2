# Bucket backup OCI (persiapan S2)

Disiapkan 2026-10-31. Tidak ada rahasia di dokumen ini.

## Keadaan

| Hal                 | Nilai                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Bucket              | `dompetku-backup`, region `ap-batam-1`, compartment root, Standard, versioning mati, private  |
| Enkripsi bucket     | Oracle managed keys (data sudah dienkripsi WAL-G di VM dengan libsodium)                      |
| Namespace, endpoint | `ax40rkaxashz`, `https://ax40rkaxashz.compat.objectstorage.ap-batam-1.oraclecloud.com`        |
| Akses               | user `dompetku-backup` (domain Default) di group `dompetku-backup`, hanya Customer Secret Key |
| Policy              | `dompetku-backup`: baca bucket, `OBJECT_CREATE`/`OBJECT_INSPECT`/`OBJECT_READ`, tanpa hapus   |
| Retention rule      | `min-30-hari`, 30 hari, **belum dikunci**                                                     |
| Lifecycle rule      | `infra/oci/lifecycle-backup.sh`: `pg17/` 35 hari, `pg17-monthly/` 400 hari, `_test/` 31 hari  |
| Kredensial di VM DB | `/opt/dompetku/env/backup.env` (root 600), diisi pemilik; salinan di password manager pemilik |

Penyiapan: `infra/oci/setup-backup-iam.sh` dijalankan pemilik di OCI Cloud Shell.

## Uji akses dari VM DB

Dengan aws-cli 2.38.1 (path-style, checksum `when_required`), 5 kali berturut-turut: upload ok, baca ok, hapus ditolak, timpa objek yang sudah ada ditolak `RetentionRuleViolation`. Objek uji di `_test/` tertahan 30 hari oleh retention.

Kejadian saat penyiapan:

- User awalnya tidak masuk group (pengecekan keanggotaan di script memakai perintah CLI yang salah). Gejalanya: login S3 diterima (`list-buckets` jalan), semua akses bucket 403/`NoSuchBucket`. Diperbaiki manual dengan `oci iam group add-user`; script kini memakai `group list-users` dan berhenti bila user tidak tercatat.
- Setelah itu sekitar 1 menit hasilnya berubah-ubah, termasuk `SignatureDoesNotMatch ... not the home region`, sampai perubahan IAM merata.
- OCI menjawab akses yang tidak diizinkan dengan `NoSuchBucket`, bukan `AccessDenied`.

## Akibat untuk S2

- Retention memblokir **penimpaan** objek. WAL-G wajib `WALG_PREVENT_WAL_OVERWRITE=true` (WAL yang sama dikirim ulang setelah crash dibandingkan isinya, tidak ditimpa) dan tidak boleh memakai perintah yang menulis ulang metadata (`backup-mark`).
- WAL-G tidak bisa menghapus (`delete retain`); pembersihan backup lama lewat lifecycle rule per prefix (`pg17/` harian sekitar 35 hari, prefix bulanan sekitar 400 hari), selalu lebih lama dari retention.
- Retention dikunci setelah uji restore pertama lulus dan perilaku WAL-G di atas terbukti.

## Dipakai sejak S2 (2026-10-31)

WAL-G aktif (`WALG_S3_PREFIX=s3://dompetku-backup/pg17`, zstd, libsodium, `WALG_PREVENT_WAL_OVERWRITE=true`), dump bulanan di `pg17-monthly/`. Hasil uji di `docs/ops/runbook-s2.md`.
