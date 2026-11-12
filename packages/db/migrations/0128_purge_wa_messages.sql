-- migrate:up
-- S10 (plan S10 Task 9, K7; handoff wa.md "Data dan DB"): retensi app.wa_messages. Expand-only:
-- satu fungsi job baru.
--
-- jobs.purge_wa_messages(): hapus baris pesan WhatsApp yang lebih tua dari 14 hari, apa pun statusnya.
-- 14 hari sengaja di dalam retensi idempotensi ledger (30 hari, jobs.purge_idempotency): pesan lama yang
-- diputar ulang sesudah baris dihapus diklaim baru, tetapi createEntry memakai client_id turunan id
-- pesan, jadi kunci idempotensi yang masih ada mengembalikan entri yang sama (tidak ada catatan ganda).
-- Jendela `batal` (10 menit) jauh di dalam 14 hari. Baris `pending` yang tak pernah selesai ikut
-- dihapus (kalau tidak ia menjadi "catatan terakhir" abadi yang memblokir `batal`, wa_last_cancellable).
-- DEFINER milik dompetku_owner (BYPASSRLS; wa_messages ber-RLS FORCE tanpa policy owner), EXECUTE hanya
-- dompetku_worker; mengembalikan jumlah baris terhapus (job_runs.rows). Idempoten.
create function jobs.purge_wa_messages() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  delete from app.wa_messages m where m.created_at < app.now() - interval '14 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function jobs.purge_wa_messages() to dompetku_worker;

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function jobs.purge_wa_messages();
