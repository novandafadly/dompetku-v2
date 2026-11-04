# Akses DB manual: `dompetku-psql`

Satu-satunya jalur psql manual yang disetujui di VM DB (BSD §12, TRD §3.4). Skrip: `infra/db-vm/bin/dompetku-psql`, tes: `infra/db-vm/bin/test/dompetku-psql-test.sh` (job CI `infra`). Tanpa rahasia di dokumen ini.

## Yang dilakukan alat ini

1. Menolak berjalan tanpa alasan. Alasan harus 3 sampai 120 karakter dan hanya berisi huruf, angka, spasi, dan `. , : _ / ( ) -`. Alasan tersimpan di `audit.events`, jadi **jangan tulis data pribadi, email, nominal, atau rahasia**. Contoh alasan yang baik: `owner_email bootstrap`, `email_fix`, `pemulihan faktor`.
2. Menulis event `db_manual_access` ke `audit.events` sebagai `dompetku_owner`, dalam transaksi sendiri. Isi `meta`:
   - `via = 'cli'`;
   - `target` = role sesi (`dompetku_owner` atau `postgres`);
   - `reason` = alasan;
   - `op` = `SUDO_USER` yang sudah disaring (`[A-Za-z0-9._-]`, selain itu `unknown`).

   Kunci-kunci ini sudah ada di daftar kunci yang diizinkan (0004), jadi tidak perlu migrasi. Bila event gagal ditulis, sesi **tidak** dibuka (kode keluar 3).

3. Mengirim ping `/fail` ke check Healthchecks `dompetku-manual-access`, sehingga pemilik menerima email "down" berisi `sesi manual dibuka role=… op=… event=<id>`. Saat skrip keluar (normal, galat, HUP, TERM), alat ini mengirim ping sukses, sehingga pemilik menerima email "up" berisi `sesi manual ditutup`. Alasan tidak ikut dikirim. URL ping tidak pernah dicetak. Ping yang gagal (timeout 10 detik) hanya menghasilkan peringatan.
4. Membuka psql di container postgres (`docker compose exec postgres gosu postgres psql -d dompetku`):
   - `PGAPPNAME=dompetku-psql-<id event>`, untuk mencocokkan log koneksi dengan event;
   - `idle_in_transaction_session_timeout = 10min`, supaya transaksi yang terlupa tidak menahan kunci;
   - bawaannya `role=dompetku_owner`, yang diset saat koneksi.

   `session_user` tetap `postgres` (pgaudit `all`), dan `reset role` bisa mengembalikan sesi ke superuser. Jadi `--as owner` hanyalah pagar salah ketik, bukan batas keamanan: siapa pun yang menjalankan alat ini sudah root di VM.

Pemakaian:

```bash
sudo /opt/dompetku/bin/dompetku-psql -- "alasan"                          # interaktif, sebagai dompetku_owner
sudo /opt/dompetku/bin/dompetku-psql -c "select 1" -- "alasan"            # satu perintah
sudo /opt/dompetku/bin/dompetku-psql -- "alasan" <prosedur.sql            # skrip dari stdin, ON_ERROR_STOP
sudo /opt/dompetku/bin/dompetku-psql --as postgres -- "alasan"            # superuser, hanya bila owner tidak cukup
```

SQL yang memuat email atau data lain sebaiknya dikirim lewat stdin, bukan `-c`, karena isi `-c` terlihat di daftar proses. Kedua cara tetap tercatat pgaudit di log Postgres.

**Jangan membaca objek skema `pgboss` lewat alat ini**, baik sebagai `dompetku_owner` maupun `postgres`. Alasannya ada di `runbook-s7-worker.md` langkah 5 (view jebakan milik `dompetku_worker`). Banner sesi interaktif mengingatkan hal ini.

Yang sengaja tidak memakai alat ini:

- `docs/superpowers/handoff/cek-duplikat-dompet-0109.sh`: read only, keluarannya hanya jumlah.
- Pembacaan katalog dan `jobs.job_runs` di `runbook-s7-worker.md` langkah 5.
- Deployer (`psql_postgres`): otomatis dan tercatat di `deploy.log`.

## Pemasangan (sekali, di VM DB)

1. **[PEMILIK] Healthchecks.io:** buat check `dompetku-manual-access` di project yang sama dengan `dompetku-backup`.
   - Jenis: Simple, Period maksimum (365 hari), Grace 1 menit.
   - Alert ke email pemilik.
   - Check ini sengaja tidak punya jadwal ping. Statusnya "down" selama sesi terbuka dan kembali "up" saat sesi ditutup. Period dibuat maksimum supaya check tidak menjadi "down" dengan sendirinya di antara sesi.
   - URL ping-nya rahasia ringan: jangan tempel di chat atau repo.
2. **[PEMILIK] `ops.env`** (root 600, nilai diisi langsung di VM):

   ```bash
   sudo install -m 600 -o root -g root /dev/null /opt/dompetku/env/ops.env
   sudo nano /opt/dompetku/env/ops.env        # satu baris: HC_MANUAL_ACCESS_URL=https://hc-ping.com/<uuid>
   sudo grep -c '^HC_MANUAL_ACCESS_URL=https://.\{20,\}$' /opt/dompetku/env/ops.env   # 1
   sudo stat -c '%a %U' /opt/dompetku/env/ops.env                                       # 600 root
   ```

   Selama `ops.env` belum ada, misalnya saat bootstrap, alat tetap berjalan tetapi mencetak `PERINGATAN: ... TIDAK mengirim alert email`. Event audit tetap ditulis.

3. **Skrip** (sesi VM; salin `infra/db-vm/bin/dompetku-psql` dari `main` ke `/tmp/dompetku-psql` lebih dulu):

   ```bash
   sudo install -m 755 -o root -g root /tmp/dompetku-psql /opt/dompetku/bin/dompetku-psql
   sudo /opt/dompetku/bin/dompetku-psql -c "select count(*) from audit.events where event = 'db_manual_access'" -- "uji pemasangan"
   ```

   Hasil yang diharapkan:
   - angka ≥ 1 (event uji itu sendiri);
   - dua email Healthchecks: "down", lalu "up";
   - tanpa `PERINGATAN`.

## Ditunda

- Alert anomali untuk koneksi `postgres`/`dompetku_owner` yang tidak didahului event `db_manual_access` (BSD §12). Fitur ini butuh log Postgres yang dikirim ke luar VM dan pencocokan `application_name`/waktu dengan `audit.events`. Pengiriman log ke luar VM belum ada (TRD §3.7), jadi fitur ini belum dibangun. Sampai saat itu, jejak sesi di luar alat ini hanya `log_connections` dan pgaudit di log container lokal.
- Event penutup sesi di `audit.events`. Saat ini penutupan sesi hanya ditandai ping sukses Healthchecks; jejak di DB hanya event pembuka.
