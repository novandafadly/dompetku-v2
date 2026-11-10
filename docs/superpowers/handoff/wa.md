# Serah-terima Catat lewat WhatsApp (OpenWA)

Dokumen ini untuk sesi agen berikutnya dan untuk pemilik. Baca sampai habis sebelum mengerjakan apa pun.

- Spec (disetujui, diperbarui di tempat; bagian 12 = perubahan saat implementasi): `docs/superpowers/specs/2026-11-09-catat-wa-openwa-design.md`. Plan: `docs/superpowers/plans/2026-11-09-catat-wa-openwa.md`.
- Catatan teknis DB dan web: BSD §16 "Catatan WA". Pasang dan operasi: `docs/ops/runbook-wa.md` (langkah, rollback, Risiko, Daftar periksa pemilik). Cakupan pemindaian image: `docs/ops/ci-keamanan.md` "Image OpenWA".
- Branch: `ccr-6fc4b982-0wmz1i`. PR [novandafadly/dompetku-v2#27](https://github.com/novandafadly/dompetku-v2/pull/27). **Merge = rilis + deploy otomatis + migrasi 0123 di produksi. Belum di-merge.** Merge sendiri tidak menyalakan fitur: tanpa variabel `WA_*`/`OPENWA_*` di `web.env`, route webhook menjawab 404 dan menu WhatsApp tampil sebagai fitur mati; deployer tidak menyalakan `openwa` tanpa `env/openwa.env`.

## Yang dibangun

| Task | Isi | Commit |
| --- | --- | --- |
| 0 | pemeriksaan awal, format 7 berkas yang membuat `format:check` merah di `main` | 52b84aa..fd27a61 |
| 1 | parser `parseMessage` murni (`apps/web/src/server/wa/parse.ts`): nominal `25rb`/`25k`/`25.000`/`1,5jt`/`Rp 25.000`, `+`/kata pemasukan, `b`/`bersama`, `batal`, `hubung KODE` | d637e27 |
| 2 | migrasi `0123_wa_catat.sql`: `wa_links`, `wa_link_codes`, `wa_messages`, fungsi `api.wa_*`, event audit `wa_linked`/`wa_unlinked`; pgTAP `26_wa` (113 asersi), `00_katalog`, `04_audit`. Putaran perbaikan: status `pending` + ambil alih 30 detik, `wa_last_cancellable` tanpa mundur, dompet bawaan tanpa `kantor` | 5a7c193, 4adc076 |
| 3 | `config.ts` (`readWaEnv`), `WaTransport`, adaptor `openwa.ts` (HMAC atas byte, `senderPhone`, sufiks pengirim); fixture webhook | cac624f, 820cfb0 |
| 4 | `handle.ts` (`handleInbound`), `phone.ts`, `uuid.ts` (v5), `ratelimit.ts`; tes int di Postgres sungguhan | 1cc4051 |
| 5 | route `POST /api/wa/webhook` (404/503/413/401, byte mentah, `no-store`) | be1b7c7 |
| 6 | halaman `/[ruang]/whatsapp` (hubungkan, kode 10 menit, putuskan), butir Menu, tautan `wa.me`, pengumuman layar-baca | 85857a1, 4c21049 |
| 7 | container `openwa` (image `0.29.1@sha256:5d4e2d71…`, network `wa` + `wa_egress`), gw `404` untuk `/api/wa/*`, deployer, `deploy-test.sh` 31 skenario, runbook | 1dbd5f1, 8b32a59, a254601 |
| 8 | BSD §16, spec, runbook, README `packages/db`, `CLAUDE.md`, handoff ini, gerbang penuh | fabe285 dan commit dokumen sesudahnya |
| Akhir | perbaikan review akhir: satuan terpisah (`25 rb`, `1,5 jt`, `25 ribu`) di parser; `api.wa_last_cancellable(p_current)` sadar pesan `pending` (0123 diubah di tempat); log `[wa] ignored <alasan>` di webhook; label `Pemasukan ·` di balasan ✅; `[wa] config_error` dari `waEnabled()`; contoh `web.env` `WA_MAX_AMOUNT=25000000`/`WA_RATE_PER_MIN=10`; prosedur pembersihan entri palsu di runbook | f618b5b, 08eb2c7, 7839f46, f92cda1, dan commit dokumen sesudahnya |

## Angka akhir (gerbang di HEAD, PG 16 lokal; CI memakai PG 17)

Sesudah perbaikan akhir (2026-11-10): pgTAP 1853 asersi di 28 berkas (`26_wa` 119), `test:registry` 7, unit web 2488 (2487 lulus + 1 gagal `rencana.test.tsx` yang sama), `test:int` web 229 (`handle.int` 30, `link.int` 6), `deploy-test.sh` 31, lint/typecheck/format:check/build hijau, round trip down/up 0123 = skema identik. e2e tidak dijalankan ulang (tidak ada UI yang berubah); worker tidak disentuh. Angka di bawah = gerbang Task 8 sebelum perbaikan akhir.

- pgTAP 1847 asersi di 28 berkas (sebelum fitur: 1730; +113 di `26_wa`, +4 di `04_audit`). `pnpm test:registry` 7 lulus (tidak ada ID registry baru).
- Unit web 2455: 2454 lulus, 1 gagal = `rencana.test.tsx` yang sudah ada di `main` (lihat "Diketahui"). Worker unit 35, worker int 10, domain 97 + 28 + 28, demo-data 40.
- `test:int` web 227 (WA menambah `handle.int` 28 dan `link.int` 6; angka S9 192 lebih tua dari Pra-S10, jadi selisih lain berasal dari sana).
- e2e prototipe 308, `e2e:auth` 22, `e2e:ledger` 101 (+25 screenshot dilewati), `e2e:bersama` 33, `deploy-test.sh` 31 (sebelumnya 25).
- lint, typecheck, format:check, build hijau.
- Budget JS (batas 162 kB rute): Beranda nyata 157,5, Transaksi nyata 156,8, Rencana nyata 150,3, Laporan nyata 151,2 (e2e:bersama), `/pribadi/whatsapp` nyata 148,3 (diukur Task 6; spec `ledger.spec.ts` menegaskan ≤ 162 dan lulus di gerbang). Pulau klien WhatsApp ~3,2 kB gzip dimuat malas; rute prototipe tidak berubah (`budget.spec` hijau).
- Gerbang tidak bisa dijalankan terhadap WhatsApp atau OpenWA sungguhan: semua tes memakai fixture dan stub. Bentuk payload `message.received` belum diverifikasi pada sesi hidup (ditandai `UNVERIFIED` di `openwa.ts:36` dan di runbook).
- Catatan lingkungan: `pnpm test:int` dan `e2e:*` mengubah data di DB lokal; jalankan `bash docs/superpowers/handoff/db-reset-lokal.sh` sebelum `pg_prove`, kalau tidak 00_katalog dan beberapa berkas gagal "Bad plan".

## Langkah pemilik

Semua langkah rinci (perintah persis) ada di `docs/ops/runbook-wa.md`, "Daftar periksa pemilik". Ringkasan urutan:

1. **SIM khusus** dan HP bot (bukan nomor utama); WhatsApp terpasang dan dipakai sebentar.
2. **Sebelum merge:** CI hijau di head PR #27 (job `db`, `auth`, `infra`, `image`, build, e2e). Putuskan butir "Keputusan pemilik" di bawah; yang bersifat "terima atau perbaiki" sebaiknya sebelum fitur dinyalakan, tidak harus sebelum merge.
3. **Sesudah merge** (deploy + migrasi 0123 otomatis): pasang berkas ke VM (`compose.yml`, `bin/deploy`, `gw/Caddyfile`), cek subnet `172.16.26.0/24` bebas, **`caddy validate`** Caddyfile di VM sebelum `docker compose restart gw` (tidak ada binary caddy di sandbox, jadi blok `/api/wa/*` baru dibaca, belum divalidasi mesin), cek `/api/wa/*` = `404` tanpa `Cache-Control` dari VM App.
4. **Cek digest image** di VM (arm64, uid 997, `curl` ada) sebelum menaikkan `openwa`.
5. **Isi rahasia langsung di VM, tidak lewat chat:** `env/openwa.env` (`API_MASTER_KEY`), tambahan `web.env` (`WA_WEBHOOK_SECRET`, `OPENWA_URL=http://openwa:2785`, `OPENWA_API_KEY`, `OPENWA_SESSION`, `WA_BOT_NUMBER`, `WA_MAX_AMOUNT=25000000`/`WA_RATE_PER_MIN=10` dari `web.env.example`, kosong = bawaan kode 100000000/30).
6. **Pairing nomor bot:** kode pairing (utama) atau QR lewat tunnel (cadangan), matikan timer deploy selama memautkan, nyalakan lagi sesudahnya.
7. **Daftarkan webhook** tepat satu ke `http://web:3000/api/wa/webhook` dengan rahasia yang sama.
8. **Hubungkan di app** (Menu > WhatsApp > Buat kode hubung), kirim `hubung KODE` dari nomor masing-masing; **uji pesan pertama** (`25rb makan siang`, `batal`); log tidak boleh memuat teks pesan.
9. Ulangi cek `/api/wa/*` sesudah web dikonfigurasi (dari luar harus `404`, bukan `401`).

## Keputusan pemilik yang dibutuhkan

1. **Terima atau perbaiki: `openwa` yang disusupi melewati jeda IP.** Network `wa` membuka semua route web tanpa gw; `clientIp()` percaya `X-Forwarded-For` pertama, sehingga jeda auth yang hanya berbasis IP (TOTP saat masuk, `signUpOwner`, `rl-undangan`, `rl-passkey`, separuh IP password/recovery/reset) bisa dilewati dan IP audit dipalsukan. Jeda per akun, lockout 2FA, dan password + TOTP/passkey tetap berlaku. Opsi: (a) terima sampai ada sidecar; (b) bangun sidecar Caddy `wa-proxy` (hanya `POST /api/wa/webhook`, buang `X-Forwarded-For`/`Forwarded`/`X-Real-IP`/`X-Middleware-Subrequest`, `allowedIps` mengarah ke sidecar, web keluar dari `wa`). Rincian: runbook "Risiko".
2. **Terima atau perbaiki: webhook palsu bertanda tangan sah.** `openwa` memegang rahasia webhook, jadi yang menyusupinya bisa membuat dan membatalkan entri atas nama nomor terhubung mana pun, sampai `WA_RATE_PER_MIN` entri per menit per nomor, masing-masing sampai `WA_MAX_AMOUNT`. `web.env.example` dikirim dengan `WA_MAX_AMOUNT=25000000` dan `WA_RATE_PER_MIN=10` (10 entri/menit per nomor, masing-masing paling besar Rp25.000.000); bawaan kode bila kosong tetap Rp100.000.000 dan 30 (spec). Gaji di atas Rp25 juta lewat WhatsApp ditolak "Gunakan app" kecuali batas dinaikkan. Bot juga membalas ke nomor korban (pemilik nomor melihat ✅ yang mengejutkan), dan semuanya bisa dibatalkan dari app (per entri, tanpa pembatalan massal; prosedur cari-dulu lewat `dompetku-psql` di runbook "Risiko" > "Membersihkan entri WhatsApp palsu"). Sidecar tidak menutup ini. Opsi: terima dengan nilai contoh; ubah nilai di `web.env` (tanpa kode); tambah deteksi (lonjakan entri WhatsApp); atau jangan nyalakan fitur dan tunggu Cloud API.
3. **Umur image: 0.29.1 (3 hari) atau 0.27.1.** Repo memakai `minimumReleaseAge` 7 hari untuk npm, tidak untuk image. 0.29.1 memuat perbaikan Baileys + SQLite; OpenWA dirilis sangat sering (0.27.1 ke 0.29.1 dalam 5 hari). Ganti = PR yang mengubah digest.
4. **Pemindaian image OpenWA.** `osv-scanner` repo hanya membaca lockfile; image tidak dipindai (spec §6 "ikut osv-scanner" tidak terpenuhi). Usulan: job mingguan `osv-scanner scan image` atau `trivy image` (`docs/ops/ci-keamanan.md`). Perlu keputusan dan secret CI bila ada.
5. **Aturan egress DROP untuk `wa_egress`.** Saat ini NAT biasa: `openwa` menjangkau metadata OCI `169.254.169.254`, VCN (VM App `10.0.0.149`), dan port yang terikat di host. Usulan di runbook "Firewall dan egress": patok subnet `wa_egress`, `DOCKER-USER` DROP ke `169.254.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`, izinkan 443 keluar, plus aturan `INPUT` setara. Belum dibuat.
6. **Backup `openwa_data`:** diputuskan tidak di-backup (pairing ulang cukup menit; kunci Baileys berputar; retensi bucket terkunci 30 hari). Setujui atau ubah.
7. **Kategori bawaan.** Pesan tanpa kata kunci dikategorikan lewat saran teratas (riwayat, lalu nama), karena seed tidak punya "Lainnya"; balasan ✅ menyebut kategorinya. Setujui, atau minta migrasi seed "Lainnya" (mengubah ruang yang sudah ada).
8. **`saldo_negatif` ditolak dari WhatsApp** (tanpa konfirmasi lewat chat). Setujui atau minta jalur konfirmasi.

## Diketahui

- `apps/web/src/app/[ruang]/_real/rencana.test.tsx` "Bayar bernama dengan nominal; Lunas tanpa Bayar; Dilewati punya Batalkan lewati" (S9-TG1, baris 465) gagal, **juga di checkout bersih `origin/main` (d6b81d2)**. Bukan karena tanggal: test mengharapkan teks `Dilewati · Rp 485.000` di `textContent`, sedangkan `bill-row-view.tsx:96-99` (perbaikan critique S9-C3 di Pra-S10) merender `Dilewati`, `·`, dan nominal sebagai elemen terpisah tanpa spasi (`Dilewati·Rp 485.000`). Tidak disentuh di branch ini (di luar cakupan).
- Pengujian hanya dengan fixture dan stub: tidak ada WhatsApp sungguhan di CI.

## Dibawa ke S10

Setiap butir dari ledger SDD Task 1 sampai 7 dan catatan laporan task. Nomor baris diperiksa terhadap HEAD saat ini (baris di ledger lama bergeser).

### Keamanan dan jaringan

- [ ] Sidecar `wa-proxy` dan keputusan pemilik di atas (butir 1, 2, 5): `docs/ops/runbook-wa.md` "Risiko", "Firewall dan egress".
- [ ] Anti-tebak `hubung` global (`apps/web/src/server/wa/ratelimit.ts:58`): 6 nomor x 5 percobaan mengunci semua orang satu jam; jatah per nomor ikut terpakai saat terkunci global. Saran: global hanya dihitung dari percobaan ke-2 satu nomor dalam jendela, cek global sebelum mengonsumsi per nomor.
- [ ] Batas ukuran body route tidak berlaku untuk body chunked/tanpa `Content-Length`: seluruh body dibaca dulu (`apps/web/src/app/api/wa/webhook/route.ts:41-44`). Baca streaming dengan batas (~12 baris). Dijadikan Penting bila gw tidak memblokir `/api/wa/*` dari luar.
- [ ] `createPools` membangun dua pool, dan `readServerEnv()` memvalidasi seluruh env sehingga typo env lain = 503 (`route.ts:27`, `:36`).
- [ ] `createLinkCode` tanpa batas laju per user (`apps/web/src/app/[ruang]/_actions/wa.ts:15`); kode baru menimpa kode lama.
- [ ] `wa_messages`: kolom `created_at` bisa diisi masa depan lewat grant INSERT/UPDATE semua kolom (`0123_wa_catat.sql:75`); ganti dengan grant kolom.
- [ ] `wa_finish_message` belum memeriksa `e.created_by = v_uid` untuk entri (`0123_wa_catat.sql:288-294`).
- [x] SHA-256 tanpa garam atas kode 30 bit dan invarian policy `own_or_lookup` yang dilebarkan GUC: dikomentari di `0123_wa_catat.sql` (perbaikan akhir).
- [ ] Tautan WA tetap hidup setelah cabut semua sesi/reset sandi (butuh step-up atau unlink otomatis).
- [ ] `deploy`: `timeout` pada `pull`/`up` openwa agar exit 124 menjadi `openwa_up_failed` (`infra/db-vm/deploy/deploy:278-293`); `deploy-test.sh` belum menegaskan bahwa `openwa_up_failed` memicu alert/HC `/fail` (`deploy-test.sh:418-425`).
- [ ] Aturan `DOCKER-USER` DROP dari subnet `wa_egress` (`infra/db-vm/firewall.sh` atau setara; perlu subnet `wa_egress` yang dipatok).
- [ ] Image arm64 memuat Chromium Debian yang tidak dipakai Baileys (permukaan CVE); job pemindaian image.

### Data dan DB

- [ ] **Retensi `wa_messages` belum ada** (tumbuh terus, kecil): job purge worker > N hari, tidak boleh menghapus baris `recorded` yang masih dalam jendela `batal`.
- [ ] Retensi `wa_messages`: jendela purge harus berada di dalam retensi idempotensi `client_id` ledger, kalau tidak pesan bertanda tangan lama yang diputar ulang bisa tercatat lagi.
- [ ] Down migrasi gagal bila `audit.events` sudah memuat `wa_linked`/`wa_unlinked` (`0123_wa_catat.sql:355-360`): hapus baris itu dulu atau catat.
- [ ] `wa_default_account` memindai `entries` tanpa indeks `(space_id, created_by, created_at)` (`0123_wa_catat.sql:231-247`); ukur sebelum menambah indeks.
- [ ] Nomor SIM yang didaur ulang: nomor milik A memblokir B sampai A memutuskan (ruling Task 2).
- [ ] `message_id` PK global: id yang sama milik user lain = klaim false (diam).
- [ ] `wa_create_link_code` mewajibkan profil (user belum diprovisi = `DK401`).

### Handler dan alur pesan

- [x] `batal` membatalkan catatan lebih lama bila `finish('recorded')` gagal atau catatan lebih baru masih berjalan: diperbaiki (`api.wa_last_cancellable(p_current)`, pesan `pending` menghalangi; tes pgTAP + int). Sisa: pesan `pending` yang tidak pernah dikirim ulang menghalangi `batal` sampai ada pesan lebih baru yang selesai (gagal tertutup).
- [ ] Crash antara `createEntry` dan `finish`, lalu pilihan dompet/kategori berubah sebelum ambil alih: `DK410` membuat pesan berakhir `rejected` padahal entri ada (`handle.ts:300-316`, jarang).
- [ ] Dua webhook `hubung` bersamaan dari nomor tak terhubung mendapat balasan yang bertentangan (`handle.ts:372-395`).
- [ ] Sesudah `batal` berhasil tetapi `finish` gagal, ambil alih membalas `cancelUnavailable` (`handle.ts:332-363`); entri tetap void.
- [ ] Tidak ada tes tingkat handler untuk: `batal` lintas user (Farida vs Novanda di Bersama), `b` dari non-anggota (`noSpace`), balapan `DK409` antar `batal` bersamaan (`__int__/handle.int.test.ts`).
- [ ] `RateLimiter.size()` dan `createLinkLimiter` adalah ekspor di luar brief (diterima); batas laju hidup di memori satu proses (hilang saat restart, tidak dibagi antar instans).
- [ ] Handler dan route: `handleInbound` di-`await` sebelum jawaban 200 sementara `sendText` batas 10 detik (`openwa.ts:65`) bisa melewati batas waktu webhook OpenWA (`WEBHOOK_TIMEOUT=20000` di compose) dan memicu kirim ulang; aman (idempoten), tapi pertimbangkan balas sesudah 200.
- [ ] Banjir entri palsu: batas `WA_RATE_PER_MIN` x `WA_MAX_AMOUNT` (keputusan pemilik butir 2; contoh `web.env` 10 x Rp25.000.000). Tidak ada pembatalan massal dari app.
- [ ] P1 spec: perintah `saldo`, tanggal `kemarin`, pengaturan dompet bawaan WhatsApp, pemantauan sesi OpenWA (worker + Healthchecks; sesi putus = alert).
- [ ] Pesan `@lid` tanpa `senderPhone` diabaikan diam-diam (`handle.ts:421-426`); bergantung pada `RESOLVE_LID_TO_PHONE=true` (dipatok di compose).

### Parser (`apps/web/src/server/wa/parse.ts`)

- [ ] Tanda baca di ujung token nominal (`25rb,`, `25rb.`) = `bad_amount` (`parse.ts:27-40` `toAmount`, `:78-86`); pesan WhatsApp nyata sering memilikinya.
- [ ] `slice(0, MAX_DESCRIPTION)` dalam unit UTF-16 bisa memotong pasangan surrogat (`parse.ts:105`).
- [ ] `+` dihitung pemasukan di mana pun, bukan hanya di awal (`parse.ts:69-72`, `:81`).
- [ ] Tes belum ada untuk `gaji +5jt`, `Rp.25.000`, `0,5rb`, tanda baca ujung (`parse.test.ts`). (`25 rb` dan satuan terpisah lain: selesai, perbaikan akhir.)

### Transport dan konfigurasi (`openwa.ts`, `config.ts`)

- [ ] `sendText` belum memvalidasi nomor tujuan `^\d{8,15}$` (`openwa.ts:56`).
- [ ] `sendText`: `redirect: 'error'`, batalkan body yang tidak dibaca, ubah pesan timeout (`openwa.ts:59-71`).
- [ ] Tandai asumsi `data.id`/`data.from` sebagai `// UNVERIFIED` (`openwa.ts:34-36`); verifikasi payload pada sesi hidup saat pasang (langkah 8).
- [ ] Tes belum ada: heks huruf besar, header ganda, heks ganjil, body multibyte, `sendText` dengan `to` buruk, `status@broadcast`, `WA_RATE_PER_MIN` tak sah. (`try/catch` kosong di `config.test.ts`: selesai, perbaikan akhir.)
- [ ] Tes route: Content-Length non-numerik/negatif, `verify`/`toInbound` yang melempar = 500, 503 tidak di-cache, asersi `warn` pada kasus 503/handler error, heks huruf besar (`route.test.ts`).

### UI (`/[ruang]/whatsapp`)

- [ ] Pemindai sumber `actions.test.ts` menerima `accountContext()` untuk semua action (`app/[ruang]/_actions/actions.test.ts:529`); batasi ke `wa.ts` atau tambah tes negatif.
- [ ] Kegagalan `createCode` selalu dipetakan ke pesan jaringan (`features/wa/wa-link-view.tsx:37`, `:139`).
- [ ] Urutan import `menu-sheet.tsx` (`DeviceMobileIcon` di antara ikon lain, `:10`).
- [x] `waEnabled()` menelan `EnvError` tanpa log: kini `[wa] config_error` (perbaikan akhir). Catatan: dicatat setiap kali halaman memanggilnya selama konfigurasi salah.
- [ ] Tautan `wa.me` dibuka di tab baru tanpa petunjuk nama (`wa-link-view.tsx:261`); tinggi tombol `sm` vs 44 px (`:321`); kode kedua saat "Kode siap" tampil tidak diumumkan ulang; varian `botChatHref` tanpa kode tidak dipakai (`bot-number.ts:24`); kode yang dibuat di antara putus dan prop yang dimuat ulang terhapus saat kunci berubah; gaya `aria-disabled` saat membuat kode (`:202`); salinan "bot" di keadaan terhubung dan judul yang mengulang "kirim".
- [ ] Keadaan aktif (env WA terisi) belum dilihat di browser sungguhan pada 360 px; e2e tidak menyalakan env WA. Lakukan satu cek visual saat pasang atau tambah e2e dengan stub.
- [ ] Item sidebar desktop WhatsApp tidak ada (halaman lewat Menu; sengaja).

### Proses

- [ ] Task 3, 5, 6 menulis tes bersama implementasi tanpa RED terpisah (dicatat di laporan task).
- [ ] Delivery Gate antislop dijalankan sebagai daftar periksa (skill tidak terpasang); ulangi bila tersedia.

## Cara melanjutkan

1. Lingkungan: `docs/superpowers/handoff/s9-konteks-subagent.md` dan "Cara melanjutkan" di `docs/superpowers/handoff/s7.md`; reset DB: `bash docs/superpowers/handoff/db-reset-lokal.sh`.
2. Gerbang: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm test:registry`, `pnpm build`, `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`, `test:int` (env `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`), `e2e:auth`, `e2e:ledger`, `e2e:bersama` (env `AUTH_E2E_DATABASE_URL`, `AUTH_E2E_ADMIN_URL`), worker `test` + `test:int` (`TEST_WORKER_DATABASE_URL`), `pg_prove` seluruh suite, `deploy-test.sh`.
3. Urutan terhadap S10 (spec §9): keduanya menambah migrasi; WA sudah memakai 0123, jadi migrasi S10 mulai 0124 bila WA di-merge lebih dulu, selain itu nomor harus diurutkan ulang.
