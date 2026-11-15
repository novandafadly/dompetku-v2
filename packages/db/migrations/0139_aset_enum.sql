-- migrate:up
-- S14 (plan S14 Task 2, K3): dua nilai enum aset. Pocket `aset` = dompet aset non-kas (emas,
-- properti, kendaraan, reksa dana, deposito, saham, lainnya; rincian di app.asset_details 0140),
-- entry_kind `valuation` = perubahan nilai aset (kelas laporan x_valuasi, bukan pemasukan/
-- pengeluaran). File sendiri karena nilai enum baru tidak boleh dipakai di transaksi yang sama
-- dengan ALTER TYPE ... ADD VALUE (dbmate menjalankan tiap migrasi dalam transaksinya sendiri).
-- Sampai 0140, `valuation` ditolak assert_entry_shape (cabang else) dan api.create_account
-- menerima `aset` tanpa penjaga; 0140 memasang penjaga dompet aset, api 0141.
alter type app.pocket add value if not exists 'aset';
alter type app.entry_kind add value if not exists 'valuation';

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
