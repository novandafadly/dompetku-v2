# Keputusan controller selama M0a

Daftar lengkap keputusan yang diambil atas nama pemilik saat eksekusi plan M0a (urutan kronologis). Format: keputusan — alasan — risiko bila salah.

- **T1 self** (copies docs/spec/*): skip copy step — already done — none
- **T1↔T6** (alias @dompetku/demo-data): T1 sets workspace glob packages/*; T6 adds package — none
- **T1↔T5** (smoke test expects "Data demo"): T1 temp page renders plain text "Data demo"; T5 replaces with component — none
- **T4↔T5** (tnum.spec uses /dev/ui#angka): T4 creates minimal /dev/ui with #angka; T5 extends — none
- **T4 self** (next/font Google downloads at build): use next/font/local with @fontsource files (Plus Jakarta Sans, Source Serif 4) — no network at build — slight setup cost
- **T9 self** (keyboard emulation vague): test shrinks viewport height by 300px as keyboard proxy and asserts elements in viewport — may miss iOS specifics; real-device check in T13
- **T13 self** (Vercel preview needs Vercel project/token): STOP point — ask owner before creating Vercel project
- Node — sandbox has Node 22.22; .nvmrc=24, CI on 24, engines.node '>=22.12' so local dev works — if wrong, minor engines bump — low
- commit trailer stays 'Claude Opus 5.5' for all commits (session-level attribution mandated by harness) — subagent model differs — cosmetic
- dark `hairline` = #2C2B27 (spec A.1 gives light only; decorative, not a contrast pair) — gap in spec — cosmetic, easy to change
- no data-theme default on <html>; system pref applies until Pengaturan sets it — my dispatch wording "set defaults" was ambiguous — none
- env flag = NEXT_PUBLIC_PROTOTYPE (plan lines 149, 362); T4 used NEXT_PUBLIC_DEMO from my dispatch — T5 renames it — none
- happy-dom instead of jsdom (jsdom 30 engines reject Node 22.22) — test env only — low
- @phosphor-icons/react accepted — spec §9 picks Phosphor icons — none
- T6 space_transfer = two Entry legs sharing `linkId`, with `direction: 'out'|'in'` (optional fields on Entry); out leg −amount in source ruang, in leg +amount in dest ruang, in leg description undefined — spec §9 two linked entries — adds 2 optional fields to contract
- T6 variant 'empty' = members only, no accounts/entries/bills/budgets — plan T8/T11 empty checklist needs first wallet — none
- T6 billsUntilEom = Σ unposted bills with dueOn ≤ endOfMonth(today) (overdue included); budgetWajibRemaining = Σ over wajib budgets for month of max(0, amount − spent) — spec "aman dipakai" — formula visible in M0a review
- accept DemoState.today, createDemoStore(seed,{clock}), groupByDay drops voided (undo via toast restores), no addSpaceTransfer helper yet (T9 may add), budget-spent selector deferred to T11 if needed — consistent with brief — small API additions later
- an obligation is either a bill or a wajib budget, never both; seed fixes data, formula unchanged — avoids double count — M2 real budgets need same rule (note for M2 spec)
- fold into fix round: void/restore of one space_transfer leg also voids/restores the linked leg; drop localeCompare Intl in selectors — integrity + global constraint — small
- T7 DemoProvider mounts in root app/layout.tsx (client boundary, Suspense for useSearchParams) so store survives ruang switch; seed/today/hero read once at mount — [ruang] layout remounts on segment change — none
- T7 Catat opens placeholder Sheet titled "Catat"; T9 replaces content — T9 builds sheet — none
- "Rencana hidden when empty" = ruang has no budgets and no bills — plan wording "belum ada isi" — minor
- space switcher = two <Link>s (aria-current="page" on active) styled as segmented, not router.push — binding "all navigation <Link>" — none
- fold in data-ruang/data-hero via useLayoutEffect (avoid wrong-tint flash on /bersama deep link) — visible in owner review — none
- T8 adds to demo-data (tested): `budgetProgress(state, ruang, today)` → [{budget, category, spent, pct}] (same rollup as safeToSpend) and store `markNoSpendDay(ruang, date)` + `state.noSpendDays` — brief needs both, T6 had none — small API growth
- T8 "Tagihan 7 hari" = unposted bills dueOn ≤ today+7 incl. overdue (labeled "Lewat N hari"); "hampir habis" = pct ≥ 80; "Terakhir" = 5 latest non-void entries — spec silent — owner review will tune
- fold in activityFeed privacy test (no Pribadi description/amount ever in Bersama feed) — spec privacy rule, untested — none
- R12 desktop two-column deferred to final polish / owner review note (plan has no R12 task; spec says "sebaiknya") — desktop review less polished — revisit after T12
- T9 store.addEntry idempotent on optional Entry.clientId (same clientId → returns existing entry, no duplicate), tested in demo-data — mirrors M1 idempotency table — none
- T9 transfer type = same-ruang only with "Ke dompet" picker; cross-ruang space_transfer stays out of Catat for M0a — scope — owner may ask for it
- T9 default wallet = operasional account of the ruang with most recent non-void entry by createdAt, else first operasional, else first account; toast income "ke <dompet>", expense "dari <dompet>"
- tests must use today=2026-10-17 like the rest; fix seed so last-used Pribadi operasional at 10-17 is BCA — one demo date across suite — goes into T9 fix round
- "Menyimpan…" state deferred to M1 (sync demo store) — R3 — none in M0a
- fold in switchRuang regenerates clientId (new ruang = new intent) — avoids M1 idempotency mismatch — none
- T10 list is month-scoped (default month of today, prev/next month control), newest first, 50 per page + "Muat lagi"; filters: Operasional=operasional-pocket accounts, Kantor=kantor pocket, Menunggu reimburse=non-void reimbursable expenses — "di Oktober" copy implies month scope — owner may prefer infinite history
- T10 Ubah and Pindahkan both toast "Segera di M1" (prefilled Catat would create a duplicate, not edit) — avoid fake edit semantics — owner sees no edit in M0a
- T10 Ringkasan excludes kantor-pocket income/expense ("Kas kantor") and transfer/space_transfer ("Transfer internal"); opening_balance excluded silently from income — matches v1 audit fix — none
- Bersama hides Kantor/Menunggu reimburse filters per ui-ux.md:18 (spec binds over controller) — my earlier ruling wrong — goes into T10 fix round; month moves to URL ?bulan=YYYY-MM so detail→back keeps it
- voided entry by URL shows "Transaksi ini sudah dibatalkan." (not 404) — avoids not-found flash after void — none
- fold in monthSummary counts space_transfer in-legs of receiving ruang in "Transfer internal" (money must be accounted somewhere) + void toast names ruang/amount like Catat — none
- Task 10: fix round 2/5 (1 addressed, 0 open — Ringkasan literals; commits 98cf785..682e099). Ruling: re-review done by controller directly (6-line test-only diff; grep shows literals; transaksi.spec 13/13 run by controller) — subagent seat not worth it for this diff — low
- T11 net worth (Dompet tab) = Σ balances of operasional+tabungan accounts of the ruang; Kas Kantor shown with its balance but excluded and labeled — company money is not personal wealth (v1 audit) — none
- T11 adds @axe-core/playwright and an axe helper (serious/critical = 0) used for auth pages + Dompet; wallet history = /[ruang]/dompet/[id] — plan needs axe, none existed — new devDep
- accept recovery-codes step + checklist-until-first-expense — spec design.md + brief flow — none
- T12 fold in T11 MUST-FIX (mock password hint + autoComplete off) — preview URL will be shared — none
- T12 budget 120 kB: measure first; if over, lazy-load Catat sheet/cmdk/Phosphor per-icon imports; if framework baseline alone > 120 kB, record measured baseline + ADR and set budget = baseline+margin — Next16/React19 baseline unknown — budget may move
- T12 screenshots: hero=serif|sans variants only on beranda routes; other routes serif only — keeps PNG count sane — none
- accept ADR 0002 budget 162 kB (route JS, prefetch excluded) — measured baseline, plan's 120 unattainable on stack — owner informed; M2 150 kB target needs re-decision at M2
- screenshots of long pages (dompet/[id], transaksi) must be viewport-only to cap repo bloat — 1.4 MB each forever in git — into T12 fix round
- budget gate stays route-only (prefetch excluded) — state explicitly in ADR 0002 + assert own ⊆ sizes — prefetch is post-load, not cold-load cost — none
- fold in: always-mounted empty toast live region (a11y), skip hero=sans for empty seed, robust @screens gate (env var SCREENS=1), viewport-only shots for long pages
- squashed 10e67c3+e21a6d9 into 3d8a43c before first push (keeps 9.7 MB of obsolete PNGs out of history; unpushed own branch) — none
- T13 no preview.yml — Vercel Git integration deploys branch pushes; ADR numbering shifts (0002 = JS budget) → preview ADR 0003, results ADR 0004 — none
- one fix wave covers findings 1,2,4,5,6,7,8 + ADR 0003 rewrite to Shareable Link option (owner confirms plan) — cheap, all in-scope — none
- Owner 2026-10-31: keep violet Bersama on dark + uppercase "RUANG PRIBADI"/SpaceTag; keep handoff copy; drop M2 150 kB target (stay 162 kB); visual direction approved
- A4 has no account form, so account creation moves to new `/buat-akun` (Terima undangan → Buat akun → Amankan): email comes from the invite token (read-only, not shown as a value in the prototype to avoid inventing an address), new password min 12 chars, then passkey + TOTP + recovery codes — matches spec §auth (email+password account, strong factor, recovery codes) and keeps A4 a pure decision screen — 12 may change when Better Auth policy is set in BSD/M0b

## Keputusan agen atas nama pemilik selama S10 (2026-11-11 s.d. 2026-11-12)

Pemilik menjawab "gas" pada plan S10 dan bingkai; default K1–K7 dipakai. Format: keputusan — alasan — risiko bila salah.

- **K1** rincian di dalam anggaran induk (`Σ rincian ≤ induk`; hanya induk dihitung di aman dipakai dan Laporan) — BSD §15.1, tidak dobel — pemilik ingin rincian berdiri sendiri (ubah trigger dan `budget_progress`).
- **K2** hapus anggaran induk menghapus rinciannya (konfirmasi menyebut jumlah) — alternatif menolak memaksa hapus satu-satu — hilang rincian tak sengaja (dialog fokus awal Kembali).
- **K3** rincian tidak wajib — XOR dengan tagihan dinilai di induk — rincian wajib tidak tersedia.
- **K4** penyesuaian salin = persen bulat −90..100, dibulatkan ke Rp1.000 (induk ke atas, rincian ke bawah) — menjaga `Σ rincian ≤ induk` — induk kecil bisa naik (Rp500 −10% → Rp1.000).
- **K5** ekspor = satu baris per KAKI entri (bukan per entri) — transfer berbiaya berkelas ganda tidak bisa dicocokkan bila digabung — baris lebih banyak dari jumlah transaksi.
- **K6** tombol Ekspor di Laporan (periode dan dasar terbawa); Menu → Export tetap "Segera" — tidak ada rute Pengaturan — pemilik mencari di Menu.
- **K7** retensi `wa_messages` 14 hari, SEMUA status (juga `pending`); job 01:27 WIB (di jendela 01:00–01:30) — di bawah idempotensi 30 hari; ditambah batas umur pesan 7 hari di webhook — tanpa batas umur, kirim ulang sesudah hari ke-30 tercatat ganda — bila `data.timestamp` tak ada di payload OpenWA, batas itu mati (fail-open, log `no_timestamp`).
- **Pemisah CSV koma** — standar, Sheets — Excel id-ID membuka satu kolom (ganti `;` bila diminta).
- **Batas laju ekspor 10/jam/user di memori** — satu VM web — reset saat restart.
- **`export_max_rows` di `app.settings`** (bukan konstanta) — tes tidak perlu menyisipkan 50.000 baris (3,5 menit) — admin bisa menaikkan batas.
- **Audit `export` meta `{count, via}`** — kunci meta audit tertutup (0006) — rentang tidak tercatat.
- **Review bulanan hanya dasar gajian; rincian selalu terbuka; ringkasan memakai kartu Laporan** — anggaran berlabel periode gajian; angka sama dengan Laporan — pemilik ingin kartu khusus.
- **Worker `process.exit(1)` pada `unhandledRejection`** — gagal keras, container restart — loop restart bila rejection deterministik (runbook).

## Keputusan agen atas nama pemilik selama S11 (2026-11-12 s.d. 2026-11-13)

Pemilik menjawab K1 (tabel Kontak), K2, K3, K5 pada 2026-11-12 dan mengizinkan PR + merge otomatis dengan pemilihan model dinilai agen ("PR dan merge otomatis, pemilihan model dinilai lead sendiri"). Format: keputusan — alasan — risiko bila salah. Butir bertanda **[konfirmasi pemilik]** belum disetujui eksplisit.

### Keputusan plan (default agen, di luar K1/K2/K3/K5)

- **K4** pokok dan nominal cicilan tidak bisa diubah (batal lalu catat ulang); judul, catatan, kontak boleh tanpa efek ledger — tidak menulis ulang entri ledger — pemilik ingin koreksi nominal langsung (perlu jalur ubah yang membalik dan menulis ulang atomik).
- **K6** dompet Pribadi aktif bukan Kantor; saldo negatif tanpa flag ditolak (`saldo_negatif`) — pola tagihan dan mutasi lain — pengguna yang meminjamkan dari dompet kurang saldo harus mengonfirmasi `Tetap simpan`.
- **K7** bayar lebih ditolak atomik (`payment_exceeds`), UI menawarkan `Bayar sisa` yang hanya mengisi kolom — PRD:157 — satu ketukan tambahan bagi yang mau melunasi.
- **K8** utang = segmen ketiga di Rencana (Pribadi saja), detail = halaman, istilah baku `Utang` — bingkai Task 1, ui-ux:20 — pemilik ingin Utang di tab sendiri.
- **K9** tanpa wizard onboarding utang berjalan — tidak ada di AFD/PRD final — onboarding utang lama harus lewat sheet Tambah satu per satu.
- **K10** definisi T6 sampai T9 diinferensi dari backlog PO (isi aslinya tidak ada di repo): T6 edit keterangan tanpa efek, T7 bayar > sisa ditolak, T8 batal cicilan membalik, T9 hapus utang atomik; T10 (modal trading) = S12 — **[konfirmasi pemilik]** — bila definisi asli berbeda, tes T6 sampai T9 perlu disesuaikan, kode tidak.

### Keputusan agen selama implementasi (handoff s11 butir 1 sampai 6)

1. **Judul dan catatan opsional, pintasan di SQL:** `title` dan `note` kosong atau spasi saja disimpan `null`; judul ≤ 80 dan catatan ≤ 200 sesudah trim. Pintasan 25%/50% dari SISA, rupiah penuh dibulatkan ke bawah, dihitung di SQL (null bila 0, UI menyembunyikan chip). Pratinjau `sisa − jumlah` di sheet dihitung di UI (preseden S6-C3/S9-TG3). Pemulihan utang dari grup `Utang dihapus` di segmen Utang, bukan Sampah. Kontak hanya bisa diarsipkan (tanpa hapus atau pulihkan). Server menolak bayar sebelum tanggal mulai (`payment_before_opened`). Tanpa jatuh tempo, tanpa bunga, tanpa kartu utang di Beranda — bingkai butir 1 sampai 8, tidak ada K untuk jatuh tempo — pemilik ingin jatuh tempo atau pengingat (kolom baru + job). **[konfirmasi pemilik]**
2. **`safe_to_spend` = kas murni (0120), tidak diubah.** Sempat dibuat memotong sisa utang pinjaman, dibatalkan karena angka menjadi salah (−Rp3 juta) bila uang pinjaman dipindah ke Tabungan. Akibatnya meminjam menaikkan "aman dipakai" sebesar kas yang masuk — angka tetap benar sebagai kas, tetapi bisa terbaca "boleh belanja uang pinjaman" — bila menyesatkan, tambah kartu "Utang yang harus dibayar" terpisah (S12). **[konfirmasi pemilik]** (keputusan terbuka)
3. **Penanda `voided_with_debt`:** `restore_debt` hanya memulihkan entri bertanda; `trash_list` menyembunyikan semua entri utang terhapus (signature tak berubah); Sampah tidak punya teks "Pulihkan dari Utang" seperti bingkai #3 (teks itu ada di detail transaksi dengan tautan `Buka Utang`) — penanda kolom, bukan kesamaan `voided_at` (jam tes dipatok, dua pembatalan jam sama tak terbedakan) — cicilan yang dibatalkan sendiri sebelum Hapus utang tetap batal sesudah Pulihkan; salinan detail untuk kasus itu menyesatkan (utang di handoff).
4. **`create_debt` menerima `p_contact_id` atau `p_contact_name`:** kontak baru dibuat di transaksi yang sama dan ikut idempoten — satu ketukan Simpan tanpa kontak yatim bila gagal — signature lebih lebar, dua jalur input yang harus konsisten.
5. **Purge:** entri `voided_with_debt` tidak dipurge selama utangnya terhapus ≤ 90 hari; sesudahnya `jobs.purge_voided` juga menghapus baris `app.debts` tanpa event audit (dicatat di BSD) — catatan/judul tidak tinggal selamanya — hilang jejak audit penghapusan utang; kontak tidak pernah dihapus.
6. **Keterbatasan diterima (dokumentasi):** dompet yang dipakai utang lalu diarsipkan membuat `void_debt`/`restore_debt` ditolak `account_archived` (pola `void_entry`); `api.net_worth` hanya kas (piutang/utang masuk S12/S14); loader (`read.ts`) mengenal kind utang sejak Task 5 supaya Transaksi, riwayat dompet, dan Sampah tidak melempar — Hapus/Pulihkan utang pada dompet terarsip ditolak dengan galat (belum ada jalan keluar di UI).

### Ruling pengendali (ledger SDD S11)

- **Model:** Opus untuk review Task 5 dan review akhir, Opus untuk Task 5 (server uang), Sonnet implementer untuk UI Task 6 dan 7 dengan design reviewer terpisah — spec meminta model terkuat untuk uang/DB/server — pemakaian token lebih tinggi.
- **`errors.ts` memetakan `already_voided`/`not_voided` ke `conflict` untuk semua jalur** (juga `void_entry`/`restore_entry`/`purge_entry` lama) — reviewer: tidak terjangkau dari UI lama karena versi dicek lebih dulu (DK409), dan UI memperlakukan `conflict` sebagai muat ulang — galat langka tampil sebagai "muat ulang" alih-alih `unknown` + log.
- **e2e Menu → Kontak dipindah dari Task 6 ke Task 8** (`e2e:ledger`) — spec e2e milik Task 8, brief Task 6 melarang implementer menulisnya — bila Task 8 lupa, tautan Menu tak teruji di browser (Task 8 memuatnya, tes 11).
- **CSV kategori/catatan kosong untuk pokok dan cicilan diterima:** `export_entries` tidak mengambil kontak/judul utang; Jenis dan Kelas laporan benar, nominal bertanda benar, Σ tidak tercemar; perbaikan butuh migrasi `0132` (S12: `coalesce(description, kontak · judul)`) — CSV kurang informatif, bukan salah — pemilik membuka ekspor di Excel dan bingung siapa lawan utangnya. **[konfirmasi pemilik]** (dicatat di handoff)
- **Kolom Jenis di ekspor tetap kunci mesin** (`debt_principal`, `debt_payment`) seperti semua kind lain — memberi label hanya kind baru tidak konsisten dan mengubah kontrak CSV S10 — pemilik menginginkan label Indonesia untuk semua kind.
- **Tab `Beranda` menyala di `/pribadi/kontak`** (Task 6 fix I1: `hrefs.ts`/`nav-provider.tsx` dikembalikan persis ke baseline agar Beranda prototipe +0 byte) — budget Beranda prototipe hanya 0,4 kB di bawah batas — pengguna melihat tab Beranda menyala di Kontak; pemindah ruang dari Kontak jatuh ke Beranda ruang lain.
- **Dialog Batalkan cicilan memakai salinan Transaksi generik** (`Saldo {dompet} bertambah Rp …`), bukan kalimat AK1 persis — kalimat benar arah dan dipakai bersama dialog Batalkan lain (pola S6) — toast tak persis seperti bingkai.
