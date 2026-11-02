import { Button } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons/plus';

/** Tombol Tambah dompet (header laptop, isi halaman, keadaan kosong); pemanggil memegang aksinya. */
export function AddWalletButton({
  onAdd,
  onPreload,
  className = '',
}: {
  onAdd: () => void;
  /** Pointer/fokus: muat lebih awal kode sheet yang dimuat malas. */
  onPreload?: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      onClick={onAdd}
      onPointerEnter={onPreload}
      onFocus={onPreload}
      className={className}
    >
      <PlusIcon size={18} weight="bold" />
      Tambah dompet
    </Button>
  );
}
