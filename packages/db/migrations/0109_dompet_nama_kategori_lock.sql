-- migrate:up
-- S7 (IPD §4): nama dompet unik per ruang dan kunci urut api.archive_category. Expand-only.
-- - app.accounts_name_unique: nama dompet aktif unik per ruang, tanpa beda huruf besar/spasi tepi
--   (lower(btrim(name))). Dompet terarsip tidak ikut, jadi nama bisa dipakai lagi sesudah arsip.
--   Server memetakan 23505 dari indeks ini ke name_taken (nama indeks = kontrak).
-- - api.archive_category: induk dan anak-anaknya dikunci dalam satu select ... order by id for update
--   sebelum update. Versi 0106 mengunci induk lalu meng-update anak dalam urutan tak terkendali,
--   sementara api.update_category(anak, induk) mengunci {anak, induk} urut id; dengan
--   anak.id < induk.id keduanya bisa saling tunggu (40P01). Tanda tangan dan hasil tetap.

-- ===== Nama dompet unik per ruang =====
-- Data lama dengan nama ganda membuat create unique index gagal dengan 23505 yang memuat nama di
-- detail. Ditolak lebih dulu dengan DK500 tanpa nama; detail = jumlah grup ganda. Cek sebelum rilis:
-- docs/superpowers/handoff/cek-duplikat-dompet-0109.sh.
-- Tabel dikunci SHARE (menolak tulis, baca tetap jalan) sampai akhir transaksi migrasi (dbmate
-- membungkus berkas ini dalam satu transaksi; tanpa transaction:false), sehingga tidak ada dompet
-- baru yang lolos di antara cek dan create unique index.
lock table app.accounts in share mode;
do $$
declare v_n int;
begin
  select count(*) into v_n from (
    select 1 from app.accounts
     where archived_at is null
     group by space_id, lower(btrim(name))
    having count(*) > 1) d;
  if v_n > 0 then
    raise exception using errcode = 'DK500', message = 'duplicate_account_names', detail = v_n::text;
  end if;
end $$;

create unique index accounts_name_unique on app.accounts (space_id, lower(btrim(name)))
  where archived_at is null;

-- ===== Kategori: arsip (0106 + kunci urut id) =====
-- affected = jumlah baris yang berubah (panggilan kedua = 0). Entri lama tetap memakai kategorinya.
-- Kunci: kategori + semua anaknya (aktif atau tidak) di ruang yang sama, urut id, sama dengan
-- urutan api.update_category. Anak yang baru dipindah ke bawah kategori ini oleh transaksi lain
-- yang sudah commit tetap ikut terarsip: update di bawah memakai snapshot baru (READ COMMITTED).
create or replace function api.archive_category(p_category_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_c   app.categories%rowtype;
  v_n   int;
begin
  select * into v_c from app.categories where id = p_category_id;
  if v_c.id is null or not (v_c.space_id = any (app.my_space_ids())) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  perform 1 from app.categories
    where space_id = v_c.space_id and (id = v_c.id or parent_id = v_c.id)
    order by id
    for update;
  update app.categories
     set archived_at = app.now()
   where space_id = v_c.space_id and (id = v_c.id or parent_id = v_c.id) and archived_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('category_id', v_c.id, 'archived', true, 'affected', v_n);
end $$;

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

drop index app.accounts_name_unique;

-- api.archive_category kembali ke definisi 0106.
create or replace function api.archive_category(p_category_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_c   app.categories%rowtype;
  v_n   int;
begin
  select * into v_c from app.categories where id = p_category_id for update;
  if v_c.id is null or not (v_c.space_id = any (app.my_space_ids())) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  update app.categories
     set archived_at = app.now()
   where space_id = v_c.space_id and (id = v_c.id or parent_id = v_c.id) and archived_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('category_id', v_c.id, 'archived', true, 'affected', v_n);
end $$;

select private.own_api_functions();
