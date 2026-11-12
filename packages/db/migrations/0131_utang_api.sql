-- migrate:up
-- S11 (IPD §6, plan S11 Task 4, K1 sampai K7, K10; bingkai docs/design/s11-bingkai.md): API utang/
-- piutang dan kontak, penutupan jalur generik untuk entri utang, DQ05, "aman dipakai" tanpa pinjaman.
-- Expand-only: satu kolom baru (default false) + CHECK di app.entries, fungsi baru, enam fungsi diganti
-- utuh (create or replace, tanda tangan dan kolom hasil sama): private.set_void_state, api.purge_entry,
-- api.trash_list, jobs.purge_voided, api.safe_to_spend, private.dq_run.
--
-- - app.entries.voided_with_debt: true hanya pada entri yang dibatalkan api.void_debt (CHECK: batal dan
--   kind utang). restore_debt memulihkan tepat entri ini (cicilan yang dibatalkan sendiri sebelumnya
--   tetap batal). Penanda kolom, bukan kesamaan voided_at: jam tes dipatok, dua pembatalan di jam yang
--   sama tidak bisa dibedakan dari waktunya.
-- - Urutan kunci seragam: utang (private.lock_debt, FOR NO KEY UPDATE: menyerialkan bayar/batal/hapus
--   per utang; FK entri baru tetap boleh FOR KEY SHARE) -> entri (urut id) -> akun (lock_accounts).
--   pay_debt, void_debt, restore_debt, dan set_void_state untuk cicilan mengikutinya. Kontak dikunci
--   sendiri (rename/archive FOR UPDATE; trigger debt_guard 0130 FOR SHARE saat utang dibuat/diubah).
--   Σ cicilan hidup dibaca dari app.debt_balances SESUDAH kunci utang (READ COMMITTED: snapshot baru per
--   pernyataan), jadi dua pembayaran paralel tidak bisa melewati pokok (C3). Diuji di 99_konkurensi.
-- - Kontak (K1, hanya Pribadi): api.create_contact (idempoten client_id), api.rename_contact dan
--   api.archive_contact (idempoten alami). Nama 1..60 sesudah btrim (DK400 invalid_argument/name); nama
--   aktif sama tanpa beda huruf = DK422 contact_name_taken (23505 contacts_name_unique dipetakan di
--   private.insert_contact/rename). Kontak terarsip tidak bisa diganti nama (contact_archived); arsip
--   tidak menyentuh utang.
-- - api.create_debt (idempoten client_id; hash tanpa p_allow_negative): mode baru = utang + entri pokok
--   (occurred_on = opened_on, satu line main di dompet Pribadi aktif bukan Kantor, borrowed +, lent -;
--   saldo_negatif bila lent membuat saldo negatif tanpa flag); mode berjalan = utang saja, tanpa dompet
--   (nol efek saldo/Laporan, K2). Kontak: p_contact_id ATAU p_contact_name (kontak baru dibuat di
--   transaksi yang sama, ikut idempoten). Ruang Bersama = DK422 debt_personal_only (B10).
-- - api.pay_debt (T7, K7): payment_exceeds (DK422, nol efek; termasuk utang lunas), payment_before_opened,
--   debt_deleted, debt_account_kantor, saldo_negatif, idempoten client_id. Hasil memuat angka dari SQL
--   (private.debt_numbers): principal, paid, remaining, paid_pct (persen terbayar dibulatkan ke bawah),
--   settled, quick {p25, p50, full} (25%/50% dari SISA, dibulatkan ke bawah ke rupiah penuh).
-- - api.update_debt_info (K4, T6): kontak, judul, catatan (ganti penuh); tanpa efek ledger.
-- - api.void_debt / api.restore_debt (K5, T9): void atomik pokok + semua cicilan hidup dan utang;
--   restore memulihkan entri voided_with_debt, jendela 90 hari (restore_window_closed), saldo_negatif
--   per dompet. Keduanya mengembalikan effects = efek per dompet (private.debt_effects, tanpa nol).
-- - Jalur generik (temuan review S2): private.set_void_state menolak pokok (debt_principal_locked: hanya
--   lewat Hapus utang), cicilan mengunci utang dulu, debt_deleted bila utang terhapus, pulihkan cicilan
--   yang membuat Σ melebihi pokok = payment_exceeds. api.purge_entry menolak entri voided_with_debt
--   (debt_deleted). api.trash_list tidak memuat entri voided_with_debt (pemulihan dari segmen Utang;
--   UI menautkan cicilan batal lewat app.entries.debt_id, signature trash_list tetap). update_entry dan
--   move_entry_to_space sudah menolak kind utang (kind_not_editable, kind_not_movable; diuji).
-- - jobs.purge_voided: entri voided_with_debt tidak dipurge selama utangnya terhapus <= 90 hari (sama
--   dengan jendela restore_debt); sesudah lintasan entri, utang terhapus > 90 hari tanpa entri tersisa
--   ikut dihapus (catatan/judul tidak tinggal selamanya). Kontak tidak pernah dihapus.
-- - Baca (INVOKER milik owner, assert_member di awal): api.list_contacts (kontak aktif + Σ sisa dan
--   jumlah utang aktif per arah), api.list_debts (utang hidup + terhapus <= 90 hari, angka per utang,
--   total sisa dan jumlah kontak per arah untuk utang hidup bersisa), api.debt_detail (jsonb: rincian,
--   quick, riwayat pembayaran termasuk yang dibatalkan, void_effects = efek bila dihapus sekarang).
-- - api.safe_to_spend (temuan T1 review independen): saldo operasional dikurangi Σ remaining utang
--   borrowed, mode baru, tidak terhapus, yang pokok hidupnya di dompet operasional. Pinjam tidak
--   menaikkan angka, bayar cicilan tidak menurunkannya, belanja uang pinjaman menurunkannya. lent dan
--   mode berjalan tidak diubah. Kolom hasil sama (kontrak web).
-- - private.dq_run: + DQ05 (error): utang dengan Σ |main| cicilan hidup > principal (sisa negatif).
-- - Kode galat baru: DK422 debt_personal_only, contact_name_taken, contact_archived (0130), debt_deleted,
--   payment_exceeds, payment_before_opened, debt_account_kantor, debt_principal_locked; DK404
--   debt_not_found, contact_not_found (0130). Pesan/detail tanpa nominal dan nama. Tanpa event audit
--   baru (pola S7/S9: mutasi ledger tercatat di entry_history).

-- ===== Penanda entri yang ikut Hapus utang =====
alter table app.entries add column voided_with_debt boolean not null default false;
alter table app.entries add constraint entries_voided_with_debt_check
  check (not voided_with_debt or (voided_at is not null and kind in ('debt_principal', 'debt_payment')));

-- ===== Helper (INVOKER milik owner, EXECUTE dompetku_api; berjalan di bawah RLS pemanggil) =====
-- Ruang utang: anggota (DK404) dan Pribadi (DK422 debt_personal_only, B10).
create function private.assert_debt_space(p_space_id uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if (select s.kind from app.spaces s where s.id = p_space_id) <> 'personal' then
    raise exception using errcode = 'DK422', message = 'debt_personal_only';
  end if;
end $$;

-- Kunci utang sesudah keanggotaan terbukti; kembalikan versi terbaru. Tidak terlihat = DK404.
create function private.lock_debt(p_debt_id uuid) returns app.debts
language plpgsql set search_path = '' as $$
declare v app.debts%rowtype;
begin
  select * into v from app.debts where id = p_debt_id;
  if v.id is null then
    raise exception using errcode = 'DK404', message = 'debt_not_found';
  end if;
  perform app.assert_member(v.space_id);
  select * into v from app.debts where id = p_debt_id for no key update;
  return v;
end $$;

create function private.lock_contact(p_contact_id uuid) returns app.contacts
language plpgsql set search_path = '' as $$
declare v app.contacts%rowtype;
begin
  select * into v from app.contacts where id = p_contact_id;
  if v.id is null then
    raise exception using errcode = 'DK404', message = 'contact_not_found';
  end if;
  perform app.assert_member(v.space_id);
  select * into v from app.contacts where id = p_contact_id for update;
  return v;
end $$;

create function private.insert_contact(p_space_id uuid, p_name text, p_uid uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  v      uuid;
  v_name text := nullif(btrim(p_name), '');
begin
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  insert into app.contacts (space_id, name, created_by, updated_by, created_at, updated_at)
  values (p_space_id, v_name, p_uid, p_uid, app.now(), app.now())
  returning id into v;
  return v;
exception when unique_violation then
  raise exception using errcode = 'DK422', message = 'contact_name_taken';
end $$;

-- Angka utang untuk UI (BSD §1.1: uang dihitung di SQL). paid_pct dibulatkan ke bawah (tidak pernah
-- 100 sebelum lunas); quick = 25%/50% dari sisa, dibulatkan ke bawah ke rupiah penuh.
create function private.debt_numbers(p_principal bigint, p_paid bigint) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'principal', p_principal, 'paid', p_paid, 'remaining', p_principal - p_paid,
    'paid_pct', (p_paid * 100 / p_principal)::int, 'settled', p_paid >= p_principal,
    'quick', jsonb_build_object('p25', (p_principal - p_paid) / 4, 'p50', (p_principal - p_paid) / 2,
                                'full', p_principal - p_paid))
$$;

-- Efek per dompet dari sekumpulan entri: p_sign = 1 (dipulihkan) atau -1 (dibatalkan). Tanpa baris nol.
create function private.debt_effects(p_entry_ids uuid[], p_sign int) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('account_id', x.account_id, 'account_name', a.name,
                                               'amount', x.amt) order by a.name, a.id), '[]'::jsonb)
  from (select l.account_id, (p_sign * sum(l.amount))::bigint as amt
          from app.entry_lines l where l.entry_id = any (p_entry_ids) group by l.account_id) x
  join app.accounts a on a.id = x.account_id
  where x.amt <> 0
$$;

-- ===== Kontak =====
create function api.create_contact(p_client_id uuid, p_space_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := nullif(btrim(p_name), '');
  v_id   uuid;
  v_r    jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_contact', private.req_hash(
           jsonb_build_object('space', p_space_id, 'name', v_name)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.assert_debt_space(p_space_id);
  v_id := private.insert_contact(p_space_id, v_name, v_uid);
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('contact_id', v_id, 'name', v_name));
end $$;

create function api.rename_contact(p_contact_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := nullif(btrim(p_name), '');
  v_c    app.contacts%rowtype;
begin
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  v_c := private.lock_contact(p_contact_id);
  if v_c.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'contact_archived';
  end if;
  begin
    update app.contacts set name = v_name, updated_by = v_uid, updated_at = app.now() where id = v_c.id;
  exception when unique_violation then
    raise exception using errcode = 'DK422', message = 'contact_name_taken';
  end;
  return jsonb_build_object('contact_id', v_c.id, 'name', v_name);
end $$;

create function api.archive_contact(p_contact_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_c   app.contacts%rowtype;
begin
  v_c := private.lock_contact(p_contact_id);
  if v_c.archived_at is null then
    update app.contacts set archived_at = app.now(), updated_by = v_uid, updated_at = app.now()
     where id = v_c.id;
  end if;
  return jsonb_build_object('contact_id', v_c.id, 'archived', true);
end $$;

-- ===== Utang baru (K2: mode baru/berjalan) =====
create function api.create_debt(
  p_client_id      uuid,
  p_space_id       uuid,
  p_direction      text,
  p_principal      bigint,
  p_mode           text,
  p_contact_id     uuid    default null,
  p_contact_name   text    default null,
  p_account_id     uuid    default null,
  p_opened_on      date    default null,
  p_title          text    default null,
  p_note           text    default null,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_title   text := nullif(btrim(p_title), '');
  v_note    text := private.clean_text(p_note, 'note');
  v_cname   text := nullif(btrim(p_contact_name), '');
  v_contact uuid := p_contact_id;
  v_on      date;
  v_acc     app.accounts%rowtype;
  v_debt    uuid;
  v_entry   uuid;
  v_amt     bigint;
  v_r       jsonb;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_opened_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'create_debt', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'direction', p_direction, 'principal', p_principal, 'mode', p_mode,
           'contact', p_contact_id, 'contact_name', v_cname, 'account', p_account_id,
           'on', p_opened_on, 'title', v_title, 'note', v_note)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.assert_debt_space(p_space_id);
  if p_direction is null or p_direction not in ('borrowed', 'lent') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'direction';
  end if;
  if p_mode is null or p_mode not in ('baru', 'berjalan') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'mode';
  end if;
  perform private.check_amount(p_principal, 'principal');
  v_on := private.check_date(p_opened_on);
  if length(v_title) > 80 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'title';
  end if;
  if (v_contact is null) = (v_cname is null) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'contact';
  end if;
  if (p_mode = 'baru') <> (p_account_id is not null) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  if v_cname is not null then
    v_contact := private.insert_contact(p_space_id, v_cname, v_uid);
  end if;
  if p_mode = 'baru' then
    perform private.lock_accounts(array[p_account_id]);
    v_acc := private.get_account(p_account_id, 'account_id');
    if v_acc.space_id <> p_space_id then
      raise exception using errcode = 'DK422', message = 'space_mismatch';
    end if;
    if v_acc.archived_at is not null then
      raise exception using errcode = 'DK422', message = 'account_archived';
    end if;
    if v_acc.pocket = 'kantor' then
      raise exception using errcode = 'DK422', message = 'debt_account_kantor';
    end if;
    if v_on < v_acc.opened_on then
      raise exception using errcode = 'DK422', message = 'before_opening';
    end if;
  end if;

  -- Kontak aktif ruang yang sama dijaga trigger debt_guard (0130): contact_not_found/contact_archived.
  insert into app.debts (space_id, contact_id, direction, title, principal, mode, opened_on, note,
                         created_by, created_at, updated_by, updated_at)
  values (p_space_id, v_contact, p_direction, v_title, p_principal, p_mode, v_on, v_note,
          v_uid, app.now(), v_uid, app.now())
  returning id into v_debt;

  if p_mode = 'baru' then
    v_amt := case p_direction when 'borrowed' then p_principal else -p_principal end;
    insert into app.entries (space_id, space_kind, kind, occurred_on, debt_id, created_by, updated_by)
    values (p_space_id, 'personal', 'debt_principal', v_on, v_debt, v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, p_space_id, 'main', v_acc.id, v_amt);
    perform private.write_history(v_entry, 'create', v_uid);
    perform private.assert_balance(v_acc.id, v_amt, p_allow_negative);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'debt_id', v_debt, 'contact_id', v_contact, 'entry_id', v_entry, 'version', 1,
    'warnings', '[]'::jsonb) || private.debt_numbers(p_principal, 0));
end $$;

-- ===== Ubah info utang (K4: tanpa efek ledger) =====
create function api.update_debt_info(p_debt_id uuid, p_contact_id uuid, p_title text, p_note text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_title text := nullif(btrim(p_title), '');
  v_note  text := private.clean_text(p_note, 'note');
  v_d     app.debts%rowtype;
begin
  if p_contact_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'contact';
  end if;
  if length(v_title) > 80 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'title';
  end if;
  v_d := private.lock_debt(p_debt_id);
  if v_d.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'debt_deleted';
  end if;
  update app.debts
     set contact_id = p_contact_id, title = v_title, note = v_note,
         updated_by = v_uid, updated_at = app.now()
   where id = v_d.id;
  return jsonb_build_object('debt_id', v_d.id);
end $$;

-- ===== Bayar / terima cicilan (T7, K7) =====
create function api.pay_debt(
  p_client_id      uuid,
  p_debt_id        uuid,
  p_account_id     uuid,
  p_amount         bigint,
  p_occurred_on    date    default null,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_on    date;
  v_d     app.debts%rowtype;
  v_acc   app.accounts%rowtype;
  v_paid  bigint;
  v_rem   bigint;
  v_amt   bigint;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'pay_debt', private.req_hash(jsonb_build_object(
           'debt', p_debt_id, 'account', p_account_id, 'amount', p_amount, 'on', p_occurred_on)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;
  -- Utang dulu (serial per utang), lalu akun: lihat urutan kunci di kepala berkas.
  v_d := private.lock_debt(p_debt_id);
  if v_d.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'debt_deleted';
  end if;
  if v_on < v_d.opened_on then
    raise exception using errcode = 'DK422', message = 'payment_before_opened';
  end if;
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> v_d.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if v_acc.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_acc.pocket = 'kantor' then
    raise exception using errcode = 'DK422', message = 'debt_account_kantor';
  end if;
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  select b.paid, b.remaining into v_paid, v_rem
    from app.debt_balances b where b.space_id = v_d.space_id and b.debt_id = v_d.id;
  if p_amount > v_rem then
    raise exception using errcode = 'DK422', message = 'payment_exceeds';
  end if;

  v_amt := case v_d.direction when 'borrowed' then -p_amount else p_amount end;
  insert into app.entries (space_id, space_kind, kind, occurred_on, debt_id, created_by, updated_by)
  values (v_d.space_id, 'personal', 'debt_payment', v_on, v_d.id, v_uid, v_uid)
  returning id into v_entry;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_entry, v_d.space_id, 'main', v_acc.id, v_amt);
  perform private.write_history(v_entry, 'create', v_uid);
  perform private.assert_balance(v_acc.id, v_amt, p_allow_negative);

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'debt_id', v_d.id, 'version', 1, 'warnings', '[]'::jsonb)
    || private.debt_numbers(v_d.principal, v_paid + p_amount));
end $$;

-- ===== Hapus utang (K5, T9): void atomik pokok + cicilan hidup =====
create function api.void_debt(p_client_id uuid, p_debt_id uuid, p_allow_negative boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_d    app.debts%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'void_debt', private.req_hash(
           jsonb_build_object('debt', p_debt_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_d := private.lock_debt(p_debt_id);
  if v_d.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'already_voided';
  end if;
  -- Cicilan baru/batal/pulihkan paralel mengunci utang lebih dulu, jadi daftar ini stabil.
  select coalesce(array_agg(e.id order by e.id), '{}') into v_ids from app.entries e
   where e.space_id = v_d.space_id and e.debt_id = v_d.id and e.voided_at is null;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select coalesce(array_agg(distinct account_id order by account_id), '{}') into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  update app.entries
     set voided_at = app.now(), voided_by = v_uid, voided_with_debt = true,
         version = version + 1, updated_by = v_uid, updated_at = app.now()
   where id = any (v_ids);
  perform private.write_history(id, 'void', v_uid) from unnest(v_ids) as id;
  update app.debts
     set voided_at = app.now(), voided_by = v_uid, updated_by = v_uid, updated_at = app.now()
   where id = v_d.id;
  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id order by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id, -v_acc.amt, p_allow_negative);
  end loop;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'debt_id', v_d.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, -1),
    'warnings', '[]'::jsonb));
end $$;

create function api.restore_debt(p_client_id uuid, p_debt_id uuid, p_allow_negative boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_d    app.debts%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_paid bigint;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'restore_debt', private.req_hash(
           jsonb_build_object('debt', p_debt_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_d := private.lock_debt(p_debt_id);
  if v_d.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if v_d.voided_at < app.now() - interval '90 days' then
    raise exception using errcode = 'DK422', message = 'restore_window_closed';
  end if;
  select coalesce(array_agg(e.id order by e.id), '{}') into v_ids from app.entries e
   where e.space_id = v_d.space_id and e.debt_id = v_d.id and e.voided_with_debt;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select coalesce(array_agg(distinct account_id order by account_id), '{}') into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  update app.entries
     set voided_at = null, voided_by = null, voided_with_debt = false,
         version = version + 1, updated_by = v_uid, updated_at = app.now()
   where id = any (v_ids);
  perform private.write_history(id, 'restore', v_uid) from unnest(v_ids) as id;
  update app.debts
     set voided_at = null, voided_by = null, updated_by = v_uid, updated_at = app.now()
   where id = v_d.id;
  -- Pertahanan berlapis: selama utang terhapus tidak ada cicilan yang bisa ditambah atau dipulihkan.
  select b.paid into v_paid from app.debt_balances b where b.space_id = v_d.space_id and b.debt_id = v_d.id;
  if v_paid > v_d.principal then
    raise exception using errcode = 'DK422', message = 'payment_exceeds';
  end if;
  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id order by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id, v_acc.amt, p_allow_negative);
  end loop;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'debt_id', v_d.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, 1),
    'warnings', '[]'::jsonb) || private.debt_numbers(v_d.principal, v_paid));
end $$;

-- ===== Baca (SECURITY INVOKER: RLS tetap berlaku) =====
-- Kontak aktif urut nama, dengan Σ sisa dan jumlah utang aktif (hidup, sisa > 0) per arah.
create function api.list_contacts(p_space_id uuid)
returns table (contact_id uuid, name text, borrowed_remaining bigint, lent_remaining bigint,
               borrowed_count int, lent_count int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select c.id, c.name,
         coalesce(sum(x.remaining) filter (where x.direction = 'borrowed'), 0)::bigint,
         coalesce(sum(x.remaining) filter (where x.direction = 'lent'), 0)::bigint,
         (count(x.debt_id) filter (where x.direction = 'borrowed'))::int,
         (count(x.debt_id) filter (where x.direction = 'lent'))::int
  from app.contacts c
  left join (
    select d.contact_id, d.id as debt_id, d.direction, b.remaining
    from app.debts d join app.debt_balances b on b.space_id = d.space_id and b.debt_id = d.id
    where d.space_id = p_space_id and d.voided_at is null and b.remaining > 0
  ) x on x.contact_id = c.id
  where c.space_id = p_space_id and c.archived_at is null
  group by c.id, c.name
  order by lower(c.name), c.id;
end $$;

-- Utang hidup dan terhapus <= 90 hari (angka utang terhapus = sesudah dipulihkan). account_id = dompet entri pokok (mode baru). direction_remaining /
-- direction_contacts = total sisa dan jumlah kontak utang hidup bersisa searah (kartu Sisa).
-- Urut: hidup bersisa, lunas, terhapus; borrowed sebelum lent; sisa terbesar; nama kontak.
create function api.list_debts(p_space_id uuid)
returns table (debt_id uuid, contact_id uuid, contact_name text, direction text, mode text, title text,
               principal bigint, paid bigint, remaining bigint, paid_pct int, quick_25 bigint,
               quick_50 bigint, opened_on date, account_id uuid, voided_at timestamptz,
               direction_remaining bigint, direction_contacts int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  with x as (
    select d.id, d.contact_id, c.name, d.direction, d.mode, d.title, d.principal,
           coalesce(w.paid, b.paid) as paid, d.principal - coalesce(w.paid, b.paid) as remaining,
           d.opened_on, d.voided_at,
           (select l.account_id from app.entries e
              join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
             where e.space_id = d.space_id and e.debt_id = d.id and e.kind = 'debt_principal'
             order by e.voided_at is not null, e.created_at desc limit 1) as account_id
    from app.debts d
    join app.contacts c on c.space_id = d.space_id and c.id = d.contact_id
    join app.debt_balances b on b.space_id = d.space_id and b.debt_id = d.id
    -- Utang terhapus: angka sesudah dipulihkan (cicilan yang ikut terhapus), bukan sisa = pokok.
    left join lateral (
      select coalesce(sum(abs(l.amount)), 0)::bigint as paid from app.entries e
      join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
      where e.space_id = d.space_id and e.debt_id = d.id and e.kind = 'debt_payment' and e.voided_with_debt
    ) w on d.voided_at is not null
    where d.space_id = p_space_id
      and (d.voided_at is null or d.voided_at >= app.now() - interval '90 days')
  ), t as (
    select x.direction, sum(x.remaining)::bigint as total, count(distinct x.contact_id)::int as n
    from x where x.voided_at is null and x.remaining > 0 group by x.direction
  )
  select x.id, x.contact_id, x.name, x.direction, x.mode, x.title, x.principal, x.paid, x.remaining,
         (x.paid * 100 / x.principal)::int, x.remaining / 4, x.remaining / 2, x.opened_on, x.account_id,
         x.voided_at, coalesce(t.total, 0)::bigint, coalesce(t.n, 0)
  from x left join t on t.direction = x.direction
  order by x.voided_at is not null, x.remaining = 0, x.direction, x.remaining desc, lower(x.name), x.id;
end $$;

-- Satu utang (termasuk yang terhapus; UI memutuskan 404). payments = semua cicilan, terbaru dulu,
-- amount positif, voided/voided_with_debt sebagai penanda. void_effects = efek per dompet bila utang
-- dihapus sekarang (entri hidup), tanpa nol.
create function api.debt_detail(p_debt_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_d app.debts%rowtype;
  v   jsonb;
begin
  select * into v_d from app.debts where id = p_debt_id;
  if v_d.id is null then
    raise exception using errcode = 'DK404', message = 'debt_not_found';
  end if;
  perform app.assert_member(v_d.space_id);
  -- Angka sama dengan private.debt_numbers/debt_effects (helper itu di skema private, tanpa USAGE web).
  select jsonb_build_object(
    'debt_id', v_d.id, 'contact_id', v_d.contact_id, 'contact_name', c.name,
    'contact_archived', c.archived_at is not null, 'direction', v_d.direction, 'mode', v_d.mode,
    'title', v_d.title, 'note', v_d.note, 'opened_on', v_d.opened_on, 'created_at', v_d.created_at,
    'voided_at', v_d.voided_at,
    'principal', v_d.principal, 'paid', b.paid, 'remaining', b.remaining,
    'paid_pct', (b.paid * 100 / v_d.principal)::int, 'settled', b.remaining <= 0,
    'quick', jsonb_build_object('p25', b.remaining / 4, 'p50', b.remaining / 2, 'full', b.remaining),
    'principal_entry_id', pe.id, 'account_id', pe.account_id, 'account_name', pe.account_name,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entry_id', e.id, 'version', e.version, 'occurred_on', e.occurred_on,
               'account_id', l.account_id, 'account_name', a.name, 'amount', abs(l.amount),
               'voided', e.voided_at is not null, 'voided_at', e.voided_at,
               'voided_with_debt', e.voided_with_debt, 'created_at', e.created_at)
             order by e.occurred_on desc, e.created_at desc, e.id desc)
      from app.entries e
      join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
      join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
      where e.space_id = v_d.space_id and e.debt_id = v_d.id and e.kind = 'debt_payment'), '[]'::jsonb),
    'void_effects', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', x.account_id, 'account_name', a.name,
                                          'amount', x.amt) order by a.name, a.id)
      from (select l.account_id, (-sum(l.amount))::bigint as amt
              from app.entries e
              join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id
             where e.space_id = v_d.space_id and e.debt_id = v_d.id and e.voided_at is null
             group by l.account_id) x
      join app.accounts a on a.space_id = v_d.space_id and a.id = x.account_id
      where x.amt <> 0), '[]'::jsonb))
  into v
  from app.contacts c
  join app.debt_balances b on b.space_id = v_d.space_id and b.debt_id = v_d.id
  left join lateral (
    select e.id, l.account_id, a.name as account_name from app.entries e
    join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
    join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
    where e.space_id = v_d.space_id and e.debt_id = v_d.id and e.kind = 'debt_principal'
    order by e.voided_at is not null, e.created_at desc limit 1
  ) pe on true
  where c.space_id = v_d.space_id and c.id = v_d.contact_id;
  return v;
end $$;

-- ===== Batalkan / pulihkan (0111 + jalur utang) =====
create or replace function private.set_void_state(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_void boolean, p_allow_negative boolean
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_op   text := case when p_void then 'void_entry' else 'restore_entry' end;
  v_e    app.entries%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_t    app.entries%rowtype;
  v_d    app.debts%rowtype;
  v_r    jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, v_op, private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version)));
  if v_r is not null then
    return v_r;
  end if;

  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  -- 0131: pokok utang hanya lewat api.void_debt/restore_debt (K5). Cicilan mengunci utangnya sebelum
  -- entri (urutan utang -> entri -> akun, sama dengan pay_debt/void_debt); utang terhapus = debt_deleted.
  if v_e.kind = 'debt_principal' then
    raise exception using errcode = 'DK422', message = 'debt_principal_locked';
  end if;
  if v_e.kind = 'debt_payment' then
    v_d := private.lock_debt(v_e.debt_id);
    if v_d.voided_at is not null then
      raise exception using errcode = 'DK422', message = 'debt_deleted';
    end if;
  end if;
  if v_e.kind = 'space_transfer' then
    -- Edit/void hanya oleh pencatat; selain pencatat mendapat DK404 (spec §9.1, security A1).
    if v_e.created_by <> v_uid then
      raise exception using errcode = 'DK404', message = 'entry_not_found';
    end if;
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if (v_e.voided_at is not null) = p_void then
    raise exception using errcode = 'DK422',
      message = case when p_void then 'already_voided' else 'not_voided' end;
  end if;
  -- 0111: entri yang sudah dipindah ke ruang lain tidak bisa dipulihkan (dibaca sesudah kunci).
  if not p_void and v_e.moved_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_moved';
  end if;
  if p_void and v_e.kind = 'opening_balance' then
    raise exception using errcode = 'DK422', message = 'opening_locked';
  end if;
  if p_void and exists (select 1 from app.entries r
                         where r.reimburses_entry_id = any (v_ids) and r.voided_at is null) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  if not p_void and v_e.voided_at < app.now() - interval '90 days' then
    raise exception using errcode = 'DK422', message = 'restore_window_closed';
  end if;
  -- 0110: reimburse yang dipulihkan harus tetap sah: talangan hidup dan reimbursable, Σ reimburse
  -- hidup (termasuk yang ini) tidak melebihi nominal. Kunci reimburse (di atas) lalu talangan.
  if not p_void and v_e.kind = 'reimbursement' then
    select * into v_t from app.entries where id = v_e.reimburses_entry_id for update;
    if v_t.id is null or v_t.kind <> 'expense' or not v_t.reimbursable or v_t.voided_at is not null then
      raise exception using errcode = 'DK422', message = 'not_reimbursable';
    end if;
    if (select coalesce(sum(l.amount), 0)
          from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
         where r.space_id = v_t.space_id and r.reimburses_entry_id = v_t.id
           and (r.voided_at is null or r.id = v_e.id))
       > (select -l.amount from app.entry_lines l where l.entry_id = v_t.id and l.role = 'main') then
      raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
    end if;
  end if;
  -- 0131: cicilan yang dipulihkan tidak boleh membuat Σ cicilan hidup melebihi pokok (di bawah kunci utang).
  if not p_void and v_e.kind = 'debt_payment'
     and (select b.remaining from app.debt_balances b where b.space_id = v_e.space_id and b.debt_id = v_e.debt_id)
         < (select abs(l.amount) from app.entry_lines l where l.entry_id = v_e.id and l.role = 'main') then
    raise exception using errcode = 'DK422', message = 'payment_exceeds';
  end if;

  select array_agg(distinct account_id order by account_id) into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  update app.entries
     set voided_at  = case when p_void then app.now() end,
         voided_by  = case when p_void then v_uid end,
         version    = version + 1,
         updated_by = v_uid,
         updated_at = app.now()
   where id = any (v_ids);
  perform private.write_history(id, case when p_void then 'void' else 'restore' end::app.history_op, v_uid)
     from unnest(v_ids) as id;

  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id,
            case when p_void then -v_acc.amt else v_acc.amt end, p_allow_negative);
  end loop;

  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'affected', to_jsonb(v_ids),
    'warnings', '[]'::jsonb));
end $$;

-- ===== Sampah: hapus permanen (0103 + entri yang ikut Hapus utang ditolak) =====
create or replace function api.purge_entry(p_entry_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_e   app.entries%rowtype;
  v_ids uuid[];
  v_n   int;
begin
  set constraints all deferred;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null or (v_e.kind = 'space_transfer' and v_e.created_by <> v_uid) then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if exists (select 1 from app.entries r where r.reimburses_entry_id = any (v_ids)) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  -- 0131: entri yang ikut Hapus utang hanya hilang bersama utangnya (restore_debt butuh entri itu).
  if v_e.voided_with_debt then
    raise exception using errcode = 'DK422', message = 'debt_deleted';
  end if;
  v_n := private.purge_entries(v_ids, 'entry_purged');
  set constraints all immediate;
  return jsonb_build_object('affected', to_jsonb(v_ids), 'purged', v_n);
end $$;

-- ===== Sampah (0111 + tanpa entri yang ikut Hapus utang) =====
-- Sampah (keputusan pemilik #10): entri batal yang masih bisa dipulihkan (<= 90 hari).
-- Pulihkan = api.restore_entry; hapus permanen = api.purge_entry. Entri yang ikut Hapus utang
-- dipulihkan dari segmen Utang (api.restore_debt), jadi tidak tampil di sini.
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
    and not e.voided_with_debt
  order by e.voided_at desc, e.id desc
  limit p_limit;
end $$;

-- ===== Purge 90 hari (0113 + utang) =====
-- Entri voided_with_debt menunggu jendela pulihkan utangnya (voided_at keduanya sama, jadi syarat ini
-- pertahanan berlapis). Sesudah lintasan entri, utang terhapus > 90 hari yang tidak lagi dirujuk entri
-- dihapus; kontak tetap. DELETE memeriksa ulang voided_at sesudah menunggu kunci restore_debt paralel.
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

-- ===== Aman dipakai (0120 + pinjaman tidak menaikkan angka) =====
-- Saldo operasional dikurangi Σ sisa utang borrowed mode baru hidup yang pokok hidupnya di dompet
-- operasional (dompet terarsip ikut: uangnya sudah pindah ke dompet lain, utangnya tetap). lent dan
-- mode berjalan tidak diubah.
create or replace function api.safe_to_spend(p_space_id uuid, p_today date default null)
returns table (operasional bigint, bills_until_eom bigint, budget_wajib_remaining bigint,
               total bigint, per_day bigint, days_left int, until date)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
  v_label date;
  v_until date;
  v_ops   bigint;
  v_debt  bigint;
  v_bills bigint;
  v_wajib bigint;
  v_days  int;
begin
  perform app.assert_member(p_space_id);
  select p.ends_on, p.label_month into v_until, v_label from app.pay_period(p_space_id, v_today) p;
  select coalesce(sum(ab.balance), 0)::bigint into v_ops
    from app.account_balances ab
    join app.accounts a on a.id = ab.account_id
   where ab.space_id = p_space_id and ab.pocket = 'operasional' and a.archived_at is null;
  select coalesce(sum(b.remaining), 0)::bigint into v_debt
    from app.debts d
    join app.debt_balances b on b.space_id = d.space_id and b.debt_id = d.id
   where d.space_id = p_space_id and d.direction = 'borrowed' and d.mode = 'baru' and d.voided_at is null
     and exists (select 1 from app.entries e
                 join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
                 join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
                 where e.space_id = d.space_id and e.debt_id = d.id and e.kind = 'debt_principal'
                   and e.voided_at is null and a.pocket = 'operasional');
  v_ops := v_ops - greatest(0, v_debt);
  select coalesce(sum(bs.amount), 0)::bigint into v_bills
    from app.bill_schedule bs
   where bs.space_id = p_space_id and not bs.posted and bs.skipped_at is null
     and not bs.bill_archived and bs.due_on <= v_until;
  select coalesce(sum(greatest(0, bp.remaining)), 0)::bigint into v_wajib
    from api.budget_progress(p_space_id, v_label) bp
   where bp.wajib;
  v_days := v_until - v_today + 1;
  return query select v_ops, v_bills, v_wajib, v_ops - v_bills - v_wajib,
    case when v_days > 0 then floor((v_ops - v_bills - v_wajib)::numeric / v_days)::bigint
         else v_ops - v_bills - v_wajib end,
    v_days, v_until;
end $$;

-- ===== Cek kualitas data (0130 + DQ05) =====
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
$$;

-- ===== Hak =====
grant execute on function private.assert_debt_space(uuid), private.lock_debt(uuid),
  private.lock_contact(uuid), private.insert_contact(uuid, text, uuid),
  private.debt_numbers(bigint, bigint), private.debt_effects(uuid[], int) to dompetku_api;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function api.debt_detail(uuid);
drop function api.list_debts(uuid);
drop function api.list_contacts(uuid);
drop function api.restore_debt(uuid, uuid, boolean);
drop function api.void_debt(uuid, uuid, boolean);
drop function api.pay_debt(uuid, uuid, uuid, bigint, date, boolean);
drop function api.update_debt_info(uuid, uuid, text, text);
drop function api.create_debt(uuid, uuid, text, bigint, text, uuid, text, uuid, date, text, text, boolean);
drop function api.archive_contact(uuid);
drop function api.rename_contact(uuid, text);
drop function api.create_contact(uuid, uuid, text);
drop function private.debt_effects(uuid[], int);
drop function private.debt_numbers(bigint, bigint);
drop function private.insert_contact(uuid, text, uuid);
drop function private.lock_contact(uuid);
drop function private.lock_debt(uuid);
drop function private.assert_debt_space(uuid);

-- Fungsi yang diganti kembali ke badan sebelumnya (0111, 0103, 0113, 0120, 0130).
create or replace function private.set_void_state(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_void boolean, p_allow_negative boolean
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_op   text := case when p_void then 'void_entry' else 'restore_entry' end;
  v_e    app.entries%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_t    app.entries%rowtype;
  v_r    jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, v_op, private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version)));
  if v_r is not null then
    return v_r;
  end if;

  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    -- Edit/void hanya oleh pencatat; selain pencatat mendapat DK404 (spec §9.1, security A1).
    if v_e.created_by <> v_uid then
      raise exception using errcode = 'DK404', message = 'entry_not_found';
    end if;
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if (v_e.voided_at is not null) = p_void then
    raise exception using errcode = 'DK422',
      message = case when p_void then 'already_voided' else 'not_voided' end;
  end if;
  -- 0111: entri yang sudah dipindah ke ruang lain tidak bisa dipulihkan (dibaca sesudah kunci).
  if not p_void and v_e.moved_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_moved';
  end if;
  if p_void and v_e.kind = 'opening_balance' then
    raise exception using errcode = 'DK422', message = 'opening_locked';
  end if;
  if p_void and exists (select 1 from app.entries r
                         where r.reimburses_entry_id = any (v_ids) and r.voided_at is null) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  if not p_void and v_e.voided_at < app.now() - interval '90 days' then
    raise exception using errcode = 'DK422', message = 'restore_window_closed';
  end if;
  -- 0110: reimburse yang dipulihkan harus tetap sah: talangan hidup dan reimbursable, Σ reimburse
  -- hidup (termasuk yang ini) tidak melebihi nominal. Kunci reimburse (di atas) lalu talangan.
  if not p_void and v_e.kind = 'reimbursement' then
    select * into v_t from app.entries where id = v_e.reimburses_entry_id for update;
    if v_t.id is null or v_t.kind <> 'expense' or not v_t.reimbursable or v_t.voided_at is not null then
      raise exception using errcode = 'DK422', message = 'not_reimbursable';
    end if;
    if (select coalesce(sum(l.amount), 0)
          from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
         where r.space_id = v_t.space_id and r.reimburses_entry_id = v_t.id
           and (r.voided_at is null or r.id = v_e.id))
       > (select -l.amount from app.entry_lines l where l.entry_id = v_t.id and l.role = 'main') then
      raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
    end if;
  end if;

  select array_agg(distinct account_id order by account_id) into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  update app.entries
     set voided_at  = case when p_void then app.now() end,
         voided_by  = case when p_void then v_uid end,
         version    = version + 1,
         updated_by = v_uid,
         updated_at = app.now()
   where id = any (v_ids);
  perform private.write_history(id, case when p_void then 'void' else 'restore' end::app.history_op, v_uid)
     from unnest(v_ids) as id;

  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id,
            case when p_void then -v_acc.amt else v_acc.amt end, p_allow_negative);
  end loop;

  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'affected', to_jsonb(v_ids),
    'warnings', '[]'::jsonb));
end $$;

create or replace function api.purge_entry(p_entry_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_e   app.entries%rowtype;
  v_ids uuid[];
  v_n   int;
begin
  set constraints all deferred;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null or (v_e.kind = 'space_transfer' and v_e.created_by <> v_uid) then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if exists (select 1 from app.entries r where r.reimburses_entry_id = any (v_ids)) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  v_n := private.purge_entries(v_ids, 'entry_purged');
  set constraints all immediate;
  return jsonb_build_object('affected', to_jsonb(v_ids), 'purged', v_n);
end $$;

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
      order by e.id
      for update of e
    ) x;
    exit when cardinality(v_ids) = 0;
    v_n := v_n + private.purge_entries(v_ids, 'purge_voided');
  end loop;
  return v_n;
end $$;

create or replace function api.safe_to_spend(p_space_id uuid, p_today date default null)
returns table (operasional bigint, bills_until_eom bigint, budget_wajib_remaining bigint,
               total bigint, per_day bigint, days_left int, until date)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
  v_label date;
  v_until date;
  v_ops   bigint;
  v_bills bigint;
  v_wajib bigint;
  v_days  int;
begin
  perform app.assert_member(p_space_id);
  select p.ends_on, p.label_month into v_until, v_label from app.pay_period(p_space_id, v_today) p;
  select coalesce(sum(ab.balance), 0)::bigint into v_ops
    from app.account_balances ab
    join app.accounts a on a.id = ab.account_id
   where ab.space_id = p_space_id and ab.pocket = 'operasional' and a.archived_at is null;
  select coalesce(sum(bs.amount), 0)::bigint into v_bills
    from app.bill_schedule bs
   where bs.space_id = p_space_id and not bs.posted and bs.skipped_at is null
     and not bs.bill_archived and bs.due_on <= v_until;
  select coalesce(sum(greatest(0, bp.remaining)), 0)::bigint into v_wajib
    from api.budget_progress(p_space_id, v_label) bp
   where bp.wajib;
  v_days := v_until - v_today + 1;
  return query select v_ops, v_bills, v_wajib, v_ops - v_bills - v_wajib,
    case when v_days > 0 then floor((v_ops - v_bills - v_wajib)::numeric / v_days)::bigint
         else v_ops - v_bills - v_wajib end,
    v_days, v_until;
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
$$;

alter table app.entries drop constraint entries_voided_with_debt_check;
alter table app.entries drop column voided_with_debt;
