# DBD: cetak biru desain DompetKu v2 (Panel Malam)

Status: draf revisi setelah review designer dan keputusan pemilik 2026-10-31. Tanggal: 2026-10-31.
Menggantikan arah visual "buku kas" (`docs/spec/ui-ux.md` Lampiran A dan R4, `docs/spec/design.md` §9.3 "Visual"; baris "Visual" di Spec induk §9.3 kini diberi catatan "digantikan ADR 0006") dan "gelap premium" ([ADR 0005](../adr/0005-visual-dark-premium.md)). Alur, IA, dan kriteria UX di `docs/spec/ui-ux.md` §2 sampai §6 tetap berlaku.

Sumber kebenaran, berurutan:

1. [`docs/design/panel-malam/README.md`](../design/panel-malam/README.md): spesifikasi mengikat per layar, bingkai B1 sampai G10.
2. [`docs/design/panel-malam/dompetku-tokens.css`](../design/panel-malam/dompetku-tokens.css) dan [`apps/web/src/styles/tokens.css`](../../apps/web/src/styles/tokens.css): nilai token (kode memuat nilai handoff persis, ditambah token turunan).
3. [`DESIGN.md`](../../DESIGN.md): ringkasan untuk agen. [ADR 0006](../adr/0006-panel-malam.md): keputusan. [`IMPLEMENTATION-REPORT.md`](../design/panel-malam/IMPLEMENTATION-REPORT.md): penyimpangan yang disengaja.

Bila dokumen ini berbeda dengan 1 atau 2, yang di atas menang.

## 1. Identitas

Panel instrumen malam: hampir hitam kehijauan, satu angka besar per layar, lime hanya di saat penting. Dial ENERGY 2 / RHYTHM 2 / MOTION 1. Tanpa foto, ilustrasi, atau avatar gambar; orang = inisial N/F. Motif: kartu utama dengan bilah proporsi (aman, tagihan, wajib) dan `SpaceTag` ruang.

## 2. Token

### 2.1 Warna

Tema gelap bawaan. Terang dan "Ikuti sistem" dipilih di Menu → Tampilan (`localStorage` kunci `dompetku-theme`, ditulis ke `html[data-theme]` oleh skrip kepala sebelum cat pertama). `?theme=light|dark` menang atas pilihan tersimpan. Tabel nilai lengkap: README handoff bagian "Design tokens" dan `tokens.css`. Ringkasan peran:

| Peran                                        | Gelap                                         | Terang                                        |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `bg` / `surface` / `surface-2` / `surface-3` | `#0F1211` / `#1A1F1D` / `#232927` / `#2C3330` | `#F4F6F3` / `#FFFFFF` / `#EBEFEA` / `#E1E6E0` |
| `text` / `text-soft` / `text-muted`          | `#EDF1EE` / `#C9D1CD` / `#9BA5A0`             | `#141917` / `#38423D` / `#56605B`             |
| `border` (kontrol) / `hairline` (dekoratif)  | `#737E79` / `#262C2A`                         | `#7D8782` / `#DDE2DE`                         |
| `accent` + `on-accent`                       | lime `#C4EE6A` + `#11160A`                    | sama, ditambah garis `accent-edge` `#4A6A0F`  |
| `accent-text`                                | `#C4EE6A`                                     | `#4A6A0F`                                     |
| `income`                                     | `#5FD8A4`                                     | `#1A7447` (handoff `#1B7A4B`, lihat bawah)    |
| `danger` / `warning`                         | `#FF8F7D` / `#F0B44C`                         | `#B8322A` / `#945700` (handoff `#9A5B00`)     |
| `focus`                                      | `#C4EE6A`                                     | `#3F5F0A`                                     |

Token bilah proporsi (chart), gelap / terang: `chart-aman` `#C4EE6A` / `#75A127` (handoff terang `#7FAE2A`), `chart-tagihan` `#F0B44C` / `#D99A2B`, `chart-tagihan-2` `#B8862F` / `#B07A1C`, `chart-wajib` `#FF8F7D` / `#D9564B`. Bilah selalu disertai teks (label `aria-label` dan baris rincian dengan swatch), jadi hanya `chart-aman` yang diuji sebagai grafik non-teks (≥ 3:1 di putih).

**Penyimpangan dari handoff (kontras, review designer):** tiga nilai terang digelapkan minimal dengan hue tetap, dicatat di `IMPLEMENTATION-REPORT.md`: `income` `#1B7A4B` menjadi `#1A7447`, `warning` `#9A5B00` menjadi `#945700` (keduanya di `surface-3` sebelumnya 4,22 dan 4,29), `chart-aman` terang `#7FAE2A` menjadi `#75A127` (di putih 2,63 menjadi 3,05).

Sumber token turunan: `tab` (`#141816` / `#FFFFFF`) dan `hover` (`#212725` / `#F0F3EF`) ada di tabel token README handoff tetapi **tidak** di berkas `dompetku-tokens.css` handoff (berkas itu belum lengkap); `*-fill`, `on-*`, `*-tint`, `toast-*`, `scrim`, `--ruang*`, `--shadow-*` adalah tambahan kode. `scrim` hanya beda notasi. Kelas Tailwind hanya semantik (`--color-*: initial` mematikan palet bawaan); nilai warna mentah tidak boleh muncul di komponen.

### 2.2 Kontras

Daftar pasangan wajib dan rasio handoff ada di [`token-pairs.ts`](../../apps/web/src/styles/token-pairs.ts); [`contrast.test.ts`](../../apps/web/src/styles/contrast.test.ts) menguji teks ≥ 4,5:1 dan batas kontrol/fokus ≥ 3:1 di kedua tema, dan mencocokkan rasio dengan handoff sampai satu desimal. Contoh rasio tertulis (gelap / terang):

| Pasangan                             | Gelap | Terang |
| ------------------------------------ | ----- | ------ |
| `text` di `bg`                       | 16,5  | 16,4   |
| `text-muted` di `bg`                 | 7,4   | 6,0    |
| `on-accent` di `accent`              | 13,8  | 13,8   |
| `accent-text` di `bg`                | 14,2  | 5,8    |
| `bersama` di `surface`               | 7,7   | 6,7    |
| `pribadi` di `surface`               | 12,6  | 6,3    |
| `danger` di `surface`                | 7,5   | 6,0    |
| `income` di `bg`                     | 10,6  | 5,3    |
| `income` di `surface-3`              | -     | 4,6    |
| `warning` di `surface-3`             | -     | 4,6    |
| `warning` di `warning-tint`          | 7,7   | 5,1    |
| `chart-aman` di `surface` (non-teks) | -     | 3,05   |
| `border` di `bg` (non-teks)          | 4,5   | 3,4    |
| `focus` di `bg` (non-teks)           | 14,2  | 6,8    |

Pasangan di atas `surface-2`, `surface-3`, dan `hover` untuk `income` dan `warning` ikut diuji (terang ≥ 4,5:1). Rasio terang `income`/`warning` tidak lagi dicocokkan dengan angka handoff karena nilainya digelapkan. `border` gelap di `surface-3` 3,07 (lolos tipis).

Aturan: lime di tema terang tidak pernah menjadi teks; tombol primer terang diberi garis `accent-edge`. Skrip cek manual: plugin antislop `check_contrast`.

### 2.3 Tipografi

Plus Jakarta Sans 400 sampai 800, OFL, lokal dari `@fontsource` (tanpa unduhan saat build). Semua nominal `tabular-nums`, `nowrap`, rata kanan.

| Gaya               | Ukuran / tebal                   | Pakai                                         |
| ------------------ | -------------------------------- | --------------------------------------------- |
| display-xl         | 56, 800, −0,025em                | Angka aman laptop                             |
| display-lg         | 52, 800                          | Angka hero tablet (tambahan kode)             |
| display            | `clamp(32px, 11,3vw, 44px)`, 800 | Angka aman HP: 44 px di 390, 36 px di 320     |
| display-long       | `clamp(28px, 8,5vw, 44px)`, 800  | Nominal panjang (`Rp 12.345.678.900`)         |
| amount / amount-sm | 40 / 36, 800                     | Nominal Catat dan detail / varian lebih kecil |
| title-lg / title   | 28 / 26, 800                     | Judul halaman laptop, auth                    |
| headline           | 20                               | Judul kartu utama                             |
| header             | 19                               | Judul ruang di header                         |
| heading            | 18, 800                          | Judul sheet                                   |
| subheading         | 17                               | Sub judul                                     |
| keypad             | 22                               | Tombol angka Catat                            |
| body-strong / body | 15, 600 sampai 700 / 500         | Baris dan paragraf                            |
| label              | 14, 700                          | Tombol, chip, judul kartu                     |
| meta               | 13, 500                          | Kategori · dompet, status                     |
| caption, nav, tag  | 12, 11,5, 11 (600 sampai 800)    | Tab bar, tag ruang                            |

**Keputusan pemilik (2026-10-31):** angka besar `display` mengecil di layar sempit (clamp) dipertahankan agar nominal panjang tidak terpotong di 320 px; handoff menulis 44 tetap. Gaya tambahan di atas (selain handoff) dicatat sebagai penyimpangan sengaja di `IMPLEMENTATION-REPORT.md`.

### 2.4 Spasi, radius, bayangan

- Grid 4 px (`--spacing: 4px`): 4, 8, 12, 16, 20, 24, 32, 40, 48. Antar kartu 12 (HP), 16 sampai 20 (laptop). Padding kartu 16 (kartu utama laptop 24).
- Radius: 3 bilah proporsi (`--radius-xs`; handoff menulis 4), 6 tag, 10 segmen dalam, 12 tombol/input/chip/ubin, 14 toast (`--radius-toast`, tambahan kode), 16 kartu daftar, 20 kartu utama dan dialog, 24 sheet, penuh hanya pengalih ruang, filter, avatar.
- Kartu tanpa bayangan, cukup garis `hairline`. Bayangan hanya untuk lapisan mengambang (sheet, dialog, toast, menu): gelap `0 24px 60px rgba(0,0,0,.45)`, terang `0 24px 60px rgba(20,25,23,.16)`.
- Format uang: `Rp 1.250.000`; negatif memakai U+2212 (`−Rp 35.000`); pemasukan `+Rp …` warna `income`. Tanggal "Hari ini", "Kemarin", "Kam, 15 Okt"; jam memakai titik ("10.55").

### 2.5 Gerak

Hanya transisi CSS: sheet 200 ms ease-out, toast 160 ms. Semua 0 ms di `prefers-reduced-motion`; skeleton tanpa denyut. Tanpa library animasi.

## 3. Komponen dan keadaan

Implementasi di [`apps/web/src/components/ui/`](../../apps/web/src/components/ui/) dan `apps/web/src/features/`. Galeri keadaan: `/dev/ui` (hanya dev). Daftar:

| Komponen                                                                                                      | Catatan dan keadaan                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button (primer, sekunder, bahaya, teks), IconButton                                                           | Tinggi ≥ 44. Default, hover (pointer saja), aktif, fokus, nonaktif (`surface-2` + `text-muted`, `not-allowed`). Terang: primer bergaris `accent-edge`                                                                                                                                              |
| Chip kategori, filter pil                                                                                     | Tinggi 44, radius 12. Terpilih: tint ruang + ✓ + tebal; chip kategori `radio` dengan `aria-checked` (penyimpangan dari `aria-pressed` handoff, dicatat di laporan). Tidak pernah terpilih otomatis                                                                                                 |
| SegmentedControl                                                                                              | `tablist` untuk Daftar/Ringkasan; item 44                                                                                                                                                                                                                                                          |
| TextField, MoneyInput, Select                                                                                 | Border `border` 1 px; galat 2 px `danger` + ikon + `aria-describedby`; fokus pindah ke kolom salah                                                                                                                                                                                                 |
| Sheet (Radix Dialog), ConfirmDialog (AlertDialog)                                                             | HP: bottom sheet radius atas 24; ≥ 600: dialog tengah maks 520. AlertDialog: fokus awal di aksi aman ("Kembali")                                                                                                                                                                                   |
| Toast (Radix)                                                                                                 | Dibalik dari tema, tinggi 52, radius 14, 6 detik, jeda saat hover/fokus, `role="status"`; HP 92 px dari bawah (di atas tab bar), laptop kanan bawah lebar 400                                                                                                                                      |
| SpaceTag, SpaceSwitcher                                                                                       | Selalu teks ruang; pengalih = dua `<Link>` dengan ✓ dan `aria-current="page"`                                                                                                                                                                                                                      |
| MoneyText                                                                                                     | U+2212, tabular, teks pembaca layar; tanpa "Rp 0" sebelum data ada                                                                                                                                                                                                                                 |
| ListCard, BillRow, BudgetRow, TxRow, ActivityRow, WalletRow                                                   | Baris ≥ 62; status = ikon + teks ("Lewat 3 hari", "85% terpakai")                                                                                                                                                                                                                                  |
| Kartu utama + bilah proporsi (AmanCard, Kekayaan bersih)                                                      | Bilah `role="img"` dengan `aria-label` berisi semua angka; negatif: `danger` + kotak peringatan                                                                                                                                                                                                    |
| State (kosong, memuat, galat)                                                                                 | Satu per layar data; memuat = skeleton + teks "Memuat…" + `role="status"`; galat dengan "Coba lagi"                                                                                                                                                                                                |
| Keadaan Catat (AFD §3): saldo tidak cukup, galat simpan, "Menyimpan…", bentrok `DK410`, konflik versi `DK409` | **Belum ada bingkai handoff** (utang desain, sebelum S6). Rancangan: peringatan saldo inline (bukan dialog); galat simpan = sheet tetap terbuka + pesan sebaris + "Coba lagi"; "Menyimpan…" = tombol nonaktif + teks, `aria-busy`; konflik = pesan + nilai terbaru + pilihan Muat ulang atau Timpa |
| Keypad aplikasi (varian B)                                                                                    | Grid 3 kolom, tombol 52, `1 sampai 9, 000, 0, ⌫`                                                                                                                                                                                                                                                   |

Ikon: Phosphor, regular untuk navigasi, fill untuk aktif/status, bold di tombol; path disalin per berkas di `components/ui/icons/` agar hanya ikon terpakai yang terbundel (ADR 0006). Peta ikon kategori ada di README handoff bagian "Assets".

## 4. Tata letak per breakpoint

| Lebar           | Kerangka                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 320 sampai 599  | Header 66 px (judul ruang, pengalih ruang, Menu). Tab bar: Beranda, Transaksi, Catat (slot tengah, bukan FAB), Dompet, Rencana; safe-area bawah. Satu kolom. Di bawah 360: Catat jadi ikon 48 dengan label, judul ruang `sr-only` |
| 600 sampai 1023 | Tab bar tetap; isi maks 720, padding 24; Tagihan dan Anggaran 2 kolom; Catat jadi dialog tengah maks 520                                                                                                                          |
| ≥ 1024          | Sidebar 248 px (tab bar hilang); header halaman dengan label ruang kapital berjarak + H1 28; isi maks 1000; Beranda grid `1,3fr / 1fr`; Transaksi daftar + kolom Ringkasan 340; `c` membuka Catat, `Enter` simpan, `Esc` tutup    |

Bingkai handoff hanya ada untuk Beranda (X1) dan dialog Catat (L2) di 600 sampai 1023, dan tidak ada bingkai 320 px; Transaksi, Dompet, Detail, dan auth di tablet serta semua layar di 320 adalah utang desain (§9) dan diuji lewat screenshot.

Uji wajib: tanpa gulir horizontal di 320 px (termasuk nominal `Rp 12.345.678.900`); mode keyboard Catat di 360×640 (bilah status 24 + keyboard 260) menyisakan judul ruang, nominal, ≥ 4 chip, dompet, Simpan terlihat, tinggi sheet ≤ 356.

## 5. Aturan warna ruang

- Pribadi = lime (`pribadi*`), Bersama = violet (`bersama*`); diterapkan per subtree lewat `data-ruang`. Dikonfirmasi pemilik 2026-10-31 (juga label kapital "RUANG PRIBADI" dan teks handoff), walau bertabrakan dengan pola slop antislop R-01 dan R-06 (ADR 0006).
- Warna tidak pernah satu-satunya penanda: ruang selalu tertulis (judul header, pil pengalih ✓, `SpaceTag`, judul Catat, toast, dialog). Dibedakan juga dalam mode grayscale.
- Rute Bersama tidak memuat data Pribadi sama sekali (bukan disembunyikan CSS). Feed Bersama tidak memuat nama dompet atau entri Pribadi.
- Kantor ditandai label teks "Kantor", tanpa warna sendiri; ditampilkan "Tidak masuk hitungan pribadi".

## 6. Aksesibilitas

- WCAG 2.2 AA (kriteria spesifik: `docs/spec/ui-ux.md` R10). Kontras seperti §2.2.
- Target sentuh ≥ 44×44, jarak ≥ 8. Status selalu ikon + teks.
- Fokus: `outline: 2px solid var(--focus); offset 2` di semua elemen interaktif, termasuk baris dan chip; fokus tidak tertutup tab bar atau toast.
- Navigasi hanya keyboard: buka Catat, isi, simpan, Esc menutup dan fokus kembali ke pemicu. Pintasan `c` hanya saat fokus bukan di field teks (WCAG 2.1.4).
- Region toast dan pengumuman selalu terpasang; live region untuk memuat.
- `prefers-reduced-motion` dihormati; `aria-current="page"` pada navigasi; nama ruang di judul halaman (H1).
- Layar auth (WCAG 2.2 3.3.8 Authentication Minimum): kolom kode 6 digit menerima tempel dan isi otomatis, kata sandi boleh ditempel dan dibantu pengelola kata sandi, kode pemulihan bisa disalin; tidak ada uji kognitif (mengingat atau menyalin ulang tanpa alternatif). Diuji axe dan Playwright auth.
- Uji: axe-core serious/critical = 0 pada layar inti di terang dan gelap, 320/390/1280.

## 7. Budget JS

Batas **162 kB** gzip JS rute pada muat dingin (baseline framework 131,9 kB + 30 kB kode aplikasi), diukur `apps/web/tests/e2e/budget.spec.ts` ([ADR 0002](../adr/0002-js-budget.md)). Terukur Panel Malam: 160,9 kB `/pribadi/beranda`, 161,0 kB `/pribadi/transaksi` (sisa sekitar 1 kB). Terukur akhir S6 (2026-11-03): prototipe `budget.spec.ts` 160,8 kB beranda, 160,0 kB transaksi, 156,9 kB detail, 157,9 kB sampah, 156,4 kB dompet; mode nyata (`e2e:ledger`) angka yang sama (160,8 / 160,0 / 156,9 / 157,9 / 156,4 kB), headroom terkecil 1,2 kB di beranda. Seed demo masih ikut JS mode nyata (ditunda). Target 150 kB di M2 dibatalkan pemilik (2026-10-31). Kode yang hanya dipakai saat dibuka (Catat, Tambah dompet, Menu, tampilan toast) dimuat malas; ikon per berkas. Sisa 1 kB berarti setiap penambahan JS rute di M1 perlu pengukuran dan keputusan (Belum diputuskan: naikkan batas atau kurangi kode).

## 8. Layar dan bingkai

Indeks bingkai (HP, tablet, laptop, terang): README handoff bagian "Files". Cakupan M0a: Beranda (B1 sampai B7), Catat (C1 sampai C5), Transaksi (T1 sampai T5), Detail (D1 sampai D4), Dompet (W1 sampai W4), Rencana kosong (R1), auth tiruan (A1 sampai A4), laptop/tablet (L1 sampai L6, X1), terang (G1 sampai G10).

## 9. Utang desain (layar atau keadaan yang disebut dokumen tetapi belum didesain)

Proses (keputusan pemilik 2026-10-31): agen merancang mengikuti pola Panel Malam dengan kursi design reviewer di tiap task UI; pemilik menilai di pratinjau; layar besar baru (Pengaturan, Analisis, Laporan dan grafik) lewat Claude Design. Sprint mengikuti IPD §8.

| #   | Layar / keadaan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Sprint target                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Auth: `/buat-akun`, langkah 3 kode pemulihan (salin, unduh, konfirmasi "sudah menyimpan", galat), masuk TOTP dan kode pemulihan, lupa kata sandi, akun pertama, keadaan galat (kode salah, rate limit, passkey dibatalkan, jeda bertahap), halaman galat undangan, Tautan terkirim, Undangan tertunda                                                                                                                                                                                                                                                                                                      | sebelum S4                   |
| 2   | Menu → Pengaturan: daftar perangkat dan cabut sesi, audit log (Claude Design)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | sebelum S4                   |
| 3   | Sampah; Catat: saldo tidak cukup, galat simpan, "Menyimpan…", transfer lintas ruang, mode Pindahkan ke ruang lain; Detail: sheet Ubah dan konflik versi, transaksi dibatalkan (bingkai D5 dengan Pulihkan). **Selesai (S6, 2026-11-03):** [`s6-bingkai.md`](../design/s6-bingkai.md) S6-C1 sampai S6-C6, S6-D1 sampai S6-D3, S6-S1 dibangun di mode prototipe dan nyata, dikritik dan lulus Delivery Gate tertulis (bagian "Design critique dan Delivery Gate"). Menunggu penilaian pemilik di pratinjau. Transfer lintas ruang dan Pindahkan ke ruang lain dibingkai di S7 (keputusan pemilik 2026-11-01) | sebelum S6 (lintas ruang S7) |
| 4   | Dompet: Cocokkan saldo, edit saldo awal 7 hari, arsip dompet, talangan dan reimburse ("Menunggu reimburse"); baris transfer (`TxRow` transfer, `ActivityRow` setoran; label teks, bukan warna, yang membedakan)                                                                                                                                                                                                                                                                                                                                                                                            | S6 sampai S7                 |
| 5   | Bersama solo (Farida belum bergabung) dan Bersama kosong; checklist Beranda Farida (3 langkah)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | sebelum S8                   |
| 6   | Setoran, feed sebelum/sesudah, kontribusi; Anggaran (editor, salin 1 ketukan), tagihan, review bulanan, Rencana nyata, ekspor                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | S8 sampai S10                |
| 7   | Laporan dan grafik (Recharts), ekspor PDF (Claude Design)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | S9, S16                      |
| 8   | Menu: Kategori (S6), Trip, Kontak, Export, Analisis (Claude Design). Kategori **selesai (S6, 2026-11-03):** [`s6-bingkai.md`](../design/s6-bingkai.md) S6-K1, S6-K2; tombol hari tanpa pengeluaran S6-B1 (keduanya dibangun di mode nyata)                                                                                                                                                                                                                                                                                                                                                                 | sprint fiturnya              |
| 9   | Bingkai tablet 600 sampai 1023 selain Beranda dan Catat; bingkai 320 px; terang untuk auth, Menu, Rencana, Tambah dompet, Detail dompet                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | S4 sampai S6                 |
| 10  | 404 dan sesi kedaluwarsa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | S4                           |
| 11  | PWA: ikon aplikasi, splash, favicon (berkas dari pemilik), dialog pasang                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | S3                           |
| 12  | M3 sampai M6: utang/piutang dan cicilan, modal trading, bagi tagihan, tujuan, aset dan saham, net worth, kalender arus kas, deteksi langganan, Catat teks bebas, analisis AI, offline-baca, foto struk, kuota habis                                                                                                                                                                                                                                                                                                                                                                                        | sebelum sprint masing-masing |

## Konflik dan pertanyaan terbuka

1. Konflik (diselesaikan): `docs/spec/design.md` §9.3 dan `ui-ux.md` R4 menyebut "buku kas" dan token lama; digantikan DBD ini (ADR 0006). Spec induk §9.3 diberi catatan penggantian.
2. Konflik: `frontend.md` R11 dan ROADMAP menargetkan 120 atau 150 kB dan CLS < 0,05; ADR 0002 menetapkan 162 kB dan keputusan pemilik menetapkan CLS < 0,1.
3. Favicon: dibuat pemilik dari `docs/design/favicon-prompt.md`; berkas belum diterima.
4. Budget JS setelah M1 (lihat §7).
5. Peran design reviewer di setiap task UI dan design critique pratinjau Panel Malam: ditetapkan sebagai proses (IPD §8); pelaksanaan critique sebelum S4.
