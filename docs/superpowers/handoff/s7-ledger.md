# SDD ledger — plan: docs/superpowers/plans/2026-11-03-dompetku-v2-s7-transfer-talangan.md

Spec: IPD §4 S7 + BSD/AFD/PRD (lihat header plan). Keputusan pemilik K1–K3 = rekomendasi (disetujui 2026-11-03).
Konteks subagent: docs/superpowers/handoff/s7-konteks-subagent.md. Baseline: pgTAP 721 hijau (main d97be63 + plan 7f5c285).

## Pre-flight scan
| Pasangan / task | Produksi vs konsumsi | Temuan |
| --- | --- | --- |
| T2 ↔ T6 | indeks `accounts_name_unique` → peta 23505 name_taken | konsisten |
| T3 ↔ T4 | T3 ganti `update_entry`; T4 ganti `restore_entry`/`trash_list`, pakai `set_void_state` | tidak tumpang tindih fungsi; T4 harus membaca definisi terakhir (0110) |
| T4 ↔ T5 | `moved_to_entry_id` → DQ12 | DQ12 "menunjuk entri yang ada" salah positif sesudah entri baru dipurge → Ruling R1 |
| T5 internal | DQ03 "memanggil logika assert_entry_shape" di fungsi milik auditor | auditor tidak punya EXECUTE private.*; → Ruling R2 |
| T5 internal | tes merusak data via `session_replication_role` | dompetku_test bukan superuser → Ruling R3 |
| T5 ↔ T15 | skema pgboss + spike hak | konsisten (T15 Step 1 gerbang) |
| T6 ↔ T7 | keduanya ubah `read.ts` | urut T6 lalu T7; T7 wajib mempertahankan wrapper T6 |
| T6/T8 ↔ T10–T12 | wrapper/aksi → UI | konsisten (nama di Interfaces) |
| T7 ↔ T13 | `BerandaData.bersama` dihitung di transaksi baca T7 | konsisten |
| T9 ↔ T10–T13 | headroom budget | T9 sebelum UI, konsisten |
| T15 ↔ T16 | `worker.mjs`, `--check-config` | T15 harus menyediakan flag `--check-config` (disebut T16) → Ruling R4 |
| Review Focus #1 | menyebut "unit loader di Task 7" | loader kebocoran adalah T6 int (listEntries Bersama) → Ruling R5 |
| T1–T18 masing-masing | tes vs kode vs berkas | tidak ada kontradiksi internal lain |

Ruling R1: DQ12 = `moved_to_entry_id` menunjuk entri yang ada ATAU tombstone di `app.entry_tombstones` — purge sah tidak boleh memicu alert — biaya bila salah: satu cek DQ terlalu longgar.
Ruling R2: DQ03 ditulis sebagai kueri SQL independen di `private.dq_run` (mengulang aturan bentuk per kind, seperti DQ01 independen dari view), bukan memanggil assert_entry_shape — biaya bila salah: duplikasi aturan bentuk di dua tempat (DQ menjaga trigger, itu tujuannya).
Ruling R3: tes positif DQ di 17_dq merusak data lewat helper SECURITY DEFINER milik superuser di setup.sql (pola dblink yang ada) atau sebagai owner dengan trigger dinonaktifkan dalam transaksi tes yang di-rollback; pilihan implementer, tanpa memberi hak baru ke role aplikasi — biaya: helper tes tambahan.
Ruling R4: T15 menambah `--check-config` di index.ts (validasi env lalu keluar 0/1 tanpa koneksi DB) — biaya: satu flag.
Ruling R5: tes kebocoran Pribadi untuk Review Focus #1 di tingkat server ada di T6 (int), kanari UI di T17 — biaya: tidak ada.
Ruling R6: model "terkuat" = opus (pola S6); UI = sonnet implementer + sonnet reviewer, DB/uang/worker = opus implementer + opus reviewer — biaya: ongkos.

## Progress
Ruling R7: kursi "design reviewer" di task UI = reviewer task yang di-dispatch controller dengan lensa desain (DESIGN.md, Panel Malam), bukan subagent yang di-spawn implementer (aturan SDD: implementer tidak men-dispatch subagent) — biaya: satu kursi review digabung.
Ruling R8: Task 1 = bingkai tekstual mengikuti format docs/design/s6-bingkai.md; screenshot hanya layar prototipe terkait yang sudah ada bila membantu (layar baru belum ada); screenshot layar jadi di critique T18 — biaya: pemilik menilai bingkai tanpa gambar.
Task 1: review → Needs fixes (4 Important). Screenshot (Imp 4a) → R8 berlaku, tidak di-loop.
Ruling R9: Detail kaki Bersama transfer antar ruang menampilkan dompet Bersama sendiri (bukan dompet Pribadi) di Detail DAN daftar, konsisten — AFD "tanpa nama dompet sumber" = tanpa dompet ruang lain — biaya: salinan bila pemilik ingin tanpa dompet sama sekali.
Ruling R10: "Pindahkan ke ruang lain" hanya oleh pencatat; DB menolak `not_creator` (masuk brief Task 4) — biaya: anggota lain tidak bisa memindahkan entri pasangan.
Ruling R11: Pindahkan Pribadi→Bersama TIDAK membawa keterangan kecuali pengguna mencentang "Bawa keterangan" (bawaan mati); DB `move_entry_to_space` dapat `p_keep_description boolean default false` (mengubah Interfaces T4) — prinsip batas Pribadi: Bersama hanya menerima teks yang diisi eksplisit — biaya: satu parameter + satu kontrol.
Ruling R12: toggle Talangan di Catat = tombol ikon 44×44 `role="switch"`/`aria-pressed` di baris meta (tanpa baris baru), petunjuk aktif satu baris tanpa menambah tinggi mode keyboard — biaya: keterbacaan toggle lebih rendah.
Task 1: fix round 1/5 (4 addressed, 0 open; commits ab1e69f..2ec05a4)
Task 1: minor (deferred): heroCard tulis "radius 2xl (20)"; klaim tinggi C2 dibuktikan tes ukuran Task 10; MetaSelect ±104 px di 360 dibuktikan Task 10.
Ruling R13: Pindahkan Bersama→Pribadi membawa keterangan (arah ke Pribadi tidak membocorkan apa pun); `p_keep_description` hanya berlaku bila tujuan Bersama, Task 4 dan 11 — biaya: satu aturan arah.
Task 1: complete (commits 0e2a669..2ec05a4, review clean)
Task 2: review → Needs fixes (1 Important: skrip cek pakai dompetku-psql yang tidak ada). Minor 1 (lock table) ikut ronde 1.
Task 2: minor (deferred): DETAIL 23505 memuat nama dompet di log Postgres (sama dengan categories_name_unique; pertimbangkan log_error_verbosity=terse di review keamanan akhir); asersi indexdef ganda 00_katalog/14; archive_category mengunci anak terarsip juga (tidak berbahaya).
Task 2: fix round 1/5 (2 addressed, 0 open; commits 3bf87ce..75bb8e1)
Task 2: minor (deferred): packages/db/README.md:57 & docs/ops merujuk `dompetku-psql` yang tidak ada di repo (cek review akhir); jalur bawaan skrip cek hanya diuji docker tiruan.
Task 2: complete (commits 2ec05a4..75bb8e1, review clean)
Ruling R14: urutan kunci talangan = entri dulu, lalu akun (BSD §9.1, sama dengan update_entry/set_void_state; urutan "akun dulu" di plan terbukti deadlock di 99) — Task 4 wajib memakai entri → akun — biaya: tidak ada bila konsisten.
Ruling R15: tambahan Task 3 di luar brief diterima (restore reimburse ditolak not_reimbursable/reimbursement_exceeds; update_entry nominal talangan < Σ reimburse → reimbursement_exceeds) — menjaga invarian uang; Task 6 memetakan kode di restore_entry — biaya: dua aturan tambahan.
Task 3: minor (deferred): 05_read_committed tidak memuat create_reimbursement; Σ reimburse hidup ditulis 4× (helper private.reimbursed_total disarankan); tanggal reimburse boleh < tanggal talangan (catat BSD §16); asersi null hampa 15_talangan:215; reimburse ke dompet kantor = x_kantor (catat BSD §16); open_reimbursables grant hanya web (konsisten INVOKER); remaining pada replay = nilai awal (wrapper baca ulang open_reimbursables).
Task 3: complete (commits 75bb8e1..3c7a8fe, review clean)
Ruling R16: tidak ada id lintas ruang yang disimpan: kolom `moved_to_entry_id` diganti `moved_at timestamptz null` di entri asal (tanpa penunjuk), riwayat tidak memuat id entri ruang lain; hasil fungsi tetap mengembalikan kedua id ke pemanggil (pencatat, anggota kedua ruang). DQ12 (Task 5) menjadi "moved_at terisi ⇒ voided_at terisi" (R1 gugur) — Global Constraint S7: Bersama tidak pernah menerima id entri Pribadi — biaya: tidak bisa menelusuri pasangan pindah dari DB (audit web Task 8 boleh mencatat tanpa nominal).
Ruling R17: DB menolak pindah bila dompet asal atau tujuan berjenis kantor → DK422 cross_space_kantor (selaras aturan transfer antar ruang); talangan tetap boleh dipindah di DB (UI tidak menawarkan) — biaya: satu cek.
Ruling R18: p_allow_negative di luar hash idempotensi diterima (pola create_entry/update_entry/create_transfer: kirim ulang sesudah konfirmasi saldo = replay) — biaya: tidak ada.
Task 4: concern implementer → R16–R18 (commit f6f4949) sebelum review.
Task 4: review → Needs fixes (1 Important: kategori terarsip DK404 bukan DK422 category_archived); M2 urutan kind_not_movable/not_creator ikut ronde 1.
Task 4: minor (deferred): feed Bersama (activity_feed) memberi event void untuk entri yang dipindah Bersama→Pribadi — Task 8 putuskan label; penanda pindah hilang saat rollback lokal (diterima); README tabel ditulis ulang prettier.
Task 4: fix round 1/5 (2 addressed, 0 open; commits f6f4949..d7b54b4)
Task 4: complete (commits 3c7a8fe..d7b54b4, review clean)
Ruling R19: DQ12 "moved_at ⇒ voided_at" sudah dijamin CHECK entries_moved_check (tautologis), jadi isi DQ diganti: DQ11 = reimburse hidup menunjuk talangan hidup reimbursable di ruang sama; DQ12 = Σ reimburse hidup ≤ nominal talangan (dipisah dari DQ11). Total tetap 10 cek. R1 gugur — biaya: tidak ada.
Task 5: percobaan pertama terhenti (batas 5 jam, tanpa berkas); dispatch ulang dari awal sesudah reset DB.
Ruling R20: alert dq_reconcile (Task 15): fail untuk setiap error dan warn KECUALI DQ07 (dompet negatif bisa sah via p_allow_negative); DQ07 > 0 dilaporkan di body ping sukses — mengganti "error atau warn → fail" di plan T15 — biaya: dompet tabungan negatif tidak memicu email.
Task 5: minor (deferred): tes positif DQ03 untuk opening_balance/adjustment/space_transfer out belum ada; kinerja DQ03/DQ07 belum diukur vs statement_timeout 60s worker; README prettier bising; teks plan masih menyebut DQ12 moved_to_entry_id & DQ03 memanggil assert_entry_shape (diselaraskan di T18/BSD §16).
Task 5: complete (commits d7b54b4..8696bd0, review clean)
Ruling R21: Task 15 (worker) dan 16 dikerjakan SEKARANG sebelum Task 6, karena reviewer T5 mereproduksi `CREATE SCHEMA IF NOT EXISTS` ditolak untuk worker (hak CREATE database dicek dulu); spike pg-boss harus memutuskan bentuk skema selagi konteks DB masih segar. Tidak ada dependensi T15/T16 ke T6–T14 — biaya: urutan berbeda dari plan.
Ruling R22: worker pakai opsi resmi pg-boss `createSchema: false` (jalan a; tanpa 0113) — biaya: tidak ada.
Ruling R23: DQ07 boleh ikut di body /fail bila cek lain gagal (tidak sensitif, konteks berguna); tes int worker di job CI `auth` (bukan `db`: job db tanpa Node/port host, dan pgboss mengotori dump rollback) — biaya: tidak ada.
Task 15: minor (deferred): errorCode regex cocok errno Node 5 huruf (EPIPE dll.) dilabeli seperti SQLSTATE; unhandledRejection hanya log (sebaiknya exitCode=1 + shutdown); log abandoned_closed count; tes konkurensi satu instance saja; tes int jadwal bergantung urutan; purge_unfinished_users/purge_voided tidak diuji int; lockfile: next/better-auth kini resolve @opentelemetry/api 1.10.0 (no-op tanpa SDK); satu check HC `jobs` dipakai 4 job (fail bisa tertimpa sukses berikutnya).
Task 15: complete (commits 8696bd0..6571a69, review clean)
Task 16: review → Needs fixes (I1 worker.env kosong di runbook → rollback; I2 worker basi tetap hidup saat dilewati). Minor 1,2,4,5,6,7,8,9 ikut ronde 1.
Task 16: minor (deferred): label revision tidak membedakan dua digest dari commit sama (rerun release); SBOM/Trivy image tidak melihat dependensi yang dibundel di worker.mjs (pg, pg-boss, zod) — hanya osv-scanner lockfile; keputusan pemilik di review akhir.
Task 16: fix round 1/5 (2 Important + 7 minor addressed, 0 open; commits 312defc..661895c)
Task 16: minor (deferred): semua kegagalan docker run preflight dilabeli worker_config_invalid ? dan diulang tiap 5 menit (alert berulang); role/password salah baru tertangkap cek stabil 20s (rollback kode 3).
Task 16: complete (commits 6571a69..661895c, review clean)
Task 6: minor (deferred): linkedEntryId dikembalikan apa pun arahnya (Task 8 tidak boleh meneruskannya ke klien di rute Bersama); asersi kanari '6500' substring bisa flaky; variabel pengisi fBca di tes not_creator; toast batal reimburse "dari" → "ke" (Task 11/12); ReimbursableVM.description null vs opsional; cross_space_not_allowed tak tercapai lewat wrapper (jangan buat salinan UI mati); budget JS belum diukur sesudah present.ts/entry-detail-view.tsx.
Task 6: complete (commits 661895c..64619af, review clean)
Task 7: implementasi selesai (commit 64619af..b2a5ead; test:int 129, e2e:ledger 18, e2e 280, Beranda 160,8 kB); REVIEW TASK BELUM (cutoff sesi atas permintaan pemilik). Sesi berikutnya: review task 7 (BASE 64619af, HEAD b2a5ead) dulu, lalu Task 8. Concern implementer: +3–5 ms muat tunggal; retry tidak dites int; nama sufiks `Tx`; page Dompet/Kategori tanpa layout memuat satu kueri ekstra.
Task 7: review (sesi baru) → Approved, 0 Critical/Important.
Task 7: minor (deferred): loadTransaksi memvalidasi month sesudah meminjam koneksi (page sudah validMonth); bentuk `Tx` percaya ctx = ctx withLedger pemanggil (tulis aturannya di komentar); tes pool belum menutup hold-and-wait (pool max 1) dan peak 0 untuk loadDetail non-uuid; page Dompet/Kategori tanpa layout satu kueri ekstra.
Task 7: complete (commits 64619af..b2a5ead, review clean)
Ruling R24: hasil aksi tidak pernah memuat linkedEntryId/linkId; moveEntryAction ke Pribadi tidak mengembalikan id entri baru → Task 11 menavigasi ke `/pribadi/transaksi` (bukan Detail entri baru seperti S7-D2) — biaya: satu ketukan ekstra untuk membuka entri yang dipindah.
Ruling R25: Batalkan/pulihkan space_transfer oleh bukan pencatat = DK404 not_found (keputusan DB 0103); Task 11 menyembunyikan Batalkan untuk bukan pencatat — biaya: tidak ada.
Ruling R26: label feed Bersama untuk entri yang dipindah = "{Nama} memindahkan transaksi ke ruang lain" (event void dengan moved_at), dikerjakan saat feed nyata dirender (S8/S9) — biaya: tidak ada di S7.
Task 8: review → Approved, 0 Critical/Important. Minor 1 (komentar voidEntryAction not_creator → not_found) diperbaiki controller.
Ruling R27: respons action atas permintaan pemilik Pribadi dari rute Bersama (moveTargetsAction('bersama','pribadi'), catatOptions('pribadi')) boleh memuat dompet/kategori Pribadi miliknya; Task 10/11 wajib memuatnya malas saat sheet dibuka, tidak di URL/searchParams/cache bersama/props RSC; dicatat di BSD §16 (Task 18) — biaya: tidak ada.
Task 8: minor (deferred): tes int createReimbursementAction lintas ruang (talangan Pribadi dari /bersama, dompet penerima Bersama → not_found) belum ada — tambah di Task 17; ruang tujuan di-resolve dua kali + 3 transaksi per transfer antar ruang/pindah (aman, berurutan); toSpaceId: undefined lolos skema (tak dipakai).
Task 8: complete (commits 09ff840..63a518a, review clean)
