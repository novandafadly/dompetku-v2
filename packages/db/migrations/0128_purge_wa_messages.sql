-- migrate:up
-- S10 (plan S10 Task 9, K7; handoff wa.md "Data dan DB"): retensi app.wa_messages. Expand-only:
-- satu fungsi job baru.
--
-- jobs.purge_wa_messages(): hapus baris pesan WhatsApp yang lebih tua dari 14 hari, apa pun statusnya.
-- Dedupe pesan (wa_claim_message) hanya berlaku selama baris ada, jadi jaminan "tidak ada catatan ganda"
-- bertumpu pada DUA lapis di luar tabel ini: (1) web mengabaikan pesan yang data.timestamp-nya lebih
-- tua dari 7 hari (handle.ts MAX_MESSAGE_AGE_SECONDS, di bawah 14 hari); (2) untuk pesan 7-14 hari yang
-- baris dedupe-nya sudah tiada, createEntry memakai client_id turunan id pesan dan kunci idempotensi
-- ledger (30 hari, jobs.purge_idempotency) mengembalikan entri yang sama. Tanpa lapis (1) pesan yang
-- dikirim ulang sesudah hari ke-30 akan tercatat ganda. Jendela `batal` (10 menit) jauh di dalam 14
-- hari. Baris `pending` yang tak pernah selesai ikut dihapus (tak ada gunanya disimpan; entri, bila
-- sempat dibuat, tetap ditemukan lewat idempotensi). DEFINER milik dompetku_owner (BYPASSRLS;
-- wa_messages ber-RLS FORCE tanpa policy owner), EXECUTE hanya dompetku_worker; mengembalikan jumlah
-- baris terhapus (job_runs.rows). Idempoten.
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
