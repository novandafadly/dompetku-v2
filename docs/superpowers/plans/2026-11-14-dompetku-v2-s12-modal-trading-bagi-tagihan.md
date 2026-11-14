# DompetKu v2 · S12 (Modal trading, bagi tagihan Bersama, kartu utang, perbaikan S11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (implementer per task, task review, fix loop, review akhir). Model: DB/uang/server = terkuat (opus); UI = sonnet dengan lensa desain (design reviewer di tiap task UI).

**Goal:** Menutup M3 (IPD §6 S12, gerbang M3): **modal trading** (hanya Pribadi, lewat transfer, T10), **bagi tagihan Bersama** (pengeluaran Bersama dibayar dari dompet pribadi → saldo antar-anggota + pelunasan, dihitung dari data), ditambah sisa S11 yang disetujui pemilik 2026-11-14: kartu "Utang yang harus dibayar" di Beranda, migrasi `0132` (CSV utang terbaca + `lock_debt`), `allowNegative` untuk batal cicilan. Gerbang M3: T6–T10 lulus (T6–T9 sudah, T10 di sini).

**Keputusan pemilik 2026-11-14 (sesi ini):** kartu utang **perlu**; CSV utang **perlu diperbaiki**; definisi T6–T9 (K10 S11) **disetujui**; "sepakat semua" atas ringkasan lingkup di bawah. Model data modal trading dan bagi tagihan (K2, K3) adalah **default agen**, belum dibahas rinci dengan pemilik: Task 1 menuliskannya di bingkai dan pemilik boleh membatalkan sebelum Task 4/6 mulai.

**Status spesifikasi:** spec induk §5.4 dan §9.1, PRD:106–107, S-41 (`docs/team/round1/product-owner.md:223`) menetapkan: modal trading hanya Pribadi, lewat transfer, income/expense tidak berubah, pengembalian sebagian benar, peringatan `Kurang Rp…` bila Σ sisa modal > saldo dompet trading; bagi tagihan = saldo antar-anggota + pelunasan tanpa logika tersembunyi. **BSD final tidak punya skema keduanya** (BSD:2714 hanya "polanya sama"). Isi T10 asli tidak ada di repo: definisi di K9 di bawah.

**Arsitektur:** Pola S7 (transfer, talangan) dan S11 (utang). Tidak ada `entry_kind` baru untuk modal trading: pocket dompet baru `trading` (`alter type app.pocket add value`, file sendiri, BSD:2636) + transfer biasa; modal/sisa/kurang dihitung SQL dari transfer (view), tanpa kolom tersimpan. "Aman dipakai" dan Beranda hanya menghitung `pocket = 'operasional'` (`0102:126`, `0120:49`), jadi dompet trading otomatis di luar angka itu. Bagi tagihan: tabel patungan di ruang Bersama yang menunjuk entri pengeluaran Bersama (pembayar, bagian), tabel pelunasan; saldo antar-anggota = view dari keduanya; uang dibayar dari dompet pribadi tidak boleh membuat ruang Pribadi pasangan terlihat (RLS, isolasi). Aritmetika uang di SQL; UI tidak menjumlah.

**Cabang:** `ccr-6b15bf5f-1cnpb6` (dari `main` `746d3a2`; sesi cloud hanya boleh push ke cabang ini, bukan `claude/s12-<topik>` seperti CLAUDE.md). Tanpa PR sampai CI/review siap; **merge = deploy + migrasi `0132`–`0136` di produksi** (maju-saja).

## Keputusan (default agen = rekomendasi)

| # | Keputusan | Default plan | Alasan / bila pemilik memilih lain |
| --- | --- | --- | --- |
| K1 | Kartu "Utang yang harus dibayar" (**disetujui**) | Kartu di Beranda **Pribadi** saja: Σ sisa utang `borrowed` aktif (dari SQL, `api.debt_totals`), baris kedua `Piutang` Σ sisa `lent`; tidak merah; disembunyikan bila 0 (tanpa "Rp 0"); tautan ke Rencana > Utang. Angka "aman dipakai" **tidak diubah** (tetap kas murni) | Menjawab "meminjam menaikkan aman dipakai"; budget JS Beranda nyata 157,5 → batas 162: kartu server-rendered, tanpa chunk baru |
| K2 | Model modal trading | Pocket dompet `trading` (hanya Pribadi, CHECK seperti `kantor`, B10 ditolak di Bersama). **Setor modal** = transfer dari dompet non-trading ke dompet trading; **tarik modal** = sebaliknya (keduanya `kind=transfer`, I6: income/expense tidak berubah). Sisa modal per dompet = `max(0, Σ setor − Σ tarik)`; tarik > setor = hasil realisasi (ditampilkan, bukan pemasukan otomatis); `Kurang Rp…` = `max(0, Σ sisa modal − saldo dompet trading)`. Untung/rugi tidak dicatat otomatis: pengguna mencatat penyesuaian/pemasukan biasa | Satu entri, satu pola; tanpa kind/kelas laporan baru; S-41 "lewat transfer" |
| K3 | Model bagi tagihan Bersama | Pengeluaran di ruang Bersama diberi **pembayar** (anggota) dan **bagian** per anggota (default sama rata 50/50, bisa diubah nominal; Σ bagian = nominal). Pembayar membayar dari dompet pribadinya: kaki Pribadi = transfer keluar bertanda `Bayar untuk Bersama` (bukan pengeluaran pribadi, bukan setoran/kontribusi), kaki Bersama = pengeluaran tanpa gerak dompet Bersama. **Saldo antar-anggota** = Σ(bayar) − Σ(bagian) per anggota, dari view; **pelunasan** = baris `settlement` (pembayar utang → penerima, nominal, tanggal) yang mengubah saldo; tidak ada pembulatan atau pelunasan otomatis | Sesuai PRD:107 dan IPD S12 risiko ("dihitung dari data, tanpa logika pelunasan tersembunyi"); detail kaki lintas ruang diputuskan di Task 1 bila kendala `entry_lines` (akun wajib) memaksa model lain |
| K4 | Pelunasan antar dompet pribadi | Pelunasan dicatat **satu sisi** oleh pelunas: dompet pribadinya keluar (transfer `Lunasi patungan`), baris `settlement` di Bersama mengurangi saldo; sisi penerima **tidak ditulis otomatis** di Pribadinya (isolasi RLS): penerima melihat `Diterima dari <nama>` di Bersama dan boleh mencatat pemasukan sendiri | Menjaga Pribadi pasangan tertutup; no cross-Pribadi write |
| K5 | Batal cicilan buntu saldo kurang | Jalur batal cicilan mendapat `allowNegative` + dialog `Tetap batalkan` seperti Hapus utang (temuan S11) | Konsisten dengan `Tetap hapus` |
| K6 | CSV utang (`0132`) | `export_entries` mengisi Catatan baris pokok/cicilan dengan `coalesce(description, kontak · judul)`; kolom Jenis tetap kunci mesin | Menjawab handoff S11 butir CSV |
| K7 | `lock_debt` (I1 keamanan S11) | `private.lock_debt` memeriksa baris masih ada sesudah `FOR UPDATE` dan mengembalikan `not_found` | Migrasi `0132` (0131 final) |
| K8 | Posisi UI | Modal trading: halaman Dompet (kelompok `Trading`, kartu Modal, peringatan `Kurang`, hanya Pribadi); bagi tagihan: Beranda Bersama (kartu `Saldo patungan`), `/bersama/patungan` (riwayat + Lunasi), sheet Catat Bersama mendapat `Dibayar dari dompet pribadi` | Bingkai Task 1 |
| K9 | Definisi T10 | Setor modal tidak mengubah Σ pemasukan/pengeluaran (I6, Laporan, anggaran); tarik sebagian benar (`sisa = setor − tarik`, tidak negatif, kelebihan = hasil realisasi); `Kurang Rp…` muncul tepat saat Σ sisa modal > saldo; dompet trading di Bersama ditolak (B10); saldo dompet berubah tepat sekali. **Butuh persetujuan pemilik** (isi asli tak ada di repo) | Inferensi dari S-41 |

## Global Constraints

- Semua Global Constraints S6–S11 tetap mengikat: M1 (`requireDataUser()` + `withUser`/`withLedger`), `api.*` DEFINER dengan `app.assert_member` lebih dulu, migrasi expand-only dengan penjaga `migrate_down_blocked_prod` dan `select private.own_api_functions();`, pgTAP test-first, tanpa nominal di galat/log, isolasi Pribadi vs Bersama, budget JS ≤ 162 kB rute (UI lazy).
- `alter type … add value` di **file migrasi sendiri** (`0133`); skema dan fungsi di migrasi berikutnya.
- Kode galat baru dipetakan di `apps/web/src/server/ledger/errors.ts` dan `LedgerErrorCode`.
- Setiap tempat yang mengenal `pocket` ditinjau (grep `pocket`, `'kantor'`, `'operasional'` di migrasi dan TS): Dompet, pemilih dompet Catat/transfer/tagihan, Beranda, Laporan, Ekspor, DQ reconcile, `move_entry_to_space`, WA `@nama` (bawaan tidak pernah kantor, juga tidak trading).
- Setiap `case`/`if` atas `entry_kind` **tidak berubah** (tanpa kind baru); bila Task 1 memutuskan kind baru untuk patungan, ikuti daftar tinjau S11.
- Commit kecil Conventional Commits berbahasa Indonesia, trailer sesuai instruksi sesi. Gerbang sebelum push: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm test:registry`, `pnpm build`, e2e, `test:int`, `e2e:ledger`, `e2e:bersama`, pgTAP seluruh suite + rollback/up (lalu `env='prod'`).

## Peta berkas (garis besar)

| Area | Berkas |
| --- | --- |
| DB | `packages/db/migrations/0132_perbaikan_utang.sql`, `0133_pocket_trading_enum.sql`, `0134_modal_trading.sql`, `0135_patungan_tabel.sql`, `0136_patungan_api.sql` (baru); `tests/{17_dq,00_katalog,99_konkurensi}.sql`, tes baru `31_*`–`33_*`, `REGISTRY.md`, `README.md` |
| Server | `apps/web/src/server/ledger/{utang.ts,trading.ts,patungan.ts,errors.ts,beranda.ts}`, `_actions/{utang,trading,patungan}.ts` |
| UI | `features/beranda/*` (kartu utang, kartu patungan), `features/dompet/*` (Trading, Modal), `features/patungan/*` (baru), `features/catat/*` (dibayar dari dompet pribadi) |
| Dokumen | `docs/design/s12-bingkai.md`, `docs/product/{BSD.md,IPD.md}`, `docs/m0a-keputusan.md`, `docs/superpowers/handoff/s12.md`, `CLAUDE.md` |

---

### Task 1: Persetujuan keputusan dan bingkai desain (tanpa kode)

- [ ] Catat jawaban pemilik 2026-11-14 di `docs/m0a-keputusan.md`; K2, K3, K4, K9 ditandai `[konfirmasi pemilik]`.
- [ ] Putuskan bentuk kaki lintas ruang bagi tagihan dengan kendala nyata: `entry_lines.account_id` wajib, `space_transfer` dua ruang berpasangan (spec §9.1, void bersama), Pribadi pasangan tertutup. Tulis ADR-ringkas di bingkai (pilihan A: kaki Bersama tanpa dompet lewat tabel patungan yang menunjuk entri pengeluaran dengan akun virtual `Dibayar pribadi`; pilihan B: setoran + pengeluaran atomik dalam satu fungsi, kontribusi tercatat). Pilih yang membuat Laporan Bersama, kontribusi (S8), dan reconcile tidak berubah angkanya.
- [ ] `docs/design/s12-bingkai.md` (format `s11-bingkai.md`): kartu Utang di Beranda; Dompet Trading + kartu Modal + peringatan `Kurang Rp…` + sheet Setor/Tarik modal (pakai sheet transfer); Beranda Bersama kartu `Saldo patungan`; `/bersama/patungan` (riwayat, pelunasan); toggle `Dibayar dari dompet pribadi` + pembagian; dialog akibat; keadaan kosong/galat; 320/390/1280. Salinan tanpa "Hutang", tanpa merah untuk angka utang dan saldo patungan, tanpa "Rp 0".

### Task 2: Migrasi `0132` perbaikan utang + `api.debt_totals` (DB) — opus

- [ ] Test-first pgTAP. `api.export_entries`: Catatan pokok/cicilan = `coalesce(description, kontak · judul)` (K6; Σ per kelas tetap = Laporan). `private.lock_debt`: periksa baris ada sesudah `FOR UPDATE` → `not_found` (K7; tes dengan purge di antara baca dan kunci via `99_konkurensi`). `api.debt_totals(space)` (INVOKER/DEFINER sesuai pola baca): Σ sisa `borrowed`, Σ sisa `lent`, jumlah utang aktif, hanya Pribadi, utang terhapus tidak dihitung.
- [ ] `select private.own_api_functions();`, `00_katalog`, rollback/up.

### Task 3: Kartu "Utang yang harus dibayar" (server + UI Beranda Pribadi) — sonnet + lensa desain

- [ ] Loader di `server/ledger/beranda.ts` (satu kueri tambahan, pola S9: tidak menggandakan kueri tagihan), kartu server-rendered di Beranda nyata Pribadi (K1), tautan ke Rencana > Utang, tersembunyi bila nol dan di Bersama. Tes unit, `__int__`, e2e `e2e:ledger`. Budget JS Beranda nyata ≤ 162 kB (kini 157,5): bila tembus, pindahkan ke chunk lazy.

### Task 4: Migrasi `0133` enum pocket dan `0134` modal trading (DB) — opus

- [ ] `0133`: `alter type app.pocket add value 'trading'` (file sendiri). `0134`: `app.accounts` CHECK `pocket <> 'trading' or space_kind = 'personal'` (B10), view `app.trading_capital` (per dompet trading: `capital_in`, `capital_out`, `capital_left = max(0, in − out)`, `realized = max(0, out − in)`; dari transfer same-space antara dompet non-trading dan trading, entri non-void), `api.trading_overview(space)` (per dompet + total, `shortfall = max(0, Σ capital_left − Σ saldo trading)`, Pribadi saja). Transfer lewat `api.create_transfer` yang ada: dompet trading boleh sumber/tujuan; salin tes batas (`saldo_negatif`, dompet sama, arsip).
- [ ] Tes: T10 (K9) dengan setor, tarik sebagian, tarik > setor, void/restore transfer menggeser modal tepat sekali, `Kurang` muncul dan hilang tepat di batas, I6 (Σ income/expense dan Laporan tidak berubah), B10 (dompet trading di Bersama ditolak), "aman dipakai" tidak berubah, `move_entry_to_space` dan WA `@trading` tidak mengambil dompet trading sebagai bawaan. DQ baru (DQ06): `capital_left` tidak negatif dan konsisten dengan Σ transfer.
- [ ] Review independen (opus).

### Task 5: Server + UI modal trading — sonnet + lensa desain

- [ ] `server/ledger/trading.ts`, `_actions/trading.ts`, pemilih `pocket` di sheet Tambah dompet (opsi `Trading`, Pribadi saja), kelompok Trading di Dompet, kartu Modal (modal, sisa, hasil realisasi), peringatan `Kurang Rp …` (nominal dari SQL), aksi `Setor modal` / `Tarik modal` memakai sheet transfer yang ada. Dompet Pribadi non-trading tidak menampilkan trading di pemilih Catat pengeluaran/pemasukan. Tes unit, int, e2e `e2e:ledger`.

### Task 6: Migrasi `0135`–`0136` bagi tagihan Bersama (DB) — opus

- [ ] Test-first pgTAP. `0135`: tabel patungan di ruang `shared` (menunjuk entri pengeluaran Bersama, pembayar, bagian per anggota, Σ bagian = nominal, FK komposit `(space_id, …)`, RLS ENABLE+FORCE, tulis hanya `dompetku_api`) dan `settlement` (pelunas, penerima, nominal > 0, tanggal, void lewat `voided_at`); view `app.member_balances` (saldo antar-anggota = Σ bayar − Σ bagian ± pelunasan, tidak ada pembulatan tersembunyi). Bentuk kaki sesuai keputusan Task 1.
- [ ] `0136`: `api.create_shared_expense_split` (atomik, idempoten `client_id`, pembayar harus anggota, dompet pembayar Pribadi aktif bukan Kantor/trading, `saldo_negatif`), `api.settle_split` (K4: pelunas = anggota, penerima = anggota lain, nominal ≤ yang terutang, bayar lebih `payment_exceeds`), `api.void_settlement`, `api.shared_balances` (saldo + siapa berutang ke siapa, dari view). Void entri patungan membalik bagian dan kaki Pribadi; hanya pencatat (spec §9.1).
- [ ] Tes: dua user × semua operasi, **Pribadi pasangan tidak terbaca atau tertulis** (RLS + galat tanpa nama/nominal), Σ bagian = nominal, saldo antar-anggota nol-jumlah (Σ saldo semua anggota = 0), konkurensi pelunasan ganda (C3-analog: satu ditolak), INT-12-analog (`fail_after` di tengah fungsi = rollback utuh), Laporan Bersama dan kontribusi S8 tidak berubah angkanya, reconcile `dq_reconcile` hijau. DQ07-analog untuk saldo nol-jumlah.
- [ ] Review independen (opus) + review keamanan.

### Task 7: Server + UI bagi tagihan — sonnet + lensa desain

- [ ] `server/ledger/patungan.ts`, `_actions/patungan.ts`; sheet Catat Bersama: toggle `Dibayar dari dompet pribadi` (pilih dompet, bagian sama rata atau nominal), kartu `Saldo patungan` di Beranda Bersama (`Farida berutang Rp … ke Novanda`, kalimat dari SQL), `/bersama/patungan` (riwayat, `Lunasi`, batal pelunasan dengan dialog akibat), feed Aktivitas S8 mengenal baris baru, Laporan dan Ekspor Bersama mengenal patungan, Sampah. Pribadi tidak menampilkan fitur ini. Budget JS Beranda Bersama dan rute baru ≤ 162 kB (lazy).

### Task 8: `allowNegative` batal cicilan (server + UI kecil) — sonnet

- [ ] Jalur `voidEntry` untuk cicilan utang menerima `allowNegative`; dialog Batalkan cicilan menampilkan `Tetap batalkan` saat `saldo_negatif` (K5). Tes unit, int, e2e. Sekalian: salinan dialog Batalkan cicilan di Transaksi mengikuti AK1 bila murah.

### Task 9: e2e, registry, budget

- [ ] e2e ledger: setor modal → `Kurang` → tarik sebagian; patungan → saldo → pelunasan; kartu utang; batal cicilan `Tetap batalkan`. e2e prototipe tidak berubah. `REGISTRY.md`: T10 diaktifkan, baris patungan, DQ06/DQ07-analog; `test:registry` MAX_MILESTONE sesuai. Ukur budget JS (Beranda nyata, Beranda Bersama, Dompet, Patungan).

### Task 10: Dokumen, review, penutup

- [ ] BSD §16 "Catatan S12" (tabel, view, fungsi, pocket), IPD S12, `docs/m0a-keputusan.md`, `handoff/s12.md`, critique + Delivery Gate, CLAUDE.md. Review akhir (task + keamanan, opus), gerbang penuh, PR, CI, merge (pengendali). Gerbang M3: T6–T10 hijau di registry. Catat: image VM Postgres masih 17.11 (drift pgdg 17.12, handoff s11) dan pengecualian Trivy zlib1g/OpenWA 2026-11-21.

## Review Focus

1. **Saldo antar-anggota** nol-jumlah, dari data, tidak ada logika pelunasan tersembunyi; pelunasan berlebih ditolak; void/restore membalik tepat sekali.
2. **Isolasi**: Pribadi pasangan tidak bocor lewat patungan, galat, log, feed, Ekspor; kaki Pribadi hanya milik pembayar.
3. **Modal trading bukan pemasukan/pengeluaran**: Σ income/expense, Laporan, anggaran, "aman dipakai" tidak berubah; `Kurang` dan `sisa modal` benar di batas dan setelah void/restore.
4. **Pocket baru di semua tempat** yang mengenal `pocket` (tidak ada yang jatuh ke `else`): pemilih dompet, WA `@nama`, `move_entry_to_space`, reconcile.
5. **Bersama tetap bersih**: modal trading dan utang ditolak di Bersama (B10); fitur patungan tidak muncul di Pribadi.
6. **Kartu utang** tidak mengubah "aman dipakai" dan tidak menggeser budget JS Beranda di atas 162 kB.
