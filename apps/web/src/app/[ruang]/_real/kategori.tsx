import { ErrorState } from '@/components/ui/state';
import { KATEGORI_TITLE_ID } from '@/features/kategori/ids';
import type { CategoryVM, Ruang } from '@/features/ledger/types';
import { RUANG_LABEL } from '@/features/shell/hrefs';
import { KategoriBackIsland, KategoriManagerIsland } from './kategori-islands';
import { RetryIsland } from './transaksi-islands';

/** Lebar isi (S6-K1): tablet maks 720 (dari shell), laptop maks 720, satu kolom. */
const KATEGORI_WIDTH = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6';

function KategoriHeader({ ruang }: { ruang: Ruang }) {
  return (
    <>
      <KategoriBackIsland ruang={ruang} />
      <h1
        id={KATEGORI_TITLE_ID}
        tabIndex={-1}
        className="text-headline font-extrabold text-text outline-none laptop:text-title-lg"
      >
        {`Kategori · ${RUANG_LABEL[ruang]}`}
      </h1>
    </>
  );
}

/**
 * Kategori mode nyata (Server Component): header dirender di server; daftar, sheet tambah/ubah, dan
 * dialog arsip adalah pulau klien yang dimuat malas. Data = kategori aktif ruang ini saja.
 */
export function KategoriReal({ ruang, categories }: { ruang: Ruang; categories: CategoryVM[] }) {
  return (
    <section className={KATEGORI_WIDTH}>
      <KategoriHeader ruang={ruang} />
      <KategoriManagerIsland ruang={ruang} categories={categories} />
    </section>
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function KategoriFailed({ ruang }: { ruang: Ruang }) {
  return (
    <section className={KATEGORI_WIDTH}>
      <KategoriHeader ruang={ruang} />
      <ErrorState
        title="Kategori belum bisa dimuat."
        description="Periksa koneksi lalu coba lagi."
        actions={<RetryIsland />}
      />
    </section>
  );
}
