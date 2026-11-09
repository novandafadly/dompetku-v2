# Catat lewat WhatsApp (OpenWA): desain

Status: **menunggu persetujuan pemilik** (2026-11-09). Belum ada kode. Setelah disetujui, langkah berikutnya `superpowers:writing-plans`.

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

- **Nominal (wajib, tepat satu).** Diterima: `25rb`, `25k`, `25.000`, `25000`, `1,5jt`, `1.5jt`, `Rp 25.000`, `Rp25rb`. `rb`/`k` = ×1.000, `jt` = ×1.000.000. Hasil harus bilangan bulat positif rupiah (tanpa sen). Lebih dari satu token nominal, atau nominal desimal yang tidak menjadi rupiah bulat (mis. `1,25rb`): ditolak.
- **Jenis.** Bawaan pengeluaran. Pemasukan bila ada tanda `+` di awal nominal atau pesan, atau kata penanda: `gaji`, `masuk`, `terima`, `pemasukan`.
- **Ruang.** Bawaan Pribadi. Bersama bila kata pertama `b` atau ada kata `bersama`.
- **Keterangan.** Sisa teks setelah nominal dan penanda dibuang, dipangkas, maksimum 200 karakter (batas `createEntrySchema`).
- **Kategori.** Dari kamus kata kunci yang sudah ada (`app.category_keywords()`, migrasi 0107) atas keterangan; tidak cocok → kategori "Lainnya" jenis itu di ruang itu. Kategori tidak bisa dipaksa dari teks pada v1.
- **Dompet.** Dompet bawaan ruang untuk user itu (lihat 4.4).
- **Tanggal.** Hari ini (WIB, `app.today()`). `kemarin` = P1.
- **Batal.** Pesan persis `batal` (tanpa nominal) membatalkan catatan WhatsApp terakhir milik pengirim bila masih dalam 10 menit dan belum diubah di app.

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

- Sukses: `✅ Makan Siang & Minum Rp25.000 · Pribadi · ketik batal untuk membatalkan`
- Tidak terbaca: `❌ Tidak terbaca. Contoh: 25rb makan siang` (tidak ada yang dicatat)
- Dibatalkan: `↩️ Dibatalkan: Makan Siang & Minum Rp25.000`
- Nomor belum terhubung: balasan satu kali per jam berisi cara menghubungkan (4.3). Tanpa data apa pun.
- Kegagalan sistem (DB tidak terjangkau): `⚠️ Gagal menyimpan, coba lagi sebentar lagi`. Pesan sama yang dikirim ulang aman karena idempoten (5.3).

Kegagalan mengirim balasan tidak membatalkan catatan yang sudah tersimpan.

### 4.3 Menghubungkan nomor

Pemetaan nomor WhatsApp ke user tidak boleh bisa dipalsukan.

1. Di app, user yang sudah login memilih "Hubungkan WhatsApp"; app membuat kode sekali pakai (6 karakter, berlaku 10 menit) dan menampilkannya.
2. User mengirim `hubung KODE` dari nomor yang ingin dihubungkan ke nomor bot.
3. Webhook mencocokkan kode, menyimpan nomor (format E.164) sebagai milik user itu, lalu membalas konfirmasi.
4. Satu nomor hanya untuk satu user; satu user satu nomor aktif. Menghubungkan ulang mengganti nomor lama. Ada tombol "Putuskan" di app.

Tidak ada pesan OTP yang dikirim bot ke nomor yang belum terbukti miliknya.

### 4.4 Dompet bawaan

Dompet bawaan per ruang adalah dompet aktif milik user yang paling baru dipakai di ruang itu; bila belum ada riwayat, dompet aktif pertama menurut urutan tampil. Ini keputusan saya (dapat diubah di plan); pengaturan eksplisit dompet bawaan WhatsApp adalah P1.

## 5. Rancangan teknis

### 5.1 Komponen dan jaringan (VM DB)

- Container **`openwa`** di compose project `dompetku` (VM DB: 3 vCPU, 17 GiB), profil `web`, image diikat digest, `linux/arm64`. Engine `baileys`, penyimpanan SQLite, tanpa Redis. Volume bernama untuk sesi dan basis data kecil. `read_only` kecuali volume dan tmpfs, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit` sekitar 512 MB (diukur saat implementasi).
- Network baru **`wa`** (internal, subnet dipatok di luar pool bawaan, pola sama dengan `worker_db`): hanya `openwa` dan `web`. Web memanggil REST OpenWA lewat `wa`; OpenWA memanggil webhook web lewat `wa`.
- Network baru **`wa_egress`** hanya untuk `openwa`: keluar ke server WhatsApp. Egress tidak difilter per host (server WhatsApp tidak punya daftar host stabil); `openwa` tidak berbagi network dengan postgres, gw, atau worker.
- Dasbor dan Swagger OpenWA tidak dipublikasikan. QR dipindai lewat SSH tunnel ke port loopback sementara (langkah di runbook).
- Webhook tidak melewati nginx/gw publik. Hanya `openwa` (network `wa`) yang bisa memanggilnya.

### 5.2 Penerima webhook (di web)

Route handler baru (mis. `/api/wa/webhook`), bukan server action. Urutan, semuanya wajib:

1. Verifikasi HMAC OpenWA atas body mentah dengan rahasia dari env; salah → 401, tidak diproses. Perbandingan waktu-tetap.
2. Hanya event pesan masuk, pesan pribadi (bukan grup, bukan pesan sendiri, bukan siaran/status).
3. Cari user dari nomor pengirim lewat fungsi DB `SECURITY DEFINER` sempit (`api.wa_resolve_sender(phone)`) yang hanya mengembalikan `user_id` bila nomor terhubung dan terverifikasi. Tanpa ini, web (role `dompetku_web` di bawah RLS) tidak bisa memetakan nomor ke user.
4. Batas laju per nomor (mis. 30 pesan/menit, nilai dipasang di env). Lewat batas → abaikan diam-diam dan catat log.
5. Parse → bangun `LedgerCtx` dengan user itu → `createEntry` lewat `withUser`/`withLedger` seperti jalur app. Tidak ada jalur tulis DB lain.
6. Balas lewat pengirim OpenWA (5.4).

Nominal di atas batas WhatsApp (usulan Rp100.000.000, di env) ditolak dengan balasan "gunakan app". Ini keputusan saya sebagai pengaman salah ketik; batas ledger sendiri 10¹³.

### 5.3 Idempotensi dan pembatalan

- `clientId` entri = UUID v5 deterministik dari id pesan WhatsApp. Webhook yang dikirim ulang oleh OpenWA menghasilkan `replayed: true`, bukan entri ganda.
- Tabel baru `app.wa_messages` (migrasi sesudah 0122, nomor terakhir saat ini): `message_id` unik, `user_id`, `entry_id`, `status`, `created_at`. **Teks mentah pesan tidak disimpan.** Dipakai untuk dedupe, "catatan WhatsApp terakhir" untuk `batal`, dan pemantauan kesalahan.
- `batal`: `voidEntry` dengan `expectedVersion` dari entri; bila versi sudah berubah (diedit di app) atau lewat 10 menit → balasan "tidak bisa dibatalkan dari WhatsApp, buka app" dan tidak ada yang berubah.

### 5.4 Antarmuka pengirim/penerima (siap pindah ke Cloud API)

Modul `server/wa/` memiliki: `parseMessage(text)` (murni, tanpa I/O, tabel uji), `handleInbound(msg)` (orkestrasi), dan antarmuka `WaTransport { verify(req), toInbound(req), sendText(to, text) }`. Implementasi OpenWA adalah satu adaptor. Pindah ke Cloud API = adaptor baru; parser dan ledger tidak berubah.

### 5.5 Data baru

Migrasi (nomor berikutnya sesudah 0122, `main` per 2026-11-09):

- `app.wa_links` (`user_id` unik, `phone_e164` unik, `verified_at`, kode hubung sekali pakai dan kedaluwarsa); RLS: user hanya melihat barisnya.
- `app.wa_messages` (5.3).
- `api.wa_create_link_code()`, `api.wa_confirm_link(code, phone)`, `api.wa_resolve_sender(phone)`, `api.wa_unlink()`. Fungsi yang dipanggil webhook tanpa konteks user (`confirm_link`, `resolve_sender`) `SECURITY DEFINER` dengan `search_path = ''`, hak `EXECUTE` hanya `dompetku_web`, dan diuji pgTAP (termasuk bahwa nomor tak terhubung tidak membocorkan apa pun).
- Event audit sistem baru (hubungkan/putuskan) menambah daftar event reserved; tes katalog harus diperbarui (catatan "Ditunda kecil" 7 di CLAUDE.md).

### 5.6 UI

Satu bagian kecil "WhatsApp" di pengaturan: status terhubung, tombol Hubungkan (menampilkan kode), Putuskan. Tempat tepatnya ditentukan saat plan; wajib dalam budget JS 162 kB per rute (Beranda nyata 157,5 kB, headroom 0,3 kB: bagian ini harus dimuat lazy atau di rute lain). Salinan tanpa "rumah tangga". Mode demo/prototipe tidak memuat apa pun dari fitur ini.

## 6. Keamanan

- Wajib review keamanan (uang, auth, DB) dan review akhir sebelum merge (CLAUDE.md).
- Ancaman utama: pesan dipalsukan (HMAC + pemetaan nomor terbukti + hanya pesan pribadi); pengambilalihan nomor (user bisa memutuskan; nomor SIM hilang → putuskan di app); kebocoran sesi WhatsApp (volume hanya `openwa`, izin 0600, masuk daftar jaga akses; sesi bocor = akun bot bisa diambil alih); kompromi container `openwa` (network terpisah, tanpa akses postgres, hanya bisa memanggil webhook yang ber-HMAC dan dibatasi laju); log tidak mencatat teks pesan maupun nominal.
- Rahasia (`OPENWA_API_KEY`, `OPENWA_WEBHOOK_SECRET`) diisi pemilik langsung di VM (`env/openwa.env`, tambahan di `web.env`), tidak lewat chat. Ada `.env.example`.
- OpenWA pada digest tertentu; ikut `osv-scanner` PR dan mingguan.

## 7. Persyaratan

**P0**

- Parser sesuai 4.1 dengan tabel uji menyeluruh (nominal, jenis, ruang, urutan, penolakan).
- Penerima webhook 5.2 lengkap, idempoten, terbatas laju.
- Hubungkan/putuskan nomor (4.3) dan UI minimal.
- Balasan 4.2 dan `batal` 5.3.
- Container `openwa`, network `wa`/`wa_egress`, perubahan compose, runbook pasang (`docs/ops/runbook-wa.md`: SIM, scan QR lewat tunnel, rahasia, cek, rollback).
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

Harap diperiksa saat membaca: batas nominal WhatsApp Rp100 juta; batas `batal` 10 menit; batas laju 30 pesan/menit; aturan dompet bawaan 4.4; tidak menyimpan teks mentah; egress `wa_egress` tidak difilter per host; `kemarin` dan `saldo` ditunda ke P1; anti tebak-kode hubung di web (5 percobaan/jam per nomor, 30/jam global), bukan di DB.

## 11. Eksekusi

Sesuai CLAUDE.md: branch fitur dari `main` terbaru (`claude/<milestone>-wa-catat`), plan via `superpowers:writing-plans`, eksekusi subagent-driven (logika uang/RLS/DB memakai model terkuat), gerbang `lint typecheck test format:check`, `build`, e2e, review task dan review keamanan sebelum merge. Merge = deploy dan migrasi di produksi.
