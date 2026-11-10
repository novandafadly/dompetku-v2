# Catat lewat WhatsApp (OpenWA): desain

Status: **disetujui pemilik, diimplementasikan** (PR #27, 2026-11-10). Bagian ini diperbarui di tempat sesuai implementasi; daftar perubahan beserta alasannya ada di bagian 12 "Perubahan saat implementasi (2026-11-10)".

## 1. Masalah dan tujuan

Novanda dan Farida ingin mencatat pengeluaran dan pemasukan dengan mengirim satu baris chat WhatsApp ke satu nomor khusus, tanpa membuka app. Contoh: `25rb makan siang`. Pesan dibaca oleh aturan tetap (tanpa AI), langsung masuk ledger lewat jalur Catat yang sudah ada, dan dibalas satu baris singkat.

Tujuan:

1. Mencatat dari WhatsApp dalam satu pesan, dengan konfirmasi balasan singkat.
2. Biaya tambahan Rp0 di luar pulsa atau kuota SIM khusus.
3. Tidak melemahkan jaminan ledger: RLS, idempotensi, audit, dan bisa dibatalkan.
4. Integrasi tipis di belakang satu antarmuka pengirim/penerima, supaya bisa pindah ke WhatsApp Cloud API tanpa menulis ulang parser dan ledger.

Bukan tujuan:

- Pembacaan teks dengan AI atau LLM (keputusan pemilik: format aturan tetap).
- WhatsApp Cloud API Meta (dipilih OpenWA karena pendaftaran Meta terlalu rumit; antarmuka dibuat agar bisa dipasang nanti).
- Lebih dari satu nomor bot, grup WhatsApp, foto struk, suara.
- Transfer antar ruang, talangan/reimburse, ubah/edit entri, saldo awal lewat WhatsApp.
- Notifikasi keluar yang diprakarsai bot (pengingat tagihan, ringkasan).

Anti-tujuan (dianggap gagal walau jalan): nominal salah tercatat tanpa jalan kembali; orang lain bisa mencatat ke ledger kita; kredensial sesi WhatsApp bocor atau tidak ikut jaga.

## 2. Keputusan pemilik (percakapan 2026-11-09)

- Pakai OpenWA, engine Baileys (bukan whatsapp-web.js/Chromium).
- Balasan WhatsApp singkat dipakai.
- Format teks: aturan tetap tapi longgar (urutan bebas, beberapa gaya nominal).
- Pendekatan A: catat langsung, bisa dibatalkan satu kata.

Risiko yang diterima pemilik: OpenWA tidak resmi (membongkar protokol WhatsApp). Nomor bot bisa dibanned dan sesi bisa putus. Proyek OpenWA sendiri menyatakan tidak disetujui untuk lingkungan teregulasi seperti keuangan; pemakaian di sini pribadi, dua orang. Wajib nomor khusus, bukan nomor utama.

## 3. Pendekatan yang dipertimbangkan

| | Cara | Catatan |
|---|---|---|
| **A (dipilih)** | Aturan membaca pesan, langsung `createEntry`, balas ringkasan, `batal` membatalkan | Kerja paling kecil; risiko salah baca ditekan format ketat, balasan yang mengulang hasil, dan pembatalan |
| B | Pesan jadi draf, konfirmasi di app | Paling aman, tapi butuh tabel draf dan layar baru, dan balasan WA kehilangan fungsi |
| C | Bot membalas ringkasan, tunggu "ya" | Dua pesan per catatan dan perlu status percakapan |

Pemilik memilih A. B dan C tidak dibangun.

## 4. Perilaku

### 4.1 Format pesan

Satu pesan = satu catatan. Teks dinormalisasi: huruf kecil, spasi rapat.

- **Nominal (wajib, tepat satu).** Diterima: `25rb`, `25k`, `25.000`, `25000`, `1,5jt`, `1.5jt`, `Rp 25.000`, `Rp25rb`, juga satuan terpisah dengan spasi (`25 rb`, `50 k`, `1,5 jt`, `25 ribu`, `2 juta`). `rb`/`k`/`ribu` = ×1.000, `jt`/`juta` = ×1.000.000. Satuan hanya menempel ke token angka tepat di depannya. Token tepat sesudah angka yang **diawali** satuan (dibandingkan sesudah NFKC, huruf kecil, tanpa karakter format tak terlihat: `rb`, `jt`, `rib`, `jut` dengan apa pun sesudahnya, atau `k` yang tidak diikuti huruf) selalu digabung ke angka; hanya bentuk persis `rb`/`k`/`jt`/`ribu`/`juta` yang menjadi nominal, selain itu ditolak (`bad_amount`, gagal tertutup) seperti `25rbu`: salah ketik (`25 rbu`, `2 jutaan`), tanda baca atau akhiran menempel (`25 rb,`, `50 k.`, `25 rb-an`, `25 rb/porsi`), dan satuan lebar penuh (`25 ｒｂ`) tidak pernah dibaca sebagai Rp25. Slang `reb` (`25 rebu`, `25 rebuan`) dan `ewu`, serta `miliar`/`milyar`/`triliun`/`trilyun` dan `m`/`mil` yang tidak diikuti huruf (`2 m`, `2 mil`, `2 miliar`), juga diperlakukan sebagai awal satuan dan ditolak; perbandingan memakai kunci NFKC + huruf kecil + tanpa diakritik + huruf Kiril/Yunani mirip dipetakan ke Latin (hanya untuk cek ini), jadi `25 рб`, `50 к`, `25 ríbu` = `bad_amount`. `2 mie`, `3 martabak` tetap angka bulat + keterangan; kata keterangan yang diawali `rib`/`jut`/`reb`/`ewu` tepat sesudah angka tanpa satuan (`2 rebus`) ikut ditolak (gagal tertutup). Kata keterangan sesudah satuan persis tidak ikut dicek (`25 rb ketupat` = Rp25.000 "ketupat"); `k` + huruf adalah keterangan (`50 kopi` = Rp50, pilihan terdokumentasi). Hasil harus bilangan bulat positif rupiah (tanpa sen). Lebih dari satu token nominal, atau nominal desimal yang tidak menjadi rupiah bulat (mis. `1,25rb`): ditolak.
- **Jenis.** Bawaan pengeluaran. Pemasukan bila ada tanda `+` di awal nominal atau pesan, atau kata penanda: `gaji`, `masuk`, `terima`, `pemasukan`.
- **Ruang.** Bawaan Pribadi. Bersama bila kata pertama `b` atau ada kata `bersama`.
- **Keterangan.** Sisa teks setelah nominal dan penanda dibuang, dipangkas, maksimum 200 karakter (batas `createEntrySchema`).
- **Kategori.** Dari kamus kata kunci yang sudah ada (`app.category_keywords()`, migrasi 0107) atas keterangan; tidak cocok → saran teratas `api.suggest_categories` (riwayat 30 hari, lalu nama) untuk jenis itu di ruang itu; balasan ✅ menyebut kategorinya supaya tebakan yang salah terlihat dan bisa dibatalkan atau diubah di app. Seed kategori tidak punya "Lainnya". Kategori tidak bisa dipaksa dari teks pada v1.
- **Dompet.** Dompet bawaan ruang untuk user itu (lihat 4.4).
- **Tanggal.** Hari ini (WIB, `app.today()`). `kemarin` = P1.
- **Batal.** Pesan persis `batal` (tanpa nominal) membatalkan catatan WhatsApp terakhir milik pengirim bila masih dalam 10 menit dan belum diubah di app. "Terakhir" = pesan `pending`, `recorded` atau `cancelled` terbaru selain `batal` itu sendiri: `batal` kedua sesudah `batal` pertama tidak mundur ke catatan yang lebih lama, dan pesan yang masih `pending` (catatan sedang berjalan, atau status akhirnya gagal disimpan) membuat `batal` dijawab "tidak bisa dibatalkan".
- **Saldo negatif.** Pengeluaran yang membuat saldo dompet negatif (`saldo_negatif`) ditolak dari WhatsApp dengan balasan yang mengarah ke app; tidak ada penimpaan lewat chat.

Contoh:

```
25rb makan siang        → pengeluaran Rp25.000 · Pribadi · Makan Siang & Minum
makan siang 25rb        → sama
+5jt gaji               → pemasukan Rp5.000.000 · Pribadi · Gaji
b 80rb belanja          → pengeluaran Rp80.000 · Bersama
beli 2 kopi 50rb        → ditolak (dua angka); balasan: contoh format
```

### 4.2 Balasan

Satu baris, tanpa emoji dekoratif selain tanda status.

- Sukses: `✅ Makan Siang & Minum Rp 25.000 · Pribadi · ketik batal untuk membatalkan` (nominal mengikuti `formatRupiah` repo: `Rp` + spasi tanpa putus (NBSP) + angka bertitik). Pemasukan diberi label supaya salah baca jenis terlihat: `✅ Pemasukan · Gaji Rp 5.000.000 · Pribadi · ketik batal untuk membatalkan`; pengeluaran tanpa label
- Tidak terbaca: `❌ Tidak terbaca. Contoh: 25rb makan siang` (tidak ada yang dicatat)
- Dibatalkan: `↩️ Dibatalkan: Makan Siang & Minum Rp 25.000`
- Nomor belum terhubung: balasan satu kali per jam berisi cara menghubungkan (4.3). Tanpa data apa pun.
- Kegagalan sistem (DB tidak terjangkau): `⚠️ Gagal menyimpan, coba lagi sebentar lagi`. Pesan sama yang dikirim ulang aman karena idempoten (5.3).

Kegagalan mengirim balasan tidak membatalkan catatan yang sudah tersimpan.

### 4.3 Menghubungkan nomor

Pemetaan nomor WhatsApp ke user tidak boleh bisa dipalsukan.

1. Di app, user yang sudah login memilih "Hubungkan WhatsApp"; app membuat kode sekali pakai (6 karakter, berlaku 10 menit) dan menampilkannya.
2. User mengirim `hubung KODE` dari nomor yang ingin dihubungkan ke nomor bot.
3. Webhook mencocokkan kode, menyimpan nomor (format E.164) sebagai milik user itu, lalu membalas konfirmasi.
4. Satu nomor hanya untuk satu user; satu user satu nomor aktif. Menghubungkan ulang mengganti nomor lama. Ada tombol "Putuskan" di app.
5. Reset kata sandi yang selesai dan masuk dengan kode pemulihan (keduanya mencabut semua sesi) ikut memutus nomor dan menghapus kode tertunda: sesi curian bisa saja sudah menghubungkan nomor penyerang. Event `wa_unlinked` membawa `via` `password_reset` atau `session_revoked` (tombol Putuskan: `app`). User menghubungkan ulang dari app sesudah masuk lagi.

Tidak ada pesan OTP yang dikirim bot ke nomor yang belum terbukti miliknya.

### 4.4 Dompet bawaan

Dompet bawaan per ruang adalah dompet aktif milik user yang paling baru dipakai di ruang itu; bila belum ada riwayat, dompet aktif pertama dengan kantong `operasional` lebih dulu, lalu menurut urutan tampil (sama dengan Catat di app). **Dompet `kantor` tidak pernah jadi bawaan**, di kedua cabang: pengeluaran sesudah talangan tidak boleh diam-diam masuk Kas Kantor. Ruang yang hanya punya dompet kantor dibalas "belum ada dompet aktif, buka app dulu". Ini keputusan saya; pengaturan eksplisit dompet bawaan WhatsApp adalah P1.

## 5. Rancangan teknis

### 5.1 Komponen dan jaringan (VM DB)

- Container **`openwa`** di compose project `dompetku` (VM DB: 3 vCPU, 17 GiB), profil `web`, image diikat digest, `linux/arm64`. Engine `baileys`, penyimpanan SQLite, tanpa Redis. Volume bernama untuk sesi dan basis data kecil. `read_only` kecuali volume dan tmpfs, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit` sekitar 512 MB (diukur saat implementasi).
- Sidecar **`wa-proxy`** (Caddy, image yang sama dengan gw, `infra/db-vm/wa-proxy/Caddyfile`) adalah satu-satunya jalur `openwa` ⇄ `web`: `:8081` (network `wa`) hanya `POST /api/wa/webhook` dari `openwa` ke `web:3000`, `:2786` (network `wa_web`) hanya `POST /api/sessions/<uuid>/messages/send-text` dari web ke `openwa:2785`; selain itu 404/405; header identitas klien dibuang.
- Network **`wa`** (internal, `172.16.26.0/24`, di luar pool bawaan): hanya `openwa` (`.3`) dan `wa-proxy` (`.2`). Network **`wa_web`** (internal, `172.16.28.0/24`): hanya `wa-proxy` (`.2`) dan `web` (dinamis dari `172.16.28.128/25`). `web` tidak berbagi network dengan `openwa`. Keduanya dengan gateway terisolasi (`gateway_mode_ipv4: isolated`, bridge tanpa alamat host) dan tanpa IPv6; `wa_egress` juga `enable_ipv6: false`.
- Network **`wa_egress`** (`172.16.27.0/24`) hanya untuk `openwa`: keluar ke internet (server WhatsApp). Tidak difilter per host (server WhatsApp tidak punya daftar host stabil), tetapi `firewall.sh` men-DROP koneksi baru ke IMDS/link-local, VCN, jaringan privat, CGNAT, dan alamat host (kecuali DNS ke resolver VCN); `openwa` tidak berbagi network dengan postgres, gw, worker, atau web.
- Dasbor dan Swagger OpenWA tidak dipublikasikan. Pemautan nomor utamanya lewat kode pairing (`docker compose exec`, tanpa port); cadangannya QR lewat SSH tunnel ke port loopback sementara (langkah di runbook).
- Webhook dikirim `openwa` ke `http://wa-proxy:8081/api/wa/webhook` (diteruskan ke `web:3000`), bukan lewat nginx/gw. Karena gw meneruskan semua path ke web, gw menjawab `404` untuk `/api/wa/*` dari luar (`@wa path` di Caddyfile). `OPENWA_URL` di web = `http://wa-proxy:2786`; key web di OpenWA dibatasi `allowedIps` = `172.16.26.2` (alamat `wa-proxy`). OpenWA dijalankan dengan `RESOLVE_LID_TO_PHONE=true` agar pengirim `@lid` membawa `senderPhone`.

### 5.2 Penerima webhook (di web)

Route handler baru (mis. `/api/wa/webhook`), bukan server action. Urutan, semuanya wajib:

1. Verifikasi HMAC OpenWA (`X-OpenWA-Signature: sha256=<hex>`, tanpa stempel waktu) atas byte mentah body (dibaca streaming lewat `getReader()`, bukan `text()`) dengan rahasia dari env `WA_WEBHOOK_SECRET`; salah → 401, tidak diproses. Perbandingan waktu-tetap. Sebelumnya: fitur mati (empat variabel wajib kosong; `WA_MAX_AMOUNT`, `WA_RATE_PER_MIN`, `WA_BOT_NUMBER` saja tidak menyalakan) 404; konfigurasi rusak 503 dengan body generik `{"ok":false}` (log `[wa] config_error` paling banyak satu baris per 60 detik per proses, karena terjadi sebelum verifikasi tanda tangan); ukuran di atas 64 KiB 413, dicek dari `Content-Length` lalu ditegakkan saat membaca stream (lewat batas = stream dibatalkan, body chunked tidak pernah ditampung utuh).
2. Hanya event pesan masuk, pesan pribadi (bukan grup, bukan pesan sendiri, bukan siaran/status). Selain itu 200 dengan satu baris log `[wa] ignored <alasan>` (`not_message`, `not_private`, `from_me`, `not_text`), tanpa isi pesan, pengirim, atau id.
3. Nomor pengirim = `senderPhone` bila ada, selain itu `from` (`@c.us`); `@lid` tanpa `senderPhone` diabaikan. Cari user dari nomor itu lewat fungsi DB `SECURITY DEFINER` sempit (`api.wa_resolve_sender(phone)`) yang hanya mengembalikan `user_id` bila nomor terhubung dan terverifikasi. Tanpa ini, web (role `dompetku_web` di bawah RLS) tidak bisa memetakan nomor ke user.
4. Batas laju per nomor (30 pesan/menit, `WA_RATE_PER_MIN`; dicek sebelum pencarian pengirim). Lewat batas → abaikan diam-diam dan catat log.
5. Parse → bangun `LedgerCtx` dengan user itu → `createEntry` lewat `withUser`/`withLedger` seperti jalur app. Tidak ada jalur tulis DB lain.
6. Balas lewat pengirim OpenWA (5.4).

Nominal di atas batas WhatsApp (usulan Rp100.000.000, di env) ditolak dengan balasan "gunakan app". Ini keputusan saya sebagai pengaman salah ketik; batas ledger sendiri 10¹³.

### 5.3 Idempotensi dan pembatalan

- `clientId` entri = UUID v5 deterministik dari id pesan WhatsApp. Webhook yang dikirim ulang oleh OpenWA menghasilkan `replayed: true`, bukan entri ganda.
- Id pesan OpenWA di-hash (SHA-256 hex) sebelum dipakai atau disimpan (id mentah bisa memuat nomor); `clientId` = UUID v5 dari hash itu.
- Tabel baru `app.wa_messages` (migrasi 0123): `message_id` (hash) unik, `user_id`, `entry_id`, `entry_version`, `status` (`pending`, `recorded`, `rejected`, `cancelled`, `ignored`), `created_at`. Klaim `pending` yang lebih tua dari 30 detik bisa diambil alih (pemulihan bila proses mati sebelum selesai). **Teks mentah pesan tidak disimpan.** Belum ada retensi (job purge menyusul). Dipakai untuk dedupe, "catatan WhatsApp terakhir" untuk `batal`, dan pemantauan kesalahan.
- `batal`: `voidEntry` dengan `expectedVersion` dari entri; bila versi sudah berubah (diedit di app) atau lewat 10 menit → balasan "tidak bisa dibatalkan dari WhatsApp, buka app" dan tidak ada yang berubah.

### 5.4 Antarmuka pengirim/penerima (siap pindah ke Cloud API)

Modul `server/wa/` memiliki: `parseMessage(text)` (murni, tanpa I/O, tabel uji), `handleInbound(msg)` (orkestrasi), dan antarmuka `WaTransport { verify(req), toInbound(req), sendText(to, text) }`. Implementasi OpenWA adalah satu adaptor. Pindah ke Cloud API = adaptor baru; parser dan ledger tidak berubah.

### 5.5 Data baru

Migrasi `0123_wa_catat.sql`:

- `app.wa_links` (`user_id` unik, `phone_e164` unik, `verified_at`, kode hubung sekali pakai dan kedaluwarsa); RLS: user hanya melihat barisnya.
- `app.wa_messages` (5.3).
- `api.wa_create_link_code()`, `api.wa_confirm_link(code, phone)`, `api.wa_resolve_sender(phone)`, `api.wa_unlink(via)` (bawaan `app`; `password_reset`/`session_revoked` dari jalur auth), serta `api.wa_default_account(space)`, `api.wa_claim_message(id)`, `api.wa_finish_message(id, status, entry)`, `api.wa_last_cancellable(current)` (INVOKER). Tanda tangan akhir: BSD §16 "Catatan WA". Fungsi yang dipanggil webhook tanpa konteks user (`confirm_link`, `resolve_sender`) `SECURITY DEFINER` dengan `search_path = ''`, hak `EXECUTE` hanya `dompetku_web`, dan diuji pgTAP (termasuk bahwa nomor tak terhubung tidak membocorkan apa pun).
- Event audit sistem baru `wa_linked` dan `wa_unlinked` menambah daftar event reserved; tes katalog diperbarui. Entri yang dicatat lewat WhatsApp tidak punya event audit; jejaknya ledger dan `wa_messages`.

### 5.6 UI

Satu halaman kecil `/[ruang]/whatsapp` (butir "WhatsApp" di Menu, hanya mode nyata): status terhubung, tombol Hubungkan (menampilkan kode), Putuskan. Tempat tepatnya ditentukan saat plan; wajib dalam budget JS 162 kB per rute (Beranda nyata 157,5 kB, headroom 0,3 kB: bagian ini harus dimuat lazy atau di rute lain). Salinan tanpa "rumah tangga". Mode demo/prototipe tidak memuat apa pun dari fitur ini.

## 6. Keamanan

- Wajib review keamanan (uang, auth, DB) dan review akhir sebelum merge (CLAUDE.md).
- Ancaman utama: pesan dipalsukan dari luar (HMAC + pemetaan nomor terbukti + hanya pesan pribadi; `/api/wa/*` 404 di gw); pengambilalihan nomor (user bisa memutuskan; nomor SIM hilang → putuskan di app); kebocoran sesi WhatsApp (volume hanya `openwa`, izin 700, masuk daftar jaga akses; sesi bocor = akun bot bisa diambil alih); tebak kode hubung (batas laju di web: 5 per jam per nomor dan 30 per jam global); log tidak mencatat teks pesan maupun nominal.
- **Kompromi container `openwa` (dikoreksi saat implementasi, rincian di `docs/ops/runbook-wa.md` "Risiko").** Klaim awal "hanya bisa memanggil webhook ber-HMAC" tidak benar. (1) `openwa` di network `wa` menjangkau **semua** route web, melewati gw. `clientIp()` membaca `X-Forwarded-For` apa adanya (gw biasanya menimpanya), jadi jeda auth yang **hanya** berbasis IP bisa dilewati (gagal TOTP saat masuk, `signUpOwner`, `rl-undangan`, `rl-passkey`; separuh IP dari jeda password/recovery/reset) dan IP audit bisa dipalsukan. Jeda per akun, lockout 2FA, dan kewajiban password + TOTP/passkey tetap berlaku. **Ditutup Task 10:** sidecar `wa-proxy` (hanya `POST /api/wa/webhook`, header identitas dibuang), web keluar dari network `wa`. (2) `openwa` memegang rahasia webhook (OpenWA harus menandatangani kiriman), jadi bisa memalsukan webhook **bertanda tangan sah** atas nama nomor terhubung mana pun. Dampaknya dibatasi `WA_MAX_AMOUNT` per entri, `WA_RATE_PER_MIN` entri per menit per nomor (contoh `web.env.example`: Rp25.000.000 dan 10), `batal`/pemulihan dari app, dan balasan bot yang juga sampai ke nomor korban (membuka pemalsuan). Sidecar tidak menutup ini. (3) Lewat `wa_egress` `openwa` dulu menjangkau metadata OCI, VCN, dan port host; **ditutup Task 10** (`firewall.sh`). (4) Lewat gateway bridge network internal `wa` (`172.16.26.1`, alamat host bawaan Docker) `openwa` masih menjangkau port yang terikat di host (sshd), karena DROP `INPUT` hanya untuk subnet `wa_egress`; **ditutup fix wave 2**: `wa` dan `wa_web` memakai `com.docker.network.bridge.gateway_mode_ipv4: isolated` (bridge tanpa alamat host) dan `INPUT` men-DROP koneksi baru dari `wa_egress`, `wa`, dan `wa_web`; ketiga network `enable_ipv6: false` eksplisit. (5) Log galat `wa-proxy` (mis. `502`) dulu memuat header request, termasuk `X-API-Key` web dan `X-OpenWA-Signature`; **ditutup fix wave 2** (encoder log global membuang `request>headers`). `wa-proxy` meneruskan webhook ke path tetap `/api/wa/webhook`, dan `/api/wa/*` tidak lewat proxy Next (body tidak disalin utuh sebelum batas 64 KiB). Yang tersisa: akun bot (baca/kirim pesan), webhook palsu sah (2), internet tanpa filter per host, DNS ke resolver VCN.
- Rahasia diisi pemilik langsung di VM, tidak lewat chat; ada `.env.example`. Nama dan tempatnya (berbeda dari rancangan awal): `API_MASTER_KEY` di `env/openwa.env`; `WA_WEBHOOK_SECRET` (minimal 16 karakter, dipakai web dan didaftarkan ke OpenWA lewat API, tidak disalin ke `openwa.env`), `OPENWA_API_KEY` (key operator OpenWA yang dibatasi ke sesi bot dan alamat `wa-proxy` `172.16.26.2`, bukan master key), `OPENWA_URL`, `OPENWA_SESSION` (UUID sesi, bukan nama), `WA_BOT_NUMBER`, `WA_MAX_AMOUNT`, `WA_RATE_PER_MIN` di `web.env`.
- OpenWA pada digest tertentu, rilis yang berumur >= 7 hari (`0.27.1@sha256:1a2d0c39…`). `osv-scanner` hanya membaca lockfile; image OpenWA dipindai Trivy mingguan dan di PR yang mengubah pin (`.github/workflows/openwa-image.yml`, `docs/ops/ci-keamanan.md`).

## 7. Persyaratan

**P0**

- Parser sesuai 4.1 dengan tabel uji menyeluruh (nominal, jenis, ruang, urutan, penolakan).
- Penerima webhook 5.2 lengkap, idempoten, terbatas laju.
- Hubungkan/putuskan nomor (4.3) dan UI minimal.
- Balasan 4.2 dan `batal` 5.3.
- Container `openwa` dan `wa-proxy`, network `wa`/`wa_web`/`wa_egress`, aturan egress `firewall.sh`, perubahan compose, runbook pasang (`docs/ops/runbook-wa.md`: SIM, scan QR lewat tunnel, rahasia, cek, rollback).
- Migrasi, pgTAP, `test:int`, e2e dengan stub OpenWA (tanpa WhatsApp sungguhan di CI), budget JS tetap.

**P1**

- `kemarin` / tanggal sederhana.
- Perintah `saldo`.
- Pengaturan dompet bawaan untuk WhatsApp.
- Pemantauan status sesi OpenWA (worker memanggil statusnya, ping Healthchecks; sesi putus = alert, bukan hilang diam-diam).

**P2**

- Adaptor Cloud API; pengingat tagihan keluar; foto struk.

Kriteria penerimaan inti (Given/When/Then):

- Given nomor terhubung, When pesan `25rb makan siang`, Then satu entri pengeluaran Rp25.000 tercatat di ruang Pribadi dan balasan ✅ terkirim.
- Given pesan yang sama dikirim ulang oleh webhook, Then tidak ada entri ganda.
- Given nomor tidak terhubung, When pesan apa pun, Then tidak ada baris ledger dan tidak ada data yang dibocorkan.
- Given `beli 2 kopi 50rb`, Then tidak ada entri dan balasan memuat contoh format.
- Given webhook tanpa HMAC valid, Then 401 dan tidak ada efek samping.
- Given catatan WhatsApp 11 menit lalu, When `batal`, Then tidak ada yang berubah dan balasan menunjuk ke app.

## 8. Metrik keberhasilan

- Dalam 14 hari pemakaian, minimal 80% pesan WhatsApp lolos baca tanpa ditolak (dihitung dari `wa_messages`, tanpa teks).
- Nol entri uang yang tidak bisa dibatalkan atau dikoreksi dari app.
- Median dari kirim sampai balasan di bawah 5 detik.
- Nol kejadian entri ganda dari webhook ulang (dijaga tes).

## 9. Pertanyaan terbuka

- **Pemilik, tidak memblokir desain:** nomor khusus (SIM) siapa dan kapan siap; penerimaan risiko banned sudah dicatat di bagian 2.
- **Pemilik, memblokir implementasi:** urutan terhadap S10 dari `docs/superpowers/handoff/s9.md` (worker lanjutan, CSV, review bulanan); keduanya menambah migrasi, jadi nomor harus berurutan.
- **Pembangun, tidak memblokir:** besar memori OpenWA/Baileys sebenarnya di arm64 (ukur); versi OpenWA dan digest yang dipasang; tempat UI "WhatsApp" dalam budget JS; nama event audit baru.

## 10. Catatan keputusan saya (bukan keputusan pemilik)

Harap diperiksa saat membaca: batas nominal WhatsApp Rp100 juta dan batas laju 30 pesan/menit sebagai bawaan kode, sedangkan `web.env.example` dikirim dengan `WA_MAX_AMOUNT=25000000` dan `WA_RATE_PER_MIN=10` (batas banjir entri palsu dari `openwa` yang disusupi: paling banyak 10 entri/menit per nomor, masing-masing paling besar Rp25 juta; naikkan di `web.env` bila memang mencatat nominal lebih besar lewat WhatsApp, selain itu lewat app); batas `batal` 10 menit; aturan dompet bawaan 4.4 (tanpa dompet kantor; fallback `operasional`); kategori bawaan = saran teratas, bukan "Lainnya"; `saldo_negatif` ditolak dari WhatsApp; tidak menyimpan teks mentah dan id pesan di-hash; egress `wa_egress` tidak difilter per host; `kemarin` dan `saldo` ditunda ke P1; anti tebak-kode hubung di web (5 percobaan/jam per nomor, 30/jam global; batas global bisa dipakai untuk mengunci semua orang satu jam), bukan di DB; `wa_messages` belum punya retensi.

## 11. Eksekusi

Sesuai CLAUDE.md: branch fitur dari `main` terbaru (`claude/<milestone>-wa-catat`), plan via `superpowers:writing-plans`, eksekusi subagent-driven (logika uang/RLS/DB memakai model terkuat), gerbang `lint typecheck test format:check`, `build`, e2e, review task dan review keamanan sebelum merge. Merge = deploy dan migrasi di produksi.

## 12. Perubahan saat implementasi (2026-11-10)

Teks bagian di atas sudah diperbarui di tempat. Daftar perubahan dan alasannya:

| Bagian | Perubahan | Alasan |
|---|---|---|
| 4.1 | Kategori tanpa kecocokan kamus = saran teratas `api.suggest_categories`, bukan "Lainnya"; balasan ✅ menyebut kategori | Seed 0106 tidak punya kategori "Lainnya" dan `createEntrySchema` mewajibkan kategori; migrasi seed akan mengubah ruang yang sudah ada di produksi. Balasan + `batal` menutup risiko tebakan salah |
| 4.1 | `batal` kedua tidak mundur ke catatan lama; `saldo_negatif` ditolak dari WhatsApp | Temuan review Task 2 (batal berantai membatalkan catatan yang tidak dimaksud); app menawarkan konfirmasi saldo negatif, chat tidak bisa memberi konfirmasi yang aman |
| 4.2 | Nominal di balasan mengikuti `formatRupiah` repo: `Rp 25.000` (NBSP) | Satu sumber format uang; contoh spec `Rp25.000` tidak sama dengan keluaran app |
| 4.4 | Dompet bawaan tidak pernah `kantor`; fallback memilih `operasional` dulu | Review Task 2: pengeluaran sesudah talangan akan diam-diam masuk Kas Kantor; sama dengan aturan Catat di app |
| 5.2 | Pengirim = `senderPhone ?? from`; `@lid` tanpa `senderPhone` diabaikan; OpenWA dijalankan dengan `RESOLVE_LID_TO_PHONE=true` | Pengirim `@lid` tidak membawa nomor; tanpa ini mereka tidak pernah bisa menghubungkan nomor |
| 5.2 | HMAC atas byte mentah (`arrayBuffer`) | `Request.text()` menghapus BOM dan mengganti byte tidak sah; HMAC akan berbeda dari pengirim |
| 5.3 | Id pesan di-hash sebelum disimpan; status `pending` + ambil alih 30 detik; kolom `entry_version` | Id OpenWA bisa memuat nomor; menutup jendela crash antara klaim dan `createEntry`; `batal` hanya bila versi entri belum berubah |
| 5.1, 6 | Rahasia bernama `WA_WEBHOOK_SECRET` (bukan `OPENWA_WEBHOOK_SECRET`), hanya di `web.env`; web memakai key operator OpenWA yang dibatasi, bukan master key; `OPENWA_URL` = `http://wa-proxy:2786` (Task 10; semula `http://openwa:2785`); `OPENWA_SESSION` = UUID sesi | Kode memakai prefiks `WA_`; satu salinan rahasia mengurangi paparan; mode bridge; rute OpenWA memakai UUID sesi |
| 5.1 | gw menjawab 404 untuk `/api/wa/*` | gw meneruskan semua path ke web, jadi webhook terjangkau dari internet tanpa blokir ini |
| 5.5 | `app.wa_links` dan kode hubung dipisah menjadi `wa_links` + `wa_link_codes` (hanya hash); tiga tabel dan sembilan fungsi, bukan empat fungsi; tanpa event audit untuk entri WhatsApp | Kode tidak boleh tersimpan polos; fungsi INVOKER tambahan dibutuhkan handler; entri WhatsApp dijejak lewat ledger + `wa_messages` |
| 6 | Model ancaman `openwa` yang disusupi dikoreksi (akses semua route web, bypass jeda IP, webhook palsu bertanda tangan sah, egress) | Review Task 7: klaim "hanya bisa memanggil webhook ber-HMAC" salah. Keputusan pemilik: terima atau bangun sidecar `wa-proxy`; menurunkan `WA_MAX_AMOUNT`/`WA_RATE_PER_MIN` |
| 6 | Anti tebak-kode: batas laju 5/jam per nomor dan 30/jam global ada di web | DB tidak membatasi percobaan; batas global bisa mengunci semua orang satu jam (utang) |
| 6 | Pemindaian image OpenWA: Trivy mingguan + PR (`openwa-image.yml`), bukan `osv-scanner` | `osv-scanner` repo hanya membaca lockfile; Trivy sudah dipakai repo untuk image web (Task 10) |
| 4.1 | Satuan terpisah dari angka (`25 rb`, `1,5 jt`, `25 ribu`, `2 juta`) dibaca sebagai nominal; salah ketik satuan sesudah angka ditolak | Review akhir: `25 rb makan siang` tercatat Rp25 (1000x lebih kecil) |
| 4.1, 5.3 | `batal` memperhitungkan pesan `pending`: `api.wa_last_cancellable(p_current)` | Review akhir: `batal` saat catatan lebih baru masih berjalan, atau sesudah `finish('recorded')` gagal, membatalkan catatan yang lebih lama |
| 4.2 | Balasan ✅ pemasukan berlabel `Pemasukan ·` | Review akhir: salah baca jenis (kata penanda di keterangan) harus terlihat di balasan |
| 5.2 | Webhook mencatat `[wa] ignored <alasan>` (`not_message`, `not_private`, `from_me`, `not_text`); batas (`WA_MAX_AMOUNT`, `WA_RATE_PER_MIN`) saja tidak menyalakan fitur | Bentuk payload OpenWA belum diverifikasi; tanpa log, pesan yang diabaikan tidak terlihat. `web.env.example` mengisi batas |
| 6, 10 | `web.env.example` mengisi `WA_MAX_AMOUNT=25000000`, `WA_RATE_PER_MIN=10`; bawaan kode tetap 100000000/30 | Membatasi banjir webhook palsu dari `openwa` yang disusupi tanpa mengubah bawaan yang disetujui |
| 4.1 | Satuan terpisah gagal tertutup: token sesudah angka yang diawali satuan (NFKC, tanpa karakter format) selalu digabung; hanya `rb`/`k`/`jt`/`ribu`/`juta` persis yang jadi nominal, sisanya (`25 rb,`, `50 k.`, `25 rb-an`, `25 ｒｂ`) `bad_amount` | Residu review akhir: tanda baca/akhiran menempel pada satuan terpisah masih tercatat 1000x lebih kecil |
| 5.2 | Body webhook dibaca streaming dengan batas keras 64 KiB (`getReader()`, `cancel()` lalu 413); log `[wa] config_error` dibatasi 60 detik; body 503 generik dikunci tes | Body chunked tanpa `Content-Length` sebelumnya ditampung utuh sebelum batas dicek; POST tanpa autentikasi bisa membanjiri log saat konfigurasi rusak |
| 10 | `web.env.example` mengirim `OPENWA_URL` kosong (nilai pasang di runbook) | Salinan contoh yang belum diisi tidak boleh setengah terkonfigurasi; web akan bicara ke OpenWA lewat sidecar `wa-proxy` |
| 4.3, 5.5 | Reset kata sandi dan masuk dengan kode pemulihan memutus nomor WhatsApp (`api.wa_unlink(p_via)`, audit `via` `password_reset`/`session_revoked`) | Sesi curian bisa menghubungkan nomor penyerang; tautan sebelumnya bertahan sesudah semua sesi dicabut |
| 5.3 | `wa_messages` tanpa retensi | Job purge belum dibuat (utang) |
| 5.6 | UI = halaman `/[ruang]/whatsapp` lewat Menu, pulau klien dimuat malas (rute 148,3 kB) | Beranda nyata hanya punya headroom 0,3 kB |
| 5.1, 6 | Sidecar `wa-proxy` (allowlist L7 dua arah), network `wa` = `openwa` + `wa-proxy`, network baru `wa_web` = `wa-proxy` + `web`; `allowedIps` key web = `172.16.26.2`; `SSRF_ALLOWED_HOSTS=wa-proxy` | `openwa` yang disusupi menjangkau semua route web dan memalsukan `X-Forwarded-For`; pemilik mendelegasikan pilihan paling aman (Task 10) |
| 5.1, 6 | `wa_egress` dipatok `172.16.27.0/24`; `firewall.sh` men-DROP koneksi baru ke `169.254.0.0/16` (kecuali DNS ke `169.254.169.254`), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, dan ke host (`INPUT`) | IMDS, VCN (VM App), dan port host terjangkau dari `openwa` (Task 10) |
| 6 | Network `wa`/`wa_web`: gateway `isolated` (bridge tanpa alamat host); `firewall.sh` men-DROP `INPUT` dari `172.16.26.0/24` dan `172.16.28.0/24` juga; `enable_ipv6: false` eksplisit di `wa`, `wa_web`, `wa_egress` | Review keamanan putaran 2: `openwa` menjangkau sshd host lewat `172.16.26.1` (fix wave 2) |
| 6 | Log `wa-proxy` (akses dan galat) tanpa header request; webhook diteruskan ke path tetap `/api/wa/webhook`; `/api/wa/*` dikecualikan dari matcher `apps/web/src/proxy.ts` | Log galat `502` memuat `X-API-Key` web; varian path (`/API/WA/WEBHOOK`, `//`, segmen titik) sampai ke web apa adanya; proxy Next menyalin body sampai 10 MiB sebelum handler (fix wave 2) |
| 4.3 | Reset kata sandi memutus WhatsApp sebelum audit (audit di `finally`); masuk dengan kode pemulihan memutus sebelum sesi dibuat dan sekali lagi sesudah sesi lama dihapus (kode hubung dari sesi curian di jendela itu ikut hilang), galat dicatat `[wa] unlink_failed` tanpa menggagalkan masuk | Audit gagal melewatkan pemutusan; galat pemutusan sesudah kode hangus membuang kode tanpa sesi (fix wave 2) |
| 4.1 | Slang `reb`/`ewu`, `m`/`mil` sendirian, `miliar`/`milyar`/`triliun`/`trilyun`, huruf Kiril/Yunani mirip dan beraksen sesudah angka = `bad_amount` | `25 rebu`, `25 ewu`, `2 m`, `25 рб`, `25 ríbu` tercatat 1000x (atau 10⁹x) lebih kecil (fix wave 2) |
| 6 | Image OpenWA `0.27.1` (rilis 2026-11-02), bukan `0.29.1` | `minimumReleaseAge` 7 hari repo diberlakukan juga untuk image; fitur yang dipakai ada di `0.27.1` (Task 10) |
