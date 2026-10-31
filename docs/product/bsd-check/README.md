# Validasi DDL BSD (sekali pakai)

DDL di `../BSD.md` dijalankan di cluster PostgreSQL 16.15 sekali pakai pada 2026-10-31 (sandbox belum punya PG 17 dan pgTAP).

- `02_auth_stub.sql`: bentuk minimal tabel Better Auth `auth."user"`, hanya untuk validasi; dipasang sebelum blok `02_auth` dari BSD.
- `test.sql`: 70 asersi perilaku (isolasi dua user, idempotensi, pasangan `space_transfer`, aturan tagihan ATAU anggaran wajib, purge, katalog RLS dan hak akses) dengan harness SQL kecil pengganti pgTAP.

Urutan: role (`00_roles`) sebagai superuser, lalu blok BSD berurutan sebagai `dompetku_owner` (skema, stub auth, auth, tabel, private, read, api, jobs, RLS dan grant), lalu `test.sql`.

Di M0b, asersi ini dipindah ke pgTAP dan dijalankan di CI terhadap PostgreSQL 17.
