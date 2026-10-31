# Handoff: DompetKu · arah visual "Panel Malam"

## Overview
Tampilan baru DompetKu, pencatat keuangan pribadi + bersama untuk dua orang (Novanda & Farida). Alur dan fungsi tidak berubah (lihat `ref/layar.md`). Paket ini hanya mengganti bahasa visual, lengkap dengan keadaan kosong, memuat, galat, sheet, dan dialog. Ada tema gelap (bawaan) dan terang, untuk HP (390, aman di 320), tablet (768), dan laptop (1280).

Stack target: **Next.js + Tailwind CSS v4 + Radix (Dialog, AlertDialog, Toast)**, ikon **Phosphor**, huruf **Plus Jakarta Sans** via Fontsource. Tidak perlu library animasi (batas JS 162 kB per halaman).

## About the design files
Berkas `.dc.html` di `designs/` adalah **referensi desain dalam HTML**: prototipe statis yang menunjukkan tampilan dan keadaan yang dimaksud. Berkas ini **bukan kode produksi untuk disalin**. Tugasnya adalah membangun ulang layar ini di codebase DompetKu yang sudah ada (komponen React + kelas Tailwind memakai token di `dompetku-tokens.css`), mengikuti pola codebase. Buka berkas langsung di browser (perlu `support.js` di folder yang sama). Kanvasnya bisa di-pan/zoom, dan setiap bingkai punya kode (B1, C2, L4, …) yang dipakai di dokumen ini.

## Fidelity
**High-fidelity.** Warna, tipografi, spasi, radius, dan keadaan sudah final. Bangun sepiksel mungkin. Semua angka di mock berasal dari `ref/contoh-data.json` (tanggal demo Sab, 17 Okt 2026), jangan ganti dengan angka contoh lain.

---

## Aturan global
- **Format uang:** `Rp 1.250.000`. Negatif memakai U+2212: `−Rp 35.000`. Pemasukan `+Rp …` warna `income`. Semua nominal `font-variant-numeric: tabular-nums`, `white-space: nowrap`, rata kanan.
- **Tanggal:** "Hari ini", "Kemarin", "Kam, 15 Okt". Jam memakai titik: "10.55".
- **Ruang aktif selalu tertulis:** judul header ("Pribadi"/"Bersama"), pil pengalih dengan ikon ✓ + `aria-current="page"`, dan `SpaceTag` di kartu utama, Catat, Detail, Dompet.
- **Privasi:** route Bersama tidak boleh memuat data Pribadi sama sekali (bukan sekadar disembunyikan dengan CSS). Toast dan dialog selalu menyebut ruang.
- **Status = ikon + teks**, tidak pernah warna saja ("Lewat 3 hari", "85% terpakai", "Segera").
- **Target sentuh ≥ 44×44**, jarak antar target ≥ 8.
- **Fokus:** `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` di semua elemen interaktif, termasuk baris transaksi dan chip.
- **Kurangi gerakan:** semua transisi 0 ms, skeleton tanpa denyut.

## Layout per breakpoint
| Lebar | Kerangka |
|---|---|
| 320–599 | Header 66 px (judul ruang 19/800 + "Data demo" 11/600 · pengalih ruang · IconButton Menu). `main` = `flex:1; overflow:auto; padding:12px 12px 24px; gap:12px`. Tab bar 52 px item + `padding-bottom: calc(env(safe-area-inset-bottom) + 6px)`. Konten tidak pernah tertutup bar. Di < 360: tombol Catat di tab bar jadi ikon 48×48 dengan label di bawah; judul ruang di header disembunyikan secara visual (`sr-only`). |
| 600–1023 | Tab bar tetap. Isi maks 720 px, padding 24. Tagihan + Anggaran 2 kolom. Catat jadi dialog tengah (maks 520). |
| ≥ 1024 | Sidebar 248 px, tab bar disembunyikan. Header halaman: label "Ruang Pribadi" (12/800, kapital, +0.06em, warna ruang) + H1 28/800. Isi maks 1000 px. |

---

## Screens

### Kerangka
- **Header HP:** `bg` + garis bawah `hairline`. Pengalih ruang = pil `surface` dengan border `border`, padding 2, dua tautan tinggi 44, padding 0 12, radius full. Yang aktif: isi `pribadi-fill`/`bersama-fill`, teks `on-pribadi`/`on-bersama` 14/700, ikon `check` bold 14. Yang tidak aktif: teks `text-soft` 14/600. Menu = IconButton 44, radius 12, ikon `list` 20.
- **Tab bar:** `bg: var(--tab)` (gelap `#141816`, terang `#FFFFFF`) dengan garis atas `hairline`. Isinya Beranda (`house`), Transaksi (`list-bullets`), Catat (button), Dompet (`wallet`), Rencana (`calendar-check`). Item: ikon 22 + label 11,5. Item aktif: ikon *fill* warna `accent-text` + label 800 `text`; item lain `text-muted` 500. Slot Catat `flex:1.3`, tombol 48 tinggi, padding 0 14, radius 14, isi `accent`, teks `on-accent` 14/800, ikon `plus` bold 18, `aria-keyshortcuts="c"`. Di tema terang tombol diberi border 1 px `accent-edge`. Rencana disembunyikan bila ruang belum punya anggaran/tagihan.
- **Sidebar (≥ 1024):** padding 20/16, gap 16, `bg: var(--tab)`, garis kanan `hairline`. Isi: wordmark "Dompet**Ku**" 20/800 ("Ku" `accent-text`) + "Data demo"; pengalih ruang lebar penuh; tombol Catat primer lebar penuh dengan `<kbd>C</kbd>`; NavLink 44 (Beranda, Transaksi, Dompet, Rencana, Menu). Link aktif: `surface-2` + `box-shadow: inset 3px 0 0 var(--accent-text)` + ikon fill.
- **Menu (B7):** bottom sheet. Enam item (Trip, Kategori, Kontak, Export, Analisis, Pengaturan), masing-masing baris 52 dengan ubin ikon 36 `surface-2` dan badge "Segera" (ikon `hourglass-medium`, border `border`, radius full). Item tidak interaktif (`aria-disabled`). Di bawahnya ada segmen **Tampilan: Gelap · Terang · Ikuti sistem**, yang menulis `data-theme` di `<html>`.

### 1. Beranda (B1–B7, L1, L3, X1, G1, G2, G8, G9)
Urutan di HP: **AmanCard → Tagihan 7 hari → Anggaran hampir habis → (Bersama) Aktivitas → Terakhir**. Semua ditumpuk satu kolom.
- **AmanCard:** `surface`, border `hairline`, radius 20, padding 16 (laptop 24), gap 12.
  - Baris judul: "Aman dipakai sampai 31 Okt" (Bersama: "Aman dipakai bersama sampai 31 Okt") 14/600 `text-soft`, dengan `SpaceTag` di kanan.
  - Angka: `display` 44/800, −0.025em (laptop 56).
  - "≈ **Rp 197.900** per hari untuk 15 hari": 14/500 `text-soft`, nominal 800 `text`.
  - Bilah proporsi 12 px, radius 4, gap 2, segmen `flex-grow` sesuai nilai: aman (`chart-aman`), tagihan (garis miring `chart-tagihan`/`chart-tagihan-2` 4+3 px), wajib (`chart-wajib`, min 4 px, dihilangkan bila 0). Beri `role="img"` + `aria-label` berisi keempat angka.
  - Empat baris rincian (padding 9 0, garis atas `hairline`, 14/500, swatch 10×10): Saldo operasional (swatch hanya garis), Tagihan s.d. 31 Okt (−), Sisa anggaran wajib (−, tampil "Rp 0" bila 0), **Aman dipakai** (800, nominal `accent-text`).
  - **Negatif (B6):** nominal warna `danger`; baris per hari diganti kotak `danger-tint` dengan ikon `warning-octagon` fill + "Pengeluaran wajib bulan ini melebihi saldo operasional." (14/700 `danger`).
- **ListCard:** `surface`, border `hairline`, radius 16, padding 14 16 4. Header 14/700 `text-soft` dengan ikon 18, plus tautan opsional "Semua ›" (`accent-text` 13/700, area klik 44).
  - **BillRow** (≥ 62): ubin tanggal 44×44 radius 12 `surface-2` (hari 10/700 kapital + tanggal 17/800), nama 15/600, sub "4 hari lagi" (ikon `clock`, `text-muted`), nominal 15/700. **Terlambat:** ubin `danger-tint`, teks `danger`, ikon `warning-circle` fill, "Lewat 3 hari".
  - **BudgetRow:** nama 15/600 (+ tag "Wajib" 11/600 berborder bila `wajib`), status kanan. ≥ 80% berwarna `warning` dengan ikon `warning` fill; ≥ 100% berwarna `danger` dengan ikon `warning-octagon`. Bilah 6 px `surface-2`. Sub: "Rp 154.000 dari Rp 180.000 · sisa Rp 26.000". Kosong: "Belum ada anggaran yang mendekati batas."
  - **TxRow** (≥ 62, `<a>` ke detail): ubin ikon 40 radius 12 `surface-2` (ikon kategori, lihat tabel Assets), keterangan 15/600 (ellipsis), sub "Kategori · Dompet · Hari" 13/500 `text-muted`, nominal 15/700. Hover `--hover`; fokus = ring.
  - **ActivityRow (Bersama):** avatar 36 bulat dengan inisial 14/800. N: `surface-3` + `text`. F: `bersama-tint` + `bersama`. Keduanya border `border`. Teks "**Novanda** · Pengeluaran: Minimarket" 14/500, sub "Hari ini · 10.55" 12/500, nominal di kanan.
- **Tombol "Tidak ada pengeluaran hari ini":** tombol sekunder ber-ikon `check`, hanya tampil bila hari ini belum ada pengeluaran. Setelah ditekan diganti teks "Hari ini tercatat tanpa pengeluaran" dengan ikon `check-circle` fill `accent-text`. Tidak tampil di data demo (lihat Spesifikasi).
- **Kosong (B3, `?seed=empty`):** kartu judul aman + kalimat 18/700 "Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini." + tombol "Tambah dompet". Checklist "Mulai dari sini" (1 dari 4 selesai): Akun aman (ikon `check-circle` fill + "Selesai"), lalu Tambah dompet sehari-hari, Catat satu pengeluaran, Undang Farida, masing-masing tautan 56 dengan lingkaran kosong dan caret. Terakhir: "Belum ada transaksi. Catatan pertamamu akan muncul di sini." **Tidak boleh ada "Rp 0".**
- **Memuat (B4):** skeleton `surface-2` berbentuk isi akhir + teks "Memuat…" yang terlihat + `role="status"`.
- **Galat (B5):** ubin `danger-tint` dengan ikon `cloud-slash`, "Beranda belum bisa dimuat" 20/800, "Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.", tombol "Coba lagi" (primer) dan "Catat tetap bisa" (sekunder).
- **Laptop (L1, L3):** grid `minmax(0,1.3fr) minmax(0,1fr)`, gap 20. Kiri: AmanCard + grid `repeat(auto-fit,minmax(260px,1fr))` berisi Tagihan & Anggaran. Kanan: (Aktivitas) + Terakhir. Aksi di header: tanggal "Sab, 17 Okt 2026" `text-muted`.

### 2. Sheet Catat (C1–C5, L2, G3, G4, G10)
- HP: Radix Dialog sebagai bottom sheet (radius atas 24, `surface`, scrim `--scrim`). Mulai 600 px: dialog tengah lebar maks 520, padding 24, radius 20.
- **Baris judul:** satu tombol 44 bertuliskan "Pengeluaran · Pribadi ▾" (ikon ruang, 15/800, isi tint ruang, border 1,5 px warna ruang, teks warna ruang). Tombol ini sekaligus pemilih **jenis** (Pengeluaran/Pemasukan/Transfer) lewat menu. Tutup = IconButton 44.
- **Nominal:** "Rp" 20/700 `text-muted` + angka 40/800 (mode keyboard 36), garis bawah 2 px warna ruang (abu `border` bila 0). Pemisah ribuan muncul saat mengetik. `inputmode="numeric"`, mendapat fokus pertama.
- **Chip kategori:** grid `grid-auto-flow: column; grid-template-rows: repeat(2,44px); grid-auto-columns: max-content; gap: 8px; overflow-x: auto`, lebar penuh (margin −16). Isinya 6 saran teratas + "Kategori lain…" (ikon cari). **Tidak pernah terpilih otomatis.** Chip: tinggi 44, radius 12, padding 0 14, 14/600, border `border`. Terpilih: tint ruang + border 1,5 px warna ruang + ikon ✓ + 700, `aria-pressed`. Di HP tanpa ikon kategori; di dialog laptop chip dibungkus (wrap) dan memakai ikon.
- Petunjuk bila nominal > 0 tapi kategori kosong: "Pilih kategori untuk menyimpan" (ikon `info`, 12 `text-muted`).
- **Baris meta:** Select Dompet (bawaan: dompet operasional terakhir dipakai) dan Select Tanggal ("Hari ini" s.d. 13 hari sebelumnya). Masing-masing 44, radius 12, border `border`, ikon + label + caret. Ditambah IconButton "Tambah keterangan" (`note-pencil`). Di laptop, kolom Keterangan (opsional) langsung tampil.
- **Keypad (`?keypad=app`):** grid 3 kolom, gap 8, tombol 52 tinggi, radius 12, `surface-2`, 22/700: `1–9, 000, 0, ⌫` (`aria-label="Hapus"`).
- **Kaki:** tombol teks "Pindah ke Bersama" (ikon `arrows-left-right`) + tombol **Simpan** (`flex:1`). Simpan nonaktif sampai nominal > 0 dan kategori dipilih. Gaya nonaktif: `surface-2`, teks `text-muted`, border `hairline`. Laptop: `Enter` = Simpan, `Esc` = tutup.
- **Pindah ruang (C3):** nominal tetap; dompet diganti ke dompet operasional ruang tujuan (Kas Rumah); kategori direset ke daftar ruang tujuan; semua aksen ganti ke warna ruang tujuan.
- **Mode keyboard HP (C1):** gunakan `visualViewport`. Tanpa handle, padding 6 16 10, gap 8, nominal 36, tombol kaki 44. Tinggi sheet harus ≤ 356 px agar muat di 360×640 (status bar 24 + keyboard ±260). Yang wajib terlihat: judul ruang, nominal, ≥ 4 chip, dompet, Simpan.
- **Kategori lain… (C4):** halaman kedua di sheet yang sama. Kembali (IconButton `arrow-left`), "Kategori · Pribadi", kolom cari yang langsung fokus, daftar baris 52.
- **Setelah simpan (C5):** sheet tertutup, lalu toast "Tersimpan di Pribadi · Rp 22.000 dari BCA" + "Urungkan".

### 3. Transaksi (T1–T5, L4, G5)
- Urutan di HP: Segmen `Daftar | Ringkasan` (role tablist, item 44) → pemilih bulan (IconButton ‹ · "Oktober 2026" 16/800 · ›, tombol "berikutnya" nonaktif untuk bulan berjalan) → kolom cari 44 ("Cari keterangan") → filter chip pil 44. Pribadi: Semua · Operasional · Kantor · Menunggu reimburse. Bersama: Semua · Operasional. Filter aktif: dibalik (isi `text`, teks `bg`) + ✓.
- **Kelompok per hari:** label hari + total bersih harian (13/700 `text-soft`, padding 0 4), lalu kartu `surface` radius 16 padding 0 14 berisi TxRow. Di akhir daftar: tombol sekunder "Muat lagi" (per 50 entri).
- **Kosong (T3):** "Tidak ada transaksi Kantor di Oktober." + tombol "Hapus filter".
- **Ringkasan (T2):** baris Pemasukan / Pengeluaran / **Selisih** (52 tinggi, selisih 20/800), lalu kotak info `surface-2` "Tidak termasuk: Kas kantor Rp 334.000, Transfer internal Rp 1.000.000", lalu daftar Anggaran bulan ini.
- **Memuat (T4):** "Memuat transaksi Oktober…" + skeleton baris.
- **Laptop (L4):** daftar di kiri dan kolom Ringkasan 340 px di kanan, berdampingan, sehingga segmen tidak dipakai.

### 4. Detail transaksi (D1–D4, G6)
- Tautan kembali "‹ Transaksi" (`accent-text`, 44). Kartu atas: ubin ikon 48 + keterangan 17/700 + "Pengeluaran", lalu nominal 40/800. Kartu daftar (baris 52): Kategori, Dompet, Tanggal ("Hari ini · Sab, 17 Okt"), Ruang (SpaceTag), Dicatat oleh ("kamu" / "Farida").
- Tombol lebar penuh: **Ubah** dan **Pindahkan ke ruang lain** (sekunder; keduanya memunculkan toast "Segera di M1" dengan ikon `info`), lalu **Batalkan transaksi** (bahaya, garis).
- **AlertDialog (D2):** ubin `danger-tint` + "Batalkan transaksi ini?" 19/800 + "Transaksi Rp 22.000 dibatalkan. Saldo BCA bertambah Rp 22.000. Bisa dipulihkan 90 hari dari Sampah." Tombol "Batalkan transaksi" (isi `danger`, teks `on-danger`) dan "Kembali" (sekunder). **Fokus awal di "Kembali".** Setelah konfirmasi: kembali ke daftar, baris hilang, total harian dihitung ulang, toast "Transaksi Rp 22.000 dibatalkan" + "Urungkan" (D4).

### 5. Dompet (W1–W4, L5, G7)
- Kartu **Kekayaan bersih** = operasional + tabungan (Pribadi Rp 34.253.500; Bersama Rp 18.262.000), angka 40/800 (laptop 52). Keterangan: "Operasional + tabungan. Kas Kantor tidak dihitung."
- Tombol sekunder "Tambah dompet". Kelompok Operasional / Tabungan / Kantor (Kantor hanya di Pribadi), masing-masing ListCard dengan subtotal di kanan header. Kantor diberi label "Tidak masuk hitungan pribadi" (ikon `info` fill, `warning` 12/600). WalletRow 62: ubin ikon (`bank` / `money` / `device-mobile`), nama, tipe, saldo, caret.
- **Sheet Tambah dompet (W2):** judul + SpaceTag; isian Nama, segmen Jenis (Operasional/Tabungan/Kantor), segmen Tipe (Bank/E-wallet/Tunai), Saldo hari ini (opsional, prefiks "Rp", petunjuk "Kosongkan bila belum tahu; bisa diisi nanti."), tombol "Simpan dompet". **Galat inline:** border 2 px `danger` + ikon `warning-circle` + "Nama dompet wajib diisi." (`aria-describedby`); fokus pindah ke kolom yang salah.
- **Detail dompet (W3):** kembali "‹ Dompet", kartu nama + "Operasional · Bank" + saldo 36/800, riwayat per hari (hanya transaksi dompet itu), "Muat lagi", dan di bagian paling bawah kelompok "Entri pembuka" dengan baris "Saldo awal Rp 4.100.000" (ikon `flag`).
- **Laptop (L5):** kartu kekayaan lebar penuh + grid 3 kolom kelompok.

### 6. Rencana (R1)
Keadaan kosong jujur: ubin `accent-tint` ikon `calendar-check` 28, "Rencana segera hadir", "Anggaran dan tagihan akan diatur di sini. Untuk sekarang ringkasannya tetap tampil di Beranda.", tombol "Ke Beranda".

### 7. Auth tiruan (A1–A4, L6)
Di luar kerangka aplikasi. Pita atas 36 px `warning-tint` dengan ikon `flask` fill + "Prototipe: belum aktif" (12/700 `warning`). Padding 28 24, gap 16, H1 26/800.
- **/masuk:** wordmark, "Masuk ke DompetKu", primer 52 "Masuk dengan passkey" (`fingerprint`), pemisah "atau dengan email", Email, Kata sandi (ikon `eye`), kotak `warning-tint` "Prototipe: jangan isi kata sandi asli.", sekunder "Masuk". Laptop: kartu 420 di tengah.
- **/amankan:** stepper 3 bagian (Passkey ✓ · Kode · Pemulihan; bilah 4 px), "Masukkan kode 6 digit", 6 kotak 56 tinggi (yang fokus border 2 px `focus`), "Verifikasi" nonaktif sampai 6 digit terisi. Langkah 3 (kode pemulihan) belum digambar karena isinya dari server.
- **/undang:** "Undang Farida ke ruang Bersama", penjelasan privasi, Email pasangan, petunjuk "Tautan berlaku 72 jam, sekali pakai.", tombol "Kirim undangan" (`paper-plane-tilt`).
- **/terima-undangan:** avatar N → ikon ruang Bersama, "Novanda mengundang kamu ke ruang Bersama", kotak dua baris (ikon `eye` dan `eye-slash`) tentang apa yang terlihat dan tidak, tombol "Terima undangan" dan "Tolak" (teks).

---

## Interactions & behavior
- `c` di mana saja (kecuali saat mengetik di input) membuka Catat. Sheet terbuka 200 ms ease-out (`transform: translateY`), toast 160 ms. Semuanya transisi CSS biasa.
- **Toast (Radix):** latar dibalik dari tema (`toast-bg`/`toast-text`), tinggi 52, radius 14, ikon `check-circle` fill. Aksi "Urungkan" 44 px `toast-action` 14/800. Tampil 6 detik dan berhenti sementara saat hover/fokus. Posisi HP: 12 px dari sisi, 92 px dari bawah (di atas tab bar). Laptop: kanan bawah, lebar 400. `role="status"`.
- **Pengalih ruang:** dua tautan ke `/pribadi/...` dan `/bersama/...` untuk halaman setara.
- **Hover (pointer saja):** tombol primer `accent-hover`, ditekan `accent-press`; sekunder/baris `--hover`; tombol bahaya `danger-tint`. Nonaktif: `surface-2` + `text-muted` + `cursor: not-allowed`.

## State management
- `space`: `'pribadi' | 'bersama'` (dari route).
- `theme`: `'dark' | 'light' | 'system'` (localStorage, ditulis ke `<html data-theme>`; bawaan `dark`).
- Catat: `{ jenis, space, nominal, kategoriId | null, dompetId, tanggal, keterangan }`. `canSave = nominal > 0 && kategoriId`. Pindah ruang: `nominal` dipertahankan, `kategoriId = null`, `dompetId = lastOperationalWallet(space)`.
- Status data per halaman: `loading | error | empty | ready`. Masing-masing punya tampilan sendiri di mock.
- Beranda: `noSpendToday` (tombol hanya tampil bila belum ada pengeluaran hari ini), `aman.total < 0` untuk mengganti tampilan ke keadaan negatif.

## Design tokens
Sumber kebenaran: **`dompetku-tokens.css`** (Tailwind v4 `@theme inline`, `[data-theme]`). Tabel lengkap beserta rasio kontras ada di `designs/DompetKu Spesifikasi.dc.html`.

| Token | Gelap (bawaan) | Terang |
|---|---|---|
| bg | #0F1211 | #F4F6F3 |
| surface | #1A1F1D | #FFFFFF |
| surface-2 | #232927 | #EBEFEA |
| surface-3 | #2C3330 | #E1E6E0 |
| text | #EDF1EE (16,5:1 bg) | #141917 (16,4:1) |
| text-soft | #C9D1CD | #38423D |
| text-muted | #9BA5A0 (7,4:1 bg) | #56605B (6,0:1) |
| border (kontrol, ≥ 3:1) | #737E79 | #7D8782 |
| hairline (dekoratif) | #262C2A | #DDE2DE |
| accent (isi tombol) | #C4EE6A | #C4EE6A + edge #4A6A0F |
| accent-hover / press | #D3F58C / #B0DB52 | #B5E54F / #A5D63E |
| on-accent | #11160A (13,8:1) | #11160A |
| accent-text | #C4EE6A | #4A6A0F (5,8:1) |
| accent-tint | #26301A | #E8F6C8 |
| income | #5FD8A4 | #1B7A4B |
| danger / danger-tint / on-danger | #FF8F7D / #3A201C / #1A0905 | #B8322A / #FBE6E3 / #FFFFFF |
| warning / warning-tint | #F0B44C / #33290F | #9A5B00 / #FBEFD9 |
| pribadi / pribadi-tint / pribadi-fill / on-pribadi | #C4EE6A / #26301A / #C4EE6A / #11160A | #4A6A0F / #E8F6C8 / #C4EE6A / #11160A |
| bersama / bersama-tint / bersama-fill / on-bersama | #B6A3FF / #2A2540 / #B6A3FF / #160F33 | #5B45C9 / #ECE8FF / #5B45C9 / #FFFFFF |
| focus | #C4EE6A | #3F5F0A |
| toast-bg / toast-text / toast-action | #EDF1EE / #0F1211 / #3D5A0A | #141917 / #F4F6F3 / #C4EE6A |
| scrim | rgba(4,6,5,.66) | rgba(20,25,23,.42) |
| tab (bar & sidebar) | #141816 | #FFFFFF |
| hover | #212725 | #F0F3EF |
| chart-aman / tagihan / tagihan-2 / wajib | #C4EE6A / #F0B44C / #B8862F / #FF8F7D | #7FAE2A / #D99A2B / #B07A1C / #D9564B |

Semua pasangan teks lolos 4,5:1 dan batas kontrol/fokus lolos 3:1 di kedua tema (dihitung otomatis; lihat Spesifikasi). Lime di tema terang **tidak pernah** dipakai sebagai teks.

- **Spasi (grid 4):** 4, 8, 12, 16, 20, 24, 32, 40, 48 (`--spacing: 4px`). Antar kartu 12 (HP) / 16–20 (laptop); padding kartu 16 (kartu utama laptop 24).
- **Radius:** sm 6 · md 10 · lg 12 (tombol, input, chip, ubin) · xl 16 (kartu daftar) · 2xl 20 (kartu utama, dialog) · sheet 24 · full.
- **Tipografi (Plus Jakarta Sans 400–800):**

| Gaya | Ukuran / tinggi baris · tebal | Pemakaian |
|---|---|---|
| display-xl | 56/56 · 800, −0.025em | Angka aman di laptop |
| display | 44/44 · 800, −0.025em | Angka aman di HP |
| amount | 40/42 · 800, −0.02em | Nominal Catat & detail |
| title | 26 · 800 | Judul halaman laptop & auth |
| heading | 18 · 800 | Judul sheet |
| body-strong | 15 · 600–700 | Keterangan & nominal baris |
| body | 15/22 · 500 | Paragraf, isi input |
| label | 14 · 700 | Tombol, chip, judul kartu |
| meta | 13 · 500 | Kategori · dompet, status |
| caption | 11–12 · 600–800 | Tab bar, tag ruang |

- **Bayangan:** hanya pada lapisan mengambang. Gelap: `0 24px 60px rgba(0,0,0,.45)`; terang: `0 24px 60px rgba(20,25,23,.16)`; tepi sheet `0 -12px 40px rgba(0,0,0,.25)`. Kartu tidak berbayangan, cukup border `hairline`.

## Assets
- **Huruf:** `@fontsource/plus-jakarta-sans` 400/500/600/700/800 (OFL).
- **Ikon:** Phosphor (`@phosphor-icons/react`). Regular untuk navigasi, Fill untuk aktif/status, Bold untuk ikon kecil di tombol. Ikon kategori:
  - Makan Siang & Minum `bowl-food` · Kopi & Camilan `coffee` · Transportasi `car-simple` · Belanja `bag` · Hiburan `film-slate` · Kesehatan `first-aid-kit`
  - Langganan `repeat` · Cicilan & Tagihan `receipt` · Perjalanan Dinas `briefcase` · Gaji `money`
  - Sewa Rumah `house-line` · Listrik & Air `lightning` · Internet `wifi-high` · Iuran Lingkungan `users-three` · Belanja Dapur `shopping-cart` · Sayur & Buah `carrot` · Makan di Luar `fork-knife` · Bensin & Parkir `gas-pump` · Kontribusi Farida `hand-coins`
  - Ruang: Pribadi `user`, Bersama `users-three`.
- Tidak ada foto, ilustrasi, atau avatar gambar. Orang hanya ditampilkan dengan inisial N/F.

## Files
- `designs/DompetKu HP 1 Beranda Catat.dc.html`: B1–B7, C1–C5
- `designs/DompetKu HP 2 Transaksi Dompet Auth.dc.html`: T1–T5, D1–D4, W1–W4, R1, A1–A4
- `designs/DompetKu Laptop Tablet.dc.html`: L1–L6, X1
- `designs/DompetKu Tema Terang.dc.html`: G1–G10
- `designs/DompetKu Spesifikasi.dc.html`: tabel token + kontras, skala, contoh komponen × keadaan (default, hover, aktif, fokus, nonaktif) di kedua tema
- `designs/DompetKu Arah Visual.dc.html`: tiga arah awal (yang dipilih 1b)
- `designs/support.js`: runtime untuk membuka berkas `.dc.html`
- `dompetku-tokens.css`: token siap pasang
- `ref/batasan.md`, `ref/layar.md`, `ref/contoh-data.json`: brief dan data sumber
