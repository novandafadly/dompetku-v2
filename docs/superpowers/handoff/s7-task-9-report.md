# S7 Task 9: Pangkas seed demo dari JS mode nyata (K3), laporan implementer

**Status: DONE_WITH_CONCERNS.** Seed demo sudah keluar dari semua JS mode nyata, dan semua gerbang hijau. Target Beranda nyata ≤ 157 kB **tidak tercapai**: hasilnya 157,3 kB (headroom 4,7 kB, sebelumnya 1,2 kB).

Commit: `perf(web): seed demo tidak ikut JS mode nyata`.

## Apa yang diubah

- `features/shell/demo-context.ts` (baru): `DemoContext`, `useDemo`, `DemoView`, `DataState`, tanpa seed. Semua layar prototipe sekarang mengimpor `useDemo` dari sini (13 berkas, hanya jalur impornya yang berubah).
- `features/shell/demo-provider.tsx`: isinya tinggal `DemoProvider` (seed + store) dan `demoClock`.
- `features/shell/demo-root.tsx` (baru): `DemoRoot` = `React.lazy(() => import('./demo-provider'))` dibungkus komponen fungsi. Ekspor modul klien yang dirender Server Component harus berupa fungsi; ekspor objek lazy langsung memicu React #306.
- `app/layout.tsx`: cabang prototipe memasang `<DemoRoot>`. Mode nyata tidak mengimpor `demo-provider` sama sekali.
- `features/shell/rencana-context.ts` (baru): `RencanaContext` dipindah dari `nav-items.tsx`. Tanpa ini, chunk muat malas ikut menyalin `nav-items` beserta ikonnya (±1 kB).
- Tes:
  - `tests/e2e-ledger/ledger.spec.ts`: tes baru "JS mode nyata tanpa seed demo (K3)". Untuk 10 rute nyata (Beranda, Transaksi, Dompet, Sampah, Kategori × Pribadi/Bersama) plus Detail, tes ini memeriksa semua JS yang dimuat sampai jaringan diam (muat awal, prefetch, muat malas) terhadap penanda seed: `Belanja mingguan`, `Gaji bulanan`, `Kopi susu`, `cp-makan`, `m-novanda`.
  - `src/app/layout.test.tsx`: disesuaikan ke `DemoRoot`, ditambah penjaga statis: hanya `demo-root.tsx` yang mengimpor `demo-provider`, dan lewat `import()`; `createSeed`/`createDemoStore` hanya dipanggil di `demo-provider.tsx`.
  - Tes prototipe lama yang disesuaikan, dengan alasan "chunk DemoProvider = JS rute prototipe":
    - `tests/e2e/budget.spec.ts` menghitung chunk demo (tepat satu) sebagai JS rute.
    - `tests/e2e/catat.spec.ts`: dua tes yang menahan semua JS di luar HTML kini meloloskan chunk demo.
    - `tests/e2e/route-scripts.ts` menyediakan `isDemoChunk`.
- `docs/adr/0002-js-budget.md`: bagian pembaruan berisi aturan hitung baru dan tabel angka.

## RED → GREEN

- RED, build `HEAD` sebelum perubahan:
  - Tes seed gagal: `/pribadi/beranda: /_next/static/chunks/0rlfcluta5gy-.js memuat "Belanja mingguan"`.
  - Asersi Beranda ≤ 157 gagal: `Received: 160.76`.
- GREEN: tes seed lulus di semua rute. Asersi ≤ 157 dihapus karena target tidak tercapai (sesuai brief: angka akhir dicatat, bukan dicurangi). Angkanya tercatat di anotasi `js-route-kB`.

## Budget JS (kB, JS rute muat dingin)

| Rute                 | Nyata sebelum | Nyata sesudah | Prototipe sebelum | Prototipe sesudah (termasuk chunk demo) |
| -------------------- | ------------- | ------------- | ----------------- | --------------------------------------- |
| `/pribadi/beranda`   | 160,8         | 157,3         | 160,8             | 161,4                                   |
| `/pribadi/transaksi` | 160,0         | 156,5         | 160,0             | 160,7                                   |
| Detail transaksi     | 156,9         | 153,4         | 156,8             | 157,5                                   |
| `/pribadi/sampah`    | 158,0         | 154,4         | 158,0             | 158,5                                   |
| `/pribadi/dompet`    | 156,4         | 152,9         | 156,3             | 157,0                                   |

## Gerbang

- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`: hijau (web 1771 tes).
- `pnpm build`: hijau.
- `test:int`: 141/141.
- `e2e:ledger`: 19/19.
- `e2e:auth`: 21/21.
- e2e prototipe: 280/280.

## Keputusan sendiri

1. **`React.lazy`, bukan impor dinamis di server.** Percobaan pertama memakai `await import()` di root layout. Turbopack tetap memasukkan modul klien yang diimpor dinamis dari Server Component ke JS entri layout (hash chunk tidak berubah). Batas muat malas harus ada di sisi klien.
2. **`React.lazy`, bukan `next/dynamic`.**
   - `next/dynamic` menyisipkan preload chunk di HTML, jadi perilaku prototipe identik. Tetapi runtime-nya (PreloadChunks, workAsyncStorage, BailoutToCSR) menambah ±1,4 kB ke JS muat awal kedua mode.
   - Terukur dengan `next/dynamic` (root + layar demo per page): prototipe Beranda 163,2 dan Transaksi 162,6 kB, keduanya melewati 162.
   - Varian `next/dynamic` root saja diperkirakan, tidak diukur: nyata ±158,7 dan prototipe ±162,8.
3. **Chunk demo tetap dihitung di budget prototipe.** Chunk itu tidak dirujuk HTML, tetapi hidrasi prototipe menunggunya. Kalau tidak dihitung, angka prototipe turun palsu ke ±157 kB. Chunk dikenali lewat penanda seed, dan tes menuntut tepat satu chunk demo.
4. **Layar demo per page tidak dipecah.** Varian yang memuat malas `view.tsx` per page sudah dicoba:
   - Mode nyata menjadi Beranda 153,7, Transaksi 151,3, Detail 150,0, Sampah 155,6, Dompet 150,3 (terukur dengan `next/dynamic`; dengan `React.lazy` ±1,4 kB lebih kecil).
   - Prototipe yang dihitung jujur (layar demo menghalangi hidrasi) menjadi ±162,4 kB untuk Beranda. Itu melewati 162, karena gzip per chunk terpisah kehilangan ±1 kB.
   - Karena itu varian ini tidak dipakai, dan target 157 meleset 0,3 kB.

## Concern

1. **Beranda nyata 157,3 kB > target 157** (headroom 4,7 kB). Jalan ke ≤ 157 butuh keputusan:
   - (a) Pecah layar demo per page. Hasilnya nyata ±152 kB, tetapi prototipe Beranda ±162,4 kB bila chunk layar demo ikut dihitung. Ini butuh keputusan pemilik soal aturan hitung atau batas prototipe.
   - (b) Pangkas kode lain yang dipakai bersama.
2. **Hidrasi prototipe sekarang menunggu satu permintaan tambahan.** Chunk demo baru diminta sesudah JS rute berjalan. Median waktu sampai `main h1` terhidrasi naik dari ±345 ms ke ±400 ms pada latensi emulasi 40 ms (10 muat per build). Hanya prototipe yang terdampak; mode nyata tidak memuat chunk ini.
   - Klik sebelum hidrasi hilang, seperti sebelumnya, tetapi jendelanya ±55 ms lebih lebar.
   - Tes B5 (`panel-malam.spec.ts`) sudah flaky di baseline: dengan `--repeat-each=3 --retries=0`, 2 dari 3 gagal sebelum perubahan ini. Di CI tes itu memakai retry 1.
3. **Headroom prototipe Beranda tinggal 0,6 kB.** Kode baru S7 yang ikut JS muat awal kedua mode, misalnya di shell atau layout `[ruang]`, bisa mendorong prototipe melewati 162. Kode S7 di `_real/*` dan sheet muat malas tidak terkena.
4. Penanda seed di tes bergantung pada teks seed (`Belanja mingguan` dan seterusnya). Bila seed diubah, `SEED_CODE_MARKERS` (ledger) dan `DEMO_CHUNK_MARKER` (`route-scripts.ts`) ikut diperbarui. Tes budget prototipe gagal keras (`toHaveLength(1)`) bila penanda hilang.
5. Dokumen yang belum diperbarui (tugas Task 18 atau controller): `CLAUDE.md` "Ditunda S6 (kecil)" butir seed demo, dan `docs/superpowers/handoff/s6.md` "Budget JS". ADR 0002 sudah diperbarui.
