# Auth S4: catatan operasi

Kode: `apps/web/src/server/auth/` (Better Auth 1.7.12, ADR 0007). Migrasi: `packages/db/migrations/0009_better_auth.sql`, `0010_api_daftar_undangan.sql`, diterapkan deployer (`dbmate up`) setelah `0001` sampai `0008`. Tanpa rahasia di dokumen ini.

## Variabel lingkungan web (`/opt/dompetku/env/web.env`, root 600)

| Nama                 | Isi                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`       | `dompetku_web`, `sslmode=verify-full`, `sslrootcert=/etc/dompetku/ca.crt` (contoh di `web.env.example`)      |
| `BETTER_AUTH_SECRET` | acak ≥ 32 karakter. Mengenkripsi rahasia TOTP: jangan dirotasi kecuali insiden (TRD §3.4)                    |
| `BETTER_AUTH_URL`    | `https://dompet.novandafadly.com` (origin saja, https wajib di produksi)                                     |
| `AUTH_RP_ID`         | opsional, bawaan hostname di atas. Passkey terikat nilai ini; mengubahnya membuat passkey lama tidak berlaku |
| `RESEND_API_KEY`     | wajib di produksi; tanpa ini web gagal di request auth pertama                                               |
| `AUTH_EMAIL_FROM`    | opsional, bawaan `DompetKu <dompet@novandafadly.com>`; domain harus terverifikasi di Resend                  |

Jangan isi `NEXT_PUBLIC_PROTOTYPE` atau `AUTH_CHECK_PWNED=0` di produksi. `AUTH_EMAIL_LOG` dan `AUTH_EMAIL_FILE` ditolak saat start bila `BETTER_AUTH_URL` bukan localhost. Web butuh egress HTTPS ke `api.resend.com` dan `api.pwnedpasswords.com` (network `app`).

Validasi terjadi saat request auth pertama, bukan saat start (healthcheck `/api/health` tetap hijau): setelah deploy, buka `/masuk` sekali dan pastikan bukan halaman galat.

## Urutan sebelum live

1. **Resend:** verifikasi domain pengirim (`novandafadly.com` atau subdomain) di dasbor Resend: tambah record SPF (TXT), DKIM (CNAME/TXT dari Resend), dan sebaiknya DMARC di DNS. Buat API key dengan izin kirim saja.
2. **CA ke web:** `compose.yml` memasang `./pki/postgres/ca.crt` read-only ke web (`/etc/dompetku/ca.crt`). Pastikan berkasnya ada (sama dengan yang dipakai `migrate`).
3. **`web.env`:** isi variabel di atas langsung di VM (`chmod 600`), tidak lewat chat.
4. **Rilis:** merge ke `main`; deployer menjalankan `dbmate up` (0009, 0010) lalu menukar image. Cek `select version from schema_migrations order by version desc limit 2` = `0010`, `0009`.
5. **`owner_email`:** sebagai `dompetku_owner` lewat `dompetku-psql` (tercatat `db_manual_access` + alert; pasang dulu: `docs/ops/akses-db-manual.md`). SQL lewat stdin agar email tidak terlihat di daftar proses:

   ```bash
   sudo /opt/dompetku/bin/dompetku-psql -- "owner_email bootstrap" <<'SQL'
   insert into app.settings (key, value) values ('owner_email', lower(btrim('<email pemilik>')))
   on conflict (key) do update set value = excluded.value;
   select value from app.settings where key = 'owner_email';
   SQL
   ```

6. **Bootstrap pemilik** (di peramban, domain produksi): `/buat-akun` (email = owner_email, nama, kata sandi ≥ 12) → email konfirmasi → tombol Konfirmasi → `/masuk` → `/amankan`: passkey (atau aplikasi autentikator) → buat dan simpan 10 kode pemulihan → Selesai → Beranda. Rumah tangga + ruang Bersama + Pribadi dibuat saat Selesai.
7. **Undang Farida:** `/undang` → email → Farida membuka tautan (72 jam) → Terima → Buat akun → Amankan → Selesai. Pemilik melihat status Diterima; undangan ketiga ditolak (`user_limit`).
8. **Smoke:** keluar-masuk dengan passkey dan dengan kata sandi + kode 6 digit; `/pribadi/beranda` tanpa sesi = 307 ke `/masuk`.

## Perilaku yang perlu diketahui

- Tidak ada `/api/auth/*`: semua lewat Server Action. Edge tidak perlu aturan khusus.
- IP klien = nilai pertama `X-Forwarded-For` (edge menimpanya). Tanpa header itu, jeda hanya per akun.
- Tautan undangan, reset, dan konfirmasi email membawa token di query. Edge memakai `log_format dompetku_tanpa_query` (`infra/app-vm/nginx/dompetku.conf`, `$uri` tanpa query). **Sesi VM:** salin konfigurasi baru ke `/etc/nginx/sites-available/dompetku`, `sudo nginx -t && sudo systemctl reload nginx`. Error log nginx tetap bisa memuat baris request lengkap; jangan teruskan error log ke luar VM tanpa penyaringan.
- Faktor terikat sesi: passkey yang didaftarkan di `/amankan` hanya menaikkan sesi yang mendaftarkannya; sesi lain user dicabut saat faktor atau kode pemulihan ditambahkan, dan token sesi diganti saat `/amankan` selesai.
- Batas laju per IP: intip/tolak undangan 20 per 10 menit, opsi passkey masuk 30 per 10 menit, kirim ulang email konfirmasi 5 per jam (per IP dan per user). Penghitung ada di `auth.login_throttle` (kunci hash).
- Email (reset, konfirmasi, pemberitahuan) dikirim di latar: respons tidak menunggu Resend. Gagal kirim hanya tercatat di log web (`[auth] tugas latar gagal`).
- Jeda gagal: 5/10/20 gagal = 1 menit/15 menit/1 jam per IP dan per akun, hilang 24 jam setelah gagal terakhir. Membuka paksa: `sudo /opt/dompetku/bin/dompetku-psql -c 'delete from auth.login_throttle' -- "buka jeda login"` (tidak bisa per email karena kunci di-hash).
- Akun terkunci dari faktor (HP hilang, kode pemulihan hilang): tidak ada jalur di aplikasi. Pemulihan manual = hapus faktor di DB lewat `dompetku-psql` setelah verifikasi langsung (tatap muka/telepon), lalu pengguna masuk dengan kata sandi dan mendaftar ulang di `/amankan`. Satu transaksi sebagai `dompetku_owner` (pemilik tabel `auth.*`); `<email>` diganti di VM:

  ```bash
  sudo /opt/dompetku/bin/dompetku-psql -- "pemulihan faktor" <<'SQL'
  begin;
  select id as uid from auth."user" where email = lower(btrim('<email>')) \gset
  delete from auth.passkey where "userId" = :'uid';
  delete from auth."twoFactor" where "userId" = :'uid';
  delete from auth.recovery_codes where user_id = :'uid';
  update auth."user" set "twoFactorEnabled" = false, "updatedAt" = now() where id = :'uid';
  delete from auth.session where "userId" = :'uid';  -- semua sesi lama dicabut
  insert into audit.events (event, user_id, meta) values ('factor_removed', :'uid', '{"via": "cli"}');
  commit;
  SQL
  ```

  Email tidak cocok = `\gset` tidak mengisi `uid` dan skrip berhenti sebelum `commit` (ON_ERROR_STOP).

- Akun setengah jadi (daftar tanpa selesai /amankan) dihapus `jobs.purge_unfinished_users` setelah 72 jam (worker S5); sampai worker ada, hapus manual bila perlu.

## Tes

- Unit: `pnpm --filter @dompetku/web test` (kebijakan sesi, jeda, kode pemulihan, env, cookie).
- Integrasi (Postgres): `pnpm --filter @dompetku/web test:int`, butuh `TEST_DATABASE_URL` (dompetku_web) dan `TEST_DATABASE_ADMIN_URL` (superuser) pada cluster sekali pakai yang sudah `dbmate up`.
- E2E mode nyata: `pnpm build` lalu `pnpm --filter @dompetku/web e2e:auth` dengan `AUTH_E2E_DATABASE_URL` dan `AUTH_E2E_ADMIN_URL`; passkey memakai autentikator virtual Chromium, email dibaca dari berkas. Job CI `auth` menjalankan keduanya.
