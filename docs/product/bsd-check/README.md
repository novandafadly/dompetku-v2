# Validasi DDL BSD (sekali pakai)

DDL di `../BSD.md` dijalankan di cluster PostgreSQL 16 sekali pakai pada 2026-10-31, putaran 2 setelah review backend dan security (sandbox belum punya PG 17 dan pgTAP). Cluster dihentikan dan dihapus sesudahnya.

- `02_auth_stub.sql`: bentuk minimal tabel Better Auth `auth."user"`, hanya untuk validasi; dipasang sebelum blok `auth` dari BSD (§5).
- `test.sql`: 130 asersi perilaku dengan harness SQL kecil pengganti pgTAP. Cakupan: pendaftaran tertutup dan akun pertama, undangan (tolak, salah email, kirim ulang, akun setengah jadi tidak memakan kuota dan dihapus setelah 72 jam, terima hanya setelah akun diamankan), isolasi dua user, idempotensi, pasangan `space_transfer` (deskripsi hanya di kaki Pribadi ke dua arah), saldo negatif termasuk dua koneksi paralel lewat `dblink`, isolasi wajib READ COMMITTED, `month_summary` dengan dompet kantor dan fee, kewajiban XOR (termasuk pindah induk kategori), tagihan mulai di masa lalu dan tagihan terarsip, arsip dompet hanya saldo 0, Sampah (`trash_list`, `purge_entry`), purge, `audit.log` (tanpa pemalsuan `user_id`, daftar event dan kunci `meta`), append-only (UPDATE, DELETE, TRUNCATE), `product_events`, dan katalog (RLS, PUBLIC, `search_path`, daftar tertutup DEFINER, indeks FK).

Urutan: role (`00_roles`) sebagai superuser, lalu blok BSD berurutan sebagai `dompetku_owner` (skema, stub auth, auth, tabel, private, read, api, jobs, RLS dan grant), lalu `test.sql` sebagai superuser (memakai `set role` dan `dblink`; cluster uji memakai autentikasi `trust` lokal agar `dblink` bisa membuka koneksi `dompetku_web`).

Hasil putaran 2: ALL TESTS PASSED (130/130).

Di M0b, asersi ini dipindah ke pgTAP dan dijalankan di CI terhadap PostgreSQL 17; kasus dua koneksi pindah ke Vitest.
