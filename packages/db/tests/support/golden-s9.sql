-- Fixture golden S9 (plan S9 Task 7, Review Focus #4; dipakai juga Task 8 Laporan). BUKAN tes sendiri:
-- CI dan pg_prove hanya menjalankan tests/*.sql. Dimuat dari tes lewat `\ir support/golden-s9.sql`
-- sesudah `begin; select plan(n);`, di dalam transaksi tes (semua rollback). Angka yang diharapkan ada
-- di golden-s9.json (satu sumber, juga untuk tes TypeScript bila perlu) dan dimuat ke variabel psql
-- :golden. Tes membandingkan keluaran fungsi dengan golden, bukan menghitung ulang rumus.
--
-- Variabel psql sesudah berkas ini: golden, np, fp, sh (ruang), g_bca, g_gopay, g_kantor, g_tab,
-- g_lama, g_kas (Bersama), g_dana (Pribadi F), g_b_internet, g_b_listrik, g_b_asuransi, g_b_gym,
-- g_b_kanari, g_b_hp (tagihan), c_makan, c_belanja, c_kopi, c_trans, c_ojek, c_cicilan, c_langganan,
-- c_sehat, c_hiburan, c_gaji, c_fkopi, c_fcicilan, c_dapur.
--
-- Jam akhir: 2026-11-10 10:00 WIB (Selasa). Rumah tangga payday_rule = 25 (instalasi baru = NULL,
-- diubah di dalam transaksi). Gajian efektif: 25 Sep 2026 Jumat; 25 Okt Minggu -> 23 Okt; 25 Nov
-- Rabu; 25 Des libur, 24 Des cuti bersama -> 23 Des. Periode berlabel:
--   Okt = 2026-09-25..2026-10-22, Nov = 2026-10-23..2026-11-24, Des = 2026-11-25..2026-12-22.
-- Jendela laju belanja (spend_pace) = 30 hari sebelum hari ini = 2026-10-11..2026-11-09.
--
-- ===== Dompet (semua dibuka 2026-09-01; saldo awal = entri opening_balance 1 Sep, x_koreksi) =====
--   Pribadi N: BCA operasional 5.000.000; GoPay operasional 300.000; Kas Kantor kantor 1.000.000;
--              Celengan tabungan 0; Lama operasional 50.000 (dipindah semua ke BCA 1 Sep, lalu
--              diarsipkan: saldo 0).
--   Bersama:   Kas Rumah operasional 0.
--   Pribadi F: Dana operasional 100.000.
--
-- ===== Tagihan (dibuat 2026-10-01 10:00 WIB: kemunculan pertama >= 1 Okt; materialisasi saat dibuat
-- sampai akhir periode berikutnya dari 1 Okt = 24 Nov; job 10 Nov sampai akhir periode berikutnya
-- dari 10 Nov = 22 Des) =====
--   Internet         350.000 tgl 5,  Langganan        : 5 Okt dibayar (5 Okt, BCA); 5 Nov terbuka
--                                                       (lewat); 5 Des terbuka (sesudah 24 Nov).
--   Listrik          400.000 tgl 20, Cicilan & Tagihan: 20 Okt dibayar 20 Okt lalu entri bayar
--                                                       DIBATALKAN = terbuka lagi (lewat, periode lalu);
--                                                       20 Nov terbuka; 20 Des dibayar di muka hari ini
--                                                       410.000 (K12, nominal aktual).
--   Asuransi         150.000 tgl 15, Kesehatan        : 15 Okt dilewati; 15 Nov terbuka; 15 Des terbuka.
--   Gym              200.000 tgl 12, Hiburan          : diarsipkan 10 Nov (12 Okt, 12 Nov ikut dilewati;
--                                                       12 Des tidak dibuat).
--   KANARI-N-TAGIHAN 100.000 tgl 28, Transportasi     : 28 Okt terbuka (lewat; label Nov); 28 Nov
--                                                       terbuka (label Des); 28 Des > 22 Des tidak dibuat.
--   Pribadi F: Cicilan HP 250.000 tgl 20, Cicilan & Tagihan F: 20 Okt, 20 Nov, 20 Des terbuka.
--
-- ===== Entri (tanggal; dompet; kelas BSD §8.1) =====
--   e01 2026-10-23 BCA      pemasukan Gaji 8.000.000                 income
--   e02 2026-10-05 BCA      pengeluaran Makan Siang 120.000           expense (label Okt, di luar jendela)
--   e03 2026-10-11 BCA      pengeluaran Makan Siang 250.000           expense (label Okt, hari pertama jendela)
--   e04 2026-10-23 BCA      pengeluaran Makan Siang 180.000           expense (label Nov)
--   e05 2026-11-09 BCA      pengeluaran Makan Siang 95.000            expense (hari terakhir jendela)
--   e06 2026-11-10 BCA      pengeluaran Makan Siang 60.000            expense (hari ini, di luar jendela)
--   e07 2026-11-01 BCA      pengeluaran Belanja 340.000               expense
--   e08 2026-11-03 GoPay    pengeluaran Ojek (anak Transportasi) 45.000 expense, induk Transportasi
--   e09 2026-10-10 BCA      pengeluaran Transportasi 30.000           expense (label Okt, sehari sebelum jendela)
--   e10 2026-11-02 BCA      talangan Makan Siang 500.000              x_talangan
--   e11 2026-11-06 BCA      reimburse e10 300.000                     x_reimburse
--   e12 2026-11-04 Kantor   pengeluaran Makan Siang 75.000            x_kantor
--   e13 2026-10-20 BCA->GoPay 200.000 fee 2.500                       x_transfer + expense_fee (label Okt)
--   e14 2026-11-05 BCA->Celengan 1.000.000                            x_transfer
--   e15 2026-11-07 Kantor->BCA 250.000 fee 1.000 (dari kantor)        main+fee x_kantor, counter x_transfer
--   e16 2026-11-01 BCA->Kas Rumah (setor Bersama) 700.000 fee 6.500   Pribadi: x_setor_bersama + expense_fee;
--                                                                     Bersama: x_setoran_anggota
--   e17 2026-11-08 Kas Rumah->BCA (ambil, oleh N) 150.000             Bersama: x_diambil_anggota;
--                                                                     Pribadi: x_ambil_bersama
--   e18 2026-11-02 BCA      pengeluaran Kopi & Camilan 99.000, DIBATALKAN (tidak dihitung di mana pun)
--   e19 2026-10-05 BCA      bayar Internet 5 Okt 350.000, Langganan    expense (label Okt)
--   e20 2026-10-20 BCA      bayar Listrik 20 Okt 400.000, DIBATALKAN
--   e21 2026-11-10 BCA      bayar di muka Listrik 20 Des 410.000, Cicilan & Tagihan  expense (label Nov)
--   e22 2026-11-03 Kas Rumah (oleh F) pengeluaran Belanja Dapur 120.000  Bersama expense
--   e23 2026-11-02 Dana (F) pengeluaran Kopi & Camilan F 10.000        Pribadi F expense
--
-- ===== Anggaran Pribadi N =====
--   label Okt: Makan Siang 800.000 wajib.  label Des: Kopi & Camilan 999.000 wajib.
--   label Nov: Makan Siang 1.000.000 wajib; Belanja 300.000 wajib; Kopi & Camilan 200.000 wajib;
--              Transportasi 500.000 tidak wajib. (Tidak ada tagihan pada kategori wajib: XOR lolos.)
--
-- ===== Perhitungan (ditulis tangan, diperiksa ulang terpisah) =====
-- Saldo BCA = 5.000.000 + 50.000 (Lama) + 8.000.000 (e01) + 300.000 (e11) + 250.000 (e15) + 150.000 (e17)
--             = 13.750.000 masuk;
--           - 120.000 - 250.000 - 180.000 - 95.000 - 60.000 - 340.000 - 30.000 (e02..e07, e09)
--             - 500.000 (e10) - 202.500 (e13) - 1.000.000 (e14) - 706.500 (e16) - 350.000 (e19)
--             - 410.000 (e21) = 4.244.000 keluar  ->  BCA = 9.506.000.
--   Periksa ulang: 120+250+180+95+60+340+30 = 1.075; +500 = 1.575; +202,5 = 1.777,5; +1.000 = 2.777,5;
--   +706,5 = 3.484; +350 = 3.834; +410 = 4.244 (ribu). 13.750 - 4.244 = 9.506 (ribu).
-- GoPay = 300.000 + 200.000 (e13) - 45.000 (e08) = 455.000. Lama = 0 (terarsip).
-- Operasional N = 9.506.000 + 455.000 + 0 = 9.961.000. (Kas Kantor 674.000 dan Celengan 1.000.000 tidak.)
--
-- safe_to_spend N hari ini (10 Nov, label Nov, sampai 24 Nov, sisa 24 - 10 + 1 = 15 hari):
--   tagihan belum dibayar, belum dilewati, tagihan aktif, jatuh tempo <= 24 Nov (termasuk lewat):
--     Internet 5 Nov 350.000 + Listrik 20 Okt 400.000 (entri batal = terbuka; kewajiban periode lalu,
--     bukan dobel dengan anggaran wajib Nov) + Listrik 20 Nov 400.000 + Asuransi 15 Nov 150.000
--     + KANARI 28 Okt 100.000 = 1.400.000. Tidak: Internet 5 Okt (lunas), Listrik 20 Des (lunas di
--     muka), Asuransi 15 Okt (dilewati), Gym (arsip), semua yang > 24 Nov.
--   anggaran wajib label Nov (realisasi 23 Okt..24 Nov, kelas expense, per induk):
--     Makan Siang: e04 180.000 + e05 95.000 + e06 60.000 = 335.000 (e10 talangan, e12 kantor tidak)
--       -> sisa 1.000.000 - 335.000 = 665.000;
--     Belanja: e07 340.000 > 300.000 -> sisa -40.000 -> max(0, .) = 0;
--     Kopi & Camilan: e18 batal -> 0 -> sisa 200.000;  Transportasi tidak wajib.
--     Σ = 665.000 + 0 + 200.000 = 865.000. (Okt 800.000 dan Des 999.000 bukan periode berjalan.)
--   total = 9.961.000 - 1.400.000 - 865.000 = 7.696.000; per_day = floor(7.696.000 / 15) = 513.066
--     (15 x 513.066 = 7.695.990; sisa 10).
-- safe_to_spend N p_today 24 Nov (hari terakhir periode, Z10): angka sama, sisa 1 hari,
--   per_day = 7.696.000.
-- safe_to_spend N p_today 25 Nov (label Des, sampai 22 Des, sisa 22 Des - 25 Nov + 1 = 28 hari):
--   tagihan <= 22 Des: 1.400.000 + Internet 5 Des 350.000 + Asuransi 15 Des 150.000 + KANARI 28 Nov
--   100.000 = 2.000.000 (Listrik 20 Des lunas). Periksa: Internet 700 + Listrik 800 + Asuransi 300
--   + KANARI 200 = 2.000 (ribu). Wajib label Des: Kopi 999.000 - 0 = 999.000.
--   total = 9.961.000 - 2.000.000 - 999.000 = 6.962.000; per_day = floor(6.962.000 / 28) = 248.642
--   (28 x 248.642 = 6.961.976; sisa 24).
-- safe_to_spend F (Pribadi F): Dana 100.000 - 10.000 (e23) = 90.000; tagihan 20 Okt + 20 Nov = 500.000;
--   total = -410.000; per_day = floor(-410.000 / 15) = floor(-27.333,3) = -27.334 (ke bawah, bukan ke 0).
-- safe_to_spend Bersama: Kas Rumah 700.000 - 150.000 - 120.000 = 430.000; tanpa tagihan/anggaran;
--   per_day = floor(430.000 / 15) = 28.666 (15 x 28.666 = 429.990).
-- Aturan gajian NULL (bulan kalender, label = bulan berjalan, sampai 30 Nov, sisa 30 - 10 + 1 = 21):
--   N tagihan <= 30 Nov: 1.400.000 + KANARI 28 Nov 100.000 = 1.500.000. Wajib label Nov = 1..30 Nov:
--   Makan e05 95.000 + e06 60.000 = 155.000 -> sisa 845.000; Belanja 0; Kopi 200.000 -> 1.045.000.
--   total = 9.961.000 - 1.500.000 - 1.045.000 = 7.416.000; per_day = floor(7.416.000 / 21) = 353.142
--   (21 x 353.142 = 7.415.982; sisa 18).
--   Bersama: 430.000, per_day = floor(430.000 / 21) = 20.476 (21 x 20.476 = 429.996); sama dengan rumus
--   0102 (ruang tanpa tagihan/anggaran). Bersama p_today 31 Okt: sampai 31 Okt, sisa 1, per_day 430.000.
--
-- spend_pace (avg_daily = floor(Σ |expense| + |expense_fee| 11 Okt..9 Nov / 30)):
--   N: expense e03 250.000 + e04 180.000 + e05 95.000 + e07 340.000 + e08 45.000 = 910.000;
--      expense_fee e13 2.500 + e16 6.500 = 9.000 (fee e15 dari kantor = x_kantor);
--      Σ = 919.000 -> floor(919.000 / 30) = 30.633 (30 x 30.633 = 918.990).
--      Tidak: e02, e19 (5 Okt), e09 (10 Okt), e06, e21 (hari ini), e10, e12, e18, e20.
--      overdue_bills = Internet 5 Nov, Listrik 20 Okt, KANARI 28 Okt = 3 (Asuransi 15 Okt dilewati,
--      Gym terarsip). holidays_known: periode 23 Okt..24 Nov, tahun 2026 punya libur -> true.
--   F: 10.000 / 30 = 333; overdue = 20 Okt = 1.  Bersama: 120.000 / 30 = 4.000; overdue 0.
--   N p_today 2028-03-15: jendela 14 Feb..14 Mar 2028 kosong -> 0; overdue = semua terbuka dengan
--      jatuh tempo < 15 Mar 2028: Internet 5 Nov, 5 Des; Listrik 20 Okt, 20 Nov; Asuransi 15 Nov,
--      15 Des; KANARI 28 Okt, 28 Nov = 8; tahun 2028 tanpa data libur -> holidays_known false.
--   Aturan NULL: angka laju sama (jendela tidak bergantung periode), holidays_known true.
--
-- budget_progress N (pct = floor(100 x spent / amount), remaining = amount - spent):
--   Okt (25 Sep..22 Okt): Makan e02 120.000 + e03 250.000 = 370.000; pct floor(46,25) = 46; sisa 430.000.
--   Nov: Belanja 340.000 pct floor(113,3) = 113, sisa -40.000; Kopi 0, 0, 200.000; Makan 335.000,
--        floor(33,5) = 33, 665.000; Transportasi e08 45.000 (anak Ojek), pct 9, 455.000 (e09 label Okt).
--   Des (25 Nov..22 Des): Kopi 0, 0, 999.000.
--   Nov kalender (aturan NULL, 1..30 Nov): Makan 155.000, floor(15,5) = 15, 845.000; lainnya sama.
--
-- period_summary N 23 Okt..24 Nov (inflow, outflow, jumlah entri):
--   expense 0 / 180.000 + 95.000 + 60.000 + 340.000 + 45.000 + 410.000 = 1.130.000 / 6 (e04..e08, e21);
--   expense_fee 0 / 6.500 / 1 (e16); income 8.000.000 / 0 / 1 (e01);
--   x_ambil_bersama 150.000 / 0 / 1 (e17); x_kantor 0 / 75.000 + 250.000 + 1.000 = 326.000 / 2 (e12, e15);
--   x_reimburse 300.000 / 0 / 1 (e11); x_setor_bersama 0 / 700.000 / 1 (e16);
--   x_talangan 0 / 500.000 / 1 (e10); x_transfer 1.000.000 + 250.000 = 1.250.000 / 1.000.000 / 2 (e14, e15).
--   Periksa: Pengeluaran Laporan = 1.130.000 + 6.500 = 1.136.500; Σ realisasi per induk Nov =
--   Makan 335.000 + Belanja 340.000 + Transportasi 45.000 + Cicilan & Tagihan 410.000 = 1.130.000.
-- period_summary Bersama 23 Okt..24 Nov: expense 0 / 120.000 / 1 (e22); x_diambil_anggota 0 / 150.000 / 1
--   (e17); x_setoran_anggota 700.000 / 0 / 1 (e16).

\set golden `for f in /db/tests/support/golden-s9.json packages/db/tests/support/golden-s9.json tests/support/golden-s9.json support/golden-s9.json; do if [ -f "$f" ]; then cat "$f"; exit 0; fi; done; echo golden-s9.json tidak ditemukan`

select tests.fixture();
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select tests.raw_exec(format($$insert into auth."user" (id, name, email, "emailVerified")
  values (%L, 'Luar', 'luar@example.test', true)$$, tests.x()));
select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.g_cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L and archived_at is null$q$,
    p_space, p_name))::uuid
$$;
create function pg_temp.g_entry(p_uid uuid, p_acc uuid, p_kind text, p_amount bigint, p_cat uuid,
  p_on date, p_reimb boolean default false) returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, %L, %s, %L, %L::date, null, %L) ->> 'entry_id'$q$,
    p_acc, p_acc, p_kind, p_amount, p_cat, p_on, p_reimb))::uuid
$$;
create function pg_temp.g_trf(p_uid uuid, p_from uuid, p_to uuid, p_amount bigint, p_fee bigint, p_on date)
returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_transfer(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, %L, %s, %s, %L::date) ->> 'entry_id'$q$,
    p_from, p_from, p_to, p_amount, p_fee, p_on))::uuid
$$;
create function pg_temp.g_bill(p_uid uuid, p_space uuid, p_name text, p_amount bigint, p_cat uuid, p_day int)
returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_bill(gen_random_uuid(), %L, %L, %s, %L, %s::smallint, '2026-10-01') ->> 'bill_id'$q$,
    p_space, p_name, p_amount, p_cat, p_day))::uuid
$$;
create function pg_temp.g_occ(p_bill uuid, p_due date) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.bill_occurrences where bill_id = %L and due_on = %L$q$, p_bill, p_due))::uuid
$$;
create function pg_temp.g_pay(p_uid uuid, p_occ uuid, p_acc uuid, p_on date, p_amount bigint default null)
returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.post_bill_occurrence(gen_random_uuid(), %L, %L, %L::date, false, %s) ->> 'entry_id'$q$,
    p_occ, p_acc, p_on, coalesce(p_amount::text, 'null')))::uuid
$$;
create function pg_temp.g_void(p_uid uuid, p_entry uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select api.void_entry(gen_random_uuid(), %L, 1)$q$, p_entry))
$$;

select pg_temp.g_cat(:'np', 'Makan Siang & Minum') as c_makan, pg_temp.g_cat(:'np', 'Belanja') as c_belanja,
       pg_temp.g_cat(:'np', 'Kopi & Camilan') as c_kopi, pg_temp.g_cat(:'np', 'Transportasi') as c_trans,
       pg_temp.g_cat(:'np', 'Cicilan & Tagihan') as c_cicilan, pg_temp.g_cat(:'np', 'Langganan') as c_langganan,
       pg_temp.g_cat(:'np', 'Kesehatan') as c_sehat, pg_temp.g_cat(:'np', 'Hiburan') as c_hiburan,
       pg_temp.g_cat(:'np', 'Gaji') as c_gaji, pg_temp.g_cat(:'fp', 'Kopi & Camilan') as c_fkopi,
       pg_temp.g_cat(:'fp', 'Cicilan & Tagihan') as c_fcicilan, pg_temp.g_cat(:'sh', 'Belanja Dapur') as c_dapur \gset

-- ===== 1 Okt 2026: dompet, kategori anak, tagihan =====
select tests.clock_at('2026-10-01 10:00+07');
select tests.web_val(tests.n(), format(
  $$select api.create_category(gen_random_uuid(), %L, 'expense', 'Ojek', 'Motorcycle', %L) ->> 'category_id'$$,
  :'np', :'c_trans')) as c_ojek \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 5000000, '2026-09-01') as g_bca,
       tests.account(tests.n(), :'np', 'GoPay', 'operasional', 300000, '2026-09-01') as g_gopay,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-09-01') as g_kantor,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 0, '2026-09-01') as g_tab,
       tests.account(tests.n(), :'np', 'Lama', 'operasional', 50000, '2026-09-01') as g_lama,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 0, '2026-09-01') as g_kas,
       tests.account(tests.f(), :'fp', 'Dana', 'operasional', 100000, '2026-09-01') as g_dana \gset
select pg_temp.g_trf(tests.n(), :'g_lama', :'g_bca', 50000, 0, '2026-09-01') is not null as x \gset
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'g_lama')) is not null as x \gset
select pg_temp.g_bill(tests.n(), :'np', 'Internet', 350000, :'c_langganan', 5) as g_b_internet,
       pg_temp.g_bill(tests.n(), :'np', 'Listrik', 400000, :'c_cicilan', 20) as g_b_listrik,
       pg_temp.g_bill(tests.n(), :'np', 'Asuransi', 150000, :'c_sehat', 15) as g_b_asuransi,
       pg_temp.g_bill(tests.n(), :'np', 'Gym', 200000, :'c_hiburan', 12) as g_b_gym,
       pg_temp.g_bill(tests.n(), :'np', 'KANARI-N-TAGIHAN', 100000, :'c_trans', 28) as g_b_kanari,
       pg_temp.g_bill(tests.f(), :'fp', 'Cicilan HP', 250000, :'c_fcicilan', 20) as g_b_hp \gset

-- ===== 10 Nov 2026: entri (tanggal lampau boleh), bayar, lewati, arsip, materialisasi, anggaran =====
select tests.clock_at('2026-11-10 10:00+07');
select pg_temp.g_entry(tests.n(), :'g_bca', 'income', 8000000, :'c_gaji', '2026-10-23') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 120000, :'c_makan', '2026-10-05') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 250000, :'c_makan', '2026-10-11') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 180000, :'c_makan', '2026-10-23') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 95000, :'c_makan', '2026-11-09') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 60000, :'c_makan', '2026-11-10') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 340000, :'c_belanja', '2026-11-01') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_gopay', 'expense', 45000, :'c_ojek', '2026-11-03') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 30000, :'c_trans', '2026-10-10') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 500000, :'c_makan', '2026-11-02', true) as g_e10 \gset
select tests.web_val(tests.n(), format(
  $$select api.create_reimbursement(gen_random_uuid(), %L, %L, 300000, '2026-11-06') ->> 'entry_id'$$,
  :'g_e10', :'g_bca')) is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_kantor', 'expense', 75000, :'c_makan', '2026-11-04') is not null as x \gset
select pg_temp.g_trf(tests.n(), :'g_bca', :'g_gopay', 200000, 2500, '2026-10-20') is not null as x \gset
select pg_temp.g_trf(tests.n(), :'g_bca', :'g_tab', 1000000, 0, '2026-11-05') is not null as x \gset
select pg_temp.g_trf(tests.n(), :'g_kantor', :'g_bca', 250000, 1000, '2026-11-07') is not null as x \gset
select pg_temp.g_trf(tests.n(), :'g_bca', :'g_kas', 700000, 6500, '2026-11-01') is not null as x \gset
select pg_temp.g_trf(tests.n(), :'g_kas', :'g_bca', 150000, 0, '2026-11-08') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 99000, :'c_kopi', '2026-11-02') as g_e18 \gset
select pg_temp.g_void(tests.n(), :'g_e18') is not null as x \gset
select pg_temp.g_pay(tests.n(), pg_temp.g_occ(:'g_b_internet', '2026-10-05'), :'g_bca', '2026-10-05') is not null as x \gset
select pg_temp.g_pay(tests.n(), pg_temp.g_occ(:'g_b_listrik', '2026-10-20'), :'g_bca', '2026-10-20') as g_e20 \gset
select pg_temp.g_void(tests.n(), :'g_e20') is not null as x \gset
select pg_temp.g_entry(tests.f(), :'g_kas', 'expense', 120000, :'c_dapur', '2026-11-03') is not null as x \gset
select pg_temp.g_entry(tests.f(), :'g_dana', 'expense', 10000, :'c_fkopi', '2026-11-02') is not null as x \gset
select tests.web_val(tests.n(), format($$select api.skip_bill_occurrence(%L)$$,
  pg_temp.g_occ(:'g_b_asuransi', '2026-10-15'))) is not null as x \gset
select tests.web_val(tests.n(), format($$select api.archive_bill(%L)$$, :'g_b_gym')) is not null as x \gset
select tests.worker_val(null, 'select jobs.materialize_bills()') is not null as x \gset
select pg_temp.g_pay(tests.n(), pg_temp.g_occ(:'g_b_listrik', '2026-12-20'), :'g_bca', null, 410000) is not null as x \gset
select count(coalesce(tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, %L::date, %s, %L::boolean)$$,
  :'np', b.cat, b.month, b.amount, b.wajib)), '')) as g_n_budget
from (values (:'c_makan', '2026-10-01', 800000, true), (:'c_makan', '2026-11-01', 1000000, true),
             (:'c_belanja', '2026-11-01', 300000, true), (:'c_kopi', '2026-11-01', 200000, true),
             (:'c_trans', '2026-11-01', 500000, false), (:'c_kopi', '2026-12-01', 999000, true))
  as b (cat, month, amount, wajib) \gset
