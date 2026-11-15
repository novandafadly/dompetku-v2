-- migrate:up
-- S12 (plan S12 Task 4, K2; bingkai S12-ADR1): dua nilai enum kantong dompet. `trading` untuk
-- modal trading (hanya Pribadi, 0134), `patungan` untuk dompet sistem bagi tagihan Bersama
-- (S12-ADR1 opsi C, dipakai mulai 0135). File sendiri karena nilai enum baru tidak boleh dipakai di
-- transaksi yang sama dengan ALTER TYPE ... ADD VALUE (dbmate menjalankan tiap migrasi dalam
-- transaksinya sendiri). Sampai 0134, api.create_account menerima `trading` di ruang mana pun dan
-- `patungan` tanpa penjaga; 0134 menutup keduanya.
alter type app.pocket add value if not exists 'trading';
alter type app.pocket add value if not exists 'patungan';

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
