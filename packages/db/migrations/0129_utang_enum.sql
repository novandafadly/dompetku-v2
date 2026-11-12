-- migrate:up
-- S11 (plan S11 Task 2, BSD:2636): dua nilai enum untuk utang/piutang. File sendiri karena nilai
-- enum baru tidak boleh dipakai di transaksi yang sama dengan ALTER TYPE ... ADD VALUE (dbmate
-- menjalankan tiap migrasi dalam transaksinya sendiri); pemakaiannya mulai 0130. Sampai 0130,
-- private.assert_entry_shape menolak kedua kind ini (cabang `else false`).
alter type app.entry_kind add value if not exists 'debt_principal';
alter type app.entry_kind add value if not exists 'debt_payment';

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
-- Postgres tidak bisa menghapus label enum; label ikut hilang saat 0100 di-rollback (drop type).
-- `if not exists` di atas membuat up ulang sesudah rollback parsial tetap lolos.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
