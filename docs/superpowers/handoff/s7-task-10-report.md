# S7 Task 10 · laporan implementer: Catat transfer antar ruang dan talangan

Status: DONE_WITH_CONCERNS (concern di bagian akhir; tidak ada yang menghalangi review).

## Perubahan
- `features/catat/source.ts`: `CatatDraft` + `toRuang`, `sharedNote`, `reimbursable`; `CatatSource` + `spaceTransferTargets(toRuang)` (wajib) dan `sharedAudience?()`.
- `use-catat.tsx`: state `cross` (muat malas, urutan jawaban dijaga), `setCrossTarget`, `setSharedNote`, `setReimbursable`, `crossBlocked`, `sourceAccounts` (tanpa Kantor saat antar ruang), `canReimburse`; reset saat jenis/ruang/dompet Kantor berganti; galat `cross_space_not_allowed`/`cross_space_kantor` (tanpa Coba lagi, fokus ke chip `Ruang lain…` / Select `Dari dompet`).
- `space-target-page.tsx` (baru, dimuat `React.lazy` saat `Ruang lain…` diketuk): halaman `Ke dompet di {Ruang}`, baris tanpa saldo, keadaan memuat/galat/kosong (+ `Tambah dompet`), panah hanya memindah fokus.
- `catat-sheet.tsx`, `wallet-picker.tsx` (chip `Ruang lain…`, chip terpilih `{Dompet} · {Ruang}`, keterangan Kantor, `MetaSelect tight`), `type-menu.tsx` (judul dua ruang), `chip.tsx` (prop `buttonRef`), `catat-status.tsx`, `saved-toast.ts`.
- `demo-source.ts`: dua kaki bertaut `linkId` (clientId hanya di kaki sumber; keterangan hanya di kaki Pribadi, `sharedNote` hanya di kaki Bersama), `reimbursable`, `spaceTransferTargets` (tanpa Kantor).
- `_real/catat-source-real.ts`: `space_transfer` + `toRuang`/`sharedNote`, `reimbursable`, `spaceTransferTargets` lewat `moveTargetsAction` (dimuat malas per sesi sheet, tidak lewat props/URL, R27), toast tanpa nama dompet.
- Tes: `use-catat.s7.test.ts` (11), `catat-sheet.s7.test.tsx` (8), `catat-source-real.test.ts` (+6), e2e `tests/e2e/catat-s7.spec.ts` (7), screenshot `tests/e2e/screenshots-s7.spec.ts` (@screens).

## Bukti RED -> GREEN
- Hook dan sumber nyata ditulis test-first: `use-catat.s7.test.ts` 11/11 gagal sebelum implementasi, lalu hijau; `catat-source-real` 4 gagal -> 19 hijau.
- Tes UI sheet (`catat-sheet.s7.test.tsx`) dan e2e ditulis SESUDAH komponen (jujur: tidak test-first); RED dibuktikan sesudahnya dengan menyimpan sementara `catat-sheet.tsx`, `wallet-picker.tsx`, `type-menu.tsx` ke stash: 8/8 gagal, setelah dipulihkan 8/8 hijau.

## Budget JS (kB gzip, batas 162)
| Rute | prototipe | nyata |
| --- | --- | --- |
| beranda | 161,4 (sebelum 161,4) | 157,3 (sebelum 157,3) |
| transaksi | 160,7 | 156,5 |
| detail | 157,5 | 153,4 |
| sampah | 158,6 | 154,4 |
| dompet | 157,0 | 152,9 |
Tambahan UI ada di chunk sheet (sudah malas) dan `space-target-page` (malas lagi); tidak ada perubahan angka rute.

## Gerbang
lint, typecheck, format:check hijau; unit web 1796 (+25), worker 32, domain 97/28, demo-data 37; build hijau; `test:int` 141; `e2e:ledger` 19 (budget nyata di atas); e2e prototipe 287 (280 + 7 baru). Satu putaran e2e penuh sempat gagal 2 tes lama (`catat.spec` "default date is today WIB", `theme.spec` "Terang tersimpan") karena beban paralel; lolos sendirian dua kali dan di putaran penuh ulang (287/287). Tidak terkait perubahan ini (tes berbasis jam/penyimpanan).

## Bukti ukuran (e2e `catat-s7.spec.ts`)
- 360x640 dengan keyboard, Talangan aktif: tinggi sheet <= 356 dan tidak bertambah dibanding sebelum toggle dinyalakan (selisih <= 1 px); nominal, label ruang, 4 chip, Dari dompet, toggle, Simpan terlihat utuh; baris meta satu baris; toggle >= 44x44; kedua MetaSelect >= 88 px (sebenarnya ±108) dan `Hari ini` tidak terpotong (diukur di kanvas).
- 320x568: baris meta satu baris, MetaSelect >= 88 px, tanpa gulir horizontal. Di 320 nilai Select tanggal terpotong ellipsis (area teks 28 px) sesuai fallback bingkai ("bila < 88 px ... ikon + ellipsis").
- 320: chip terpilih `{Dompet} · Bersama` <= 288 px, `Ruang lain…` utuh, judul `Pribadi → Bersama` satu baris dan tidak terpotong, tanpa gulir horizontal (nominal `12.345.678.900`).

## Screenshot (docs/design/s7/, 1x, terang dan gelap)
`c1-halaman-ruang-lain-{390,1280}-{dark,light}.png`, `c1-transfer-antar-ruang-{390,1280}-{dark,light}.png`, `c2-talangan-{390,1280}-{dark,light}.png`, `c2-talangan-keyboard-360-{dark,light}.png` (14 berkas). Regenerasi: `SCREENS=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec playwright test screenshots-s7` (butuh `pnpm build`).
Pemeriksaan sendiri terhadap DESIGN.md dan bingkai: token dan radius sama (chip 12, tombol 12, sheet 24), status = ikon + teks (chip terpilih ✓, toggle `aria-checked` + garis + petunjuk), kedua ruang tertulis di judul dengan warna ruang masing-masing, tidak ada bayangan baru, target >= 44.

## Keputusan sendiri
1. Draf tetap `type: 'transfer'` dengan `toRuang` terisi (bukan jenis baru); `save` nyata memetakannya ke `kind: 'space_transfer'`. Menu jenis tidak berubah.
2. Chip terpilih ruang lain tidak bisa diketuk (mengganti lewat `Ruang lain…`), supaya panah di radiogroup tidak membuka halaman.
3. Judul dua ruang di HP (< 600 px): kata `Transfer ·` hanya untuk pembaca layar (nama dialog tetap `Transfer · Pribadi → Bersama`); di 390/320 versi penuh terpotong menyembunyikan ruang asal, jadi ruang yang dipertahankan utuh. Dari 600 px kata itu tampil.
4. Petunjuk Talangan: satu baris ellipsis hanya di mode keyboard; di luar itu boleh membungkus (di 390 teks utuh, tinggi tidak dibatasi).
5. `MetaSelect` varian `tight` (padding dalam dirapatkan) hanya di HP saat tombol Talangan tampil, supaya `Hari ini` muat di 360.
6. Galat `cross_space_*` dipetakan ke kotak S6-C2 tanpa Coba lagi, label tombol tetap `Simpan` (retry memakai clientId sama; server menolak tanpa menyimpan, jadi aman).
7. Tidak ada UI biaya transfer (`fee`) — tidak ada di bingkai.

## Concern
- Placeholder `Catatan untuk Bersama` mode nyata memakai teks umum `Terlihat oleh anggota Bersama` (varian solo), bukan `{Nama anggota lain}`: roster Bersama tidak ada di props layout maupun hasil `moveTargetsAction`, dan menambahkannya berarti mengubah Task 8 / payload RSC. Mode prototipe memakai nama (Farida). Usul: Task 13 (Beranda Bersama, yang sudah butuh anggota) atau Task 11 menambah nama ke respons `moveTargetsAction` bila pemilik ingin nama.
- Petunjuk Talangan terpotong ellipsis di mode keyboard 360 (`Tercatat di Menu…`), sesuai bingkai (teks lengkap di `aria-describedby`); reviewer desain boleh menilai apakah salinan perlu dipendekkan.
- Tidak ada e2e mode nyata untuk transfer antar ruang/talangan di Catat (milik Task 17); tes nyata hanya tingkat unit sumber dan action yang di-mock.
- Dua proses `next-server` yatim (PID 7153, 7449) dan shell skrip controller sudah ada sebelum sesi ini; tidak disentuh.
