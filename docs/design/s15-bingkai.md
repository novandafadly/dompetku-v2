# Bingkai desain S15 (Trip: pengeluaran dikelompokkan per trip)

Gerbang awal S15 (IPD §6 S15; plan `docs/superpowers/plans/2026-11-22-dompetku-v2-s15-trip.md` Task 1). Ditulis agen mengikuti Panel Malam (`DESIGN.md`, token `apps/web/src/styles/tokens.css`), `docs/spec/ui-ux.md`, dan format `docs/design/s14-bingkai.md`/`s13-bingkai.md`. Keputusan K1 sampai K16 di plan dipakai sebagai **default agen**: pemilik hanya meminta fokus ke trip (opsi saham S14 ditunda) dan belum menjawab satu per satu; K2, K4, K9, K12 tetap **[konfirmasi pemilik]** (`docs/m0a-keputusan.md` "S15"). ID `S15-TR*` dirujuk Task 6 sampai 12. Semua bingkai hanya untuk **mode nyata**; prototipe (`NEXT_PUBLIC_PROTOTYPE=1`) tidak berubah (S15-TR23). Bagian tagihan lanjutan (Task 5, K12/K13) tidak punya layar baru dan tidak dibingkai di sini.

## Fakta kode yang membentuk bingkai

Diperiksa di `main` `424ca95` (HEAD sesudah merge PR #39). Nomor baris di plan dicocokkan satu per satu; koreksi ditulis.

- **Tidak ada trip di migrasi:** `grep -i trip packages/db/migrations` hanya cocok dengan kata "triple" di komentar kursor `0114:8`. Semua baru; nomor berikutnya `0146` (terakhir `0145_ekspor_saham.sql`; tes terakhir `43_ekspor_saham.sql`).
- **⚠ Nomor baris "versi terakhir" di plan menunjuk bagian `migrate:down`, bukan badan yang hidup.** Task 2 dan 4 menulis "salin utuh dari versi terakhir" dengan baris-baris itu; implementer yang menurutinya menyalin badan **lama** dan menghapus perubahan S11 sampai S14 (mis. penjaga `stock_account_trade_only`, `debt_*`, cabang valuasi). Versi hidup (bagian `up`):

  | Fungsi                                   | Plan menulis     | Versi hidup sebenarnya                                                                                                                        |
  | ---------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | `api.create_entry`                       | `0106:423`       | **`0106:180`** (`0106:423` = down, kembali ke `0103`); tidak diganti sesudahnya                                                               |
  | `api.update_entry`                       | `0143:1213`      | **`0143:855`** (`0143:1213` = down, kembali ke `0110:467`); badan memuat penjaga `stock_trade_id` dan kunci entri `for update` sebelum dompet |
  | `api.move_entry_to_space`                | `0143:1347`      | **`0143:993`** (insert kolom eksplisit di `0143:1094`; tidak diubah S15)                                                                      |
  | `private.assert_entry_shape`             | `0140:873`       | **`0140:168`** (`0140:873` = down, kembali ke `0130`)                                                                                         |
  | `private.dq_run`                         | "0144"           | **`0144:204`** (`0144:570` = down, kembali ke `0142`)                                                                                         |
  | `api.create_split`                       | `0136:197`       | `0136:197` benar (up; down `1059`)                                                                                                            |
  | `api.export_entries`                     | (tidak disebut)  | **`0145:15`** (down `0145:84`)                                                                                                                |
  | `api.shared_activity`                    | `0114`           | `0114:23` benar; tidak pernah diganti                                                                                                         |
  | `app.report_class` / view `report_lines` | `0102:38` (view) | view `0102:38` benar (tanpa `trip_id`); fungsi `report_class` hidup di **`0140:232`**                                                         |

  Cara aman: ambil badan dari `pg_get_functiondef` di DB yang sudah migrasi sampai `0145`, atau dari bagian `up` yang disebut tabel; **diff terhadap hasil `pg_get_functiondef` sebelum dan sesudah** wajib di review Task 4.

- **Menu Trip masih "Segera" di mode nyata:** `features/shell/menu-sheet.tsx:30` `{ name: 'Trip', Icon: AirplaneTiltIcon }` (cocok); cabang `real` hanya menangani Kategori (`:118`), Kontak (`:125`, Pribadi saja), Analisis → Laporan; selainnya jatuh ke tombol `aria-disabled` + penanda `Segera` (`:140`–`:155`). Urutan `MENU_ITEMS`: Trip, Kategori, Kontak, Export, Analisis, Pengaturan; di mode nyata Sampah dan (Bersama) Patungan di atasnya. `Export` juga masih "Segera" di menu (Ekspor lewat Laporan); bukan urusan S15. `AirplaneTiltIcon` sudah diimpor, **tidak ada ikon baru** di S15.
- **Pola rute Kontak** (dipakai ulang): `app/[ruang]/kontak/{page,loading}.tsx` (`isPrototype()` → `notFound()`, `ruangContext`, `rethrowOrNotFound`, `errorTag`, layar gagal-muat), `_real/kontak.tsx` (Server Component; `KategoriBackIsland`, `EmptyState`/`ErrorState`, `LoadingRegion`/`Skeleton`, `ROW` 62 px), `_real/kontak-islands.tsx` (pulau malas), alamat di `features/shell/utang-hrefs.ts` (`buildKontakHref`; modul sendiri supaya tidak ikut JS muat awal). Trip meniru ini dengan `features/shell/trip-hrefs.ts`.
- **Jalur tulis TS:** `createEntrySchema` `write.ts:57`, `updateEntrySchema` `:90` (ganti-penuh, tanpa default), `createEntry` `:258` (SQL `:266`), `updateEntry` SQL `:419` (satu-satunya pemanggil TS), `IN_SPACE_SQL` `:202` (plan `:205`; tabel `accounts|entries|categories`, `trips` belum ada), `create_split` di `server/ledger/patungan.ts:491`. Pemanggil SQL `api.create_entry`: `0118:360` (diganti `0122:127` dan `:263`); WA memanggil `createEntry` (`server/wa/handle.ts:451`) tanpa trip.
- **"Bagi tagihan" bukan sheet sendiri.** Yang ada: sakelar `Dibayar dari dompet pribadi` di sheet Catat Bersama dua anggota (`catat-sheet.tsx:959`, `use-catat.tsx:264–280`, `PATUNGAN_COPY.toggle`) dan halaman dalam-sheet `Pembagian · Bersama` (`split-shares-page.tsx`, S12-CT2); menu `Patungan` hanya membuka halaman saldo. Pemilih trip untuk K6 = baris pemilih yang sama dengan pengeluaran Bersama biasa (S15-TR19).
- **Catat bisa pindah ruang di dalam sheet:** `useCatat.switchRuang` (`use-catat.tsx:546`), opsi per ruang lewat `CatatSource.options(ruang)` → `catatOptions` (`_actions/catat.ts:91`) dan `CatatOptions` (`features/catat/source.ts`: `accounts`, `categories`, `defaultAccountId`, `split`). Trip masuk `CatatOptions.trips` (data ruang itu saja) dan **harus dikosongkan dari draf saat `switchRuang`** (trip Pribadi tidak valid di Bersama).
- **Slot sheet Catat:** nominal → chips kategori → petunjuk simpan → petunjuk/sakelar Talangan atau `Dibayar dari dompet pribadi` → baris dompet + `Tanggal` → `Keterangan` (`catat-sheet.tsx:728–1050`); mode `compact` = papan ketik terbuka (`use-keyboard-mode`). Sheet Ubah `edit-sheet.tsx` (492 baris) dan hook `use-edit-entry.ts`.
- **Detail transaksi:** `EntryDetailView` punya slot `rows` (sesudah `Dicatat oleh`, `entry-detail-view.tsx:182`), `after`, `actions`; `detailAbilities` (`app/[ruang]/_real/detail.tsx:59`) mengunci semua jalur generik bila `entry.split !== undefined` atau `entry.trade !== undefined` (entri patungan dan trade saham tidak diubah/dibatalkan/dipindah dari Detail). `movable` hanya untuk pembuat, bukan Kantor/Trading, ≥ 2 ruang (`:100–107`). `Pindahkan` punya daftar akibat `consequences` di `move-sheet.tsx:355` (tempat catatan `Trip tidak ikut`).
- **Baris entri:** `EntryRowView` (`features/transaksi/entry-row-view.tsx`) = `TxRow` berupa **tautan** penuh (tidak boleh memuat tombol di dalamnya). `groupByDayVM` menjumlah total harian di TS (`features/ledger/group-by-day.ts`; `hideTotal`): daftar entri Detail trip **tidak** menampilkan total harian (angka per hari datang dari `api.trip_breakdown`, aturan angka dari SQL).
- **Daftar entri:** `listEntriesTx` (`read.ts:297`) per bulan, `ENTRY_JOINS`/`HIDE_SYSTEM_LEG` (`:189`–`:191`); filter `tripId` baru (Task 6).
- **CSV:** `CSV_HEADER` 10 kolom (`csv.ts:21`, terakhir `Pencatat`); dialog Ekspor (`ekspor-client.tsx`) tidak punya daftar kolom, jadi tidak ada perubahan UI.
- **Feed Aktivitas Bersama:** `api.shared_activity` `0114:23` menampilkan setiap baris `entry_history` kecuali `opening_balance`; update tag-saja akan muncul tanpa filter K16.
- **Komponen yang dipakai ulang:** `ListCard`, `EmptyState`/`ErrorState`/`LoadingRegion`/`Skeleton` (`components/ui/state.tsx`), `Sheet` + `SpaceTag`, `ConfirmDialog` (`tone="primary"`, fokus awal `Kembali`), `TextField`, `MoneyInput`, `DateInput`, `SaveButton`, `SegmentedControl`, `BackLink`, `MoneyText`, `Toast` + `Urungkan`, bilah `role="progressbar"` satu warna ruang dari `features/tujuan/goal-card-view.tsx` (`Bar`, `aria-valuetext`), `rowDivider`/`card`/`heroCard`. Ikon yang ada dan cukup: `airplane-tilt` (trip), `calendar-blank`, `check-circle`, `archive`, `warning`, `info`, `minus-circle`, `x`, `pencil-simple`, `plus`, `caret-right`, `arrow-counter-clockwise`. **Tidak ada ikon baru.**
- **Budget JS (batas 162 kB; `docs/superpowers/handoff/s14.md:31`):** Beranda 157,5; Transaksi 157,6; Detail transaksi 153,6; Dompet 153,4; Sampah 155,6; Rencana 150,6; Kontak 148,5 (pembanding rute daftar sederhana). Beranda prototipe 161,7 tidak disentuh.

## Kendala rancangan plan (ditulis terang, usul perbaikan)

1. **Nomor baris versi terakhir salah** (tabel di atas). Task 2 dan 4 wajib mengambil badan dari bagian `up` yang benar atau `pg_get_functiondef`; review Task 4 mendiff hasilnya.
2. **`per_day` dibagi panjang trip menyesatkan untuk trip yang sedang berlangsung.** Plan Task 3: `day_count = akhir − mulai + 1`, `per_day` = total ÷ `day_count`. Pada hari ke-3 dari 8 hari, total baru tiga hari dibagi delapan = rata-rata yang rendah dan salah. **Usul (Task 3, test-first, masih murah):** `trip_overview` menambah `elapsed_days` (= `least(app.today(), ends_on) − starts_on + 1`, 0 bila belum mulai) dan `per_day` = total ÷ `elapsed_days` (null bila 0 atau total 0). `day_count` tetap untuk label panjang. Teks tampak: `Rata-rata Rp … per hari`. Trip selesai: `elapsed_days = day_count`, sama dengan rumus plan.
3. **"Bagi tagihan" bukan sheet** (fakta kode). Plan Task 9 ("sheet `Bagi tagihan`") dibaca: pemilih trip di sheet Catat Bersama, juga saat sakelar patungan menyala; tag terkunci sesudah dibagi (K6, `split_locked`).
4. **`Keluarkan dari trip` tidak boleh ada di baris patungan.** Pengeluaran Bersama hasil `create_split` terkunci (`split_locked`, `0135`; `detailAbilities` mengunci semua jalur). Baris itu di Detail trip tampil tanpa tombol, meta `Dari patungan`. `trip_candidates` tidak menyertakannya (plan sudah).
5. **Daftar entri Detail trip terpotong di 200 baris tanpa tautan ke Transaksi.** Plan Task 8 menulis "tautan Transaksi bila terpotong"; Transaksi tidak punya filter trip (K10), jadi tautan tidak menolong. Diganti satu kalimat catatan (TR8); rincian per kategori/hari/anggota tetap dari seluruh pengeluaran (SQL), dan CSV memuat kolom Trip.
6. **`trip_candidates` perlu kolom tampilan dan penanda "masih ada".** Pratinjau `Masukkan` butuh per baris: `entry_id`, `occurred_on`, `description`, nama kategori, nama dompet, `amount`. Batas 100 per panggilan: minta `p_limit = 101`; `lebih dari 100 baris` = satu perbandingan, bukan hitungan (TR9).
7. **`catatOptions.trips` hanya memuat trip yang berakhir ≤ 30 hari lalu atau akan datang** (plan Task 6). Pengeluaran bertanggal lampau yang lebih dari 30 hari lewat dari sebuah trip tidak bisa ditandai dari Catat; jalannya `Masukkan` di Detail trip atau Ubah. Pemilih Ubah selalu menyertakan trip entri itu sendiri (aktif atau terarsip) supaya tidak dilepas tanpa sengaja.
8. **`{n} transaksi` diganti `{n} pengeluaran`.** Isi trip hanya pengeluaran biasa (K4); kata itu juga konsisten dengan tombol `Masukkan {n} pengeluaran`. Plan Task 1 menulis "banyak transaksi".

## Aturan bersama

Aturan S6 sampai S14 berlaku (ruang tertulis di judul sheet dan toast; status = ikon + teks; target ≥ 44 dan jarak ≥ 8; 320 px tanpa gulir horizontal termasuk `Rp 12.345.678.900`; salinan galat **tanpa nominal**, tanpa nama trip di pesan galat DB/log; tanpa tanda seru; tanpa "rumah tangga"). Tambahan S15:

1. **Istilah.** `Trip` (label Menu yang sudah ada), `Masukkan`, `Keluarkan dari trip`, `Arsipkan`, `Pulihkan`, `Dicatat oleh`, `Anggaran trip`, `Sisa Rp …`, `Lebih Rp …`. Tidak ada "boncos", "surplus", "Liburan" sebagai istilah produk (hanya boleh sebagai isi nama buatan pengguna), "budget", "grup", "tag", "label" di layar, `aria-label`, `title`, atau toast. Kata `tag` hanya di kode.
2. **Trip hanya pengelompokan (I6).** Tidak ada layar yang menyiratkan trip mengubah saldo, anggaran bulanan, Laporan, atau "aman dipakai". Kalimat tetap di sheet Tambah/Ubah dan kartu anggaran: anggaran trip hanya pembanding (TR6, TR11).
3. **Angka dari SQL.** Total, jumlah pengeluaran, `Rata-rata per hari`, `Sisa`/`Lebih`, persen, rincian per kategori/hari/anggota, fase, hari berjalan, kandidat `Masukkan` datang dari `api.trip_overview/trip_breakdown/trip_candidates/list_trips`. UI hanya memilih kalimat (perbandingan dengan 0/null atau tanggal boleh) dan memformat; tidak menjumlah, membagi, atau mengurangkan uang. Pembanding tanggal (`di luar tanggal trip`, selesai < mulai di formulir) boleh di klien.
4. **Tanpa `Rp 0` sebagai isi.** Total 0 diganti kalimat `Belum ada pengeluaran` (daftar) / `Belum ada pengeluaran di trip ini` (detail); tidak ada baris rincian nol; anggaran dengan total 0 menampilkan `Anggaran trip Rp …` tanpa `Sisa`.
5. **Satu warna ruang, tanpa merah.** Bilah anggaran satu warna ruang (token seperti bilah tujuan S13); `Lebih Rp …` memakai ikon `warning` + kata (warna `warning` sebagai pendukung, bukan penanda tunggal); `danger` hanya untuk pesan galat; fase tidak berwarna merah/hijau.
6. **Fase = ikon + teks:** `Berlangsung` (`airplane-tilt` fill), `Akan datang` (`calendar-blank`), `Selesai` (`check-circle`), `Diarsipkan` (`archive`); semua 13/600, warna `accent-text` hanya untuk `Berlangsung`, sisanya `text-soft`/`text-muted`.
7. **Tanggal rentang** ditulis `12–19 Des 2026` (bulan dan tahun sama), `28 Nov – 3 Des 2026` (tahun sama), `28 Des 2026 – 3 Jan 2027` (beda tahun); setiap tanggal dalam `span whitespace-nowrap` supaya tidak pecah di tengah tanggal. Pembantu `features/trip/present.ts` (`rangeLabel`) dari `shortDateLabel`.
8. **Nama trip pengguna** dirender sebagai teks (React), `break-words`, `line-clamp-2` + `title`; tidak pernah di URL selain `id`, tidak di pesan galat server.

## Menu → Trip

### S15-TR1 · Butir Menu `Trip` (mode nyata, kedua ruang)

- Mode nyata: item `Trip` menjadi `MenuLink` ke `/{ruang}/trip{query}` (ikon `airplane-tilt` yang sudah ada), tanpa penanda `Segera`, di Pribadi **dan** Bersama (termasuk Bersama solo). Posisi tetap (di atas Kategori).
- `MenuSheet` mendapat cabang `real && name === 'Trip'` mengikuti Kategori/Kontak; `buildTripHref(ruang, query)` di `features/shell/trip-hrefs.ts`.
- Prototipe: tetap tombol `aria-disabled` `Segera` (S15-TR23).

## Daftar Trip

### S15-TR2 · Halaman `/{ruang}/trip`

Server Component (pola `KontakReal`), `laptop:max-w-180`, jarak `gap-3 tablet:gap-4`.

- **Header:** `BackLink` via `KategoriBackIsland`; `h1` `Trip · Pribadi` / `Trip · Bersama` (`tabIndex=-1`, fokus awal pola `focus-title`), 22/800 (laptop `title-lg`). Tombol `Tambah trip` sekunder 44 (ikon `plus` bold): penuh lebar di HP, di kanan `h1` di laptop; hanya bila sudah ada ≥ 1 trip (kosong = aksi primer di `EmptyState`).
- **Grup (urutan DOM):** `Berlangsung`, `Akan datang`, `Selesai`; masing-masing `ListCard` (judul 14/700 `text-soft`, tanpa ikon kelompok) hanya bila berisi. Di dalam grup `Berlangsung` dan `Selesai`: urutan SQL (`starts_on` turun); `Akan datang`: mulai terdekat dulu (urut terbalik di UI, hanya pengurutan). Trip dalam fase ditentukan `phase` dari SQL, bukan dari tanggal klien.
- **`Trip diarsipkan ({n})`:** `details` terlipat di akhir bila n > 0 (pola `Lunas ({n})` S11, ringkasan ≥ 44).
- **Tanpa ringkasan total semua trip** (menjumlah lintas trip tidak bermakna).

### S15-TR3 · Baris trip

Satu baris = **tautan** ke `/{ruang}/trip/{id}{query}` (≥ 72, `rowLink`), ubin ikon `airplane-tilt` 20 di ubin 40.

- **Kiri:** nama 15/600 `line-clamp-2 break-words`; di bawahnya 13/500 `text-muted` `{rentang} · {n} hari` (`n` = `day_count`; `1 hari` untuk satu hari); fase tidak diulang di baris (sudah judul grup), kecuali di `Trip diarsipkan`.
- **Kanan:** total `MoneyText` 15/700 `num` `whitespace-nowrap`; di bawahnya `{n} pengeluaran` 13/500 `text-muted`. Total 0: ganti dengan `Belum ada pengeluaran` 13/500 `text-muted` (tanpa `Rp 0`, tanpa `0 pengeluaran`).
- **Anggaran (bila ada dan total > 0):** baris ketiga 13/600 `Sisa Rp …` (`text-soft`) atau ikon `warning` 14 + `Lebih Rp …` (`warning`); tanpa bilah di daftar (bilah hanya di detail, satu angka per layar).
- **Di bawah 360 px** nominal total turun ke baris kedua rata kiri di bawah meta (pola `WalletRow`/`TrashRow`): nama tidak pernah dipampatkan oleh `Rp 12.345.678.900`.
- **Baris di `Trip diarsipkan`:** sama, ikon ubin `archive`, fase `Diarsipkan` di meta; tombol teks 44 `Pulihkan` (TR13) di baris sendiri rata kanan, **di luar** tautan.
- Tanpa kartu tanpa-tindakan: seluruh baris = satu target.

### S15-TR4 · Keadaan daftar

- **Memuat:** `loading.tsx` kerangka tiga baris 72 (`LoadingRegion` `Memuat trip…`), tanpa judul (ruang belum pasti, pola `KontakLoading`).
- **Kosong:** `EmptyState` (ikon `airplane-tilt` 28, `tone="accent"`, `headingLevel=2`) `Belum ada trip.` / `Kelompokkan pengeluaran perjalanan, lihat totalnya, dan bandingkan dengan anggaran.` / aksi primer 48 `Tambah trip`.
- **Hanya trip terarsip:** grup aktif tidak dirender; teks 13/500 `text-soft` `Tidak ada trip aktif.` + tombol `Tambah trip` tetap di header; `Trip diarsipkan` tetap terlipat.
- **Galat loader:** `ErrorState` `Trip belum bisa dimuat.` / `Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.` + `Coba lagi` (`RetryIsland`).
- **Bersama solo** dan dua anggota identik (daftar tidak menampilkan siapa membuat).

## Detail trip

### S15-TR5 · Kepala dan ringkasan (`/{ruang}/trip/{id}`)

Server Component; `BackLink` `Trip` (ke daftar). Kartu `heroCard` padding 16 (laptop 20), `aria-labelledby` = `h1`.

- **Baris 1:** `h1` nama trip 20/800 `break-words` (tidak dipotong; panjang 60 huruf boleh empat baris di 320) + `SpaceTag` di kanan (turun di bawah nama bila sempit).
- **Baris 2 (meta):** `{rentang} · {n} hari` 13/500 `text-soft`; sebelahnya fase (ikon + teks 13/600). `Berlangsung` ditambah ` · hari ke {elapsed_days} dari {day_count}` bila SQL memberi `elapsed_days` (Kendala 2); `Akan datang` ditambah ` · mulai {tgl}`.
- **Baris 3 (angka besar, satu per layar):** label 13/600 `text-soft` `Total pengeluaran`, `MoneyText` `size="amount"` (`data-testid="trip-total"`), 13/500 `text-muted` `{n} pengeluaran`. Total 0: angka besar diganti `Belum ada pengeluaran di trip ini` 15/600 `text-soft`, tanpa `{n}`.
- **Baris 4:** `Rata-rata Rp {per_day} per hari` 13/500 `text-soft`, hanya bila `per_day` tidak null (Kendala 2).
- **Aksi (urut):** `Ubah trip` sekunder 44 (ikon `pencil-simple`), `Arsipkan` tombol teks 44 (ikon `archive`). Trip terarsip: tidak ada aksi; banner TR10.
- Trip milik ruang lain, tidak ada, atau id bukan uuid: `notFound()` seragam (tanpa orakel nama).

### S15-TR6 · Kartu `Anggaran trip` (hanya bila `budget_amount` ada)

Kartu terpisah (`card`, padding 16), `h2` `Anggaran trip` 14/700 `text-soft` + `Rp {anggaran}` 15/700 di kanan (nominal tidak terpotong; turun ke baris sendiri di 320).

- **Bilah** (pola `goal-card-view` `Bar`): tinggi 8, radius 4, jalur `surface-2` + garis `hairline`, isi warna ruang selebar `min(pct,100)`%. `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow` = `min(pct,100)`, `aria-labelledby` = `h2`, `aria-valuetext` `{pct} persen dari anggaran trip, Rp … dari Rp …` (`Lebih` bila lewat). Persen tampil juga sebagai teks `{pct}%` 15/700 `num` di sebelah bilah (`Kurang dari 1%` bila total > 0 tetapi `pct` 0; lewat 100 ditulis apa adanya, mis. `112%`).
- **Baris sub:** di bawah/sama dengan anggaran: `Sisa Rp {budget_left}` 15/700 `text` (ikon `check-circle` tidak dipakai; ini angka, bukan status) atau `Lebih Rp {-budget_left}` 15/700 dengan ikon `warning` fill 16 + kata `Lebih` (warna `warning`, kontras sudah lulus). Total 0: baris `Sisa` diganti `Belum ada pengeluaran` 13/500 `text-muted`.
- **Penjelas tetap** 12/500 `text-muted`: `Hanya pembanding. Tidak mengubah anggaran bulanan.`
- **Tanpa anggaran:** kartu tidak dirender; di bawah aksi hero satu tautan teks 44 `Tambah anggaran trip` (membuka sheet Ubah dengan fokus awal di Anggaran). Tidak ada ajakan untuk trip terarsip.

### S15-TR7 · Rincian: `Per kategori`, `Per hari`, `Dicatat oleh`

Tiga `details` (ringkasan ≥ 44, judul 14/700 `text-soft`, ikon `caret-down` memutar) di dalam satu `card`; urutan: **Per kategori** (terbuka), **Per hari** (terlipat; ringkasan `Per hari ({n} hari)`), **Dicatat oleh** (terbuka; hanya Bersama dengan ≥ 2 anggota; jumlah anggota dari data yang sudah dimuat). Hanya dirender bila `entry_count > 0`.

- **Baris rincian:** `label` 15/600 `line-clamp-2 break-words` kiri; `{n} pengeluaran` 13/500 `text-muted` di bawah label; `MoneyText` 15/700 `num` kanan `whitespace-nowrap` (di bawah 360 px nominal turun ke baris ketiga rata kiri). Urutan dari SQL (jumlah turun, kunci `COLLATE "C"`). Tanpa bilah proporsi (butuh pembagian di UI) dan tanpa persen.
- **Per kategori:** kategori induk (`label` dari SQL); entri tanpa kategori = `Tanpa kategori`.
- **Per hari:** `weekdayDateLabel` (`Sab, 12 Des`; tahun bila beda dari tahun trip) dan hanya hari yang punya pengeluaran. Hari di luar `starts_on..ends_on` (entri bertrip tanggalnya di luar rentang, K5) diberi penanda ikon `info` 14 + `Di luar tanggal trip` 12/600 `text-muted` di bawah tanggal.
- **Dicatat oleh:** `Kamu` bila kunci = pengguna yang melihat, selain itu nama anggota; tanpa inisial/avatar. Tidak tampil di Pribadi dan Bersama solo (nol informasi).
- Semua baris dari SQL, jadi total kategori = total hari = total anggota = `Total pengeluaran` (Review Focus I6; e2e membandingkan).

### S15-TR8 · Daftar pengeluaran trip dan `Keluarkan dari trip`

`ListCard` `Pengeluaran` (judul 14/700) dengan tombol-baris; maks 200 baris (Task 6/8), urut tanggal turun lalu `created_at`/`id` menurun, dikelompokkan dengan kepala hari 13/600 `text-soft` (`dayLabel`) **tanpa total harian** (`hideTotal`; Kendala fakta kode `groupByDayVM`).

- **Baris:** `li` flex: kiri isi `EntryRowView` (tautan ke Detail transaksi, ikon kategori, judul, meta `{jenis} · {dompet}`, nominal); kanan tombol ikon 44×44 `minus-circle` (nama aksesibel dan `title` `Keluarkan dari trip: {judul}`). Di bawah 360 px nominal turun ke baris ketiga di dalam kolom teks (tombol tetap 44 di kanan, nama tidak pernah dipampatkan di bawah ±150 px).
- **Baris patungan** (`entry.split`): tanpa tombol; meta `Dari patungan` (ikon `info` 12). Server menolak `split_locked` bila tetap dipanggil: teks galat `Pengeluaran ini dikelola dari halaman Patungan.`
- **`Keluarkan`:** langsung jalan (tanpa dialog, aksi mudah dibalik), `setEntriesTrip(null, [id])`; baris hilang dari daftar dan angka halaman ikut (`router.refresh` / pembaruan server). Toast `{judul} dikeluarkan dari {nama trip}` + `Urungkan` (= menandai lagi ke trip ini; bila trip sudah diarsipkan, toast galat `Trip ini sudah diarsipkan. Pulihkan dulu untuk memasukkannya lagi.`). Fokus pindah ke baris berikutnya (atau `h2` daftar bila habis).
- **Terpotong:** bila ada lebih dari 200, di bawah daftar kalimat 12/500 `text-muted` ikon `info` 14 `Menampilkan 200 pengeluaran terbaru. Rincian di atas dihitung dari semua pengeluaran trip.` (Kendala 5).
- **Kosong:** lihat TR10.
- **Trip terarsip:** daftar tampil, tanpa tombol `Keluarkan`.

### S15-TR9 · Kartu dan sheet `Masukkan {n} pengeluaran tanggal trip`

Kartu (`card`, padding 16) di atas `Pengeluaran`, **hanya** bila ada kandidat dan trip tidak terarsip; kandidat = pengeluaran biasa hidup tanpa trip, tanggal dalam rentang, bukan talangan/Kantor/patungan (K4, SQL `trip_candidates`).

- **Isi kartu:** ikon `info` 18 + `h2` 15/700 `Pengeluaran tanggal trip yang belum masuk`; 13/500 `text-soft` `{n} pengeluaran bertanggal {rentang} belum masuk trip mana pun.` (`n` = jumlah baris, `100` bila lebih; tanpa pembagian); tombol sekunder 44 `Masukkan {n} pengeluaran`. Lebih dari 100: tambah kalimat 12/500 `text-muted` `Masih ada yang lain. Ulangi sesudah ini.` (penanda dari `p_limit = 101`, Kendala 6).
- **Sheet `Masukkan ke {nama trip} · {Ruang}`** (pulau malas, `SpaceTag`; laptop dialog tengah 520): kalimat 13/500 `text-soft` `Pengeluaran Kantor dan talangan tidak ikut. Kamu bisa mengeluarkan satu per satu sesudahnya.`; daftar baca-saja (tanpa tautan, tanpa kotak centang): tiap baris tanggal (`shortDateLabel`) · judul · dompet kiri, nominal kanan, `line-clamp-2`; pegangan gulir internal dengan footer menempel. Footer: `Masukkan {n} pengeluaran` primer 48 (`Memasukkan…`) dan `Batal` sekunder.
- **Toast:** `{n} pengeluaran dimasukkan ke {nama trip}` + `Urungkan` (= `setEntriesTrip(null, ids)` untuk id yang sama; aman karena sebelumnya tanpa trip).
- **Galat:** `trip_entry_invalid` (salah satu sudah berubah sejak daftar dimuat; seluruh panggilan ditolak): `alert` di sheet `Ada pengeluaran yang tidak bisa masuk trip lagi. Muat ulang halaman, lalu coba lagi.`; `trip_archived`: `Trip ini sudah diarsipkan. Muat ulang halaman.`; `trip_not_found`: `Trip ini tidak ditemukan. Muat ulang halaman.`
- **Penting untuk WhatsApp:** WA tidak menandai trip (K9); kartu ini jalan masuk pengeluaran dari WA dan yang terlupa. Tidak ada kartu bila kandidat 0.

### S15-TR10 · Keadaan Detail trip

| Keadaan                     | Tampilan                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kosong (0 pengeluaran)      | hero tanpa rata-rata; angka besar diganti `Belum ada pengeluaran di trip ini`; kartu anggaran (bila ada) tanpa `Sisa`; tanpa rincian; kartu `Masukkan` bila ada kandidat; selain itu satu kalimat 13/500 `text-soft` `Catat pengeluaran dengan tanggal di rentang trip, dan trip ini terpilih otomatis di Catat.` |
| Akan datang                 | sama dengan kosong bila belum ada pengeluaran (tiket dibeli lebih dulu boleh ditandai, K2); fase `Akan datang · mulai {tgl}`; rata-rata tidak tampil                                                                                                                                                              |
| Berlangsung / Selesai       | lengkap; `Selesai` tanpa rata-rata berubah (Kendala 2)                                                                                                                                                                                                                                                            |
| Terarsip                    | banner di atas hero (`card` biasa, tanpa warna peringatan) ikon `archive` 18 + `Trip ini diarsipkan.` 15/700 + `Pulihkan supaya bisa dipilih lagi di Catat.` 13/500 `text-soft` + tombol sekunder 44 `Pulihkan`; tanpa `Ubah trip`, `Arsipkan`, `Masukkan`, `Keluarkan`; angka dan rincian tetap tampil           |
| Memuat                      | `loading.tsx`: kerangka hero + dua kartu (tinggi tetap), `Memuat trip…`                                                                                                                                                                                                                                           |
| Galat loader                | `ErrorState` `Trip ini belum bisa dimuat.` + `Coba lagi`; `BackLink` tetap                                                                                                                                                                                                                                        |
| Trip tidak ada / ruang lain | `notFound()` (404 seragam); tidak ada pesan yang menyebut nama                                                                                                                                                                                                                                                    |
| Anggaran terlampaui         | TR6 `Lebih Rp …`                                                                                                                                                                                                                                                                                                  |

## Sheet Tambah dan Ubah trip

### S15-TR11 · Sheet `Tambah trip · {Ruang}` (pulau malas)

`Sheet` + `SpaceTag`; laptop dialog tengah 520. `clientId` lahir saat sheet dibuka (pola Tambah tujuan). Isian berurutan:

1. **`Nama trip`** (`TextField`, fokus awal, maks 60, hitungan sisa huruf mulai 50; contoh di petunjuk 13/500 `text-soft`, bukan placeholder: `Misalnya Bali, Desember 2026.`).
2. **`Mulai`** (`DateInput`, bawaan hari ini WIB, rentang 2000-01-01..2100-12-31) dengan teks tanggal pasti di bawah isian (pola `DateInput`).
3. **`Selesai`** (`DateInput`, **kosong**, wajib; tanggal terbalik dan rentang > 366 hari ditandai di kolom ini).
4. **`Anggaran trip (opsional)`** (`MoneyInput`, > 0); petunjuk 12/500 `text-muted` `Hanya pembanding di halaman trip. Tidak mengubah anggaran bulanan atau Laporan.`

- **Validasi klien** (perbandingan tanggal, bukan uang): `Selesai` sebelum `Mulai` → `Tanggal selesai tidak boleh sebelum tanggal mulai.`; rentang > 366 hari → `Rentang trip paling lama 366 hari.`; kolom kosong → `Isi tanggal selesai.`. Server `invalid_argument` per kolom sebagai cadangan (Salinan galat).
- **Footer:** `Simpan trip` (primer 48, `Menyimpan…`, `aria-disabled` selama sibuk).
- **Toast:** `Trip {nama} dibuat di {Ruang}` (tanpa `Urungkan`; arsipkan bila keliru). Sheet tertutup, daftar menyegarkan, fokus ke baris baru (`tabIndex=-1`, pola S13).
- **Bersama:** identik; judul `· Bersama`; semua anggota boleh (K1).

### S15-TR12 · Sheet `Ubah trip · {Ruang}`

- Isian sama, terisi nilai sekarang; tombol teks 44 `Hapus anggaran` bila anggaran terisi.
- Kalimat tetap 12/500 `text-muted`: `Mengubah tanggal tidak memindahkan pengeluaran yang sudah masuk trip.` (K2: keanggotaan = tag, bukan rentang.)
- Footer `Simpan perubahan`; tanpa perubahan: tombol tetap aktif, server no-op, sheet tertutup tanpa toast. Toast `Trip {nama} diperbarui di {Ruang}`.
- Trip terarsip tidak punya jalan ke sheet ini (TR10); `trip_archived` dari balapan: `alert` `Trip ini sudah diarsipkan. Muat ulang halaman.`
- Pembuka: tombol `Ubah trip` di hero dan `Tambah anggaran trip` (fokus awal Anggaran).

### S15-TR13 · `Arsipkan` dan `Pulihkan`

- **Dialog `Arsipkan {nama}?`** (`ConfirmDialog` `tone="primary"`, ikon `archive` 22, fokus awal `Kembali`): `Trip hilang dari pilihan di Catat dan dari daftar utama. Pengeluarannya tetap tercatat dan total trip tidak berubah. Kamu bisa memulihkannya dari Trip diarsipkan.` Bersama: tambahan paragraf `Trip ini juga hilang dari pilihan {nama anggota lain}.` (solo: tidak ada). Tombol `Arsipkan` (primer), `Kembali`. Toast `Trip {nama} diarsipkan` + `Urungkan` (= `restore_trip`).
- **`Pulihkan`:** tombol sekunder 44 (nama aksesibel `Pulihkan trip {nama}`) di baris `Trip diarsipkan` dan di banner Detail; langsung jalan, toast `Trip {nama} aktif lagi`. `name_taken` (nama aktif sama dibuat sesudahnya): teks di baris/banner 13/600 ikon `info` `Sudah ada trip aktif bernama {nama}. Ubah nama trip yang aktif dulu, lalu pulihkan.` (`role="status"`).
- Arsip/pulih tidak menyentuh pengeluaran: total tetap sama (e2e).

## Catat dan Ubah

### S15-TR14 · Pemilih `Trip` di sheet Catat

- **Kapan tampil:** hanya jenis `Pengeluaran`, dompet yang dipilih bukan Kantor, Talangan mati, ruang sheet punya ≥ 1 trip yang bisa dipilih (`CatatOptions.trips`, tidak terarsip, jendela Kendala 7). Selain itu baris **tidak dirender** (bukan nonaktif; tanpa ajakan kosong). Saat pengguna mengubah jenis ke pemasukan/transfer, menyalakan Talangan, atau memilih dompet Kantor: `trip` di draf dikosongkan, baris hilang (tidak ada pemberitahuan di Catat; hot path cepat).
- **Letak:** sesudah baris dompet + `Tanggal`, sebelum `Keterangan`. Satu baris `min-h-11`:
  - **Belum dipilih:** tombol teks 44 ikon `airplane-tilt` 18 + `Tambah ke trip` (`text-soft`, fokus ring).
  - **Terpilih:** chip (tombol 44; ikon `airplane-tilt` fill 16 + nama trip `truncate`, `title` nama lengkap; nama aksesibel `Trip {nama}, ganti`) dan tombol `Lepas` 44 (ikon `x` 14 + teks, nama aksesibel `Lepas dari trip {nama}`), `gap-2`. Chip membuka halaman `Pilih trip`.
- **Halaman dalam-sheet `Pilih trip · {Ruang}`** (pola halaman `Pembagian`; dimuat malas, tidak masuk JS Catat awal): `radiogroup`; opsi pertama `Tidak masuk trip`; lalu trip: nama 15/600, 13/500 `text-muted` `{rentang}`, fase (ikon + teks); yang rentangnya memuat tanggal entri diberi `Sesuai tanggal` (ikon `check` 14, 12/600 `accent-text`) dan diurutkan lebih dulu; baris terpilih ikon `check`. Memilih = menerapkan dan kembali (tanpa footer terpisah), fokus kembali ke chip.
- **Mode `compact`** (papan ketik terbuka): baris Trip tetap satu baris 44; bila nominal + chips + baris meta + Trip tidak muat di 320×568 setelah papan ketik, baris Trip dipindah **di bawah** `Keterangan` (aturan: nominal, kategori, simpan tidak boleh keluar dari layar). Task 9 mengukur di 320 dengan emulasi papan ketik (`use-keyboard-mode`) dan memilih letak.
- **`switchRuang`:** `trip` dikosongkan; opsi diambil dari ruang tujuan.

### S15-TR15 · Pemilih Trip di sheet Ubah

- Pemilih yang sama (chip + `Lepas`); menampilkan trip entri sekarang. Opsi = `trips` ruang + trip entri sendiri bila di luar jendela atau terarsip (label `{nama} · Diarsipkan`, tidak bisa dipilih ulang bila dilepas).
- `tripId` selalu terkirim (ganti-penuh, Zod mewajibkan); `Lepas` mengirim `null`.
- **Pelepasan otomatis:** bila entri bertrip lalu pengguna menyalakan Talangan atau mengganti dompet ke Kantor, trip dilepas dari draf dan satu kalimat 13/600 `text-soft` ikon `info` 14 muncul di tempat baris Trip: `Trip dilepas: pengeluaran Kantor atau talangan tidak bisa masuk trip.` (`role="status"`). Membatalkan perubahan itu (Talangan mati lagi) mengembalikan pemilih tanpa trip, tidak menyalakan ulang trip lama.
- Entri yang bukan pengeluaran biasa (pemasukan, transfer, saldo awal, pokok/cicilan utang, trade, patungan): pemilih tidak ada; sheet Ubah untuk jenis itu memang tidak mengubah trip.
- Galat `trip_archived` (dipilih lalu diarsipkan di tab lain): kolom Trip `Trip {nama} sudah diarsipkan. Pilih trip lain atau lepas.`; `trip_entry_invalid`: `Pengeluaran ini tidak bisa masuk trip.`; keduanya tanpa menutup sheet.

### S15-TR16 · Saran awal (K9)

- **Aturan:** saat sheet Catat dibuka atau tanggal diubah, bila **tepat satu** trip aktif (tidak terarsip) memuat tanggal entri (`starts_on <= tanggal <= ends_on`, perbandingan di klien dari `trips` yang sudah dimuat), trip itu terpilih sebagai chip. Dua trip atau lebih yang tumpang tindih, atau nol: tidak ada pilihan awal (pengguna memilih sendiri lewat `Tambah ke trip`).
- **Terlihat dan bisa dilepas:** chip + `Lepas` (TR14); di bawahnya (hanya mode bukan `compact`) 12/500 `text-muted` ikon `info` 12 `Dipilih otomatis karena tanggalnya di rentang trip.` Di mode `compact` kalimat jadi `sr-only`.
- **Selama pengguna belum menyentuh chip** (memilih, mengganti, atau `Lepas`), mengganti tanggal menghitung ulang saran; sesudah disentuh, pilihan pengguna tetap, tanggal tidak mengubahnya (tidak ada saran ulang).
- **Hanya Catat** (Ubah tidak menyarankan; menghormati pilihan yang tersimpan). WA tidak pernah menandai trip.
- Satu fungsi murni di `features/trip/suggest.ts` (mudah dimatikan bila pemilik tidak suka).

## Detail transaksi, Pindahkan, Patungan, CSV, Sampah

### S15-TR17 · Baris `Trip` di Detail transaksi

- Slot `rows` (sesudah `Dicatat oleh`): `DetailRow` `Trip` dengan **tautan** ke `/{ruang}/trip/{id}` bernama trip (15/600, `accent-text`, target 44 baris penuh; ikon `caret-right` 16 `text-muted` pola `Reimburse`); trip terarsip: `{nama} · Diarsipkan`. Hanya bila entri bertrip; entri batal tetap menampilkannya (baca-saja).
- Tidak ada tombol Keluarkan di sini; mengeluarkan = `Ubah` → `Lepas` (TR15) atau dari Detail trip (TR8).
- Entri patungan (terkunci) menampilkan baris yang sama tanpa Ubah.

### S15-TR18 · `Pindahkan ke ruang lain`: `Trip tidak ikut` (K15)

- Hanya bila entri bertrip: satu baris tambahan di daftar akibat dialog konfirmasi (`consequences`, `move-sheet.tsx:355`): `Trip tidak ikut. Pengeluaran ini keluar dari trip {nama}.` Entri baru di ruang tujuan tanpa trip; total trip asal turun karena entri asal batal. Tidak ada pilihan "bawa trip".

### S15-TR19 · Bagi tagihan (patungan) Bersama (K6)

- Pemilih TR14 muncul juga saat sakelar `Dibayar dari dompet pribadi` menyala (ruang Bersama): trip Bersama yang terpilih ditandai ke **pengeluaran Bersama** hasil `create_split`.
- Kalimat 12/500 `text-muted` ikon `info` 12 di bawah baris Trip **hanya** saat sakelar menyala dan trip terpilih: `Trip tidak bisa diubah sesudah tagihan dibagi. Batalkan tagihan di Patungan bila salah.`
- Rincian `Dicatat oleh` di trip Bersama menghitung pengeluaran itu atas nama pencatat (Novanda membayar dari dompet Pribadinya, tercatat pengeluaran Bersama atas namanya). Tidak ada penjelasan tambahan di layar.
- Detail trip: baris patungan tanpa `Keluarkan` (TR8).

### S15-TR20 · Kolom `Trip` di CSV (K11)

- `CSV_HEADER` + `Trip` di **akhir** (11 kolom); nilai nama trip, kosong bila tidak bertrip; dipakai pembantu `csvText` yang ada (escape rumus `=`, `+`, `-`, `@`, koma, kutip). Σ kolom `Nominal` tetap = Laporan. Tidak ada kolom id trip. Dialog Ekspor tidak punya daftar kolom, tidak berubah.

### S15-TR21 · Sampah, riwayat, feed Aktivitas

- **Sampah:** entri batal yang bertrip tampil sama seperti entri lain (tidak ada tulisan trip di baris). `Pulihkan` memulihkan entri **dengan tag** (tag tidak berubah oleh batal); bila trip kini terarsip tag tetap (K8). Dipurge > 90 hari: baris hilang, trip tidak tersentuh.
- **Feed Aktivitas Bersama:** teks tidak berubah; K16 menyaring baris `update` yang hanya mengubah `trip_id`, jadi `Masukkan (50)` tidak membanjiri Farida. Bila filter dipotong, efeknya (satu baris "diubah" per entri ditandai) dicatat di handoff.
- **Riwayat dompet dan Transaksi:** tanpa penanda trip (K10).

## Bersama

### S15-TR22 · Trip di Bersama (K1)

- Semua anggota boleh membuat, mengubah, mengarsipkan, memulihkan, menandai, dan mengeluarkan (pola tujuan S13 K1, tanpa kunci "hanya pembuat", tanpa `Dibuat {nama}`).
- Rincian `Dicatat oleh` hanya dengan ≥ 2 anggota (TR7).
- **Privasi:** trip Pribadi tidak pernah tampil di Bersama atau ke pasangan (RLS FORCE + FK komposit); opsi Catat, kolom CSV, dan daftar hanya memuat ruang itu; judul sheet dan toast selalu `· Pribadi`/`· Bersama`. Kanari nama trip Pribadi tidak ada di HTML/RSC pasangan (e2e `zz-trip`).
- Bersama solo: semua fitur sama (patungan tidak tersedia, TR19 tidak muncul).

### S15-TR23 · Prototipe

- Prototipe tidak berubah: item Menu `Trip` tetap `aria-disabled` + `Segera`; `/pribadi/trip` dan `/bersama/trip` = 404 (`isPrototype()` → `notFound()`, seperti Kontak); sheet Catat/Ubah prototipe tidak punya pemilih Trip (`demoCatatSource` tanpa `trips`); budget JS prototipe tidak berubah (Beranda 161,7).

## Salinan galat S15 (tanpa nominal, tanpa nama dari DB)

| Kode                                      | Tempat                                | Teks                                                                                                                 |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `name_taken` (`trips_name_unique`, 23505) | kolom Nama (Tambah/Ubah)              | `Sudah ada trip aktif bernama {nama} di {Ruang}.`                                                                    |
| `name_taken` (Pulihkan)                   | baris/banner Pulihkan                 | `Sudah ada trip aktif bernama {nama}. Ubah nama trip yang aktif dulu, lalu pulihkan.`                                |
| `trip_not_found` (DK404)                  | kotak atas sheet/dialog; Detail = 404 | `Trip ini tidak ditemukan. Muat ulang halaman.`                                                                      |
| `trip_archived` (DK422)                   | Masukkan / Ubah trip                  | `Trip ini sudah diarsipkan. Muat ulang halaman.`                                                                     |
| `trip_archived`                           | kolom Trip (Catat/Ubah)               | `Trip {nama} sudah diarsipkan. Pilih trip lain atau lepas.`                                                          |
| `trip_archived`                           | toast Urungkan Keluarkan              | `Trip ini sudah diarsipkan. Pulihkan dulu untuk memasukkannya lagi.`                                                 |
| `trip_entry_invalid` (DK422)              | sheet Masukkan                        | `Ada pengeluaran yang tidak bisa masuk trip lagi. Muat ulang halaman, lalu coba lagi.`                               |
| `trip_entry_invalid`                      | kolom Trip (Catat/Ubah)               | `Pengeluaran ini tidak bisa masuk trip.`                                                                             |
| `split_locked`                            | Keluarkan baris patungan (cadangan)   | `Pengeluaran ini dikelola dari halaman Patungan.`                                                                    |
| `invalid_argument/name`                   | kolom Nama                            | `Nama trip wajib diisi, paling banyak 60 huruf.`                                                                     |
| `invalid_argument/starts_on`              | kolom Mulai                           | `Isi tanggal mulai yang valid.`                                                                                      |
| `invalid_argument/ends_on`                | kolom Selesai                         | `Tanggal selesai tidak valid. Paling lama 366 hari sesudah tanggal mulai.`                                           |
| validasi klien                            | kolom Selesai                         | `Tanggal selesai tidak boleh sebelum tanggal mulai.` / `Rentang trip paling lama 366 hari.` / `Isi tanggal selesai.` |
| `invalid_argument/budget_amount`          | kolom Anggaran                        | `Anggaran harus lebih dari nol dan masuk akal.`                                                                      |
| `trip_immutable` (DK422)                  | tidak ada jalan dari UI               | (tidak ditampilkan; ruang trip tidak bisa diganti)                                                                   |
| jaringan/`unknown`                        | kotak atas sheet                      | `Belum berhasil. Sambungan ke server terputus. Coba lagi.`                                                           |
| loader                                    | `ErrorState`                          | `Trip belum bisa dimuat.` / `Trip ini belum bisa dimuat.`                                                            |

`{nama}` dan `{Ruang}` disusun klien dari data yang sudah dimuat; pesan galat DB, log, `job_runs`, dan alert tidak memuat nama trip, nominal, atau nama dompet.

## Salinan final S15 (mengikat Task 7, 8, 9, 10)

| Bingkai   | Teks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TR1–TR4   | `Trip`; `Trip · Pribadi`/`Trip · Bersama`; `Tambah trip`; `Berlangsung`; `Akan datang`; `Selesai`; `Diarsipkan`; `Trip diarsipkan ({n})`; `{rentang} · {n} hari`; `{n} pengeluaran`; `Belum ada pengeluaran`; `Sisa Rp …`; `Lebih Rp …`; `Belum ada trip.`; `Kelompokkan pengeluaran perjalanan, lihat totalnya, dan bandingkan dengan anggaran.`; `Tidak ada trip aktif.`; `Memuat trip…`; `Trip belum bisa dimuat.`; `Pulihkan`; `Pulihkan trip {nama}`                                                                                                                                                                                                                                                                                                                |
| TR5–TR7   | `Total pengeluaran`; `Belum ada pengeluaran di trip ini`; `Rata-rata Rp … per hari`; `Berlangsung · hari ke {n} dari {m}`; `Akan datang · mulai {tgl}`; `Ubah trip`; `Arsipkan`; `Anggaran trip`; `Hanya pembanding. Tidak mengubah anggaran bulanan.`; `{pct}%`; `Kurang dari 1%`; `Tambah anggaran trip`; `{pct} persen dari anggaran trip, Rp … dari Rp …`; `Per kategori`; `Per hari ({n} hari)`; `Dicatat oleh`; `Kamu`; `Tanpa kategori`; `Di luar tanggal trip`                                                                                                                                                                                                                                                                                                   |
| TR8–TR10  | `Pengeluaran`; `Keluarkan dari trip: {judul}`; `{judul} dikeluarkan dari {nama}`; `Urungkan`; `Dari patungan`; `Menampilkan 200 pengeluaran terbaru. Rincian di atas dihitung dari semua pengeluaran trip.`; `Pengeluaran tanggal trip yang belum masuk`; `{n} pengeluaran bertanggal {rentang} belum masuk trip mana pun.`; `Masukkan {n} pengeluaran`; `Masih ada yang lain. Ulangi sesudah ini.`; `Masukkan ke {nama} · {Ruang}`; `Pengeluaran Kantor dan talangan tidak ikut. Kamu bisa mengeluarkan satu per satu sesudahnya.`; `Memasukkan…`; `Batal`; `{n} pengeluaran dimasukkan ke {nama}`; `Catat pengeluaran dengan tanggal di rentang trip, dan trip ini terpilih otomatis di Catat.`; `Trip ini diarsipkan.`; `Pulihkan supaya bisa dipilih lagi di Catat.` |
| TR11–TR13 | `Tambah trip · {Ruang}`; `Ubah trip · {Ruang}`; `Nama trip`; `Misalnya Bali, Desember 2026.`; `Mulai`; `Selesai`; `Anggaran trip (opsional)`; `Hanya pembanding di halaman trip. Tidak mengubah anggaran bulanan atau Laporan.`; `Hapus anggaran`; `Mengubah tanggal tidak memindahkan pengeluaran yang sudah masuk trip.`; `Simpan trip`; `Simpan perubahan`; `Menyimpan…`; `Trip {nama} dibuat di {Ruang}`; `Trip {nama} diperbarui di {Ruang}`; `Arsipkan {nama}?`; `Trip hilang dari pilihan di Catat dan dari daftar utama. Pengeluarannya tetap tercatat dan total trip tidak berubah. Kamu bisa memulihkannya dari Trip diarsipkan.`; `Trip ini juga hilang dari pilihan {nama}.`; `Kembali`; `Trip {nama} diarsipkan`; `Trip {nama} aktif lagi`                  |
| TR14–TR16 | `Tambah ke trip`; `Trip {nama}, ganti`; `Lepas`; `Lepas dari trip {nama}`; `Pilih trip · {Ruang}`; `Tidak masuk trip`; `Sesuai tanggal`; `Dipilih otomatis karena tanggalnya di rentang trip.`; `Trip dilepas: pengeluaran Kantor atau talangan tidak bisa masuk trip.`; `{nama} · Diarsipkan`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| TR17–TR20 | `Trip`; `Trip tidak ikut. Pengeluaran ini keluar dari trip {nama}.`; `Trip tidak bisa diubah sesudah tagihan dibagi. Batalkan tagihan di Patungan bila salah.`; kolom CSV `Trip`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Ukuran layar dan tema

- **320:** nama trip 60 huruf (≤ 2 baris di daftar, penuh di detail); `Rp 12.345.678.900` di total daftar (turun ke baris sendiri), angka besar hero, anggaran, `Lebih`, baris rincian, nominal baris pengeluaran, sheet `Masukkan`; rentang `28 Des 2026 – 3 Jan 2027` membungkus di `–`/spasi, tidak di tengah tanggal; baris pengeluaran dengan tombol `Keluarkan` 44 di kanan tanpa memampatkan judul di bawah ±150 px; `Per hari` dengan penanda `Di luar tanggal trip`; sheet Tambah penuh layar, footer menempel, dua `DateInput` bersusun (satu kolom di bawah 360); baris Trip di Catat compact (papan ketik) tidak mendorong nominal/kategori/simpan keluar layar; chip dengan nama 60 huruf `truncate`.
- **390:** semua keadaan TR10 (kosong, akan datang, berlangsung, selesai, terarsip, anggaran ada/lewat/tanpa), daftar dengan tiga grup + `Trip diarsipkan` terbuka, sheet Tambah dengan galat per kolom, sheet Masukkan (5 baris dan 100+), pemilih `Pilih trip` dengan `Sesuai tanggal`, dialog Arsipkan (Bersama dengan paragraf tambahan).
- **1280:** daftar dan detail satu kolom `max-w-180` di bawah header; tombol `Tambah trip` di kanan `h1`; sheet = dialog tengah 520; rincian dan daftar pengeluaran di kolom yang sama dengan hero.
- **Tema:** gelap (bawaan) dan terang. Bilah anggaran warna ruang (`pribadi`/`bersama`) di jalur `surface-2`, kontras non-teks ≥ 3:1 di kedua tema (pasangan sudah diuji S13); `Lebih Rp …` memakai `warning` dengan ikon dan kata (terang `#9A5B00`); lime tidak pernah jadi teks di terang (`Berlangsung` memakai `accent-text`); ikon `airplane-tilt` mengikuti warna teks.

## Target sentuh, urutan fokus, nama aksesibel

- Semua kontrol ≥ 44 dengan jarak ≥ 8: `Tambah trip` (44/48), baris trip (≥ 72), `Ubah trip`, `Arsipkan`, `Pulihkan`, `Tambah anggaran trip`, `Hapus anggaran`, `Masukkan {n} pengeluaran`, ringkasan `details` rincian, tombol `Keluarkan` (44×44), `Tambah ke trip`, chip dan `Lepas` (44), opsi `Pilih trip` (≥ 56), footer sheet (48).
- **Urutan DOM = fokus = baca.** Daftar: `BackLink` → `h1` → `Tambah trip` → per grup (baris) → `Trip diarsipkan` (ringkasan → baris → `Pulihkan` per baris). Detail: `BackLink` → hero (nama → fase → total → rata-rata → `Ubah trip` → `Arsipkan` → `Tambah anggaran trip`) → anggaran → (terarsip: banner) → kartu `Masukkan` → rincian (Per kategori → Per hari → Dicatat oleh) → `Pengeluaran` (per baris: tautan → `Keluarkan`). Catat: nominal → kategori → … → dompet + tanggal → **Trip** (chip → `Lepas`) → Keterangan → Simpan.
- **Nama aksesibel:** `Keluarkan dari trip: {judul}`; `Pulihkan trip {nama}`; `Trip {nama}, ganti`; `Lepas dari trip {nama}` (teks tampak `Lepas` di awal nama); bilah anggaran `role="progressbar"` bernama `Anggaran trip` dengan `aria-valuetext` (TR6); `h1` fokus awal di daftar dan detail; fokus kembali ke pembuka sesudah sheet/dialog ditutup (`Tambah trip`, `Ubah trip`, `Masukkan`, chip); fokus awal dialog `Arsipkan` = `Kembali`; `alert` untuk galat sheet, `status` untuk pelepasan otomatis dan `name_taken` Pulihkan.
- Status tidak pernah hanya warna: fase (ikon + teks), `Lebih` (ikon + kata + warna), `Di luar tanggal trip` (ikon + teks), `Sesuai tanggal` (ikon + teks), `Dari patungan` (ikon + teks).

## Budget JS dan aturan implementasi

- Ukur dari `main` sebelum menambah: Beranda 157,5, Transaksi 157,6, Detail transaksi 153,6, Kontak 148,5, Sampah 155,6 (handoff S14). Target: `/[ruang]/trip` ≤ 152 (pembanding Kontak 148,5), `/[ruang]/trip/[id]` ≤ 154; **Beranda, Transaksi, Detail transaksi, Sampah tidak naik** di luar galat ukur (tambahan Menu `Trip` + `trip-hrefs.ts` di shell dicatat; bila > 0,3 kB, href dibuat inline). Prototipe tidak berubah (Beranda 161,7).
- **Server Component:** halaman daftar, hero Detail, kartu anggaran, rincian (`details` HTML murni), daftar pengeluaran, kartu `Masukkan`, baris `Trip` di Detail transaksi, banner terarsip. **Pulau malas** (chunk `trip-client`): sheet Tambah/Ubah, dialog Arsipkan, `Pulihkan`, `Keluarkan`, sheet Masukkan, tombol-pembuka. **Catat/Ubah:** pemilih Trip = baris kecil di bundel sheet (sudah malas) dan halaman `Pilih trip` = impor dinamis seperti `SplitSharesPage` (tidak masuk JS Catat awal).
- Tanpa pustaka grafik; bilah anggaran = dua `span`.
- **Ukuran uji layar (Task 7 sampai 9, 12):** 320, 390, 1280; gelap dan terang; `Rp 12.345.678.900` di total, anggaran, `Lebih`, rincian, baris; nama 60 huruf; keadaan daftar (kosong, satu, banyak, tiga grup, terarsip, memuat, galat), detail (semua TR10), sheet (Tambah dengan galat, Ubah, Masukkan, Arsipkan), Catat (tanpa trip, saran otomatis, dua trip tumpang tindih, Talangan/Kantor, compact 320, Bersama patungan), Detail transaksi; Bersama solo dan dua anggota; axe tanpa pelanggaran serius.

## Dampak ke task lain

1. **Task 2/3/4 (DB), nomor baris:** badan fungsi yang disalin = versi hidup di tabel "Fakta kode" (bukan baris `migrate:down`); review Task 4 mendiff `pg_get_functiondef` sebelum dan sesudah untuk `create_entry`, `update_entry`, `create_split`, `export_entries`, `assert_entry_shape`, `dq_run`. Plan menulis "terakhir `0143:1213`"/"`0106:423`"/"`0140:873`": salah.
2. **Task 3 `api.trip_overview`:** kolom `elapsed_days` dan `per_day` dibagi `elapsed_days` (Kendala 2); `phase` dari `app.today()` WIB. `api.list_trips` mengembalikan `day_count`, `spent`, `entry_count`, `budget_amount`, `budget_left` (untuk baris daftar; pola `Sisa`/`Lebih` TR3), `phase`, `archived_at`. `api.trip_breakdown` `dim=member` memberi `key` (id pengguna) dan `label` (nama dari `app.space_roster`); `dim=day` hanya hari berpengeluaran. `api.trip_candidates` memberi `entry_id`, `occurred_on`, `description`, nama kategori, nama dompet, `amount`; Task 6 meminta `p_limit = 101` (Kendala 6).
3. **Task 4:** `set_entries_trip(null)` pada trip terarsip diizinkan (UI hanya memakainya dari trip aktif dan dari `Urungkan`); `update_entry` ke trip yang sama pada entri yang sudah ber-trip boleh walau trip terarsip (Pemilih Ubah menyertakan trip entri; TR15). Entri patungan: `set_entries_trip` menolak `split_locked` (TR8).
4. **Task 6:** `CatatOptions.trips` (id, nama, `startsOn`, `endsOn`, `archived`), jendela 30 hari (Kendala 7); loader Ubah menyertakan trip entri; `EntryVM.tripId/tripName`; filter `tripId` di `listEntriesTx`; kode galat dan salinan di tabel galat; `trip-hrefs.ts`; pembantu `rangeLabel` dan `suggestTrip` (`features/trip`). `setEntriesTrip` mengembalikan jumlah baris yang berubah (toast `{n}`).
5. **Task 7:** Menu (TR1), daftar (TR2–TR4), sheet Tambah/Ubah dan dialog arsip (TR11–TR13), loading/galat; `Trip diarsipkan` terlipat.
6. **Task 8:** Detail (TR5–TR10), `Keluarkan`/`Masukkan`; daftar pengeluaran tanpa total harian dan tanpa tautan ke Transaksi saat terpotong; baris patungan tanpa tombol; rincian dari SQL, `Di luar tanggal trip`.
7. **Task 9:** pemilih di Catat/Ubah (TR14–TR16), `switchRuang` mengosongkan trip, pelepasan otomatis di Ubah, baris `Trip` Detail transaksi (TR17), catatan Pindahkan (TR18), kalimat patungan (TR19). Ukur Catat compact 320.
8. **Task 10:** kolom CSV (TR20); Sampah/Pulihkan dengan tag (TR21). Tidak ada perubahan UI Ekspor.
9. **Task 11:** e2e `trip.spec.ts` mengikuti keadaan "Ukuran layar dan tema" (320 + axe); `zz-trip.spec.ts` memeriksa kanari nama, `Dicatat oleh`, patungan ke trip, feed (K16).
10. **Task 12:** Delivery Gate dengan daftar periksa di bawah; ikon tidak ada yang baru.

## Keputusan agen atas nama pemilik (Task 1)

1. **Keanggotaan = tag eksplisit; rentang hanya saran dan `Masukkan`** (K2, **[konfirmasi pemilik]**; menyimpang dari S-47, lihat `docs/m0a-keputusan.md` "S15").
2. **Anggaran trip tanpa bilah di daftar; bilah hanya di detail**, satu warna ruang; `Lebih` = ikon + kata + `warning` (bukan merah): kelebihan anggaran adalah peringatan uang, beda dari progres rendah tujuan.
3. **`{n} pengeluaran`, bukan `{n} transaksi`** (Kendala 8).
4. **`Mulai` bawaan hari ini, `Selesai` kosong wajib** (satu keputusan sadar tentang lamanya trip; tidak menebak).
5. **`Keluarkan` langsung tanpa dialog + `Urungkan`; `Masukkan` dengan sheet pratinjau, tanpa pilih-per-baris** (satu tombol, pengeluaran bisa dikeluarkan sesudahnya; tidak menambah mode pilih).
6. **Tombol `Keluarkan` ikon-saja 44×44 di kanan baris** (baris tidak bisa memuat tombol di dalam tautan, dan teks `Keluarkan dari trip` per baris menggandakan tinggi daftar); nama aksesibel memuat kata kerja dan judul, toast memberi teks.
7. **Pelepasan trip otomatis di Ubah (Talangan/Kantor) dengan kalimat `status`**, bukan menolak simpan: mencegah galat `trip_entry_invalid` di jalur normal.
8. **Saran K9 hanya Catat, dihitung klien, berhenti setelah pengguna menyentuh chip**; dua trip tumpang tindih = tanpa saran.
9. **Tanpa kartu Beranda, segmen Rencana, filter Transaksi, badge baris** (K10): `Trip` hanya di Menu, Catat/Ubah, dan Detail transaksi.
10. **`elapsed_days` dan `per_day` dibagi hari berjalan** (Kendala 2) menggantikan rumus plan; perlu persetujuan pengendali sebelum Task 3.
11. **Nomor baris plan dikoreksi** (tabel fakta kode); bukan keputusan desain, tetapi menentukan Task 2 dan 4.

## Pertanyaan untuk pemilik dan penyimpangan

1. **K2, K4, K9, K12** tetap **[konfirmasi pemilik]** (default agen dipakai; lihat `docs/m0a-keputusan.md` "S15"). K2 menyimpang dari S-47; perubahan belakangan = `trip_exclusions` + fungsi baca `create or replace` (expand-only).
2. **Rata-rata per hari** memakai hari berjalan (Kendala 2), bukan panjang trip seperti plan. Setuju? (Tanpa ini trip yang sedang berlangsung menampilkan rata-rata terlalu rendah.)
3. **Tidak ada tautan ke Transaksi saat daftar trip terpotong** (Kendala 5) dan tidak ada filter trip di Transaksi (K10). Cukup, atau pemilik mau filter `Trip` di Transaksi sebagai task tambahan?
4. **Jendela 30 hari** untuk trip di pemilih Catat (Kendala 7): pengeluaran yang jauh di belakang masuk lewat `Masukkan` atau Ubah. Cukup?
5. **Trip tidak ada di baris Transaksi** (tanpa badge): pengguna tahu sebuah pengeluaran bertrip hanya dari Detail transaksi atau Detail trip. Cukup untuk M5?
6. **Patungan:** tag trip terkunci sesudah tagihan dibagi (K6); salah tag = batalkan tagihan lalu buat ulang. Cukup?

## Untuk kursi design reviewer

Daftar periksa Task 7 (daftar, sheet), Task 8 (Detail), Task 9 (Catat/Ubah/Detail transaksi), dinilai dari screenshot 320/390/1280 terang dan gelap, bukan dari kode saja:

1. **Salinan:** tidak ada "boncos", "surplus", "budget", "Liburan" sebagai istilah produk, "tag", "grup", "rumah tangga", tanda seru di layar, `aria-label`, `title`, toast; `Trip`, `Masukkan`, `Keluarkan dari trip`, `Dicatat oleh`, `Sisa Rp …`, `Lebih Rp …` seperti "Salinan final S15"; `{n} pengeluaran` (bukan transaksi).
2. **Tanpa `Rp 0`:** total 0 = `Belum ada pengeluaran` (daftar) / `Belum ada pengeluaran di trip ini` (detail); tidak ada baris rincian nol; anggaran tanpa pengeluaran tanpa `Sisa`; rata-rata tidak tampil bila 0 atau belum mulai.
3. **Satu angka besar per layar** (total di Detail trip); anggaran dan rincian lebih kecil; kartu tanpa bayangan; Beranda tidak berubah (tidak ada kartu trip).
4. **Anggaran:** bilah satu warna ruang di 0%, 1%, 45%, 99%, 100%, 112%; `role="progressbar"` + `aria-valuetext`; `Lebih` = ikon + kata (bukan warna saja); persen sebagai teks di sampingnya; `Hanya pembanding…` terbaca; kontras bilah ≥ 3:1 di kedua tema.
5. **Fase dan status = ikon + teks:** `Berlangsung`, `Akan datang`, `Selesai`, `Diarsipkan`, `Di luar tanggal trip`, `Sesuai tanggal`, `Dari patungan`; tidak ada merah/hijau untuk fase.
6. **Angka cocok antar layar:** total hero = Σ per kategori = Σ per hari = Σ `Dicatat oleh` (Bersama ≥ 2) = total di daftar Trip; Σ pengeluaran trip ≤ Laporan periode yang sama; Laporan, anggaran bulanan, "aman dipakai", Kontribusi tidak berubah sesudah membuat/menandai/mengeluarkan/mengarsipkan (e2e membandingkan, reviewer mengecek screenshot).
7. **320 px:** nama 60 huruf, `Rp 12.345.678.900` di semua tempat TR tanpa gulir horizontal dan tanpa nominal terpotong; rentang tidak pecah di tengah tanggal; baris pengeluaran dengan tombol `Keluarkan` tetap terbaca (judul ≥ ±150 px); sheet Tambah dua `DateInput` satu kolom; Catat compact: nominal, kategori, Trip, Simpan di layar.
8. **Target sentuh ≥ 44, jarak ≥ 8;** urutan fokus sesuai bagian "Target sentuh"; fokus kembali ke pembuka sesudah sheet/dialog; fokus awal `Arsipkan` = `Kembali`; nama aksesibel memuat judul untuk tombol per-baris.
9. **Ruang tertulis:** `Trip · Pribadi`/`· Bersama` di judul, `SpaceTag`, judul sheet dan toast; Bersama dua anggota menampilkan `Dicatat oleh`, solo/Pribadi tidak; paragraf tambahan di dialog Arsipkan hanya Bersama dua anggota; tidak ada jejak trip Pribadi di Bersama.
10. **Pemilih Catat/Ubah:** tidak tampil untuk pemasukan, transfer, Talangan, dompet Kantor, atau ruang tanpa trip; saran otomatis terlihat (chip + `Lepas` + kalimat), tidak ada saran untuk dua trip yang tumpang tindih; trip terarsip tidak muncul (kecuali trip entri sendiri di Ubah, berlabel `Diarsipkan`); pelepasan otomatis di Ubah memberi kalimat; `switchRuang` tidak membawa trip.
11. **Detail transaksi:** baris `Trip` (tautan) hanya untuk entri bertrip; `Pindahkan` menyebut `Trip tidak ikut`; entri patungan tanpa Ubah dan tanpa `Keluarkan`.
12. **Keadaan:** daftar (kosong, hanya terarsip, tiga grup, banyak, memuat, galat), detail (semua TR10 + anggaran ada/tanpa/lewat + 200 terpotong), sheet Masukkan (sedikit, 100+, galat `trip_entry_invalid`), Tambah/Ubah (galat per kolom), Bersama solo dan dua anggota.
13. **Hirarki dan konsistensi:** pola daftar = Kontak/Kategori; sheet = pola Tambah tujuan; tidak ada elemen baru di Beranda, Transaksi (baris), Rencana.

## Hasil Delivery Gate

**Lulus (2026-11-23, `docs/design/s15-critique.md`).** 84 tangkapan (14 layar × 320/390/1280 × gelap/terang) dari `screens-s15-trip.spec.ts`: overflow 0, kata terlarang 0, `Rp 0` = 0; 1 temuan Penting (`S15-C1`: judul baris `Pengeluaran` terhimpit di 390 px saat nominal 12,34 M) diperbaiki di `trip-detail-views.tsx` (`flex-wrap` + `min-w-36`) dan diverifikasi ulang, 1 Minor (`S15-C2`) ditunda, 0 Blocker. Budget JS: `/pribadi/trip` 148,3 kB, `/pribadi/trip/[id]` 148,7 kB, Beranda 157,4 kB, Transaksi 157,4 kB, Detail transaksi 153,4 kB (batas 162 kB); prototipe tidak berubah (9/9 `budget.spec.ts` lulus).
