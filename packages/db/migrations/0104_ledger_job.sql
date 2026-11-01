-- migrate:up
-- BSD §10, bagian S5: job purge entri batal dan kunci idempotensi, cek kualitas data
-- (DQ01, DQ04, DQ04b, DQ06, DQ09, DQ10). Disalin persis dari BSD. Job milik dompetku_owner
-- (DEFINER), EXECUTE hanya dompetku_worker; dq_run dan dq_reconcile dipindah ke
-- dompetku_auditor di 0105. jobs.materialize_bills menyusul bersama tabel tagihan (S9).

-- Purge entri batal > 90 hari: tombstone dulu, lalu hapus (lines + history ikut cascade).
create function jobs.purge_voided() returns int
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

create function jobs.purge_idempotency() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  delete from app.idempotency_keys where created_at < app.now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ===== Cek kualitas data (milik dompetku_auditor, keluaran tanpa nominal) =====
create function private.dq_run()
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
  -- DQ09 line menunjuk akun ruang lain
  select 'DQ09', 'error', count(*)::int from app.entry_lines l
  join app.accounts a on a.id = l.account_id where a.space_id <> l.space_id
  union all
  -- DQ10 purge macet
  select 'DQ10', 'warn', count(*)::int from app.entries e
  where e.voided_at < app.now() - interval '97 days'
$$;

create function jobs.dq_reconcile()
returns table (check_id text, severity text, violations int)
language sql security definer set search_path = '' as $$
  select * from private.dq_run()
$$;

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function jobs.dq_reconcile();
drop function private.dq_run();
drop function jobs.purge_idempotency();
drop function jobs.purge_voided();
