-- migrate:up
-- S7 (review akhir M2): jobs.purge_voided dua lintasan. Definisi 0104 memilih kandidat sebelum
-- reimburse batal dihapus, jadi talangan batal (atau dipindah, 0111) yang hanya dirujuk reimburse
-- batal baru terhapus satu siklus (Senin) kemudian. Umurnya bisa mencapai ±104 hari, melewati
-- ambang DQ10 (97 hari, warn = /fail ke pemilik) padahal purge tidak macet.
-- Lintasan 2 mengulang pemilihan yang sama sesudah lintasan 1 menghapus reimburse batal; dalam satu
-- transaksi, jadi lintasan 2 melihat hapusan lintasan 1. Satu lintasan tambahan cukup: reimburse
-- tidak pernah dirujuk entri lain, jadi rantai dependen paling dalam dua tingkat.
-- Urutan hapus aman terhadap FK reimburses_entry_id: reimburse terhapus di lintasan 1, talangan di
-- lintasan 2 (talangan yang masih dirujuk reimburse mana pun tetap tidak terpilih). Tombstone tetap
-- dari private.purge_entries (baris yang benar-benar terhapus). Kunci: tiap lintasan mengunci
-- kandidatnya urut id; pulihkan reimburse paralel (kunci reimburse lalu talangan) tidak bisa
-- deadlock karena talangan baru dikunci lintasan 2 sesudah reimburse-nya terhapus.
-- Audit: satu event `purge_voided` per lintasan yang menghapus (count per lintasan).
-- Pemilik, SECURITY DEFINER, search_path, dan EXECUTE (owner, dompetku_worker) tetap (CREATE OR
-- REPLACE oleh owner mempertahankan ACL).
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

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

-- jobs.purge_voided kembali ke definisi 0104 (satu lintasan).
create or replace function jobs.purge_voided() returns int
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
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
  return private.purge_entries(v_ids, 'purge_voided');
end $$;
