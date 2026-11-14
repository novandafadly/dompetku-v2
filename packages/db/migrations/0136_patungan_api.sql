-- migrate:up
-- S12 (plan S12 Task 6, K3, K4; bingkai S12-ADR1, PT1 sampai PT4, CT1, CT2, AK1, AK2): API bagi
-- tagihan Bersama (patungan). Expand-only: fungsi baru; api.trash_list, jobs.purge_voided, dan
-- private.dq_run diganti utuh (create or replace, tanda tangan dan kolom hasil sama).
--
-- - Bentuk (S12-ADR1 opsi C): tagihan = tiga entri yang sudah dikenal ledger dalam satu transaksi:
--   space_transfer `out` dari dompet Pribadi pembayar (deskripsi tagihan) -> `in` ke dompet sistem
--   (tanpa deskripsi, CHECK 0100) + `expense` dari dompet sistem (kategori dan deskripsi tagihan).
--   Pelunasan = pasangan space_transfer dompet Pribadi pelunas -> dompet sistem (satu sisi, K4);
--   terima = pasangan dompet sistem -> dompet Pribadi PENERIMA SENDIRI, ditulis penerima. Tidak ada
--   fungsi yang menulis ruang Pribadi selain milik pemanggil.
-- - Urutan kunci: baris patungan (tagihan/pelunasan, FOR NO KEY UPDATE) -> entri (urut id) -> dompet
--   (private.lock_accounts, urut id, selalu termasuk dompet sistem). Dompet sistem menyerialkan semua
--   mutasi patungan satu ruang; saldo antar-anggota dibaca SESUDAH kuncinya (READ COMMITTED: snapshot
--   baru per pernyataan), jadi dua pelunasan paralel tidak bisa melewati utang (C3-analog,
--   99_konkurensi). Sama dengan jalur generik (entri -> dompet), tanpa siklus.
-- - Semua tulis entri/dompet sistem di dalam konteks private.split_ctx (0135); di luar itu trigger
--   private.tg_split_guard menolak (split_locked / account_not_found).
-- - api.create_split (idempoten client_id; hash tanpa p_allow_negative): pembayar = pemanggil, anggota
--   Bersama dengan >= 2 anggota (split_needs_partner); ruang Pribadi = split_shared_only. Dompet =
--   dompet Pribadi pemanggil, aktif, operasional/tabungan (Kantor, Trading, dompet Bersama =
--   split_account_invalid; dompet orang lain tidak terlihat = account_not_found tanpa nama/nominal).
--   p_shares null = sama rata antar semua anggota, sisa pembagian ke pembayar; selain itu larik
--   [{user_id, amount}] (anggota ruang, bulat >= 0, tanpa duplikat, Σ = nominal; anggota yang tidak
--   disebut = 0), salah = invalid_argument/shares. saldo_negatif untuk dompet pembayar.
-- - api.void_split / api.restore_split: hanya pembayar (selain itu split_not_found, pola §9.1);
--   membatalkan/memulihkan ketiga entri dan baris tagihan sekaligus; pulihkan <= 90 hari
--   (restore_window_closed), saldo_negatif dompet pembayar; dompet terarsip = account_archived. Saldo
--   patungan boleh berbalik arah (tidak ada logika pelunasan tersembunyi).
-- - api.settle_split: pelunas = pemanggil, penerima = anggota lain (p_to_user, bawaan satu-satunya
--   anggota lain); nominal <= min(utang pemanggil, piutang penerima), lebih = payment_exceeds (nol efek).
-- - api.receive_settlement (hanya penerima, ke dompet Pribadinya; settlement_received bila sudah,
--   settlement_voided bila batal), api.void_receipt (hanya penerima; settlement_not_received),
--   api.void_settlement (hanya pelunas; settlement_received bila sudah diterima, already_voided).
-- - Baca (INVOKER milik owner): api.shared_balances (jsonb: saldo per anggota, arah utang, jumlah,
--   pelunasan menunggu diterima), api.split_history (tagihan + pelunasan berbaur, terbaru di atas,
--   kursor keyset; baris batal <= 90 hari hanya milik pemanggil). Tanpa id/nama dompet Pribadi.
-- - api.trash_list: entri patungan (menyentuh dompet sistem, atau pasangan space_transfer-nya) tidak
--   tampil; pemulihan dari halaman Patungan.
-- - jobs.purge_voided: baris pelunasan dan tagihan batal > 90 hari dihapus lebih dulu (FK dari entri),
--   lalu lintasan entri seperti 0131 di dalam konteks patungan; entri yang masih dirujuk baris patungan
--   (langsung atau lewat pasangannya) tidak ikut.
-- - private.dq_run: + DQ16 (error) patungan: saldo dompet sistem = Σ pelunasan hidup belum diterima;
--   per tagihan Σ bagian = nominal dan kaki masuk/pengeluaran di dompet sistem senominal dengan status
--   batal sama; per pelunasan kaki masuk (dan kaki terima bila ada) cocok; entri hidup di dompet sistem
--   wajib dirujuk baris hidup; Σ saldo anggota per ruang = 0. DQ07 tidak membaca dompet sistem.
-- Kode galat baru: DK422 split_shared_only, split_needs_partner, split_account_invalid,
-- settlement_received, settlement_voided, settlement_not_received; DK404 split_not_found,
-- settlement_not_found. Pesan/detail tanpa nominal dan nama.

-- ===== Helper (INVOKER milik owner, EXECUTE dompetku_api; berjalan di bawah RLS pemanggil) =====
create function private.assert_split_space(p_space_id uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if (select s.kind from app.spaces s where s.id = p_space_id) <> 'shared' then
    raise exception using errcode = 'DK422', message = 'split_shared_only';
  end if;
  if (select count(*) from app.space_members m where m.space_id = p_space_id) < 2 then
    raise exception using errcode = 'DK422', message = 'split_needs_partner';
  end if;
end $$;

-- Dompet sistem ruang (dibuat malas; pemanggil sudah membuka konteks split_ctx).
create function private.patungan_account(p_space_id uuid, p_uid uuid) returns uuid
language plpgsql set search_path = '' as $$
declare v uuid;
begin
  insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
  values (p_space_id, 'shared', 'Patungan', 'patungan', 'cash', date '2000-01-01', p_uid)
  on conflict (space_id) where pocket = 'patungan' do nothing;
  select a.id into v from app.accounts a where a.space_id = p_space_id and a.pocket = 'patungan';
  return v;
end $$;

-- Dompet Pribadi pemanggil (sudah dikunci): aktif, operasional/tabungan.
create function private.split_payer_account(p_account_id uuid) returns app.accounts
language plpgsql stable set search_path = '' as $$
declare v app.accounts%rowtype;
begin
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;
  v := private.get_account(p_account_id, 'account_id');
  if v.space_kind <> 'personal' or v.pocket not in ('operasional', 'tabungan') then
    raise exception using errcode = 'DK422', message = 'split_account_invalid', detail = 'account_id';
  end if;
  if v.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  return v;
end $$;

-- Tagihan milik pembayar = pemanggil, dikunci. Tidak terlihat atau bukan pembayar = DK404.
create function private.lock_split(p_split_id uuid, p_uid uuid) returns app.splits
language plpgsql set search_path = '' as $$
declare v app.splits%rowtype;
begin
  select * into v from app.splits where id = p_split_id;
  if v.id is null or v.payer_id <> p_uid then
    raise exception using errcode = 'DK404', message = 'split_not_found';
  end if;
  perform app.assert_member(v.space_id);
  select * into v from app.splits where id = p_split_id for no key update;
  return v;
end $$;

-- Pelunasan dengan pemanggil sebagai pelunas (p_as_payer) atau penerima, dikunci. Selain itu DK404.
create function private.lock_settlement(p_settlement_id uuid, p_uid uuid, p_as_payer boolean)
returns app.settlements
language plpgsql set search_path = '' as $$
declare v app.settlements%rowtype;
begin
  select * into v from app.settlements where id = p_settlement_id;
  if v.id is null or p_uid <> (case when p_as_payer then v.from_user else v.to_user end) then
    raise exception using errcode = 'DK404', message = 'settlement_not_found';
  end if;
  perform app.assert_member(v.space_id);
  select * into v from app.settlements where id = p_settlement_id for no key update;
  return v;
end $$;

-- Id kaki-kaki satu tagihan: pasangan space_transfer kaki masuk (termasuk kaki Pribadi pembayar) +
-- pengeluaran, urut id.
create function private.split_entry_ids(p_in_entry uuid, p_expense_entry uuid) returns uuid[]
language sql stable set search_path = '' as $$
  select array_agg(x.id order by x.id) from (
    select e.id from app.entries e
     where e.link_id = (select i.link_id from app.entries i where i.id = p_in_entry)
    union
    select p_expense_entry where p_expense_entry is not null
  ) x
$$;

-- Batalkan/pulihkan sekumpulan entri patungan yang sudah dikunci (konteks split_ctx sudah terbuka).
create function private.split_set_void(p_ids uuid[], p_void boolean, p_uid uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update app.entries
     set voided_at  = case when p_void then app.now() end,
         voided_by  = case when p_void then p_uid end,
         version    = version + 1,
         updated_by = p_uid,
         updated_at = app.now()
   where id = any (p_ids);
  perform private.write_history(id, case when p_void then 'void' else 'restore' end::app.history_op, p_uid)
     from unnest(p_ids) as id;
end $$;

-- Pasangan space_transfer: kaki out di p_from (main -p_amount), kaki in di p_to. Kembalikan
-- {out, in}. Deskripsi hanya di kaki Pribadi (CHECK 0100).
create function private.split_pair(p_from app.accounts, p_to app.accounts, p_amount bigint, p_on date,
                                   p_desc text, p_uid uuid) returns uuid[]
language plpgsql set search_path = '' as $$
declare
  v_link uuid := gen_random_uuid();
  v_out  uuid;
  v_in   uuid;
begin
  insert into app.entries (space_id, space_kind, kind, occurred_on, description, link_id, direction,
                           created_by, updated_by)
  values (p_from.space_id, p_from.space_kind, 'space_transfer', p_on,
          case when p_from.space_kind = 'personal' then p_desc end, v_link, 'out', p_uid, p_uid)
  returning id into v_out;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_out, p_from.space_id, 'main', p_from.id, -p_amount);
  insert into app.entries (space_id, space_kind, kind, occurred_on, description, link_id, direction,
                           created_by, updated_by)
  values (p_to.space_id, p_to.space_kind, 'space_transfer', p_on,
          case when p_to.space_kind = 'personal' then p_desc end, v_link, 'in', p_uid, p_uid)
  returning id into v_in;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_in, p_to.space_id, 'main', p_to.id, p_amount);
  perform private.write_history(v_out, 'create', p_uid);
  perform private.write_history(v_in, 'create', p_uid);
  return array[v_out, v_in];
end $$;

-- ===== Tagihan patungan (K3, CT1, CT2) =====
create function api.create_split(
  p_client_id      uuid,
  p_space_id       uuid,
  p_account_id     uuid,
  p_amount         bigint,
  p_category_id    uuid    default null,
  p_occurred_on    date    default null,
  p_description    text    default null,
  p_shares         jsonb   default null,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_desc    text := private.clean_text(p_description, 'description');
  v_on      date;
  v_members uuid[];
  v_shares  jsonb;
  v_bad     boolean;
  v_acc     app.accounts%rowtype;
  v_pat     app.accounts%rowtype;
  v_legs    uuid[];
  v_exp     uuid;
  v_split   uuid;
  v_r       jsonb;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'create_split', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'amount', p_amount, 'category', p_category_id,
           'on', p_occurred_on, 'desc', v_desc, 'shares', p_shares)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.assert_split_space(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = p_space_id and c.type = 'expense') then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  if p_category_id is not null and exists (
       select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;

  -- Bagian per anggota (semua anggota, urut user_id).
  select array_agg(m.user_id order by m.user_id) into v_members
    from app.space_members m where m.space_id = p_space_id;
  if p_shares is null then
    select jsonb_agg(jsonb_build_object('user_id', u, 'amount',
             p_amount / cardinality(v_members)
             + case when u = v_uid then p_amount % cardinality(v_members) else 0 end) order by u)
      into v_shares from unnest(v_members) u;
  else
    begin
      with s as (
        select x ->> 'user_id' as u_txt, x ->> 'amount' as a_txt
          from jsonb_array_elements(p_shares) x
      ), c as (
        select s.u_txt::uuid as u, s.a_txt::numeric as a from s
      )
      select count(*) = 0 or count(*) <> count(distinct c.u)
             or bool_or(c.u is null or c.a is null or c.a < 0 or c.a <> trunc(c.a)
                        or not coalesce(c.u = any (v_members), false))
             or coalesce(sum(c.a), 0) <> p_amount,
             (select jsonb_agg(jsonb_build_object('user_id', m.u, 'amount',
                       coalesce((select sum(c2.a)::bigint from c c2 where c2.u = m.u), 0)) order by m.u)
                from unnest(v_members) m (u))
        into v_bad, v_shares
        from c;
    exception when data_exception then
      v_bad := true;
    end;
    if v_bad then
      raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'shares';
    end if;
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  v_pat.id := private.patungan_account(p_space_id, v_uid);
  select * into v_pat from app.accounts where id = v_pat.id;
  perform private.lock_accounts(array[v_pat.id, p_account_id]);
  v_acc := private.split_payer_account(p_account_id);
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;

  v_legs := private.split_pair(v_acc, v_pat, p_amount, v_on, v_desc, v_uid);
  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           created_by, updated_by)
  values (p_space_id, 'shared', 'expense', v_on, v_desc, p_category_id, v_uid, v_uid)
  returning id into v_exp;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_exp, p_space_id, 'main', v_pat.id, -p_amount);
  perform private.write_history(v_exp, 'create', v_uid);

  insert into app.splits (space_id, in_entry_id, expense_entry_id, payer_id, amount, created_at)
  values (p_space_id, v_legs[2], v_exp, v_uid, p_amount, app.now())
  returning id into v_split;
  insert into app.split_shares (space_id, split_id, user_id, amount)
  select p_space_id, v_split, (x ->> 'user_id')::uuid, (x ->> 'amount')::bigint
    from jsonb_array_elements(v_shares) x;
  perform private.assert_balance(v_acc.id, -p_amount, p_allow_negative);

  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'split_id', v_split, 'expense_entry_id', v_exp, 'in_entry_id', v_legs[2], 'out_entry_id', v_legs[1],
    'amount', p_amount, 'shares', v_shares, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- Hapus tagihan patungan (AK1): ketiga entri + baris tagihan, hanya pembayar.
create function api.void_split(p_client_id uuid, p_split_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_s    app.splits%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'void_split', private.req_hash(
           jsonb_build_object('split', p_split_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_s := private.lock_split(p_split_id, v_uid);
  if v_s.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'already_voided';
  end if;
  v_ids := private.split_entry_ids(v_s.in_entry_id, v_s.expense_entry_id);
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select coalesce(array_agg(distinct account_id order by account_id), '{}') into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  perform private.split_set_void(v_ids, true, v_uid);
  update app.splits set voided_at = app.now(), voided_by = v_uid where id = v_s.id;
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'split_id', v_s.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, -1),
    'warnings', '[]'::jsonb));
end $$;

create function api.restore_split(p_client_id uuid, p_split_id uuid, p_allow_negative boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_s    app.splits%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'restore_split', private.req_hash(
           jsonb_build_object('split', p_split_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_s := private.lock_split(p_split_id, v_uid);
  if v_s.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if v_s.voided_at < app.now() - interval '90 days' then
    raise exception using errcode = 'DK422', message = 'restore_window_closed';
  end if;
  v_ids := private.split_entry_ids(v_s.in_entry_id, v_s.expense_entry_id);
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select coalesce(array_agg(distinct account_id order by account_id), '{}') into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  perform private.split_set_void(v_ids, false, v_uid);
  update app.splits set voided_at = null, voided_by = null where id = v_s.id;
  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id order by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id, v_acc.amt, p_allow_negative);
  end loop;
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'split_id', v_s.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, 1),
    'warnings', '[]'::jsonb));
end $$;

-- ===== Pelunasan (K4, PT3) =====
create function api.settle_split(
  p_client_id      uuid,
  p_space_id       uuid,
  p_account_id     uuid,
  p_amount         bigint,
  p_occurred_on    date    default null,
  p_to_user        uuid    default null,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_on   date;
  v_to   uuid := p_to_user;
  v_acc  app.accounts%rowtype;
  v_pat  app.accounts%rowtype;
  v_owed bigint;
  v_legs uuid[];
  v_t    uuid;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'settle_split', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'amount', p_amount, 'on', p_occurred_on,
           'to', p_to_user)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.assert_split_space(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);
  if v_to is null and (select count(*) from app.space_members m
                        where m.space_id = p_space_id and m.user_id <> v_uid) = 1 then
    select m.user_id into v_to from app.space_members m where m.space_id = p_space_id and m.user_id <> v_uid;
  end if;
  if v_to is null or v_to = v_uid
     or not exists (select 1 from app.space_members m where m.space_id = p_space_id and m.user_id = v_to) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_user';
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  v_pat.id := private.patungan_account(p_space_id, v_uid);
  select * into v_pat from app.accounts where id = v_pat.id;
  perform private.lock_accounts(array[v_pat.id, p_account_id]);
  v_acc := private.split_payer_account(p_account_id);
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  -- Dibaca sesudah kunci dompet sistem (lihat urutan kunci di kepala berkas).
  select least(greatest(-coalesce((select b.balance from app.member_balances b
                                    where b.space_id = p_space_id and b.user_id = v_uid), 0), 0),
               greatest(coalesce((select b.balance from app.member_balances b
                                   where b.space_id = p_space_id and b.user_id = v_to), 0), 0))
    into v_owed;
  if p_amount > v_owed then
    raise exception using errcode = 'DK422', message = 'payment_exceeds';
  end if;

  v_legs := private.split_pair(v_acc, v_pat, p_amount, v_on, null, v_uid);
  insert into app.settlements (space_id, from_user, to_user, amount, occurred_on, in_entry_id, created_at)
  values (p_space_id, v_uid, v_to, p_amount, v_on, v_legs[2], app.now())
  returning id into v_t;
  perform private.assert_balance(v_acc.id, -p_amount, p_allow_negative);
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'settlement_id', v_t, 'out_entry_id', v_legs[1], 'in_entry_id', v_legs[2], 'amount', p_amount,
    'to_user', v_to, 'remaining', v_owed - p_amount, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- Batalkan pelunasan (AK2, hanya pelunas, belum diterima).
create function api.void_settlement(p_client_id uuid, p_settlement_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_t    app.settlements%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'void_settlement', private.req_hash(
           jsonb_build_object('settlement', p_settlement_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_t := private.lock_settlement(p_settlement_id, v_uid, true);
  if v_t.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'already_voided';
  end if;
  if v_t.received_entry_id is not null then
    raise exception using errcode = 'DK422', message = 'settlement_received';
  end if;
  v_ids := private.split_entry_ids(v_t.in_entry_id, null);
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select coalesce(array_agg(distinct account_id order by account_id), '{}') into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  perform private.split_set_void(v_ids, true, v_uid);
  update app.settlements set voided_at = app.now(), voided_by = v_uid where id = v_t.id;
  -- Pertahanan berlapis: dompet sistem tidak pernah negatif (pelunasan belum diterima masih di sana).
  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id order by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id, -v_acc.amt, false);
  end loop;
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'settlement_id', v_t.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, -1),
    'warnings', '[]'::jsonb));
end $$;

-- Terima ke dompet (PT4): penerima memindahkan uang pelunasan dari dompet sistem ke dompet Pribadinya.
create function api.receive_settlement(
  p_client_id     uuid,
  p_settlement_id uuid,
  p_account_id    uuid,
  p_occurred_on   date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_on   date;
  v_t    app.settlements%rowtype;
  v_acc  app.accounts%rowtype;
  v_pat  app.accounts%rowtype;
  v_legs uuid[];
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'receive_settlement', private.req_hash(jsonb_build_object(
           'settlement', p_settlement_id, 'account', p_account_id, 'on', p_occurred_on)));
  if v_r is not null then
    return v_r;
  end if;
  v_on := private.check_date(p_occurred_on);
  v_t := private.lock_settlement(p_settlement_id, v_uid, false);
  if v_t.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'settlement_voided';
  end if;
  if v_t.received_entry_id is not null then
    raise exception using errcode = 'DK422', message = 'settlement_received';
  end if;
  if v_on < v_t.occurred_on then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'occurred_on';
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  select * into v_pat from app.accounts where space_id = v_t.space_id and pocket = 'patungan';
  perform private.lock_accounts(array[v_pat.id, p_account_id]);
  v_acc := private.split_payer_account(p_account_id);
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;

  v_legs := private.split_pair(v_pat, v_acc, v_t.amount, v_on, null, v_uid);
  update app.settlements set received_entry_id = v_legs[1], received_at = app.now() where id = v_t.id;
  perform private.assert_balance(v_pat.id, -v_t.amount, false);
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'settlement_id', v_t.id, 'in_entry_id', v_legs[2], 'out_entry_id', v_legs[1], 'amount', v_t.amount,
    'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- Batalkan penerimaan (AK2 penerima): uang kembali menunggu di dompet sistem; saldo patungan tetap.
create function api.void_receipt(p_client_id uuid, p_settlement_id uuid, p_allow_negative boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_t    app.settlements%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'void_receipt', private.req_hash(
           jsonb_build_object('settlement', p_settlement_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_t := private.lock_settlement(p_settlement_id, v_uid, false);
  if v_t.received_entry_id is null then
    raise exception using errcode = 'DK422', message = 'settlement_not_received';
  end if;
  v_ids := private.split_entry_ids(v_t.received_entry_id, null);
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select coalesce(array_agg(distinct account_id order by account_id), '{}') into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  perform private.split_set_void(v_ids, true, v_uid);
  update app.settlements set received_entry_id = null, received_at = null where id = v_t.id;
  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id order by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id, -v_acc.amt, p_allow_negative);
  end loop;
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'settlement_id', v_t.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, -1),
    'warnings', '[]'::jsonb));
end $$;

-- ===== Baca (SECURITY INVOKER: RLS tetap berlaku) =====
-- Saldo patungan ruang Bersama (PT1, PT2): members = semua anggota dengan saldo (positif = dipiutangi);
-- debtor/creditor/amount = arah utang (null bila impas); pending = pelunasan hidup belum diterima.
create function api.shared_balances(p_space_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v jsonb;
begin
  perform app.assert_member(p_space_id);
  if (select s.kind from app.spaces s where s.id = p_space_id) <> 'shared' then
    raise exception using errcode = 'DK422', message = 'split_shared_only';
  end if;
  with m as (
    select r.user_id, coalesce(b.balance, 0)::bigint as balance
      from app.space_roster(p_space_id) r
      left join app.member_balances b on b.space_id = p_space_id and b.user_id = r.user_id
  ), d as (
    select (select m.user_id from m where m.balance < 0 order by m.balance, m.user_id limit 1) as debtor,
           (select m.user_id from m where m.balance > 0 order by m.balance desc, m.user_id limit 1) as creditor
  )
  select jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'balance', m.balance)
                                          order by m.user_id), '[]'::jsonb) from m),
    'debtor_id', d.debtor,
    'creditor_id', d.creditor,
    'amount', case when d.debtor is not null and d.creditor is not null then
                least((select -m.balance from m where m.user_id = d.debtor),
                      (select m.balance from m where m.user_id = d.creditor)) end,
    'split_count', (select count(*) from app.splits s where s.space_id = p_space_id and s.voided_at is null),
    'settlement_count', (select count(*) from app.settlements t
                          where t.space_id = p_space_id and t.voided_at is null),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object(
                  'settlement_id', t.id, 'from_user', t.from_user, 'to_user', t.to_user,
                  'amount', t.amount, 'occurred_on', t.occurred_on) order by t.occurred_on, t.created_at, t.id),
                  '[]'::jsonb)
                  from app.settlements t
                 where t.space_id = p_space_id and t.voided_at is null and t.received_entry_id is null))
    into v from d;
  return v;
end $$;

-- Riwayat patungan (PT2): tagihan dan pelunasan berbaur, terbaru di atas (occurred_on, created_at, id).
-- Baris batal <= 90 hari hanya milik pemanggil (grup `Patungan dihapus`). Kursor = ketiga kolom
-- urutan baris terakhir halaman sebelumnya (semua atau tidak sama sekali).
create function api.split_history(
  p_space_id  uuid,
  p_limit     int default 20,
  p_before_on date default null,
  p_before_at timestamptz default null,
  p_before_id uuid default null
) returns table (item text, id uuid, occurred_on date, created_at timestamptz, actor_id uuid,
                 counterparty_id uuid, amount bigint, description text, category_id uuid,
                 expense_entry_id uuid, shares jsonb, received boolean, voided_at timestamptz,
                 purge_after timestamptz)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  if num_nulls(p_before_on, p_before_at, p_before_id) not in (0, 3) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'cursor';
  end if;
  return query
  select x.item, x.id, x.occurred_on, x.created_at, x.actor_id, x.counterparty_id, x.amount,
         x.description, x.category_id, x.expense_entry_id, x.shares, x.received, x.voided_at,
         x.voided_at + interval '90 days'
  from (
    select 'split'::text as item, s.id, e.occurred_on, s.created_at, s.payer_id as actor_id,
           null::uuid as counterparty_id, s.amount, e.description, e.category_id,
           s.expense_entry_id, (select jsonb_agg(jsonb_build_object('user_id', sh.user_id, 'amount', sh.amount)
                                                 order by sh.user_id)
                                  from app.split_shares sh where sh.space_id = s.space_id and sh.split_id = s.id)
             as shares,
           null::boolean as received, s.voided_at
      from app.splits s
      join app.entries e on e.space_id = s.space_id and e.id = s.expense_entry_id
     where s.space_id = p_space_id
    union all
    select 'settlement', t.id, t.occurred_on, t.created_at, t.from_user, t.to_user, t.amount, null, null,
           null, null, t.received_entry_id is not null, t.voided_at
      from app.settlements t
     where t.space_id = p_space_id
  ) x
  where (x.voided_at is null
         or (x.actor_id = app.current_user_id() and x.voided_at >= app.now() - interval '90 days'))
    and (p_before_on is null or (x.occurred_on, x.created_at, x.id) < (p_before_on, p_before_at, p_before_id))
  order by x.occurred_on desc, x.created_at desc, x.id desc
  limit p_limit;
end $$;

-- ===== Sampah (0131 + tanpa entri patungan) =====
-- Entri patungan (menyentuh dompet sistem, atau kaki Pribadi pasangannya) dipulihkan dari halaman
-- Patungan; pulihkannya lewat Sampah pasti split_locked.
create or replace function api.trash_list(p_space_id uuid, p_limit int default 50)
returns table (entry_id uuid, version int, kind app.entry_kind, direction app.entry_direction,
               occurred_on date, description text, amount bigint, voided_at timestamptz,
               voided_by uuid, purge_after timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  select e.id, e.version, e.kind, e.direction, e.occurred_on, e.description,
         (select abs(l.amount) from app.entry_lines l where l.entry_id = e.id and l.role = 'main'),
         e.voided_at, e.voided_by, e.voided_at + interval '90 days'
  from app.entries e
  where e.space_id = p_space_id and e.voided_at is not null
    and e.voided_at >= app.now() - interval '90 days'
    and e.moved_at is null
    -- 0131: entri utang yang terhapus (ikut Hapus utang ATAU dibatalkan sendiri sebelumnya) tidak tampil:
    -- pulihkannya pasti debt_deleted. Muncul lagi sesudah restore_debt (cicilan batal sendiri).
    and not exists (select 1 from app.debts d
                    where d.space_id = e.space_id and d.id = e.debt_id and d.voided_at is not null)
    -- 0136: entri patungan.
    and not exists (select 1 from app.entries p
                    join app.entry_lines l on l.space_id = p.space_id and l.entry_id = p.id
                    join app.accounts a on a.id = l.account_id
                    where a.pocket = 'patungan'
                      and (p.id = e.id or (e.link_id is not null and p.link_id = e.link_id)))
  order by e.voided_at desc, e.id desc
  limit p_limit;
end $$;

-- ===== Purge 90 hari (0131 + patungan) =====
create or replace function jobs.purge_voided() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_n int := 0;
begin
  -- 0136: konteks patungan (tg_split_guard) dan baris patungan batal > 90 hari lebih dulu (FK dari entri;
  -- pemulihan ditolak sesudah 90 hari, entrinya batal di waktu yang sama). Pelunasan batal selalu belum
  -- diterima (CHECK), jadi tidak merujuk kaki terima.
  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  delete from app.settlements t where t.voided_at < app.now() - interval '90 days';
  delete from app.splits s where s.voided_at < app.now() - interval '90 days';
  for i in 1..2 loop
    -- Kunci urut id (sama dengan void/restore); baris yang dipulihkan paralel diperiksa ulang
    -- sesudah lock (READ COMMITTED) dan tidak ikut (review S5).
    select coalesce(array_agg(x.id), '{}') into v_ids
    from (
      select e.id
      from app.entries e
      where e.voided_at < app.now() - interval '90 days'
        and not exists (select 1 from app.entries r where r.reimburses_entry_id = e.id)
        and (e.link_id is null or not exists (
              select 1 from app.entries p
              where p.link_id = e.link_id
                and (p.voided_at is null or p.voided_at >= app.now() - interval '90 days')))
        and not (e.voided_with_debt and exists (
              select 1 from app.debts d
              where d.space_id = e.space_id and d.id = e.debt_id
                and d.voided_at >= app.now() - interval '90 days'))
        -- 0136: entri (atau pasangannya) yang masih dirujuk baris patungan tidak ikut.
        and not exists (
              select 1 from app.entries p
              where (p.id = e.id or (e.link_id is not null and p.link_id = e.link_id))
                and (exists (select 1 from app.splits s where p.id in (s.in_entry_id, s.expense_entry_id))
                     or exists (select 1 from app.settlements t
                                 where p.id in (t.in_entry_id, t.received_entry_id))))
      order by e.id
      for update of e
    ) x;
    exit when cardinality(v_ids) = 0;
    v_n := v_n + private.purge_entries(v_ids, 'purge_voided');
  end loop;
  delete from app.debts d
   where d.voided_at < app.now() - interval '90 days'
     and not exists (select 1 from app.entries e where e.space_id = d.space_id and e.debt_id = d.id);
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();
  return v_n;
end $$;

-- ===== Cek kualitas data: DQ16 patungan, DQ07 tanpa dompet sistem (selebihnya = 0134) =====
create or replace function private.dq_run()
returns table (check_id text, severity text, violations int)
language sql stable security definer set search_path = '' as $$
  -- DQ01 saldo view = Σ ulang lines (query independen dari view)
  select 'DQ01', 'error', count(*)::int from (
    select a.id from app.accounts a
    left join app.entry_lines l on l.account_id = a.id
    left join app.entries e on e.id = l.entry_id and e.voided_at is null
    group by a.id
    having coalesce(sum(case when e.id is not null then l.amount end), 0)
           <> (select ab.balance from app.account_balances ab where ab.account_id = a.id)
  ) x
  union all
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130)
  select 'DQ03', 'error', count(*)::int from (
    select e.id
    from app.entries e
    left join lateral (
      select count(*) filter (where l.role = 'main')    as n_main,
             count(*) filter (where l.role = 'counter') as n_counter,
             count(*) filter (where l.role = 'fee')     as n_fee,
             sum(l.amount) filter (where l.role = 'main')    as m_amt,
             sum(l.amount) filter (where l.role = 'counter') as c_amt,
             sum(l.amount) filter (where l.role = 'fee')     as f_amt,
             (array_agg(l.account_id) filter (where l.role = 'main'))[1]    as m_acc,
             (array_agg(l.account_id) filter (where l.role = 'counter'))[1] as c_acc,
             (array_agg(l.account_id) filter (where l.role = 'fee'))[1]     as f_acc
      from app.entry_lines l where l.entry_id = e.id
    ) s on true
    left join app.debts d on d.id = e.debt_id
    left join app.accounts ma on ma.id = s.m_acc
    where e.voided_at is null
      and not coalesce(
        s.n_main = 1
        and (s.n_fee = 0 or (s.f_amt < 0 and s.f_acc = s.m_acc))
        and case
          when e.kind in ('income', 'reimbursement', 'opening_balance') then
               s.n_counter = 0 and s.n_fee = 0 and s.m_amt > 0
          when e.kind = 'expense' then s.n_counter = 0 and s.n_fee = 0 and s.m_amt < 0
          when e.kind = 'transfer' then
               s.n_counter = 1 and s.m_amt < 0 and s.c_amt = -s.m_amt and s.c_acc <> s.m_acc
          when e.kind = 'space_transfer' then
               s.n_counter = 0
               and case e.direction when 'out' then s.m_amt < 0
                                    else s.m_amt > 0 and s.n_fee = 0 end
          when e.kind = 'adjustment' then s.n_counter = 0 and s.n_fee = 0
          -- Paritas dengan assert_entry_shape 0130 (entri hidup saja, jadi utang harus hidup).
          when e.kind = 'debt_principal' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and d.mode = 'baru' and abs(s.m_amt) = d.principal
               and case d.direction when 'borrowed' then s.m_amt > 0 when 'lent' then s.m_amt < 0 end
          when e.kind = 'debt_payment' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and case d.direction when 'borrowed' then s.m_amt < 0 when 'lent' then s.m_amt > 0 end
          else false
        end, false)
  ) x
  union all
  -- DQ05 (0131) sisa utang tidak negatif: Σ |main| cicilan hidup per utang <= principal. Kueri
  -- independen dari app.debt_balances; api.pay_debt dan pulihkan cicilan menjaga saat tulis.
  select 'DQ05', 'error', count(*)::int from app.debts d
  where d.principal < (select coalesce(sum(abs(l.amount)), 0) from app.entries e
                       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                       where e.debt_id = d.id and e.kind = 'debt_payment' and e.voided_at is null)
  union all
  -- DQ04 transfer satu ruang: Σ = −fee
  select 'DQ04', 'error', count(*)::int from (
    select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
    where e.kind = 'transfer' group by e.id
    having sum(l.amount) <> coalesce(sum(l.amount) filter (where l.role = 'fee'), 0)
  ) x
  union all
  -- DQ04b pasangan space_transfer: 2 kaki, Σ main = 0, status void seragam
  select 'DQ04b', 'error', count(*)::int from (
    select e.link_id from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    where e.kind = 'space_transfer' group by e.link_id
    having count(*) <> 2 or sum(l.amount) <> 0 or count(distinct (e.voided_at is null)) <> 1
  ) x
  union all
  -- DQ06 version = jumlah history
  select 'DQ06', 'warn', count(*)::int from app.entries e
  where e.version <> (select count(*) from app.entry_history h where h.entry_id = e.id)
  union all
  -- DQ07 tabungan negatif sekarang, atau negatif di akhir 3 hari WIB terakhir berturut-turut
  select 'DQ07', 'warn', count(*)::int from (
    select a.id
    from app.accounts a
    left join (
      select l.account_id, l.amount, e.occurred_on
      from app.entry_lines l join app.entries e on e.id = l.entry_id
      where e.voided_at is null
    ) v on v.account_id = a.id
    where a.pocket <> 'patungan'  -- 0136: dompet sistem dijaga DQ16
    group by a.id, a.pocket
    having (a.pocket = 'tabungan' and coalesce(sum(v.amount), 0) < 0)
        or (coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 1), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 2), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 3), 0) < 0)
  ) x
  union all
  -- DQ09 line menunjuk akun ruang lain
  select 'DQ09', 'error', count(*)::int from app.entry_lines l
  join app.accounts a on a.id = l.account_id where a.space_id <> l.space_id
  union all
  -- DQ10 purge macet
  select 'DQ10', 'warn', count(*)::int from app.entries e
  where e.voided_at < app.now() - interval '97 days'
  union all
  -- DQ11 reimburse hidup menunjuk talangan hidup reimbursable di ruang yang sama
  select 'DQ11', 'error', count(*)::int from app.entries r
  where r.kind = 'reimbursement' and r.voided_at is null
    and not exists (
      select 1 from app.entries t
      where t.id = r.reimburses_entry_id and t.space_id = r.space_id and t.kind = 'expense'
        and t.reimbursable and t.voided_at is null)
  union all
  -- DQ12 Σ nominal reimburse hidup per talangan <= nominal talangan
  select 'DQ12', 'error', count(*)::int from (
    select r.reimburses_entry_id
    from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
    where r.kind = 'reimbursement' and r.voided_at is null
    group by r.reimburses_entry_id
    having sum(l.amount) > (select -tl.amount from app.entry_lines tl
                            where tl.entry_id = r.reimburses_entry_id and tl.role = 'main')
  ) x
  union all
  -- DQ13 satu kewajiban: tagihan aktif + anggaran wajib, kategori induk sama, kemunculan tagihan
  -- (mulai bill_first_on) di periode berlabel bulan anggaran. Dihitung per pasangan. Hanya label
  -- periode berjalan ke depan: label lampau yang bergeser karena payday_rule/app.holidays berubah
  -- tidak lagi memengaruhi aman dipakai, jadi tidak membuat alert merah selamanya.
  select 'DQ13', 'error', count(*)::int from app.bills b
  join app.categories c on c.id = b.category_id
  join app.budgets bu on bu.space_id = b.space_id and bu.wajib
                     and bu.category_id = coalesce(c.parent_id, c.id)
  where b.archived_at is null
    and bu.month >= (select pp.label_month from app.pay_period(b.space_id, app.today()) pp)
    and private.bill_due_in_label(b.space_id, b.day_of_month,
          private.bill_first_on(b.starts_on, b.created_at), b.ends_on, bu.month)
  union all
  -- DQ14 pohon anggaran (S10): rincian tanpa anggaran induk di label yang sama, atau jumlah rincian
  -- satu induk melewati anggaran induknya. Trigger private.tg_budget_tree menjaga saat tulis; cek ini
  -- menangkap baris yang lolos jalan lain (UPDATE massal/restore manual). Dihitung per (ruang, induk, label).
  select 'DQ14', 'error', count(*)::int from (
    select bu.space_id, c.parent_id, bu.month
    from app.budgets bu join app.categories c on c.id = bu.category_id
    where c.parent_id is not null
    group by bu.space_id, c.parent_id, bu.month
    having sum(bu.amount) > coalesce((select p.amount from app.budgets p
             where p.space_id = bu.space_id and p.category_id = c.parent_id and p.month = bu.month), 0)
  ) x
  union all
  -- DQ15 modal trading (S12, 0134): app.trading_capital = Σ ulang transfer hidup antara dompet
  -- trading dan dompet non-trading satu ruang (kueri independen membaca −main, view membaca
  -- counter), capital_left/realized tidak negatif dan capital_left - realized = setor - tarik; dompet
  -- trading wajib di Pribadi (B10, CHECK) dan wajib ada di view.
  select 'DQ15', 'error', count(*)::int from (
    select a.id
    from app.accounts a
    left join app.trading_capital tc on tc.account_id = a.id
    left join lateral (
      select coalesce(sum(-m.amount) filter (where c.account_id = a.id), 0) as cin,
             coalesce(sum(-m.amount) filter (where m.account_id = a.id), 0) as cout
      from app.entries e
      join app.entry_lines m on m.entry_id = e.id and m.role = 'main'
      join app.entry_lines c on c.entry_id = e.id and c.role = 'counter'
      join app.accounts ma on ma.id = m.account_id
      join app.accounts ca on ca.id = c.account_id
      where e.kind = 'transfer' and e.voided_at is null
        and a.id in (m.account_id, c.account_id)
        and (ma.pocket = 'trading') <> (ca.pocket = 'trading')
    ) s on true
    where a.pocket = 'trading'
      and (a.space_kind <> 'personal' or tc.account_id is null
           or tc.capital_in <> s.cin or tc.capital_out <> s.cout
           or tc.capital_left < 0 or tc.realized < 0
           or tc.capital_left - tc.realized <> s.cin - s.cout)
  ) x
  union all
  -- DQ16 patungan (S12, 0136): (a) saldo dompet sistem = Σ pelunasan hidup belum diterima; (b) per
  -- tagihan Σ bagian = nominal, kaki masuk dan pengeluaran ada di dompet sistem ruang itu senominal
  -- dengan status batal sama; (c) per pelunasan kaki masuk cocok, kaki terima (bila ada) hidup dan
  -- cocok; (d) entri hidup di dompet sistem wajib dirujuk baris patungan hidup; (e) Σ saldo anggota per
  -- ruang = 0. Kueri independen dari fungsi tulis 0136.
  select 'DQ16', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'patungan'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null)
          <> (select coalesce(sum(t.amount), 0) from app.settlements t
               where t.space_id = a.space_id and t.voided_at is null and t.received_entry_id is null)
    union all
    select s.id from app.splits s
    where s.amount <> (select coalesce(sum(sh.amount), 0) from app.split_shares sh
                        where sh.space_id = s.space_id and sh.split_id = s.id)
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.expense_entry_id and e.kind = 'expense'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = -s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
    union all
    select t.id from app.settlements t
    where not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = t.amount
                        and (e.voided_at is null) = (t.voided_at is null))
       or (t.received_entry_id is not null and not exists (
                      select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.received_entry_id and e.kind = 'space_transfer' and e.direction = 'out'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = -t.amount
                        and e.voided_at is null))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id
    where a.pocket = 'patungan' and e.voided_at is null
      and not exists (select 1 from app.splits s
                      where s.voided_at is null and e.id in (s.in_entry_id, s.expense_entry_id))
      and not exists (select 1 from app.settlements t where t.voided_at is null and t.in_entry_id = e.id)
      and not exists (select 1 from app.settlements t where t.received_entry_id = e.id)
    union all
    select b.space_id from app.member_balances b group by b.space_id having sum(b.balance) <> 0
  ) x
$$;

-- ===== Hak =====
grant execute on function private.assert_split_space(uuid), private.patungan_account(uuid, uuid),
  private.split_payer_account(uuid), private.lock_split(uuid, uuid),
  private.lock_settlement(uuid, uuid, boolean), private.split_entry_ids(uuid, uuid),
  private.split_set_void(uuid[], boolean, uuid),
  private.split_pair(app.accounts, app.accounts, bigint, date, text, uuid) to dompetku_api;
-- DQ16 di private.dq_run (milik auditor): tabel patungan dan view saldo sudah di-grant di 0135.

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function api.split_history(uuid, int, date, timestamptz, uuid);
drop function api.shared_balances(uuid);
drop function api.void_receipt(uuid, uuid, boolean);
drop function api.receive_settlement(uuid, uuid, uuid, date);
drop function api.void_settlement(uuid, uuid);
drop function api.settle_split(uuid, uuid, uuid, bigint, date, uuid, boolean);
drop function api.restore_split(uuid, uuid, boolean);
drop function api.void_split(uuid, uuid);
drop function api.create_split(uuid, uuid, uuid, bigint, uuid, date, text, jsonb, boolean);
drop function private.split_pair(app.accounts, app.accounts, bigint, date, text, uuid);
drop function private.split_set_void(uuid[], boolean, uuid);
drop function private.split_entry_ids(uuid, uuid);
drop function private.lock_settlement(uuid, uuid, boolean);
drop function private.lock_split(uuid, uuid);
drop function private.split_payer_account(uuid);
drop function private.patungan_account(uuid, uuid);
drop function private.assert_split_space(uuid);

-- Fungsi yang diganti kembali ke badan sebelumnya (0131, 0134).
create or replace function api.trash_list(p_space_id uuid, p_limit int default 50)
returns table (entry_id uuid, version int, kind app.entry_kind, direction app.entry_direction,
               occurred_on date, description text, amount bigint, voided_at timestamptz,
               voided_by uuid, purge_after timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  select e.id, e.version, e.kind, e.direction, e.occurred_on, e.description,
         (select abs(l.amount) from app.entry_lines l where l.entry_id = e.id and l.role = 'main'),
         e.voided_at, e.voided_by, e.voided_at + interval '90 days'
  from app.entries e
  where e.space_id = p_space_id and e.voided_at is not null
    and e.voided_at >= app.now() - interval '90 days'
    and e.moved_at is null
    -- 0131: entri utang yang terhapus (ikut Hapus utang ATAU dibatalkan sendiri sebelumnya) tidak tampil:
    -- pulihkannya pasti debt_deleted. Muncul lagi sesudah restore_debt (cicilan batal sendiri).
    and not exists (select 1 from app.debts d
                    where d.space_id = e.space_id and d.id = e.debt_id and d.voided_at is not null)
  order by e.voided_at desc, e.id desc
  limit p_limit;
end $$;

create or replace function jobs.purge_voided() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_n int := 0;
begin
  for i in 1..2 loop
    -- Kunci urut id (sama dengan void/restore); baris yang dipulihkan paralel diperiksa ulang
    -- sesudah lock (READ COMMITTED) dan tidak ikut (review S5).
    select coalesce(array_agg(x.id), '{}') into v_ids
    from (
      select e.id
      from app.entries e
      where e.voided_at < app.now() - interval '90 days'
        and not exists (select 1 from app.entries r where r.reimburses_entry_id = e.id)
        and (e.link_id is null or not exists (
              select 1 from app.entries p
              where p.link_id = e.link_id
                and (p.voided_at is null or p.voided_at >= app.now() - interval '90 days')))
        and not (e.voided_with_debt and exists (
              select 1 from app.debts d
              where d.space_id = e.space_id and d.id = e.debt_id
                and d.voided_at >= app.now() - interval '90 days'))
      order by e.id
      for update of e
    ) x;
    exit when cardinality(v_ids) = 0;
    v_n := v_n + private.purge_entries(v_ids, 'purge_voided');
  end loop;
  delete from app.debts d
   where d.voided_at < app.now() - interval '90 days'
     and not exists (select 1 from app.entries e where e.space_id = d.space_id and e.debt_id = d.id);
  return v_n;
end $$;

create or replace function private.dq_run()
returns table (check_id text, severity text, violations int)
language sql stable security definer set search_path = '' as $$
  -- DQ01 saldo view = Σ ulang lines (query independen dari view)
  select 'DQ01', 'error', count(*)::int from (
    select a.id from app.accounts a
    left join app.entry_lines l on l.account_id = a.id
    left join app.entries e on e.id = l.entry_id and e.voided_at is null
    group by a.id
    having coalesce(sum(case when e.id is not null then l.amount end), 0)
           <> (select ab.balance from app.account_balances ab where ab.account_id = a.id)
  ) x
  union all
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130)
  select 'DQ03', 'error', count(*)::int from (
    select e.id
    from app.entries e
    left join lateral (
      select count(*) filter (where l.role = 'main')    as n_main,
             count(*) filter (where l.role = 'counter') as n_counter,
             count(*) filter (where l.role = 'fee')     as n_fee,
             sum(l.amount) filter (where l.role = 'main')    as m_amt,
             sum(l.amount) filter (where l.role = 'counter') as c_amt,
             sum(l.amount) filter (where l.role = 'fee')     as f_amt,
             (array_agg(l.account_id) filter (where l.role = 'main'))[1]    as m_acc,
             (array_agg(l.account_id) filter (where l.role = 'counter'))[1] as c_acc,
             (array_agg(l.account_id) filter (where l.role = 'fee'))[1]     as f_acc
      from app.entry_lines l where l.entry_id = e.id
    ) s on true
    left join app.debts d on d.id = e.debt_id
    left join app.accounts ma on ma.id = s.m_acc
    where e.voided_at is null
      and not coalesce(
        s.n_main = 1
        and (s.n_fee = 0 or (s.f_amt < 0 and s.f_acc = s.m_acc))
        and case
          when e.kind in ('income', 'reimbursement', 'opening_balance') then
               s.n_counter = 0 and s.n_fee = 0 and s.m_amt > 0
          when e.kind = 'expense' then s.n_counter = 0 and s.n_fee = 0 and s.m_amt < 0
          when e.kind = 'transfer' then
               s.n_counter = 1 and s.m_amt < 0 and s.c_amt = -s.m_amt and s.c_acc <> s.m_acc
          when e.kind = 'space_transfer' then
               s.n_counter = 0
               and case e.direction when 'out' then s.m_amt < 0
                                    else s.m_amt > 0 and s.n_fee = 0 end
          when e.kind = 'adjustment' then s.n_counter = 0 and s.n_fee = 0
          -- Paritas dengan assert_entry_shape 0130 (entri hidup saja, jadi utang harus hidup).
          when e.kind = 'debt_principal' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and d.mode = 'baru' and abs(s.m_amt) = d.principal
               and case d.direction when 'borrowed' then s.m_amt > 0 when 'lent' then s.m_amt < 0 end
          when e.kind = 'debt_payment' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and case d.direction when 'borrowed' then s.m_amt < 0 when 'lent' then s.m_amt > 0 end
          else false
        end, false)
  ) x
  union all
  -- DQ05 (0131) sisa utang tidak negatif: Σ |main| cicilan hidup per utang <= principal. Kueri
  -- independen dari app.debt_balances; api.pay_debt dan pulihkan cicilan menjaga saat tulis.
  select 'DQ05', 'error', count(*)::int from app.debts d
  where d.principal < (select coalesce(sum(abs(l.amount)), 0) from app.entries e
                       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                       where e.debt_id = d.id and e.kind = 'debt_payment' and e.voided_at is null)
  union all
  -- DQ04 transfer satu ruang: Σ = −fee
  select 'DQ04', 'error', count(*)::int from (
    select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
    where e.kind = 'transfer' group by e.id
    having sum(l.amount) <> coalesce(sum(l.amount) filter (where l.role = 'fee'), 0)
  ) x
  union all
  -- DQ04b pasangan space_transfer: 2 kaki, Σ main = 0, status void seragam
  select 'DQ04b', 'error', count(*)::int from (
    select e.link_id from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    where e.kind = 'space_transfer' group by e.link_id
    having count(*) <> 2 or sum(l.amount) <> 0 or count(distinct (e.voided_at is null)) <> 1
  ) x
  union all
  -- DQ06 version = jumlah history
  select 'DQ06', 'warn', count(*)::int from app.entries e
  where e.version <> (select count(*) from app.entry_history h where h.entry_id = e.id)
  union all
  -- DQ07 tabungan negatif sekarang, atau negatif di akhir 3 hari WIB terakhir berturut-turut
  select 'DQ07', 'warn', count(*)::int from (
    select a.id
    from app.accounts a
    left join (
      select l.account_id, l.amount, e.occurred_on
      from app.entry_lines l join app.entries e on e.id = l.entry_id
      where e.voided_at is null
    ) v on v.account_id = a.id
    group by a.id, a.pocket
    having (a.pocket = 'tabungan' and coalesce(sum(v.amount), 0) < 0)
        or (coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 1), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 2), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 3), 0) < 0)
  ) x
  union all
  -- DQ09 line menunjuk akun ruang lain
  select 'DQ09', 'error', count(*)::int from app.entry_lines l
  join app.accounts a on a.id = l.account_id where a.space_id <> l.space_id
  union all
  -- DQ10 purge macet
  select 'DQ10', 'warn', count(*)::int from app.entries e
  where e.voided_at < app.now() - interval '97 days'
  union all
  -- DQ11 reimburse hidup menunjuk talangan hidup reimbursable di ruang yang sama
  select 'DQ11', 'error', count(*)::int from app.entries r
  where r.kind = 'reimbursement' and r.voided_at is null
    and not exists (
      select 1 from app.entries t
      where t.id = r.reimburses_entry_id and t.space_id = r.space_id and t.kind = 'expense'
        and t.reimbursable and t.voided_at is null)
  union all
  -- DQ12 Σ nominal reimburse hidup per talangan <= nominal talangan
  select 'DQ12', 'error', count(*)::int from (
    select r.reimburses_entry_id
    from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
    where r.kind = 'reimbursement' and r.voided_at is null
    group by r.reimburses_entry_id
    having sum(l.amount) > (select -tl.amount from app.entry_lines tl
                            where tl.entry_id = r.reimburses_entry_id and tl.role = 'main')
  ) x
  union all
  -- DQ13 satu kewajiban: tagihan aktif + anggaran wajib, kategori induk sama, kemunculan tagihan
  -- (mulai bill_first_on) di periode berlabel bulan anggaran. Dihitung per pasangan. Hanya label
  -- periode berjalan ke depan: label lampau yang bergeser karena payday_rule/app.holidays berubah
  -- tidak lagi memengaruhi aman dipakai, jadi tidak membuat alert merah selamanya.
  select 'DQ13', 'error', count(*)::int from app.bills b
  join app.categories c on c.id = b.category_id
  join app.budgets bu on bu.space_id = b.space_id and bu.wajib
                     and bu.category_id = coalesce(c.parent_id, c.id)
  where b.archived_at is null
    and bu.month >= (select pp.label_month from app.pay_period(b.space_id, app.today()) pp)
    and private.bill_due_in_label(b.space_id, b.day_of_month,
          private.bill_first_on(b.starts_on, b.created_at), b.ends_on, bu.month)
  union all
  -- DQ14 pohon anggaran (S10): rincian tanpa anggaran induk di label yang sama, atau jumlah rincian
  -- satu induk melewati anggaran induknya. Trigger private.tg_budget_tree menjaga saat tulis; cek ini
  -- menangkap baris yang lolos jalan lain (UPDATE massal/restore manual). Dihitung per (ruang, induk, label).
  select 'DQ14', 'error', count(*)::int from (
    select bu.space_id, c.parent_id, bu.month
    from app.budgets bu join app.categories c on c.id = bu.category_id
    where c.parent_id is not null
    group by bu.space_id, c.parent_id, bu.month
    having sum(bu.amount) > coalesce((select p.amount from app.budgets p
             where p.space_id = bu.space_id and p.category_id = c.parent_id and p.month = bu.month), 0)
  ) x
  union all
  -- DQ15 modal trading (S12, 0134): app.trading_capital = Σ ulang transfer hidup antara dompet
  -- trading dan dompet non-trading satu ruang (kueri independen membaca −main, view membaca
  -- counter), capital_left/realized tidak negatif dan capital_left - realized = setor - tarik; dompet
  -- trading wajib di Pribadi (B10, CHECK) dan wajib ada di view.
  select 'DQ15', 'error', count(*)::int from (
    select a.id
    from app.accounts a
    left join app.trading_capital tc on tc.account_id = a.id
    left join lateral (
      select coalesce(sum(-m.amount) filter (where c.account_id = a.id), 0) as cin,
             coalesce(sum(-m.amount) filter (where m.account_id = a.id), 0) as cout
      from app.entries e
      join app.entry_lines m on m.entry_id = e.id and m.role = 'main'
      join app.entry_lines c on c.entry_id = e.id and c.role = 'counter'
      join app.accounts ma on ma.id = m.account_id
      join app.accounts ca on ca.id = c.account_id
      where e.kind = 'transfer' and e.voided_at is null
        and a.id in (m.account_id, c.account_id)
        and (ma.pocket = 'trading') <> (ca.pocket = 'trading')
    ) s on true
    where a.pocket = 'trading'
      and (a.space_kind <> 'personal' or tc.account_id is null
           or tc.capital_in <> s.cin or tc.capital_out <> s.cout
           or tc.capital_left < 0 or tc.realized < 0
           or tc.capital_left - tc.realized <> s.cin - s.cout)
  ) x
$$;

select private.own_api_functions();
