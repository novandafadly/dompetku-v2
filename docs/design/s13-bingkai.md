# Bingkai desain S13 (tujuan tabungan, 1 dompet = 1 tujuan aktif)

Gerbang awal S13 (IPD §6 S13; plan `docs/superpowers/plans/2026-11-15-dompetku-v2-s13-tujuan-tabungan.md` Task 1). Ditulis agen mengikuti Panel Malam (`DESIGN.md`, token `apps/web/src/styles/tokens.css`) dan format `docs/design/s12-bingkai.md`. Keputusan K1 sampai K10 di plan mengikat: pemilik menyetujui rekomendasi (2026-11-15, `docs/m0a-keputusan.md` "S13"), K9 tetap **[konfirmasi pemilik]**. ID `S13-TJ*` dirujuk Task 4, 5, 6, 7. Semua bingkai hanya untuk **mode nyata**; prototipe (`NEXT_PUBLIC_PROTOTYPE=1`) tidak berubah.

## Fakta kode yang membentuk bingkai

Diperiksa di `main` `e68f948`. Nomor baris yang disebut plan dicocokkan; koreksi ditulis.

- **Pocket tidak bisa diubah sesudah dompet dibuat:** tidak ada `api.update_account` atau fungsi lain yang menulis `app.accounts.pocket` atau `name`. Satu-satunya `update app.accounts` di seluruh migrasi adalah arsip (`0103_ledger_api.sql:571`). Akibat: dompet operasional tidak bisa "dijadikan" tabungan; pengguna yang ingin tujuan di dompet operasional harus membuat dompet tabungan baru dan memindahkan isinya dengan Transfer. Sheet Tambah tujuan harus menjelaskan ini (S13-TJ4).
- **Dompet tidak bisa dipulihkan dari arsip:** tidak ada fungsi yang mengosongkan `archived_at`; kartu `Diarsipkan` di daftar Dompet tidak punya aksi pulihkan (`features/dompet/archived-accounts.tsx`, S7-W3). Akibat: tujuan yang dompetnya terarsip tidak bisa dipulihkan (`restore_goal` → `account_archived`, K7) dan UI tidak boleh menawarkan `Pulihkan` untuknya (S13-TJ8).
- **Arsip dompet butuh saldo 0:** `api.archive_account` (`0103_ledger_api.sql:559`, cek `balance_not_zero` di `:568–570`; plan menulis `0103:559` = baris `create function`, cocok). Tidak pernah diganti di migrasi sesudahnya. UI Detail dompet merender `ArchiveIsland` hanya bila saldo 0, selain itu `ArchiveBlockedCard` (`app/[ruang]/_real/dompet-detail.tsx:193–206`). Akibat: tolakan `account_has_goal` (K6) hanya muncul untuk dompet tabungan **bersaldo 0** yang masih punya tujuan aktif (tujuan baru, belum diisi, atau isinya sudah dipindah). Dompet bertujuan yang berisi saldo sudah tertahan oleh kartu saldo yang ada.
- **Segmen Rencana:** tipe `Bagian`/`Segment` di `app/[ruang]/_real/rencana.tsx:58–60`, komponen `Segmen` di `:92–114` (plan menulis `:58–97`; isi sama, komponen berakhir di `:114`). Segmen = tautan `?bagian=` dengan `aria-current="page"`, tanpa JS. `Utang` hanya di Pribadi; `page.tsx` memuat Utang lewat cabang sendiri (`UtangSection`, `loadUtang`) sehingga galat Utang tidak merusak Anggaran/Tagihan. Tujuan memakai pola yang sama (`?bagian=tujuan`, loader sendiri). Gaya item: `segmentItem` = `flex-1 min-w-0 px-3 text-label` (`components/ui/segment-styles.ts`), lihat kendala 320 px di S13-TJ1.
- **Kekayaan bersih dihitung UI:** `features/dompet/account-list-view.tsx:106–108` menjumlah saldo semua dompet kecuali `kantor` dan `patungan` (cocok dengan plan `:106`). Dompet tabungan sudah ikut; tujuan tidak mengubahnya (K9c). `api.net_worth` (`0134_modal_trading.sql:183`) tidak dipakai web.
- **"Aman dipakai" hanya operasional:** `0120_aman_dipakai.sql:46–49` (`ab.pocket = 'operasional' and a.archived_at is null`; plan `0120:49` = baris `where`, cocok). Dompet tabungan tidak pernah ikut, jadi tujuan tidak bisa menggeser angka ini.
- **Periode gajian:** `app.pay_period(p_space_id, p_on)` di `0116_periode_gajian.sql:157` (cocok). Hari gajian dibaca dari `app.households.payday_rule` per ruang (bukan konstanta 25; 25 adalah nilai yang diisi pemilik), mundur ke hari kerja sebelumnya bila libur (`app.effective_payday`, `app.holidays`); `payday_rule` null = bulan kalender. `app.period_of_label` memberi rentang per label bulan, jadi `periods_left` (K5) bisa dihitung sebagai selisih label bulan periode berjalan dan periode yang memuat `target_on`, plus 1. Label periode = bulan **sesudah** gajian (periode 25 Nov–24 Des berlabel Desember), penting untuk salinan "sampai {tanggal}" yang memakai tanggal target, bukan label periode.
- **Baris dompet:** `components/ui/wallet-row.tsx` sudah membatasi nama ke dua baris (`line-clamp-2` + `title`); di bawah 360 px saldo turun ke baris kedua. Baris terpanjang hari ini = nama 2 baris + tipe + saldo = 4 baris (utang S6 "empat baris"). Teks tujuan menambah satu baris lagi, jadi S13-TJ10 menggantikan baris tipe, bukan menambah baris.
- **Detail dompet** punya slot `afterHero` (dipakai `ModalCard` S12-TR3) dan `actions`/`footer` (`dompet-detail.tsx:144–206`): kartu tujuan masuk `afterHero`, tolakan arsip masuk `footer`.
- **Sheet Tambah dompet** (`features/dompet/add-account-sheet.tsx:89–92`) menawarkan `tabungan` di kedua ruang; tidak punya prasetel pocket. S13 tidak menambahkannya (lihat "Dampak ke task lain" butir 5).
- **Pola UI yang dipakai ulang:** `ListCard`, `EmptyState`/`ErrorState`/`CardError`, `Sheet` + `SpaceTag`, `ConfirmDialog` (`tone="primary"` untuk aksi bukan pembatalan, fokus awal `Kembali`, `alert`, `confirmDisabled`), `TextField`, `MoneyInput`, `SelectField`, `DateInput` (`features/utang/fields.tsx`, teks tanggal pasti di bawah isian), `MoneyText`, `Toast` + `Urungkan`, `segmentTrack`/`segmentItem`, `ArchiveBlockedCard`, `ArchiveWalletDialog` (`archiveFailedText`). Ikon yang sudah ada dan cukup: `flag-banner` (tujuan), `check-circle`, `clock`, `info`, `archive`, `arrow-counter-clockwise`, `pencil-simple`, `plus`, `caret-right`, `caret-down`, `wallet`. **Tidak ada ikon baru.**
- **Bilah progres yang ada** (`features/rencana/budget-row-view.tsx` `Bar`) berwarna menurut tingkat (`chart-aman`/`warning`/`danger`) dan `aria-hidden`. Bilah tujuan **tidak** memakai komponen itu: satu warna (warna ruang) dan `role="progressbar"`.
- **Budget JS (batas 162 kB):** Rencana nyata 150,5, Dompet 153,2 (CLAUDE.md, S11/S12). Kartu tujuan = Server Component; sheet dan dialog = satu pulau malas `tujuan-client`.

## Aturan bersama

Aturan S6 sampai S12 berlaku (ruang tertulis di judul sheet dan toast; status = ikon + teks; target ≥ 44 dan jarak ≥ 8; 320 px tanpa gulir horizontal termasuk `Rp 12.345.678.900`; salinan galat **tanpa nominal**; tanpa tanda seru; tanpa "rumah tangga"). Tambahan S13:

1. **Istilah `Tujuan`, tidak pernah "Goal"** (juga tidak di `aria-label`, `title`, atau nama toast). Kata kerja: `Tambah tujuan`, `Ubah tujuan`, `Selesaikan tujuan`, `Arsipkan tujuan`, `Pulihkan`. Uang masuk ke dompet tujuan disebut `setor` hanya di penjelasan; tidak ada tombol "Setor ke tujuan" (setor = Transfer biasa, K2).
2. **Tanpa merah untuk progres rendah.** Bilah selalu satu warna ruang (Pribadi `pribadi`, Bersama `bersama`; token teks ruang, ≥ 3:1 terhadap `surface-2` di kedua tema). Persen dan nominal `text`. `danger` hanya untuk pesan galat; `Lewat tanggal target` netral (`text-soft` + ikon `clock`), bukan peringatan.
3. **Tanpa "Rp 0" sebagai pencapaian.** Bila `saved` = 0 (dompet kosong atau saldo minus), angka besar diganti kalimat `Belum ada yang terkumpul`; tidak ada baris `Rp 0 dari …`. Bila `saved` > 0 tetapi `pct` = 0 (kurang dari 1%), teks persen `Kurang dari 1%`, bukan `0%`.
4. **Tanpa perayaan.** Tidak ada confetti, animasi, emoji, atau tanda seru saat tercapai; cukup status `Tercapai` (ikon `check-circle` fill + teks) dan aksi `Selesaikan tujuan`.
5. **Angka dari SQL.** `saved`, `remaining`, `pct`, `reached`, `periods_left`, `per_period` datang dari `app.goal_progress` lewat `api.list_goals`/`api.goal_for_account`. UI hanya memilih kalimat dari nilai itu (perbandingan dengan 0/null boleh), tidak menjumlah, mengurangi, membagi, atau membulatkan.
6. **Tujuan bukan dompet.** Kartu tujuan tidak menampilkan saldo dompet sebagai angka terpisah dari `saved` (keduanya sama kecuali saldo minus); riwayat uang tetap di Detail dompet.

## Rencana: segmen Tujuan

### S13-TJ1 · Segmen `Tujuan`

- **Urutan (K8):** Pribadi `Anggaran · Tagihan · Tujuan · Utang`; Bersama `Anggaran · Tagihan · Tujuan`. Tautan `?bagian=tujuan`, `aria-current="page"`, tanpa JS (pola `Segmen`). Di Bersama `?bagian=utang` tetap jatuh ke Anggaran (aturan S11 tidak berubah).
- **Kendala 320 px (nyata, Pribadi):** empat item `flex-1` di lebar 288 px = ±70 px per item; dikurangi `px-3` (24 px) tinggal ±46 px untuk teks, sedangkan `Anggaran` 14/600 Plus Jakarta Sans ±62 px (perkiraan, belum diukur). Hari ini tiga item muat (±94 px per item). Keputusan bingkai: di bawah `narrow` (360 px) item segmen Rencana memakai `px-1` dan `text-meta` (13); target tetap `h-11`. Task 4 **mengukur** di 320 (tes e2e: `scrollWidth <= clientWidth` per item dan screenshot). Bila masih terpotong, segmen menjadi grid 2×2 di bawah 360 (`grid grid-cols-2`, setiap item 44 tinggi, jarak 2), bukan gulir horizontal dan bukan elipsis. Ubah `segment-styles.ts` dan `segmented-control.tsx` bersama (komentar berkas).
- **Loader sendiri:** `?bagian=tujuan` memuat `api.list_goals` + daftar dompet tabungan ruang (untuk pemilih), terpisah dari `loadRencana`; galat tujuan tidak merusak Anggaran/Tagihan.

### S13-TJ2 · Daftar tujuan (keadaan)

Tata letak HP satu kolom, laptop `laptop:max-w-180` (sama dengan Rencana). Urutan DOM: `h2` `Tujuan` 18/800 + tombol `Tambah tujuan` → kartu tujuan aktif → `details` `Selesai dan diarsipkan`.

- **Tombol `Tambah tujuan`:** sekunder 44 penuh di HP (ikon `plus` bold), di laptop di kanan `h2`. Hanya tampil bila ada ≥ 1 dompet tabungan aktif tanpa tujuan aktif. Bila semua dompet tabungan sudah bertujuan: tombol diganti kalimat 13/500 `text-soft` + ikon `info` 16 `Semua dompet tabungan sudah punya tujuan. Selesaikan atau arsipkan salah satunya, atau tambah dompet tabungan baru.` + tautan teks 44 `Tambah dompet tabungan`.
- **Kosong, belum ada dompet tabungan:** `EmptyState` (ikon `flag-banner` 26) `Belum ada dompet tabungan.` / `Tujuan menempel pada satu dompet tabungan. Progresnya mengikuti saldo dompet itu.` / aksi primer 48 `Tambah dompet tabungan` (tautan ke `/{ruang}/dompet`; sheet Tambah dompet di sana). Tidak membuka sheet Tambah tujuan yang kosong.
- **Kosong, ada dompet tabungan, belum ada tujuan:** `EmptyState` (ikon `flag-banner` 26) `Belum ada tujuan.` / `Pilih dompet tabungan, isi target, dan lihat progresnya dari saldo dompet itu.` / aksi primer 48 `Tambah tujuan`.
- **Satu tujuan:** satu kartu S13-TJ3 penuh lebar.
- **Banyak tujuan:** kartu bertumpuk jarak 12 (laptop 16), urutan dari SQL (usulan Task 3: tercapai dulu, lalu `target_on` terdekat, lalu tanpa tanggal, lalu `created_at`). Tidak ada ringkasan total semua tujuan (menjumlah lintas tujuan = angka baru tanpa makna; bila perlu, dari SQL di S14).
- **`Selesai dan diarsipkan ({n})`:** `details` terlipat (pola `Lunas ({n})` S11), hanya bila n > 0. Baris (≥ 64): ikon `check-circle` (selesai) atau `archive` (diarsip) 20 di ubin 40, nama 15/600 `line-clamp-2`, meta 13/500 `text-muted` `Selesai {tgl} · {dompet} · target Rp …` atau `Diarsipkan {tgl} · {dompet}`; kolom kanan `Pulihkan` (S13-TJ8). **Tanpa bilah dan tanpa persen** (progres live dari saldo hari ini akan menyesatkan untuk tujuan yang sudah ditutup; tidak ada snapshot, K2).
- **Memuat:** `Memuat tujuan…` + kerangka dua kartu (tinggi kartu tetap, tanpa lompatan).
- **Galat:** `ErrorState` `Tujuan belum bisa dimuat.` / `Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.` + `Coba lagi`.

### S13-TJ3 · Kartu progres tujuan (komponen bersama Rencana dan Detail dompet)

Server Component, `section` kartu radius 16, garis `hairline`, tanpa bayangan, padding 16 (laptop 20). `aria-labelledby` = id nama tujuan.

- **Baris 1:** ikon `flag-banner` 18 `text-soft` + nama tujuan `h3` 15/700 `line-clamp-2 break-words` (`title` = nama lengkap); di kanan status (bila ada) ikon + teks 13/700.
- **Baris 2 (meta):** `{dompet}` 13/500 `text-muted` dengan ikon `wallet` 14 (truncate satu baris + `title`); di Bersama dua anggota disusul ` · Dibuat {nama}` (S13-TJ12).
- **Baris 3 (angka):** `MoneyText` `saved` 22/800 + ` dari Rp {target}` 13/600 `text-soft` (boleh turun ke baris sendiri di 320, nominal `whitespace-nowrap`); di kanan persen 15/700 `num` (`45%`). Angka besar dan persen di satu baris flex-wrap; persen tidak pernah terdorong keluar.
- **Baris 4 (bilah):** tinggi 8, radius 4, jalur `surface-2` dengan garis `hairline`, isi warna ruang selebar `pct`% (0 = jalur kosong). `role="progressbar"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow={pct}`, `aria-labelledby` nama tujuan, `aria-valuetext` `{pct} persen, Rp {saved} dari Rp {target}` (atau `Belum ada yang terkumpul dari Rp {target}`). Persen juga tampil sebagai teks (baris 3), jadi warna dan panjang bilah tidak pernah satu-satunya sumber.
- **Baris 5 (sub, 13/500 `text-soft`):** `Sisa Rp {remaining}`; bila `per_period` tidak null, baris berikut `Perlu Rp {per_period}/bulan sampai {target_on}` (tanggal `d MMM yyyy`, mis. `25 Mar 2027`); bila `periods_left` = 1: `Perlu Rp {per_period} sampai {target_on}` (tanpa `/bulan`, karena satu periode tersisa). Tanpa `target_on`: hanya `Sisa`.
- **Baris aksi:** flex-wrap jarak 8: tombol teks 44 `Ubah` (ikon `pencil-simple`), `Arsipkan` (ikon `archive`), dan di Rencana tautan teks 44 `Lihat dompet` (ke Detail dompet). Nama aksesibel memuat nama tujuan bila ada lebih dari satu kartu (`Ubah tujuan Dana darurat`, Label in Name: teks tampak `Ubah` adalah awal nama).

**Keadaan kartu:**

| Keadaan                                                             | Status (kanan baris 1)                                   | Baris 3                                                                   | Baris 5                                                                                                                         | Aksi tambahan                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Berjalan, ada tanggal                                               | tidak ada                                                | `Rp 4.500.000 dari Rp 10.000.000` · `45%`                                 | `Sisa Rp 5.500.000` / `Perlu Rp 1.375.000/bulan sampai 25 Mar 2027`                                                             | tidak ada                                                           |
| Berjalan, tanpa tanggal                                             | tidak ada                                                | sama                                                                      | `Sisa Rp …`                                                                                                                     | tidak ada                                                           |
| `saved` > 0, `pct` = 0                                              | tidak ada                                                | `Rp 50.000 dari Rp 10.000.000` · `Kurang dari 1%`                         | sama                                                                                                                            | tidak ada                                                           |
| Saldo 0                                                             | tidak ada                                                | `Belum ada yang terkumpul` 15/600 `text-soft` · `0%`; baris `Target Rp …` | `Isi lewat Transfer ke {dompet}.` (+ `Perlu …` bila ada tanggal)                                                                | tidak ada                                                           |
| Saldo minus                                                         | tidak ada                                                | sama dengan saldo 0                                                       | ikon `info` 14 + `Saldo {dompet} sedang minus, jadi progres dihitung 0%.` (+ `Perlu …`)                                         | tidak ada                                                           |
| **`Tercapai`** (`reached`, menang atas Lewat tanggal)               | ikon `check-circle` fill 16 + `Tercapai` (`accent-text`) | `Rp 10.250.000 dari Rp 10.000.000` · `100%` (bilah penuh)                 | `Selesaikan supaya {dompet} bisa dipakai untuk tujuan baru.` (tanpa `Sisa`, tanpa `Perlu`, tanpa "lebih Rp …")                  | tombol sekunder 44 `Selesaikan tujuan` di awal baris aksi (S13-TJ6) |
| **`Lewat tanggal target`** (`target_on` < hari ini, belum tercapai) | ikon `clock` 16 + `Lewat tanggal target` (`text-soft`)   | angka seperti biasa                                                       | `Sisa Rp …` / `Target {target_on} sudah lewat. Ubah tanggal atau hapus tanggalnya.` (tanpa `Perlu`, `per_period` null dari SQL) | tidak ada (`Ubah` sudah ada)                                        |

### S13-TJ4 · Sheet `Tambah tujuan · {Ruang}` (pulau malas)

- **Masuk dari:** tombol `Tambah tujuan` (TJ2), `Buat tujuan` di Detail dompet (TJ9, dompet terkunci).
- **Tata letak:** `Sheet` + `SpaceTag`; laptop dialog tengah 520. Isian berurutan:
  1. **`Nama tujuan`** (`TextField`, fokus awal, maks 60, hitungan sisa huruf mulai 50; contoh di petunjuk 13/500 `text-soft`: `Misalnya Dana darurat atau Liburan Desember.`, bukan placeholder).
  2. **`Target`** (`MoneyInput`, > 0).
  3. **`Dompet tabungan`** (`SelectField`): hanya dompet `tabungan` aktif ruang ini **tanpa** tujuan aktif, label opsi `{nama}` (nama 60 huruf terpotong + `title`). Satu pilihan = terisi otomatis. Dari Detail dompet: teks terkunci `Dompet: {nama}` (bukan select). Di bawahnya, satu kalimat 13/500 `text-soft` dari saldo yang sudah dimuat: saldo > 0 `Sudah ada Rp {saldo} di {dompet}. Progres dimulai dari saldo ini.`; saldo ≤ 0 `{dompet} masih kosong. Isi lewat Transfer kapan saja.` Lalu petunjuk tetap 12/500 `text-muted`: `Hanya dompet tabungan yang bisa punya tujuan. Untuk dompet lain, buat dompet tabungan lalu pindahkan isinya.` (fakta: pocket tidak bisa diubah).
  4. **`Tanggal target (opsional)`** (`DateInput`, `min` = hari ini WIB, `max` = hari ini + 50 tahun), teks pasti di bawah (`Belum diisi` / `25 Mar 2027`), petunjuk `Kosongkan bila tidak ada tenggat. Dengan tanggal, DompetKu menghitung berapa perlu disisihkan per bulan.`
- **Tanpa pratinjau `Perlu Rp …/bulan` di sheet** (butuh pembagian di UI, aturan 5); angka muncul di kartu sesudah simpan.
- **Keadaan pemilih kosong** (sheet terbuka tetapi dompet terakhir baru saja dipakai tujuan lain): ganti isian 3 dengan kalimat TJ2 `Semua dompet tabungan sudah punya tujuan. …` dan tombol simpan `aria-disabled`.
- **Footer:** `Simpan tujuan` (primer 48, spinner `Menyimpan…`, `aria-disabled` selama sibuk). `clientId` lahir saat sheet dibuka (pola Tambah dompet).
- **Toast:** `Tujuan {nama} dibuat di {Ruang}` (tanpa `Urungkan`; arsipkan bila keliru). Fokus kembali ke `Tambah tujuan` atau ke kartu baru (`h3` dengan `tabIndex=-1`, pola `focus-title`).

### S13-TJ5 · Sheet `Ubah tujuan · {Ruang}`

- Isian: `Nama tujuan`, `Target`, `Tanggal target (opsional)` dengan tombol teks 44 `Hapus tanggal` bila terisi. Dompet tampil terkunci: `Dompet: {nama}` + 12/500 `text-muted` `Dompet tidak bisa diganti. Arsipkan tujuan ini lalu buat tujuan baru di dompet lain.` (K7).
- Tujuan dengan tanggal yang sudah lewat: `DateInput` menampilkan tanggal lama apa adanya; menyimpan nama/target saja **tidak** boleh ditolak (lihat "Dampak ke task lain" butir 2). Mengganti ke tanggal lampau lain ditolak di kolom (`goal_target_past`).
- Footer `Simpan perubahan` (primer 48). Tanpa perubahan: tombol tetap aktif, menyimpan = no-op server, sheet tertutup tanpa toast.
- Toast: `Tujuan {nama} diperbarui di {Ruang}`.

### S13-TJ6 · Dialog `Selesaikan tujuan?`

- Hanya dari kartu `Tercapai`. `ConfirmDialog` `tone="primary"`, ikon `check-circle` 22.
- **Judul:** `Selesaikan {nama}?` **Isi:** `Tujuan pindah ke Selesai dan diarsipkan. Saldo {dompet} tidak berubah, dan {dompet} bisa dipakai untuk tujuan baru.`
- **Tombol:** `Selesaikan` (primer), `Kembali` (fokus awal).
- **Toast:** `Tujuan {nama} selesai` + `Urungkan` (= `restore_goal`). Tidak ada perayaan.
- **Galat `goal_not_reached`** (saldo turun sebelum konfirmasi): `alert` di dialog `Saldo {dompet} sudah di bawah target lagi. Muat ulang halaman.`, `confirmDisabled`.

### S13-TJ7 · Dialog `Arsipkan tujuan?`

- Dari kartu mana pun (aktif atau tercapai). `ConfirmDialog` `tone="primary"` (bisa dipulihkan, bukan penghapusan), ikon `archive` 22.
- **Judul:** `Arsipkan {nama}?` **Isi:** `Tujuan berhenti dilacak. Saldo {dompet} tidak berubah. Kamu bisa memulihkannya dari Selesai dan diarsipkan.` Bersama, tambahan satu paragraf: `Tujuan ini juga hilang dari Rencana {nama anggota lain}.` (solo: tidak ada).
- **Tombol:** `Arsipkan` (primer), `Kembali` (fokus awal). Toast `Tujuan {nama} diarsipkan` + `Urungkan` (= `restore_goal`).

### S13-TJ8 · `Pulihkan` (baris Selesai dan diarsipkan)

- Tombol sekunder 44 `Pulihkan` (nama aksesibel `Pulihkan tujuan {nama}`). Langsung jalan (tanpa dialog), toast `Tujuan {nama} aktif lagi`.
- **Tidak dirender** bila dompetnya terarsip; baris menampilkan meta tambahan `Dompet sudah diarsipkan` (ikon `info` 14, `text-muted`), karena dompet tidak bisa dipulihkan.
- **Dompet sudah punya tujuan aktif lain:** tombol tetap ada (data bisa berubah sejak halaman dimuat); tolakan `goal_exists` tampil di baris 13/600 `text-text` + ikon `info`: `{dompet} sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.` (`role="status"`). Bila loader sudah tahu (dompet ini dipakai tujuan aktif lain), tombol diganti kalimat itu sejak awal.

## Dompet

### S13-TJ9 · Kartu tujuan di Detail dompet tabungan

- **Posisi:** slot `afterHero` (di bawah kartu saldo, sebelum aksi), sama dengan kartu Modal S12-TR3.
- **Dompet tabungan dengan tujuan aktif:** kartu TJ3 tanpa `Lihat dompet`, ditambah tautan teks 44 `Lihat semua tujuan` (ke `/{ruang}/rencana?bagian=tujuan`).
- **Dompet tabungan tanpa tujuan aktif, tidak terarsip:** kartu tipis (`card`, padding 16) ikon `flag-banner` 18 + `Belum ada tujuan untuk {dompet}.` 15/600 + 13/500 `text-soft` `Pasang target, dan progresnya mengikuti saldo dompet ini.` + tombol sekunder 44 `Buat tujuan` (membuka TJ4 dengan dompet terkunci).
- **Dompet non-tabungan atau terarsip:** tidak ada apa pun (tanpa ajakan, tanpa teks "tidak bisa").
- **Galat loader tujuan:** `CardError` `Tujuan belum bisa dimuat.` + `Coba lagi`; saldo dan riwayat tetap tampil.
- Saldo, riwayat, `Cocokkan saldo`, dan `Ubah saldo awal` tidak berubah.

### S13-TJ10 · Teks tujuan di daftar Dompet

- Baris dompet tabungan dengan tujuan aktif: baris tipe (`Bank`, `E-wallet`, …) **diganti** `{nama tujuan} · {pct}%` 13/500 `text-soft` (satu baris `truncate`, persen dalam `span` `shrink-0` sehingga persen tidak pernah terpotong; nama tujuan lengkap di `title` dan teks `sr-only`). `Tercapai`: `{nama tujuan} · Tercapai` (ikon `check-circle` fill 12 + teks). Saldo 0/minus: `{nama tujuan} · 0%` (satu-satunya tempat `0%` tanpa kalimat, karena saldo di kanan baris sudah menjelaskan).
- Tanpa bilah, tanpa ikon baru, tinggi baris tidak bertambah (nama tetap ≤ 2 baris, `WalletRow`). Tipe dompet tetap terbaca dari ikon ubin dan di Detail dompet.
- `pct` dari loader daftar Dompet (gabung `app.goal_progress` per `account_id`, satu kueri), bukan dihitung UI. Kekayaan bersih, subtotal kelompok, dan urutan tidak berubah.

### S13-TJ11 · Arsip dompet bertujuan ditolak

- **Detail dompet tabungan bersaldo 0 dengan tujuan aktif:** `ArchiveIsland` **tidak** dirender; `footer` memuat `ArchiveBlockedCard` varian tujuan: `{dompet} masih punya tujuan aktif {nama tujuan}. Selesaikan atau arsipkan tujuannya dulu, lalu arsipkan dompet ini.` + tautan teks 44 `Lihat tujuan` (ke Rencana `?bagian=tujuan`). Urutan bila saldo ≠ 0 **dan** ada tujuan aktif: pesan saldo yang ada lebih dulu (tombol arsip memang tidak dirender karena saldo; server juga menolak tujuan lebih dulu, tetapi pengguna tetap harus memindahkan saldo).
- **Balapan** (tujuan dibuat di tab lain sesudah dialog arsip dibuka): `archiveFailedText` mendapat cabang `account_has_goal`: `{dompet} masih punya tujuan aktif, jadi belum bisa diarsipkan. Selesaikan atau arsipkan tujuannya dulu.`, `confirmDisabled`.

## Bersama

### S13-TJ12 · Tujuan di Bersama (K1)

- Semua anggota boleh membuat, mengubah, menyelesaikan, mengarsipkan, dan memulihkan (pola anggaran). Tidak ada kunci "hanya pembuat".
- **Siapa yang membuat tampil:** ya, di Bersama dua anggota saja, sebagai meta kartu ` · Dibuat {nama}` (nama anggota, termasuk penonton sendiri, pola `Dibayar Novanda` S12) dan di baris terlipat. Bersama solo dan Pribadi: tidak tampil. Siapa yang terakhir mengubah: tidak tampil (S13 tidak punya feed tujuan).
- **Setor dari Pribadi:** dompet tabungan Bersama diisi lewat `space_transfer` dari dompet Pribadi (fitur S7). Kaki masuk berkelas `x_setoran_anggota`, jadi **ikut Kontribusi S8** penyetor; itu benar (uang memang disetor ke Bersama) dan bingkai tidak mengubahnya. Kartu tujuan tidak menyebut siapa menyetor berapa (tidak ada rincian per anggota di S13).
- **Privasi:** tujuan Pribadi tidak pernah tampil di Bersama atau ke pasangan; kartu Bersama tidak menyebut nama dompet Pribadi siapa pun. Toast dan judul sheet selalu `· Bersama`.
- **Bersama tanpa dompet** (S7-B2): keadaan TJ2 "belum ada dompet tabungan".

## Salinan galat S13 (tanpa nominal)

| Kode                             | Tempat                                   | Teks                                                                                                      |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `goal_exists` (DK409)            | kolom Dompet (Tambah) / baris (Pulihkan) | `{dompet} sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.`                            |
| `goal_pocket_invalid`            | kolom Dompet                             | `Hanya dompet tabungan yang bisa punya tujuan.`                                                           |
| `account_archived`               | kolom Dompet / baris (Pulihkan)          | `Dompet ini sudah diarsipkan. Pilih dompet tabungan lain.` / `Dompet sudah diarsipkan`                    |
| `account_has_goal`               | dialog arsip dompet                      | `{dompet} masih punya tujuan aktif, jadi belum bisa diarsipkan. Selesaikan atau arsipkan tujuannya dulu.` |
| `goal_not_reached`               | dialog Selesaikan                        | `Saldo {dompet} sudah di bawah target lagi. Muat ulang halaman.`                                          |
| `goal_not_active`                | kotak atas sheet/dialog                  | `Tujuan ini sudah tidak aktif. Muat ulang halaman.`                                                       |
| `goal_target_past`               | kolom Tanggal target                     | `Tanggal target tidak boleh sebelum hari ini.`                                                            |
| `goal_not_found` (DK404)         | kotak atas                               | `Tujuan ini tidak ditemukan. Muat ulang halaman.`                                                         |
| `invalid_argument/name`          | kolom Nama                               | `Nama tujuan wajib diisi, paling banyak 60 huruf.`                                                        |
| `invalid_argument/target_amount` | kolom Target                             | `Target harus lebih dari nol dan masuk akal.`                                                             |
| `invalid_argument/target_on`     | kolom Tanggal target                     | `Tanggal target tidak valid.`                                                                             |
| jaringan/`unknown`               | kotak atas sheet                         | `Belum berhasil. Sambungan ke server terputus. Coba lagi.`                                                |
| loader                           | `ErrorState`/`CardError`                 | `Tujuan belum bisa dimuat.`                                                                               |

Nama dompet dan nama tujuan di teks UI disusun klien dari data yang sudah dimuat; pesan galat DB, log, `job_runs`, dan alert tidak memuat nominal, nama dompet, atau nama tujuan (Global Constraints).

## Salinan final S13 (mengikat Task 4, 5, 6)

| Bingkai  | Teks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TJ1–TJ2  | `Tujuan`; `Tambah tujuan`; `Semua dompet tabungan sudah punya tujuan. Selesaikan atau arsipkan salah satunya, atau tambah dompet tabungan baru.`; `Tambah dompet tabungan`; `Belum ada dompet tabungan.`; `Tujuan menempel pada satu dompet tabungan. Progresnya mengikuti saldo dompet itu.`; `Belum ada tujuan.`; `Pilih dompet tabungan, isi target, dan lihat progresnya dari saldo dompet itu.`; `Selesai dan diarsipkan ({n})`; `Selesai {tgl}`; `Diarsipkan {tgl}`; `target Rp …`; `Memuat tujuan…`; `Tujuan belum bisa dimuat.`                                                                                                                                                                                                                                                                |
| TJ3      | `{saved} dari Rp {target}`; `{pct}%`; `Kurang dari 1%`; `Belum ada yang terkumpul`; `Target Rp …`; `Sisa Rp …`; `Perlu Rp …/bulan sampai {tgl}`; `Perlu Rp … sampai {tgl}`; `Isi lewat Transfer ke {dompet}.`; `Saldo {dompet} sedang minus, jadi progres dihitung 0%.`; `Tercapai`; `Selesaikan supaya {dompet} bisa dipakai untuk tujuan baru.`; `Selesaikan tujuan`; `Lewat tanggal target`; `Target {tgl} sudah lewat. Ubah tanggal atau hapus tanggalnya.`; `Ubah`; `Arsipkan`; `Lihat dompet`; `Dibuat {nama}`; `{pct} persen, Rp … dari Rp …`                                                                                                                                                                                                                                                   |
| TJ4–TJ5  | `Tambah tujuan · {Ruang}`; `Ubah tujuan · {Ruang}`; `Nama tujuan`; `Misalnya Dana darurat atau Liburan Desember.`; `Target`; `Dompet tabungan`; `Dompet: {nama}`; `Sudah ada Rp … di {dompet}. Progres dimulai dari saldo ini.`; `{dompet} masih kosong. Isi lewat Transfer kapan saja.`; `Hanya dompet tabungan yang bisa punya tujuan. Untuk dompet lain, buat dompet tabungan lalu pindahkan isinya.`; `Tanggal target (opsional)`; `Belum diisi`; `Kosongkan bila tidak ada tenggat. Dengan tanggal, DompetKu menghitung berapa perlu disisihkan per bulan.`; `Hapus tanggal`; `Dompet tidak bisa diganti. Arsipkan tujuan ini lalu buat tujuan baru di dompet lain.`; `Simpan tujuan`; `Simpan perubahan`; `Menyimpan…`; `Tujuan {nama} dibuat di {Ruang}`; `Tujuan {nama} diperbarui di {Ruang}` |
| TJ6–TJ8  | `Selesaikan {nama}?`; `Tujuan pindah ke Selesai dan diarsipkan. Saldo {dompet} tidak berubah, dan {dompet} bisa dipakai untuk tujuan baru.`; `Selesaikan`; `Kembali`; `Tujuan {nama} selesai`; `Urungkan`; `Arsipkan {nama}?`; `Tujuan berhenti dilacak. Saldo {dompet} tidak berubah. Kamu bisa memulihkannya dari Selesai dan diarsipkan.`; `Tujuan ini juga hilang dari Rencana {nama}.`; `Tujuan {nama} diarsipkan`; `Pulihkan`; `Pulihkan tujuan {nama}`; `Tujuan {nama} aktif lagi`; `Dompet sudah diarsipkan`                                                                                                                                                                                                                                                                                   |
| TJ9–TJ11 | `Lihat semua tujuan`; `Belum ada tujuan untuk {dompet}.`; `Pasang target, dan progresnya mengikuti saldo dompet ini.`; `Buat tujuan`; `{nama tujuan} · {pct}%`; `{nama tujuan} · Tercapai`; `{dompet} masih punya tujuan aktif {nama tujuan}. Selesaikan atau arsipkan tujuannya dulu, lalu arsipkan dompet ini.`; `Lihat tujuan`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Ukuran layar dan tema

- **320 (HP kecil):** segmen empat item Pribadi (TJ1, ukur); kartu TJ3 dengan nama 60 huruf (2 baris) dan `Rp 12.345.678.900 dari Rp 12.345.678.900` (angka besar dan `dari …` di dua baris, persen tetap di kanan baris angka atau turun ke baris sendiri rata kanan); `Perlu Rp 12.345.678.900/bulan sampai 25 Mar 2027` membungkus di spasi, tidak di tengah nominal; baris aksi membungkus 2 baris tanpa tumpang; sheet penuh layar dengan footer menempel; daftar Dompet nama 60 huruf + teks tujuan tanpa baris kelima.
- **390 (HP umum):** semua keadaan TJ3 (tabel), keadaan kosong dua jenis, `Selesai dan diarsipkan` terbuka, sheet Tambah dengan pemilih tiga dompet dan dengan pemilih kosong.
- **1280 (laptop):** Rencana satu kolom `max-w-180` di bawah header; tombol `Tambah tujuan` di kanan `h2`; sheet menjadi dialog tengah 520; Detail dompet dengan kartu tujuan di kolom yang sama dengan kartu saldo.
- **Tema:** gelap (bawaan) dan terang. Terang: isi bilah `pribadi` `#4A6A0F` / `bersama` `#5B45C9` di jalur `surface-2` `#EBEFEA`; lime tidak pernah jadi teks (`Tercapai` memakai `accent-text`); tombol primer dengan garis `accent-edge`. Uji kontras bilah ≥ 3:1 (komponen non-teks) di kedua tema; tambahkan pasangan ke `contrast.test.ts` bila belum ada.

## Target sentuh, urutan fokus, nama aksesibel

- Semua kontrol ≥ 44 dengan jarak ≥ 8: segmen (44), `Tambah tujuan` (44/48), `Ubah`/`Arsipkan`/`Lihat dompet`/`Selesaikan tujuan` (44), `Pulihkan` (44), `Hapus tanggal` (44), `Buat tujuan` (44), `Lihat tujuan`/`Lihat semua tujuan` (44), footer sheet (48).
- Urutan DOM = urutan baca = urutan fokus. **Rencana Tujuan:** segmen → `Tambah tujuan` → per kartu (`Selesaikan tujuan` bila ada → `Ubah` → `Arsipkan` → `Lihat dompet`) → `Selesai dan diarsipkan` (ringkasan → `Pulihkan` per baris). **Sheet Tambah:** Nama → Target → Dompet → Tanggal → Simpan. **Detail dompet:** BackLink → kartu saldo → kartu tujuan (`Ubah` → `Arsipkan` → `Lihat semua tujuan` / `Buat tujuan`) → aksi dompet → riwayat → footer arsip.
- Status tidak pernah hanya warna: `Tercapai` (ikon + teks), `Lewat tanggal target` (ikon + teks), persen sebagai teks di samping bilah, `Dompet sudah diarsipkan` (ikon + teks).
- `role="progressbar"` hanya pada bilah tujuan aktif (bukan di baris terlipat, bukan di daftar Dompet).

## Budget JS dan aturan implementasi

- Ukur dari `main` sebelum menambah: Rencana nyata (Pribadi dan Bersama, `?bagian=tujuan`), Dompet, Detail dompet; Beranda tidak tersentuh. Target: Rencana ≤ 152, Dompet ≤ 154, Detail dompet tidak bertambah lebih dari 1 kB (pembuka `Buat tujuan` = pulau kecil yang memuat sheet malas).
- Server Component: segmen, daftar, kartu TJ3, baris terlipat, kartu ajakan TJ9, teks TJ10, `ArchiveBlockedCard` varian tujuan. Pulau malas (satu chunk `tujuan-client`): sheet TJ4/TJ5, dialog TJ6/TJ7, tombol `Pulihkan`. Tidak ada pustaka grafik; bilah = dua `span`.
- Ukuran uji layar (Task 6): 320, 390, 1280; gelap dan terang; `Rp 12.345.678.900` di kartu (saved, target, sisa, perlu); nama tujuan dan dompet 60 huruf; keadaan kosong (dua jenis), satu, banyak, tercapai, lewat tanggal, saldo 0, saldo minus, kurang dari 1%, semua dompet bertujuan, terlipat dengan dompet terarsip, memuat, galat; Bersama dua anggota dan solo; axe tanpa pelanggaran serius.

## Dampak ke task lain

1. **Task 2/3 (`app.goal_progress`, `api.list_goals`, `api.goal_for_account`):** kolom yang dibutuhkan bingkai: `id`, `name`, `account_id`, nama dompet, `account_archived` (untuk TJ8), `target_amount`, `target_on`, `status`, `completed_at`, `archived_at`, `created_by` (TJ12; server memetakan ke nama anggota), `saved`, `remaining`, `pct`, `reached`, `periods_left`, `per_period`, dan untuk baris arsip/selesai `account_has_other_active` (TJ8, opsional; tanpa itu `Pulihkan` selalu tampil dan galat tampil sesudah ketuk). Urutan aktif usulan TJ2. Daftar Dompet butuh `pct`/`reached`/nama tujuan per `account_id` (TJ10): dari `list_goals` yang sudah ada atau gabung di loader Dompet, satu kueri.
2. **Task 3 `api.update_goal`:** `goal_target_past` hanya bila `target_on` **berubah** (`is distinct from` nilai lama) dan < hari ini. Tanpa ini, tujuan `Lewat tanggal target` tidak bisa diganti nama atau targetnya tanpa menghapus tanggal (TJ5). Plan K7 menulis "saat diisi harus ≥ hari ini" tanpa pengecualian ini.
3. **Task 3 `archive_account`:** urutan cek K6 (tujuan sebelum saldo) tetap; UI TJ11 menampilkan pesan saldo lebih dulu bila keduanya berlaku, karena tombol arsip tidak dirender untuk saldo ≠ 0. Tidak ada konflik.
4. **Task 4 `segment-styles.ts`:** kendala 320 px (TJ1) diselesaikan di sini, termasuk `segmented-control.tsx` (salinan gaya yang sama).
5. **Task 5:** tautan `Tambah dompet tabungan` membuka halaman Dompet (sheet Tambah dompet yang ada); prasetel `pocket = tabungan` lewat query **tidak** dibuat di S13 (sheet tidak punya prasetel; menambahkannya menyentuh `add-account-sheet.tsx` dan budget Dompet). `archiveFailedText` + `account_has_goal`; `ArchiveBlockedCard` varian tujuan.
6. **Task 6:** `REGISTRY.md` dan e2e mengikuti keadaan di "Ukuran layar dan tema"; screenshot 320/390/1280 terang dan gelap jadi bahan kursi design reviewer.

## Keputusan agen atas nama pemilik (Task 1)

1. **Kartu tujuan selesai/diarsip tanpa bilah dan persen** (progres live dari saldo hari ini menyesatkan untuk tujuan yang sudah ditutup; tidak ada snapshot karena K2 melarang kolom progres).
2. **`Lewat tanggal target` netral** (`text-soft` + `clock`), bukan `warning`: tanggal lewat bukan risiko uang, dan aturan "tanpa merah untuk progres rendah" diperluas ke amber.
3. **Bilah satu warna ruang** (`pribadi`/`bersama`), tidak bertingkat seperti bilah anggaran.
4. **Teks tujuan di daftar Dompet menggantikan baris tipe dompet**, supaya baris tidak bertambah tinggi (utang S6 empat baris).
5. **`Dibuat {nama}` tampil di Bersama dua anggota**, tidak di Pribadi dan Bersama solo.
6. **Tidak ada pratinjau `Perlu Rp …/bulan` di sheet** (butuh pembagian di UI); angka hanya dari SQL sesudah simpan.
7. **`Tambah dompet tabungan` = tautan ke halaman Dompet**, bukan sheet bertumpuk atau prasetel baru.
8. **Selesaikan dan Arsipkan bisa diurungkan dari toast** (`restore_goal`), Tambah tidak (arsipkan bila keliru).

## Pertanyaan untuk pemilik dan penyimpangan

1. **Segmen empat item di 320 px (Pribadi)** kemungkinan tidak muat dengan gaya sekarang (perkiraan, belum diukur). Bingkai memilih huruf 13 + padding kecil di bawah 360, lalu grid 2×2 bila masih terpotong. Alternatif: label `Tujuan` dipindah ke Dompet saja (menyimpang dari K8). Rekomendasi: ikuti bingkai.
2. **`update_goal` dan tanggal yang sudah lewat** (Dampak butir 2): penajaman K7, bukan penggantian. Setuju?
3. **Setor ke tujuan Bersama dari Pribadi ikut Kontribusi S8** (kelas `x_setoran_anggota`). Bingkai menganggapnya benar dan tidak mengubah Kontribusi. Bila pemilik ingin setoran tujuan dipisah dari Kontribusi, itu butuh penanda di transfer (yang ditolak K2).
4. **Tidak ada feed atau jejak "siapa mengubah"** untuk tujuan Bersama di S13 (hanya `Dibuat {nama}`). Feed Aktivitas S8 tidak mendapat baris tujuan. Cukup?
5. **"Perlu Rp …/bulan" dihitung per periode gajian** (K5) tetapi tertulis "per bulan"; menjelang tanggal 25 angkanya bisa melompat karena satu periode habis. Salinan tidak menjelaskan periode gajian di kartu. Cukup, atau perlu kalimat `Dihitung per periode gajian`?
6. **K9 (definisi "bagian T11")** tetap butuh konfirmasi isi; bingkai mengikuti K9 apa adanya.

## Untuk kursi design reviewer

Daftar periksa Task 4 (Rencana) dan Task 6 (e2e/screenshot), dinilai dari screenshot 320/390/1280 terang dan gelap, bukan dari kode saja:

1. **Salinan:** tidak ada "Goal"/"goal" di layar, `aria-label`, `title`, toast; tidak ada tanda seru; tidak ada "rumah tangga"; semua teks cocok dengan "Salinan final S13".
2. **Warna:** bilah satu warna ruang di semua persen (0%, 5%, 45%, 99%, 100%); tidak ada merah/amber untuk progres rendah atau `Lewat tanggal target`; `danger` hanya di pesan galat; lime tidak menjadi teks di tema terang.
3. **Tanpa `Rp 0` sebagai pencapaian:** saldo 0 dan minus menampilkan `Belum ada yang terkumpul`; `Kurang dari 1%` saat ada uang tetapi persen 0; tercapai tanpa `Sisa Rp 0`.
4. **Tanpa perayaan:** tidak ada confetti, animasi, emoji saat `Tercapai`/`Selesaikan`.
5. **Status = ikon + teks:** `Tercapai`, `Lewat tanggal target`, `Dompet sudah diarsipkan`; persen tampil sebagai teks di samping bilah.
6. **ARIA bilah:** `role="progressbar"`, `aria-valuenow` = persen teks, `aria-valuemin/max`, `aria-valuetext` berisi nominal, nama dari `h3` tujuan; axe tanpa pelanggaran serius.
7. **320 px:** segmen empat item terbaca utuh (tanpa elipsis, tanpa gulir horizontal); `Rp 12.345.678.900` di kartu tidak terpotong; nama 60 huruf maksimal 2 baris; baris aksi tidak tumpang; daftar Dompet tidak bertambah baris.
8. **Target sentuh ≥ 44, jarak ≥ 8;** urutan fokus sesuai bagian "Target sentuh"; fokus kembali ke pembuka sesudah sheet/dialog ditutup; fokus awal dialog `Kembali`.
9. **Ruang tertulis:** judul sheet `· Pribadi`/`· Bersama` + `SpaceTag`, toast menyebut ruang; Bersama dua anggota menampilkan `Dibuat {nama}`, solo tidak.
10. **Angka:** nominal di kartu sama persis dengan saldo dompet di Detail dompet (saldo ≥ 0); Kekayaan bersih, Aman dipakai, Laporan tidak berubah sesudah tujuan dibuat/diselesaikan.
11. **Keadaan:** kosong (tanpa dompet tabungan, dengan dompet tabungan), satu, banyak, semua dompet bertujuan, terlipat (selesai, diarsip, dompet terarsip), memuat, galat, Bersama solo, Pribadi tanpa jejak tujuan Bersama dan sebaliknya.
12. **Hirarki:** satu angka besar per kartu (`saved`), persen sekunder, kartu tanpa bayangan; Detail dompet tetap dipimpin kartu saldo.
