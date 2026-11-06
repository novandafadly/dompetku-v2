-- migrate:up
-- S9 (IPD §5, plan S9 Task 5, K3, K4, K12): API tagihan rutin dasar dan materialisasi kemunculan.
-- Expand-only: fungsi baru, satu hak tabel baru (DELETE bill_occurrences untuk dompetku_api), dan
-- private.tg_obligation_xor diganti utuh (create or replace, tanda tangan sama).
--
-- - private.bill_first_on(starts_on, created_at): kemunculan pertama yang mungkin = greatest(starts_on,
--   awal bulan created_at WIB) (BSD §2.2 #6, §10: bulan sebelum bulan tagihan dibuat dilewati). SATU
--   sumber untuk materialisasi dan aturan satu kewajiban.
-- - private.tg_obligation_xor (0117) kini memakai bill_first_on, bukan starts_on mentah: tagihan baru
--   dengan starts_on lampau tidak lagi bentrok dengan anggaran wajib label periode yang tidak pernah
--   punya kemunculan (review Task 4). Invarian tetap: kemunculan hanya dibuat >= bill_first_on, jadi
--   setiap kemunculan yang mungkin tetap diperiksa XOR. created_at tidak pernah diubah fungsi api
--   (api.create_bill mengisinya dengan app.now()).
-- - private.materialize_bill(p_bill_id, p_through, p_from) (DEFINER milik owner, BYPASSRLS; EXECUTE
--   hanya dompetku_api): badan jobs.materialize_bills BSD §10 untuk satu tagihan aktif. Tanggal 29..31
--   jatuh ke hari terakhir bulan pendek; batas bawaan = akhir periode gajian BERIKUTNYA dari
--   app.today() untuk ruang tagihan (app.pay_period, K1/K3); bulan yang sudah punya kemunculan
--   (dibayar, dilewati, lampau, atau tanggal lama) dilewati agar ubah tanggal tidak menggandakan
--   kewajiban bulan itu; on conflict do nothing menyerap materialisasi paralel. Mengunci baris tagihan
--   FOR SHARE dulu: menunggu update_bill/archive_bill yang belum commit lalu membaca versi barunya.
-- - jobs.materialize_bills(p_through): semua tagihan aktif urut id (EXECUTE hanya dompetku_worker).
-- - private.check_bill: validasi bersama create_bill/update_bill (INVOKER, berjalan sebagai
--   dompetku_api di bawah RLS): nama 1..60, nominal (check_amount), tanggal 1..31, starts_on wajib,
--   ends_on >= starts_on, kategori pengeluaran di ruang yang sama (DK404 category_not_found) dan aktif
--   (DK422 category_archived), dompet (opsional) di ruang yang sama (DK404 account_not_found), aktif
--   (DK422 account_archived), bukan Kas Kantor (DK422 bill_account_kantor: bayar dari kantor berkelas
--   x_kantor, tidak pernah terbaca lunas di Laporan; keputusan agen plan Task 5).
-- - Fungsi tulis (DEFINER milik dompetku_api): ruang dibuktikan (app.assert_member) SEBELUM INSERT,
--   UPDATE, atau kunci baris, sehingga ruang orang lain = DK404, tidak pernah obligation_double atau
--   42501 dari trigger/RLS (review Task 4). Urutan kunci seragam: tagihan (FOR UPDATE untuk ubah/arsip,
--   FOR SHARE untuk bayar/lewati) lalu kemunculan, lalu (bayar) akun lewat api.create_entry, lalu
--   (ubah) kunci kewajiban ruang + kategori FOR SHARE di trigger XOR. Kategori tidak pernah dikunci
--   FOR UPDATE di sini. update_category/archive_category hanya mengunci kategori (dan membaca tagihan
--   tanpa kunci di tg_category_depth), jadi tidak ada siklus tunggu dengan fungsi tagihan.
--   * api.create_bill (BSD §9 + check_bill + created_at/updated_at = app.now() + materialisasi).
--   * api.update_bill (di luar BSD; idempoten alami, ganti penuh): kemunculan terbuka (belum
--     dibayar, belum dilewati, entry_id kosong, jatuh tempo >= hari ini) DIHAPUS lalu dimaterialisasi
--     ulang mulai awal bulan berjalan; yang lampau, dibayar, dilewati, atau tertaut entri batal tidak
--     disentuh (entri batal yang dipulihkan menutupnya lagi). Hapus + ulang dipilih atas UPDATE di
--     tempat karena ends_on yang dimajukan harus menghapus kemunculan sesudahnya; butuh grant DELETE
--     bill_occurrences ke dompetku_api (dipagari policy member_write, hanya dipakai fungsi ini). Id
--     kemunculan terbuka berganti sesudah ubah (UI memuat ulang).
--   * api.archive_bill (BSD §9 + assert_member, updated_at).
--   * api.post_bill_occurrence (BSD §9 + p_amount default null (K12, ikut hash; nominal aktual,
--     kemunculan tetap menyimpan perkiraan), urutan cek M5 S7, bill_archived, dompet ruang sama dan
--     bukan kantor). Hash tanpa p_allow_negative (BSD §9.1). Bayar di muka (due_on di masa depan,
--     tanggal entri <= hari ini) boleh (BSD §15 #2). Entri yang sudah tertaut tidak dikunci: void
--     paralel yang belum commit membuat bayar = already_posted (aman, tidak dobel; ulangi sesudahnya).
--   * api.skip_bill_occurrence / api.unskip_bill_occurrence (K4, idempoten alami): dibayar =
--     already_posted, tagihan terarsip = bill_archived. Lewati kemunculan yang entrinya batal
--     melepas tautan itu (CHECK entry_id XOR skipped_at).
-- - Baca (INVOKER milik owner, EXECUTE web, assert_member di awal): api.bill_list, api.bills_due.
--   bills_due.amount = nominal entri untuk yang lunas (nominal aktual, K12), selain itu nominal
--   kemunculan.
-- - Kode galat baru (DK422): bill_account_kantor, bill_archived, already_posted; DK404 bill_not_found.
--   Pesan dan detail tanpa nominal.

-- ===== Kemunculan pertama yang mungkin (BSD §2.2 #6, §10) =====
create function private.bill_first_on(p_starts_on date, p_created_at timestamptz) returns date
language sql immutable set search_path = '' as $$
  select greatest(p_starts_on, d - (extract(day from d)::int - 1))
  from (select (p_created_at at time zone 'Asia/Jakarta')::date as d) x
$$;

-- ===== Satu kewajiban (0117) dengan kemunculan pertama = bill_first_on =====
create or replace function private.tg_obligation_xor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_conflict boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.obligation:' || new.space_id));
  if tg_table_name = 'budgets' then
    if not new.wajib then
      return new;
    end if;
    select exists (
      select 1 from app.bills b
      join app.categories c on c.id = b.category_id
      where b.space_id = new.space_id and b.archived_at is null
        and coalesce(c.parent_id, c.id) = new.category_id
        and private.bill_due_in_label(b.space_id, b.day_of_month,
              private.bill_first_on(b.starts_on, b.created_at), b.ends_on, new.month)
    ) into v_conflict;
  else
    if new.archived_at is not null then
      return new;
    end if;
    -- Kunci baris kategori tagihan FOR SHARE sebelum membaca induknya (lihat 0117).
    perform 1 from app.categories c where c.id = new.category_id and c.space_id = new.space_id for share;
    select exists (
      select 1 from app.budgets bu
      join app.categories c on c.id = new.category_id
      where bu.space_id = new.space_id and bu.wajib
        and bu.category_id = coalesce(c.parent_id, c.id)
        and private.bill_due_in_label(new.space_id, new.day_of_month,
              private.bill_first_on(new.starts_on, new.created_at), new.ends_on, bu.month)
    ) into v_conflict;
  end if;
  if v_conflict then
    raise exception using errcode = 'DK422', message = 'obligation_double';
  end if;
  return new;
end $$;

-- ===== Materialisasi kemunculan (BSD §10) =====
create function private.materialize_bill(p_bill_id uuid, p_through date default null,
                                         p_from date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_b       app.bills%rowtype;
  v_first   date;
  v_through date;
  v_n       int;
begin
  select * into v_b from app.bills where id = p_bill_id for share;
  if v_b.id is null or v_b.archived_at is not null then
    return 0;
  end if;
  v_through := coalesce(p_through, (
    select n.ends_on from app.pay_period(v_b.space_id, app.today()) c
    cross join lateral app.pay_period(v_b.space_id, c.ends_on + 1) n));
  v_through := least(v_through, coalesce(v_b.ends_on, v_through));
  v_first := greatest(private.bill_first_on(v_b.starts_on, v_b.created_at), coalesce(p_from, '-infinity'::date));
  if v_first > v_through then
    return 0;
  end if;
  insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
  select v_b.space_id, v_b.id, d.due_on, v_b.amount
  from generate_series((v_first - (extract(day from v_first)::int - 1))::timestamp, v_through::timestamp,
                       interval '1 month') g
  cross join lateral (
    select g::date as m,
           least(g::date + (v_b.day_of_month - 1), (g + interval '1 month')::date - 1) as due_on
  ) d
  where d.due_on between v_first and v_through
    and not exists (select 1 from app.bill_occurrences o
                    where o.bill_id = v_b.id and o.due_on >= d.m
                      and o.due_on < (d.m + interval '1 month')::date)
  order by d.due_on
  on conflict (bill_id, due_on) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Job harian (worker, K3): semua tagihan aktif, batas bawaan per ruang (akhir periode berikutnya).
create function jobs.materialize_bills(p_through date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n  int := 0;
begin
  for v_id in select b.id from app.bills b where b.archived_at is null order by b.id loop
    v_n := v_n + private.materialize_bill(v_id, p_through);
  end loop;
  return v_n;
end $$;

-- ===== Validasi bersama create_bill/update_bill (INVOKER: RLS pemanggil dompetku_api) =====
create function private.check_bill(p_space_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_starts_on date, p_ends_on date, p_account_id uuid) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_c    app.categories%rowtype;
  v_a    app.accounts%rowtype;
begin
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  perform private.check_amount(p_amount, 'amount');
  if p_day_of_month is null or p_day_of_month not between 1 and 31 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'day_of_month';
  end if;
  if p_starts_on is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'starts_on';
  end if;
  if p_ends_on < p_starts_on then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'ends_on';
  end if;
  select * into v_c from app.categories c
   where c.id = p_category_id and c.space_id = p_space_id and c.type = 'expense';
  if v_c.id is null then
    raise exception using errcode = 'DK404', message = 'category_not_found', detail = 'category_id';
  end if;
  if v_c.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;
  if p_account_id is not null then
    select * into v_a from app.accounts a where a.id = p_account_id and a.space_id = p_space_id;
    if v_a.id is null then
      raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
    end if;
    if v_a.archived_at is not null then
      raise exception using errcode = 'DK422', message = 'account_archived';
    end if;
    if v_a.pocket = 'kantor' then
      raise exception using errcode = 'DK422', message = 'bill_account_kantor';
    end if;
  end if;
end $$;

-- ===== Tagihan: buat (BSD §9) =====
create function api.create_bill(
  p_client_id uuid, p_space_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_starts_on date, p_ends_on date default null,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_bill', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', btrim(p_name), 'amount', p_amount,
           'category', p_category_id, 'day', p_day_of_month, 'starts', p_starts_on,
           'ends', p_ends_on, 'account', p_account_id)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  perform private.check_bill(p_space_id, p_name, p_amount, p_category_id, p_day_of_month,
                             p_starts_on, p_ends_on, p_account_id);
  insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month,
                         starts_on, ends_on, created_by, created_at, updated_at)
  values (p_space_id, btrim(p_name), p_amount, p_category_id, p_account_id, p_day_of_month,
          p_starts_on, p_ends_on, v_uid, app.now(), app.now())
  returning id into v_id;
  perform private.materialize_bill(v_id);
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('bill_id', v_id));
end $$;

-- ===== Tagihan: ubah (ganti penuh; idempoten alami) =====
create function api.update_bill(p_bill_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_account_id uuid, p_ends_on date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_today date := app.today();
  v_b     app.bills%rowtype;
begin
  select * into v_b from app.bills where id = p_bill_id;
  if v_b.id is null then
    raise exception using errcode = 'DK404', message = 'bill_not_found';
  end if;
  perform app.assert_member(v_b.space_id);
  select * into v_b from app.bills where id = p_bill_id for update;
  if v_b.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'bill_archived';
  end if;
  perform private.check_bill(v_b.space_id, p_name, p_amount, p_category_id, p_day_of_month,
                             v_b.starts_on, p_ends_on, p_account_id);
  -- Terbuka = belum dibayar (tanpa entri hidup; entri bayar yang dibatalkan dihitung terbuka) dan
  -- belum dilewati.
  delete from app.bill_occurrences o
   where o.bill_id = v_b.id and o.skipped_at is null and o.due_on >= v_today
     and not private.occurrence_posted(o);
  update app.bills
     set name = btrim(p_name), amount = p_amount, category_id = p_category_id,
         day_of_month = p_day_of_month, account_id = p_account_id, ends_on = p_ends_on,
         updated_at = app.now()
   where id = v_b.id;
  perform private.materialize_bill(v_b.id, null, v_today - (extract(day from v_today)::int - 1));
  return jsonb_build_object('bill_id', v_b.id);
end $$;

-- ===== Tagihan: arsip (BSD §9; idempoten alami) =====
create function api.archive_bill(p_bill_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_b   app.bills%rowtype;
  v_n   int;
begin
  select * into v_b from app.bills where id = p_bill_id;
  if v_b.id is null then
    raise exception using errcode = 'DK404', message = 'bill_not_found';
  end if;
  perform app.assert_member(v_b.space_id);
  select * into v_b from app.bills where id = p_bill_id for update;
  if v_b.archived_at is null then
    update app.bills set archived_at = app.now(), updated_at = app.now() where id = v_b.id;
  end if;
  -- Tautan ke entri bayar yang dibatalkan dilepas (CHECK entry_id XOR skipped_at).
  update app.bill_occurrences o set skipped_at = app.now(), entry_id = null
   where o.bill_id = v_b.id and o.skipped_at is null and not private.occurrence_posted(o);
  get diagnostics v_n = row_count;
  return jsonb_build_object('bill_id', v_b.id, 'skipped', v_n);
end $$;

-- Kunci tagihan (FOR SHARE) lalu kemunculan (FOR UPDATE) sesudah keanggotaan terbukti; kembalikan
-- kemunculan versi terbaru. Dipakai bayar/lewati/batalkan lewati (urutan kunci sama dengan ubah/arsip).
create function private.lock_occurrence(p_occurrence_id uuid) returns app.bill_occurrences
language plpgsql set search_path = '' as $$
declare v_o app.bill_occurrences%rowtype;
begin
  select * into v_o from app.bill_occurrences where id = p_occurrence_id;
  if v_o.id is null then
    raise exception using errcode = 'DK404', message = 'bill_not_found';
  end if;
  perform app.assert_member(v_o.space_id);
  perform 1 from app.bills b where b.id = v_o.bill_id and b.space_id = v_o.space_id for share;
  select * into v_o from app.bill_occurrences where id = p_occurrence_id for update;
  if v_o.id is null then
    raise exception using errcode = 'DK404', message = 'bill_not_found';
  end if;
  if exists (select 1 from app.bills b where b.id = v_o.bill_id and b.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'bill_archived';
  end if;
  return v_o;
end $$;

-- true bila kemunculan sudah dibayar (entri tertaut hidup).
create function private.occurrence_posted(p_o app.bill_occurrences) returns boolean
language sql stable set search_path = '' as $$
  select p_o.entry_id is not null
     and exists (select 1 from app.entries e where e.id = p_o.entry_id and e.voided_at is null)
$$;

-- ===== Bayar tagihan = pengeluaran berkategori tagihan, ditautkan ke kemunculannya (BSD §9, K12) =====
create function api.post_bill_occurrence(
  p_client_id uuid, p_occurrence_id uuid, p_account_id uuid default null,
  p_occurred_on date default null, p_allow_negative boolean default false,
  p_amount bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_o   app.bill_occurrences%rowtype;
  v_b   app.bills%rowtype;
  v_acc app.accounts%rowtype;
  v_res jsonb;
  v_r   jsonb;
begin
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'post_bill_occurrence', private.req_hash(
           jsonb_build_object('occurrence', p_occurrence_id, 'account', p_account_id,
                              'on', p_occurred_on, 'amount', p_amount)));
  if v_r is not null then
    return v_r;
  end if;
  if p_amount is not null then
    perform private.check_amount(p_amount, 'amount');
  end if;
  perform private.check_date(p_occurred_on);
  v_o := private.lock_occurrence(p_occurrence_id);
  if v_o.skipped_at is not null or private.occurrence_posted(v_o) then
    raise exception using errcode = 'DK422', message = 'already_posted';
  end if;
  select * into v_b from app.bills where id = v_o.bill_id;
  select * into v_acc from app.accounts a
   where a.id = coalesce(p_account_id, v_b.account_id) and a.space_id = v_o.space_id;
  if coalesce(p_account_id, v_b.account_id) is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  elsif v_acc.id is null then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
  elsif v_acc.pocket = 'kantor' then
    raise exception using errcode = 'DK422', message = 'bill_account_kantor';
  end if;
  -- client_id turunan acak: kunci entri unik per pembayaran; replay dijaga kunci luar.
  v_res := api.create_entry(
    p_client_id      => gen_random_uuid(),
    p_space_id       => v_o.space_id,
    p_account_id     => v_acc.id,
    p_kind           => 'expense',
    p_amount         => coalesce(p_amount, v_o.amount),
    p_category_id    => v_b.category_id,
    p_occurred_on    => p_occurred_on,
    p_description    => v_b.name,
    p_allow_negative => p_allow_negative);
  update app.bill_occurrences set entry_id = (v_res ->> 'entry_id')::uuid where id = v_o.id;
  return private.idem_finish(v_uid, p_client_id, (v_res - 'replayed')
    || jsonb_build_object('occurrence_id', v_o.id));
end $$;

-- ===== Lewati / batalkan lewati (K4; idempoten alami) =====
create function api.skip_bill_occurrence(p_occurrence_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_o   app.bill_occurrences%rowtype;
begin
  v_o := private.lock_occurrence(p_occurrence_id);
  if private.occurrence_posted(v_o) then
    raise exception using errcode = 'DK422', message = 'already_posted';
  end if;
  if v_o.skipped_at is null then
    update app.bill_occurrences set skipped_at = app.now(), entry_id = null where id = v_o.id;
  end if;
  return jsonb_build_object('occurrence_id', v_o.id, 'skipped', true);
end $$;

create function api.unskip_bill_occurrence(p_occurrence_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_o   app.bill_occurrences%rowtype;
begin
  v_o := private.lock_occurrence(p_occurrence_id);
  if private.occurrence_posted(v_o) then
    raise exception using errcode = 'DK422', message = 'already_posted';
  end if;
  if v_o.skipped_at is not null then
    update app.bill_occurrences set skipped_at = null where id = v_o.id;
  end if;
  return jsonb_build_object('occurrence_id', v_o.id, 'skipped', false);
end $$;

-- ===== Baca (SECURITY INVOKER: RLS tetap berlaku) =====
-- Semua tagihan ruang; berikutnya = kemunculan belum dibayar dan belum dilewati paling awal (termasuk
-- yang lewat jatuh tempo); tagihan terarsip tanpa berikutnya. Urut: aktif dulu, jatuh tempo, nama.
create function api.bill_list(p_space_id uuid)
returns table (bill_id uuid, name text, amount bigint, category_id uuid, account_id uuid,
               day_of_month smallint, starts_on date, ends_on date, archived boolean,
               next_due_on date, next_occurrence_id uuid)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select b.id, b.name, b.amount, b.category_id, b.account_id, b.day_of_month, b.starts_on, b.ends_on,
         b.archived_at is not null, n.due_on, n.id
  from app.bills b
  left join lateral (
    select s.id, s.due_on from app.bill_schedule s
    where s.bill_id = b.id and not s.posted and s.skipped_at is null
    order by s.due_on limit 1
  ) n on b.archived_at is null
  where b.space_id = p_space_id
  order by b.archived_at is not null, n.due_on nulls last, b.name, b.id;
end $$;

-- Kemunculan tagihan aktif: belum dibayar dan belum dilewati dengan jatuh tempo <= p_through
-- (termasuk lewat), ditambah yang dibayar/dilewati dengan jatuh tempo dari awal periode gajian
-- berjalan s.d. p_through (tampilan Lunas/Dilewati). p_through kosong = akhir periode berjalan.
create function api.bills_due(p_space_id uuid, p_through date default null)
returns table (occurrence_id uuid, bill_id uuid, name text, amount bigint, due_on date,
               days_until int, overdue boolean, posted boolean, skipped boolean, entry_id uuid)
language plpgsql stable set search_path = '' as $$
declare
  v_today date;
  v_start date;
  v_end   date;
begin
  perform app.assert_member(p_space_id);
  v_today := app.today();
  select p.starts_on, p.ends_on into v_start, v_end from app.pay_period(p_space_id, v_today) p;
  v_end := coalesce(p_through, v_end);
  return query
  select s.id, s.bill_id, s.name,
         case when s.posted
              then coalesce((select -l.amount from app.entry_lines l
                             where l.entry_id = o.entry_id and l.role = 'main'), s.amount)
              else s.amount end,
         s.due_on, s.due_on - v_today,
         not s.posted and s.skipped_at is null and s.due_on < v_today,
         s.posted, s.skipped_at is not null, o.entry_id
  from app.bill_schedule s
  join app.bill_occurrences o on o.id = s.id
  where s.space_id = p_space_id and not s.bill_archived and s.due_on <= v_end
    and ((not s.posted and s.skipped_at is null) or s.due_on >= v_start)
  order by s.due_on, s.name, s.id;
end $$;

-- ===== Hak =====
-- update_bill menghapus kemunculan terbuka lalu materialisasi ulang (dipagari policy member_write).
grant delete on app.bill_occurrences to dompetku_api;
grant execute on function private.materialize_bill(uuid, date, date), private.check_bill(uuid, text,
  bigint, uuid, smallint, date, date, uuid), private.lock_occurrence(uuid),
  private.occurrence_posted(app.bill_occurrences) to dompetku_api;
grant execute on function jobs.materialize_bills(date) to dompetku_worker;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
revoke delete on app.bill_occurrences from dompetku_api;
drop function api.bills_due(uuid, date);
drop function api.bill_list(uuid);
drop function api.unskip_bill_occurrence(uuid);
drop function api.skip_bill_occurrence(uuid);
drop function api.post_bill_occurrence(uuid, uuid, uuid, date, boolean, bigint);
drop function private.occurrence_posted(app.bill_occurrences);
drop function private.lock_occurrence(uuid);
drop function api.archive_bill(uuid);
drop function api.update_bill(uuid, text, bigint, uuid, smallint, uuid, date);
drop function api.create_bill(uuid, uuid, text, bigint, uuid, smallint, date, date, uuid);
drop function private.check_bill(uuid, text, bigint, uuid, smallint, date, date, uuid);
drop function jobs.materialize_bills(date);
drop function private.materialize_bill(uuid, date, date);

-- tg_obligation_xor kembali ke versi 0117 (starts_on mentah).
create or replace function private.tg_obligation_xor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_conflict boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.obligation:' || new.space_id));
  if tg_table_name = 'budgets' then
    if not new.wajib then
      return new;
    end if;
    select exists (
      select 1 from app.bills b
      join app.categories c on c.id = b.category_id
      where b.space_id = new.space_id and b.archived_at is null
        and coalesce(c.parent_id, c.id) = new.category_id
        and private.bill_due_in_label(b.space_id, b.day_of_month, b.starts_on, b.ends_on, new.month)
    ) into v_conflict;
  else
    if new.archived_at is not null then
      return new;
    end if;
    -- Tambahan atas BSD §7: kunci baris kategori tagihan sebelum membaca induknya. Pindah induk
    -- (update_category mengunci FOR UPDATE; UPDATE langsung mengunci baris sebelum trigger) yang
    -- belum commit membuat tagihan ini menunggu, lalu kueri di bawah (snapshot baru, READ
    -- COMMITTED) membandingkan dengan induk BARU. Sebaliknya, tagihan yang belum commit menahan
    -- pindah induk sampai tg_category_depth bisa melihatnya (category_in_obligation). FOR SHARE,
    -- bukan FOR KEY SHARE: pindah anak ke induk lain tidak mengubah kolom kunci (NO KEY UPDATE).
    -- Pemindah kategori tidak mengambil kunci kewajiban, jadi urutan ini tanpa deadlock. Hanya
    -- baris ruang yang sama: kategori ruang lain tidak pernah dikunci (FK komposit menolaknya).
    perform 1 from app.categories c where c.id = new.category_id and c.space_id = new.space_id for share;
    select exists (
      select 1 from app.budgets bu
      join app.categories c on c.id = new.category_id
      where bu.space_id = new.space_id and bu.wajib
        and bu.category_id = coalesce(c.parent_id, c.id)
        and private.bill_due_in_label(new.space_id, new.day_of_month, new.starts_on, new.ends_on, bu.month)
    ) into v_conflict;
  end if;
  if v_conflict then
    raise exception using errcode = 'DK422', message = 'obligation_double';
  end if;
  return new;
end $$;
drop function private.bill_first_on(date, timestamptz);
